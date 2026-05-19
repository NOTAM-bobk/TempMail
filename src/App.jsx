import { useState, useEffect, useRef, useCallback, memo } from "react";

// ─── Worker URL ───────────────────────────────────────────────────────────────
// Set VITE_AUTH_WORKER_URL in your .env file:
//   VITE_AUTH_WORKER_URL=https://burnermail-auth.<your-subdomain>.workers.dev
const WORKER = import.meta.env.VITE_AUTH_WORKER_URL || "";

// ─── Cookie helpers ───────────────────────────────────────────────────────────
const Cookies = {
  set(name, value, days = 30) {
    const exp = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(JSON.stringify(value))};expires=${exp};path=/;SameSite=Lax`;
  },
  get(name) {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    if (!match) return null;
    try { return JSON.parse(decodeURIComponent(match[1])); } catch { return null; }
  },
  del(name) {
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
  },
};

// ─── Rate limiter ─────────────────────────────────────────────────────────────
const RateLimit = {
  check(key, limitMs) {
    const last = parseInt(localStorage.getItem(key) || "0", 10);
    return Date.now() - last < limitMs ? limitMs - (Date.now() - last) : 0;
  },
  mark(key) { localStorage.setItem(key, Date.now()); },
};

const NEW_ADDR_LIMIT = 60_000;
const REFRESH_LIMIT  = 10_000;

// ─── Mail.tm API ──────────────────────────────────────────────────────────────
const API = "https://api.mail.tm";

async function apiFetch(path, opts = {}, token = null) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(API + path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e["hydra:description"] || e.message || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Cloudflare Worker API ────────────────────────────────────────────────────
const workerFetch = async (path, opts = {}, token = null) => {
  if (!WORKER) throw new Error("VITE_AUTH_WORKER_URL not set");
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(WORKER + path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function rand(n = 10) {
  return Array.from({ length: n }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso);
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString())
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(31, h) + s.charCodeAt(i) | 0;
  return Math.abs(h);
}

// ─── Icons ────────────────────────────────────────────────────────────────────
const Icon = {
  Inbox: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
    </svg>
  ),
  Guide: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  Settings: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  ),
  Copy: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  ),
  Refresh: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10" /><path d="M3.5 15a9 9 0 102.8-4.8L1 10" />
    </svg>
  ),
  New: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  Back: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  ),
  Mail: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  ),
  Delete: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
    </svg>
  ),
  Check: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  Shield: ({ size = 32 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  Clock: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  Edit: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  ),
  Star: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  StarFilled: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  Archive: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="21 8 21 21 3 21 3 8" /><rect x="1" y="3" width="22" height="5" /><line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  ),
  MarkRead: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  Download: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  Search: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  Hamburger: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  ),
  Close: ({ size = 16 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  SwitchHoriz: ({ size = 13 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/>
    </svg>
  ),
  User: ({ size = 15 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
    </svg>
  ),
  LogOut: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  ),
  Cloud: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/>
    </svg>
  ),
};

// ─── Animated spotlight background ───────────────────────────────────────────
function SpotlightBg({ theme }) {
  const ref = useRef(null);
  const colorRef = useRef({ t: 0 });
  const lightMode = theme === "light";
  const brutalist = theme === "brutalist";

  useEffect(() => {
    if (brutalist) return; // brutalist has its own static bg
    const el = ref.current;
    let mx = 50, my = 40;
    let animFrame;
    const move = (e) => { mx = e.clientX / window.innerWidth * 100; my = e.clientY / window.innerHeight * 100; };
    window.addEventListener("mousemove", move);
    const tick = () => {
      const c = colorRef.current;
      c.t += 0.003;
      const orbX = 50 + Math.sin(c.t * 0.7) * 30 + Math.cos(c.t * 0.4) * 15;
      const orbY = 40 + Math.cos(c.t * 0.5) * 25 + Math.sin(c.t * 0.3) * 12;
      const finalX = orbX * 0.7 + mx * 0.3;
      const finalY = orbY * 0.7 + my * 0.3;
      const hue = 220 + Math.sin(c.t * 0.4) * 60;
      const hue2 = 260 + Math.cos(c.t * 0.3) * 50;
      const hue3 = 200 + Math.sin(c.t * 0.25) * 40;
      const a1 = lightMode ? 0.08 : 0.13;
      const a2 = lightMode ? 0.06 : 0.10;
      const a3 = lightMode ? 0.05 : 0.09;
      el.style.setProperty("--mx", finalX + "%");
      el.style.setProperty("--my", finalY + "%");
      el.style.setProperty("--orb1-color", `hsla(${hue},80%,65%,${a1})`);
      el.style.setProperty("--orb2-color", `hsla(${hue2},75%,60%,${a2})`);
      el.style.setProperty("--orb3-color", `hsla(${hue3},70%,55%,${a3})`);
      animFrame = requestAnimationFrame(tick);
    };
    animFrame = requestAnimationFrame(tick);
    return () => { window.removeEventListener("mousemove", move); cancelAnimationFrame(animFrame); };
  }, [lightMode, brutalist]);

  if (brutalist) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 0, background: "#f5f0e8", backgroundImage: "radial-gradient(circle at 20% 20%, #ffe4b5 0%, transparent 50%), radial-gradient(circle at 80% 80%, #ffd6e7 0%, transparent 50%)" }} />
    );
  }

  return (
    <div ref={ref} style={{ position: "fixed", inset: 0, zIndex: 0, overflow: "hidden", "--mx": "50%", "--my": "40%", "--orb1-color": "rgba(99,102,241,0.13)", "--orb2-color": "rgba(139,92,246,0.10)", "--orb3-color": "rgba(59,130,246,0.09)" }}>
      <div style={{ position: "absolute", inset: 0, background: lightMode ? "radial-gradient(ellipse 120% 80% at 50% 0%, #f0f0ff 0%, #e8eaf6 100%)" : "radial-gradient(ellipse 120% 80% at 50% 0%, #0d0d1a 0%, #060610 100%)", transition: "background 0.4s ease" }} />
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle 700px at var(--mx) var(--my), var(--orb1-color) 0%, transparent 70%)" }} />
      <div style={{ position: "absolute", width: 800, height: 800, top: -200, left: -150, background: "radial-gradient(circle, var(--orb2-color) 0%, transparent 65%)", borderRadius: "50%", animation: "orb1 18s ease-in-out infinite alternate" }} />
      <div style={{ position: "absolute", width: 700, height: 700, bottom: -150, right: -100, background: "radial-gradient(circle, var(--orb3-color) 0%, transparent 65%)", borderRadius: "50%", animation: "orb2 22s ease-in-out infinite alternate" }} />
      <div style={{ position: "absolute", width: 500, height: 500, top: "40%", left: "60%", background: "radial-gradient(circle, rgba(244,114,182,0.06) 0%, transparent 65%)", borderRadius: "50%", animation: "orb3 14s ease-in-out infinite alternate" }} />
      <div className="scanlines" />
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px)", backgroundSize: "60px 60px" }} />
      <style>{`
        @keyframes orb1 { from { transform: translate(0,0) scale(1); } to { transform: translate(120px,80px) scale(1.2); } }
        @keyframes orb2 { from { transform: translate(0,0) scale(1); } to { transform: translate(-90px,-100px) scale(1.15); } }
        @keyframes orb3 { from { transform: translate(0,0) scale(1) rotate(0deg); } to { transform: translate(-60px,80px) scale(1.3) rotate(45deg); } }
        .scanlines { position:absolute; inset:0; background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.03) 2px,rgba(0,0,0,0.03) 4px); pointer-events:none; z-index:1; }
      `}</style>
    </div>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ toasts, brutalist }) {
  return (
    <div style={{ position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)", zIndex: 9999, display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
      {toasts.map(t => (
        <div key={t.id} style={brutalist ? {
          background: "#111", color: t.type === "error" ? "#ff3333" : t.type === "success" ? "#00aa44" : "#111",
          padding: "10px 20px", border: "2.5px solid #111", borderRadius: 0,
          fontFamily: "var(--font-mono)", fontSize: 13,
          boxShadow: "4px 4px 0 #111",
          animation: "toastIn 0.2s ease",
          whiteSpace: "nowrap",
        } : {
          background: "rgba(18,18,32,0.95)", backdropFilter: "blur(20px)",
          border: `1px solid ${t.type === "error" ? "rgba(248,113,113,0.4)" : t.type === "success" ? "rgba(74,222,128,0.4)" : "rgba(255,255,255,0.12)"}`,
          color: t.type === "error" ? "#f87171" : t.type === "success" ? "#4ade80" : "#e2e8f0",
          padding: "10px 20px", borderRadius: 12, fontSize: 13, fontFamily: "var(--font-mono)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          animation: "toastIn 0.3s cubic-bezier(0.34,1.56,0.64,1)",
          whiteSpace: "nowrap",
        }}>
          {t.msg}
        </div>
      ))}
      <style>{`@keyframes toastIn { from { opacity:0; transform:translateY(16px) scale(0.9); } to { opacity:1; transform:none; } }`}</style>
    </div>
  );
}

// ─── Loading screen ───────────────────────────────────────────────────────────
const LOADING_PHRASES = ["SETTING UP YOUR INBOX…","SPAWNING A FRESH ADDRESS…","WARMING UP THE SERVERS…","ALMOST THERE…","JUST A MOMENT…"];

function LoadingScreen({ onDone }) {
  const TOTAL = 5;
  const [count, setCount] = useState(TOTAL);
  const [phase, setPhase] = useState("loading");
  const [phraseIdx, setPhraseIdx] = useState(0);

  useEffect(() => {
    const pi = setInterval(() => setPhraseIdx(i => (i + 1) % LOADING_PHRASES.length), 1800);
    return () => clearInterval(pi);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setCount(c => { if (c <= 1) { clearInterval(interval); setPhase("ready"); return 0; } return c - 1; });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (phase === "ready") { const t = setTimeout(onDone, 600); return () => clearTimeout(t); }
  }, [phase, onDone]);

  const pct = ((TOTAL - count) / TOTAL) * 283;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "radial-gradient(ellipse 120% 80% at 50% 0%, #0d0d1a 0%, #060610 100%)", transition: "opacity 0.6s ease", opacity: phase === "ready" ? 0 : 1 }}>
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
        <div style={{ position: "absolute", width: 600, height: 600, top: "10%", left: "20%", background: "radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%)", borderRadius: "50%", animation: "orb1 10s ease-in-out infinite alternate" }} />
        <div style={{ position: "absolute", width: 500, height: 500, bottom: "10%", right: "15%", background: "radial-gradient(circle, rgba(139,92,246,0.07) 0%, transparent 70%)", borderRadius: "50%", animation: "orb2 13s ease-in-out infinite alternate" }} />
      </div>
      <div style={{ position: "relative", marginBottom: 32, zIndex: 1 }}>
        <svg width={100} height={100} viewBox="0 0 96 96" style={{ transform: "rotate(-90deg)", filter: "drop-shadow(0 0 20px rgba(129,140,248,0.3))" }}>
          <circle cx="48" cy="48" r="45" fill="none" stroke="rgba(99,102,241,0.12)" strokeWidth="4" />
          <circle cx="48" cy="48" r="45" fill="none" stroke="url(#lg)" strokeWidth="4" strokeDasharray="283" strokeDashoffset={283 - pct} strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(0.4,0,0.2,1)" }} />
          <defs><linearGradient id="lg" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#818cf8" /><stop offset="100%" stopColor="#f472b6" /></linearGradient></defs>
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ color: "#e2e8f0", fontSize: 24, fontFamily: "var(--font-display)", fontWeight: 800, lineHeight: 1 }}>
            {phase === "ready" ? <Icon.Check size={24} /> : count}
          </div>
        </div>
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 900, letterSpacing: "-0.8px", marginBottom: 8, zIndex: 1 }}>
        <span style={{ background: "linear-gradient(135deg,#818cf8,#f472b6,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Burner</span>
        <span style={{ color: "rgba(255,255,255,0.45)", fontWeight: 400 }}>Mail</span>
      </div>
      <p style={{ color: "rgba(255,255,255,0.18)", fontSize: 10, fontFamily: "var(--font-mono)", letterSpacing: "3px", zIndex: 1, marginBottom: 6 }}>FAST · PRIVATE · DISPOSABLE</p>
      <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 11, fontFamily: "var(--font-mono)", marginTop: 4, letterSpacing: "2px", zIndex: 1, animation: "phraseFade 1.8s infinite" }}>
        {phase === "ready" ? "✓ READY" : LOADING_PHRASES[phraseIdx]}
      </p>
      <style>{`
        @keyframes phraseFade { 0%,100% { opacity:0.6; } 50% { opacity:1; } }
        @keyframes orb1 { from { transform: translate(0,0) scale(1); } to { transform: translate(80px,60px) scale(1.15); } }
        @keyframes orb2 { from { transform: translate(0,0) scale(1); } to { transform: translate(-60px,-80px) scale(1.1); } }
      `}</style>
    </div>
  );
}

// ─── Auth Modal ───────────────────────────────────────────────────────────────
function AuthModal({ onClose, onSuccess, brutalist }) {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    setError("");
    if (!username.trim() || !password.trim()) { setError("Please fill in both fields."); return; }
    if (!WORKER) { setError("Auth worker URL not configured. Add VITE_AUTH_WORKER_URL to your .env"); return; }
    setLoading(true);
    try {
      const data = await workerFetch(`/auth/${mode}`, { method: "POST", body: JSON.stringify({ username: username.trim().toLowerCase(), password }) });
      onSuccess(data.token, data.username);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  if (brutalist) {
    return (
      <>
        <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 800, background: "rgba(0,0,0,0.5)" }} />
        <div style={{
          position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
          zIndex: 801, background: "#f5f0e8", border: "3px solid #111",
          boxShadow: "8px 8px 0 #111", padding: "32px 36px", minWidth: 340, maxWidth: "90vw",
          animation: "fadeUp 0.2s ease",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 900, fontSize: 22, color: "#111", letterSpacing: "-0.5px" }}>
              {mode === "login" ? "SIGN IN" : "CREATE ACCOUNT"}
            </div>
            <button onClick={onClose} style={{ ...brutalistIconBtn(), width: 32, height: 32 }}><Icon.Close size={14} /></button>
          </div>
          <BrutalistField label="USERNAME" value={username} onChange={setUsername} placeholder="your_username" onEnter={handleSubmit} />
          <BrutalistField label="PASSWORD" value={password} onChange={setPassword} placeholder="••••••••" type="password" onEnter={handleSubmit} />
          {error && <div style={{ background: "#ffeeee", border: "2px solid #ff3333", padding: "8px 12px", fontFamily: "var(--font-mono)", fontSize: 12, color: "#cc0000", marginBottom: 16 }}>{error}</div>}
          <button onClick={handleSubmit} disabled={loading} style={{ width: "100%", background: "#111", color: "#f5f0e8", border: "2.5px solid #111", padding: "12px", fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 14, letterSpacing: "1px", cursor: loading ? "not-allowed" : "pointer", boxShadow: loading ? "none" : "4px 4px 0 #555", transition: "all 0.1s", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            {loading ? <Spinner /> : (mode === "login" ? "SIGN IN" : "CREATE ACCOUNT")}
          </button>
          <div style={{ textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 12, color: "#555" }}>
            {mode === "login" ? "No account? " : "Have an account? "}
            <span onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }} style={{ cursor: "pointer", fontWeight: 700, color: "#111", textDecoration: "underline" }}>
              {mode === "login" ? "Register" : "Sign in"}
            </span>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 800, background: "rgba(6,6,16,0.8)", backdropFilter: "blur(8px)" }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        zIndex: 801, background: "rgba(12,12,28,0.97)", backdropFilter: "blur(30px)",
        border: "1px solid rgba(255,255,255,0.12)", borderRadius: 20,
        boxShadow: "0 24px 80px rgba(0,0,0,0.6)", padding: "32px 36px",
        minWidth: 340, maxWidth: "90vw", animation: "fadeUp 0.3s cubic-bezier(0.32,0.72,0,1)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20, color: "#e2e8f0" }}>
              {mode === "login" ? "Welcome back" : "Create account"}
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "rgba(255,255,255,0.3)", marginTop: 3 }}>
              {mode === "login" ? "Sign in to sync your inboxes" : "Save inboxes across devices"}
            </div>
          </div>
          <button onClick={onClose} style={{ ...iconBtnBase("rgba(255,255,255,0.5)"), borderRadius: 8 }}><Icon.Close size={15} /></button>
        </div>

        <GlassField label="Username" value={username} onChange={setUsername} placeholder="yourname" onEnter={handleSubmit} />
        <GlassField label="Password" value={password} onChange={setPassword} placeholder="••••••••" type="password" onEnter={handleSubmit} />

        {error && (
          <div style={{ background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 10, padding: "10px 14px", fontFamily: "var(--font-mono)", fontSize: 12, color: "#f87171", marginBottom: 16 }}>
            {error}
          </div>
        )}

        <button onClick={handleSubmit} disabled={loading} style={{
          width: "100%", background: "linear-gradient(135deg,rgba(99,102,241,0.9),rgba(139,92,246,0.8))",
          border: "1px solid rgba(99,102,241,0.5)", borderRadius: 12, padding: "12px",
          fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14, color: "#fff",
          cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1,
          boxShadow: "0 4px 20px rgba(99,102,241,0.3)", marginBottom: 14,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          transition: "all 0.18s",
        }}>
          {loading ? <Spinner /> : (mode === "login" ? "Sign in" : "Create account")}
        </button>

        <div style={{ textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
          {mode === "login" ? "No account? " : "Have an account? "}
          <span onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
            style={{ cursor: "pointer", color: "#818cf8", fontWeight: 500 }}>
            {mode === "login" ? "Register" : "Sign in"}
          </span>
        </div>

        <div style={{ marginTop: 20, padding: "12px 14px", background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.15)", borderRadius: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--font-mono)", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
            <Icon.Cloud size={12} />
            Saved to Cloudflare — access your inboxes on any device
          </div>
        </div>
      </div>
    </>
  );
}

function GlassField({ label, value, onChange, placeholder, type = "text", onEnter }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "1.5px", color: "rgba(255,255,255,0.4)", marginBottom: 6, textTransform: "uppercase" }}>{label}</div>
      <input
        type={type} value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => e.key === "Enter" && onEnter()}
        style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "11px 14px", fontFamily: "var(--font-mono)", fontSize: 13, color: "#e2e8f0", outline: "none", transition: "border 0.2s" }}
      />
    </div>
  );
}

function BrutalistField({ label, value, onChange, placeholder, type = "text", onEnter }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "2px", color: "#111", marginBottom: 5, fontWeight: 700 }}>{label}</div>
      <input
        type={type} value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => e.key === "Enter" && onEnter()}
        style={{ width: "100%", background: "#fff", border: "2.5px solid #111", borderRadius: 0, padding: "10px 12px", fontFamily: "var(--font-mono)", fontSize: 13, color: "#111", outline: "none", boxShadow: "3px 3px 0 #111", transition: "box-shadow 0.1s" }}
      />
    </div>
  );
}

// ─── Pill nav ─────────────────────────────────────────────────────────────────
function PillNav({ tab, setTab, unread, brutalist }) {
  const tabs = [
    { id: "inbox", label: "Inbox", icon: <Icon.Inbox size={17} /> },
    { id: "guide", label: "How to Use", icon: <Icon.Guide size={17} /> },
    { id: "settings", label: "Settings", icon: <Icon.Settings size={17} /> },
  ];

  if (brutalist) {
    return (
      <div style={{ display: "inline-flex", gap: 0, border: "2.5px solid #111" }}>
        {tabs.map((t, i) => (
          <button key={t.id} onClick={() => setTab(t.id)} title={t.label} style={{
            display: "flex", alignItems: "center", gap: 7, padding: "9px 16px",
            border: "none", borderRight: i < tabs.length - 1 ? "2px solid #111" : "none",
            cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700,
            background: tab === t.id ? "#111" : "#f5f0e8",
            color: tab === t.id ? "#f5f0e8" : "#111",
            letterSpacing: "0.5px", transition: "all 0.1s", position: "relative",
          }}>
            {t.icon}
            <span className="nav-label">{t.label}</span>
            {t.id === "inbox" && unread > 0 && (
              <span style={{ background: "#ff3333", color: "#fff", fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 0, border: "1.5px solid #111", marginLeft: 2 }}>{unread}</span>
            )}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.11)", borderRadius: 999, padding: "5px", backdropFilter: "blur(20px)", boxShadow: "0 4px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.08)" }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => setTab(t.id)} title={t.label} style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
          padding: "10px 18px", borderRadius: 999, border: "none", cursor: "pointer",
          transition: "all 0.2s cubic-bezier(0.4,0,0.2,1)",
          background: tab === t.id ? "linear-gradient(135deg,rgba(99,102,241,0.8),rgba(139,92,246,0.7))" : "transparent",
          color: tab === t.id ? "#fff" : "rgba(255,255,255,0.45)",
          boxShadow: tab === t.id ? "0 2px 14px rgba(99,102,241,0.4), inset 0 1px 0 rgba(255,255,255,0.15)" : "none",
          position: "relative", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 500,
        }}>
          {t.icon}
          <span className="nav-label">{t.label}</span>
          {t.id === "inbox" && unread > 0 && (
            <span style={{ position: "absolute", top: 8, right: 10, background: "#f472b6", width: 7, height: 7, borderRadius: "50%", border: "1.5px solid rgba(6,6,16,0.8)" }} />
          )}
        </button>
      ))}
    </div>
  );
}

// ─── Glass card (adapts to theme) ─────────────────────────────────────────────
function Glass({ children, style = {}, brutalist = false, ...props }) {
  if (brutalist) {
    return (
      <div style={{ background: "#fff", border: "2.5px solid #111", borderRadius: 0, boxShadow: "5px 5px 0 #111", ...style }} {...props}>
        {children}
      </div>
    );
  }
  return (
    <div style={{
      background: "rgba(255,255,255,0.04)", backdropFilter: "blur(24px) saturate(180%)",
      WebkitBackdropFilter: "blur(24px) saturate(180%)",
      border: "1px solid rgba(255,255,255,0.09)", borderRadius: 20,
      boxShadow: "0 8px 40px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.07)", ...style,
    }} {...props}>
      {children}
    </div>
  );
}

// ─── Accounts Drawer ──────────────────────────────────────────────────────────
function AccountsDrawer({ open, onClose, accounts, activeAddress, onSwitch, onDeleteAccount, onAddNew, newCooldown, loadingAddr, brutalist }) {
  if (!open) return null;

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(6,6,16,0.6)", backdropFilter: "blur(4px)", animation: "fadeIn 0.2s ease" }} />
      <div style={brutalist ? {
        position: "fixed", top: 0, left: 0, bottom: 0, width: 300, maxWidth: "85vw",
        zIndex: 401, display: "flex", flexDirection: "column",
        background: "#f5f0e8", borderRight: "3px solid #111",
        boxShadow: "6px 0 0 #111",
        animation: "drawerSlideIn 0.25s ease",
      } : {
        position: "fixed", top: 0, left: 0, bottom: 0, width: 300, maxWidth: "85vw",
        zIndex: 401, display: "flex", flexDirection: "column",
        background: "rgba(10,10,24,0.97)", backdropFilter: "blur(30px) saturate(180%)",
        borderRight: "1px solid rgba(255,255,255,0.09)",
        boxShadow: "4px 0 40px rgba(0,0,0,0.6)",
        animation: "drawerSlideIn 0.28s cubic-bezier(0.32,0.72,0,1)",
      }}>
        <div style={brutalist ? { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px", borderBottom: "2.5px solid #111" } :
          { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 900, fontSize: 16, color: brutalist ? "#111" : "#e2e8f0", letterSpacing: brutalist ? "-0.3px" : 0 }}>Inboxes</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: brutalist ? "#555" : "rgba(255,255,255,0.3)", letterSpacing: "1.5px", marginTop: 2 }}>
              {accounts.length} ADDRESS{accounts.length !== 1 ? "ES" : ""}
            </div>
          </div>
          <button onClick={onClose} style={brutalist ? brutalistIconBtn() : { ...iconBtnBase("rgba(255,255,255,0.4)"), width: 32, height: 32, borderRadius: 8 }}>
            <Icon.Close size={15} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
          {accounts.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 16px", color: brutalist ? "#555" : "rgba(255,255,255,0.25)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
              No saved inboxes yet
            </div>
          )}
          {accounts.map((acc, i) => {
            const isActive = acc.address === activeAddress;
            return (
              <div key={acc.address} onClick={() => !isActive && onSwitch(acc)} style={brutalist ? {
                display: "flex", alignItems: "center", gap: 12, padding: "11px 10px",
                marginBottom: 6, background: isActive ? "#fff" : "transparent",
                border: isActive ? "2.5px solid #111" : "2px solid transparent",
                boxShadow: isActive ? "3px 3px 0 #111" : "none",
                cursor: isActive ? "default" : "pointer", transition: "all 0.1s",
                animation: `fadeUp 0.3s ${i * 50}ms both ease`,
              } : {
                display: "flex", alignItems: "center", gap: 12, padding: "12px 10px", borderRadius: 12, marginBottom: 4,
                background: isActive ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.03)",
                border: isActive ? "1px solid rgba(99,102,241,0.35)" : "1px solid transparent",
                transition: "all 0.15s", animation: `fadeUp 0.3s ${i * 50}ms both ease`,
                cursor: isActive ? "default" : "pointer",
              }}>
                {/* No avatar — just a colored dot */}
                <div style={{ width: 10, height: 10, borderRadius: brutalist ? 0 : "50%", flexShrink: 0, background: isActive ? (brutalist ? "#111" : "#818cf8") : (brutalist ? "#888" : "rgba(255,255,255,0.2)"), border: brutalist ? "1.5px solid #111" : "none" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: brutalist ? (isActive ? "#111" : "#444") : (isActive ? "#c7d2fe" : "rgba(255,255,255,0.6)"), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: isActive ? 700 : 400 }}>
                    {acc.address}
                  </div>
                  {isActive && <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: brutalist ? "#111" : "#818cf8", letterSpacing: "1px", marginTop: 2, fontWeight: 700 }}>● ACTIVE</div>}
                </div>
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  {!isActive && <button onClick={e => { e.stopPropagation(); onSwitch(acc); }} title="Switch" style={brutalist ? brutalistIconBtn() : iconBtnBase("rgba(129,140,248,0.8)")}><Icon.SwitchHoriz size={12} /></button>}
                  <button onClick={e => { e.stopPropagation(); onDeleteAccount(acc.address); }} title="Remove" style={brutalist ? { ...brutalistIconBtn(), color: "#cc0000" } : iconBtnBase("rgba(248,113,113,0.6)")}><Icon.Delete size={12} /></button>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ padding: "14px 16px", borderTop: brutalist ? "2.5px solid #111" : "1px solid rgba(255,255,255,0.07)" }}>
          <CooldownButton icon={<Icon.New size={13} />} label="Add new inbox" onClick={() => { onAddNew(); onClose(); }} cooldown={newCooldown} limitMs={NEW_ADDR_LIMIT} disabled={loadingAddr} primary brutalist={brutalist} />
        </div>
      </div>

      <style>{`
        @keyframes drawerSlideIn { from { transform: translateX(-100%); opacity: 0.6; } to { transform: translateX(0); opacity: 1; } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </>
  );
}

function iconBtnBase(color) {
  return { display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 7, border: "none", background: "rgba(255,255,255,0.06)", cursor: "pointer", color, transition: "background 0.15s" };
}

function brutalistIconBtn() {
  return { display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, border: "2px solid #111", background: "#f5f0e8", cursor: "pointer", color: "#111", borderRadius: 0, transition: "all 0.1s" };
}

// ─── Address card ─────────────────────────────────────────────────────────────
function AddressCard({ address, availableDomains, onCopy, onNew, onRefresh, onSetCustom, newCooldown, refreshCooldown, loading, brutalist }) {
  const [customMode, setCustomMode] = useState(false);
  const [customLocal, setCustomLocal] = useState("");
  const [selectedDomain, setSelectedDomain] = useState("");
  const [customError, setCustomError] = useState("");

  useEffect(() => {
    if (availableDomains.length && !selectedDomain) setSelectedDomain(availableDomains[0]);
  }, [availableDomains, selectedDomain]);

  const handleCustomSubmit = () => {
    const local = customLocal.trim().toLowerCase();
    if (!local) { setCustomError("Enter a username."); return; }
    if (!/^[a-z0-9._+-]+$/.test(local)) { setCustomError("Only letters, numbers, . _ + - allowed."); return; }
    if (local.length < 3) { setCustomError("At least 3 characters."); return; }
    if (!selectedDomain) { setCustomError("No domain available."); return; }
    setCustomError("");
    onSetCustom(local + "@" + selectedDomain);
    setCustomMode(false); setCustomLocal("");
  };

  if (brutalist) {
    return (
      <Glass brutalist style={{ padding: "24px 24px 20px", animation: "fadeUp 0.4s ease" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "2px", color: "#888", fontWeight: 700 }}>YOUR TEMP ADDRESS</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "2px", color: "#111", display: "flex", alignItems: "center", gap: 5, background: "#c8f7c5", border: "1.5px solid #111", padding: "2px 8px" }}>
            <span style={{ display: "inline-block", width: 6, height: 6, background: "#00aa44", border: "1px solid #111" }} /> LIVE
          </div>
        </div>

        {!customMode ? (
          <>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "clamp(13px,3vw,17px)", fontWeight: 700, color: loading ? "#888" : "#111", marginBottom: 16, wordBreak: "break-all", borderBottom: "2px solid #111", paddingBottom: 12 }}>
              {loading ? <span style={{ display: "flex", alignItems: "center", gap: 8 }}><Spinner dark /> generating…</span> : (address || "—")}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {address && !loading && <button onClick={onCopy} style={brutalistBtn("primary")}><Icon.Copy size={13} /> Copy</button>}
              <CooldownButton icon={<Icon.New size={13} />} label="New" onClick={onNew} cooldown={newCooldown} limitMs={NEW_ADDR_LIMIT} disabled={loading} primary brutalist />
              <CooldownButton icon={<Icon.Refresh size={13} />} label="Refresh" onClick={onRefresh} cooldown={refreshCooldown} limitMs={REFRESH_LIMIT} disabled={loading || !address} brutalist />
              <button onClick={() => setCustomMode(true)} style={brutalistBtn()} disabled={loading || !availableDomains.length}><Icon.Edit size={13} /> Custom</button>
            </div>
          </>
        ) : (
          <div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#555", marginBottom: 10, fontWeight: 700 }}>CHOOSE USERNAME:</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
              <input autoFocus value={customLocal} onChange={e => { setCustomLocal(e.target.value); setCustomError(""); }} onKeyDown={e => e.key === "Enter" && handleCustomSubmit()} placeholder="username" style={{ flex: 1, minWidth: 100, background: "#fff", border: "2.5px solid #111", padding: "8px 10px", fontFamily: "var(--font-mono)", fontSize: 13, color: "#111", outline: "none", boxShadow: "3px 3px 0 #111" }} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "#111", fontWeight: 700 }}>@</span>
              {availableDomains.length > 1 ? (
                <select value={selectedDomain} onChange={e => setSelectedDomain(e.target.value)} style={{ background: "#fff", border: "2.5px solid #111", padding: "8px 10px", fontFamily: "var(--font-mono)", fontSize: 12, color: "#111", outline: "none", cursor: "pointer" }}>
                  {availableDomains.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              ) : <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "#555" }}>{selectedDomain}</span>}
            </div>
            {customError && <div style={{ color: "#cc0000", fontSize: 11, fontFamily: "var(--font-mono)", marginBottom: 8, fontWeight: 700 }}>{customError}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleCustomSubmit} style={brutalistBtn("primary")}><Icon.Check size={13} /> Use this</button>
              <button onClick={() => { setCustomMode(false); setCustomError(""); }} style={brutalistBtn()}>Cancel</button>
            </div>
          </div>
        )}
      </Glass>
    );
  }

  return (
    <Glass style={{ padding: "28px 28px 24px", position: "relative", overflow: "hidden", animation: "fadeUp 0.5s ease" }}>
      <div style={{ position: "absolute", top: -80, right: -80, width: 280, height: 280, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.10), transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: -60, left: -40, width: 200, height: 200, borderRadius: "50%", background: "radial-gradient(circle, rgba(244,114,182,0.06), transparent 70%)", pointerEvents: "none" }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 10, letterSpacing: "2.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.35)", fontFamily: "var(--font-mono)" }}>Your temporary address</div>
        <div style={{ fontSize: 9, letterSpacing: "2px", color: "rgba(129,140,248,0.5)", fontFamily: "var(--font-mono)", display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: "rgba(74,222,128,0.7)", animation: "livePulse 2s infinite" }} /> DISPOSABLE
        </div>
      </div>

      {!customMode ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-mono)", fontSize: "clamp(13px,3vw,18px)", fontWeight: 500, color: loading ? "rgba(255,255,255,0.3)" : "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontStyle: loading ? "italic" : "normal" }}>
              {loading ? <span style={{ display: "flex", alignItems: "center", gap: 8 }}><Spinner /> generating…</span> : address ? <span className="glitch-text" data-text={address}>{address}</span> : "—"}
            </div>
            {address && !loading && <button onClick={onCopy} style={btnStyle("ghost")}><Icon.Copy size={13} /> Copy</button>}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
            <CooldownButton icon={<Icon.New size={13} />} label="New address" onClick={onNew} cooldown={newCooldown} limitMs={NEW_ADDR_LIMIT} disabled={loading} primary />
            <CooldownButton icon={<Icon.Refresh size={13} />} label="Refresh" onClick={onRefresh} cooldown={refreshCooldown} limitMs={REFRESH_LIMIT} disabled={loading || !address} />
            <button onClick={() => setCustomMode(true)} style={btnStyle("ghost")} disabled={loading || !availableDomains.length}><Icon.Edit size={13} /> Custom</button>
          </div>
        </>
      ) : (
        <div style={{ animation: "fadeUp 0.25s ease" }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontFamily: "var(--font-mono)", marginBottom: 10 }}>Choose your own username:</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input autoFocus value={customLocal} onChange={e => { setCustomLocal(e.target.value); setCustomError(""); }} onKeyDown={e => e.key === "Enter" && handleCustomSubmit()} placeholder="username" style={{ flex: 1, minWidth: 120, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "9px 14px", fontFamily: "var(--font-mono)", fontSize: 14, color: "#e2e8f0", outline: "none" }} />
            <span style={{ color: "rgba(255,255,255,0.4)", fontFamily: "var(--font-mono)", fontSize: 14, whiteSpace: "nowrap" }}>@</span>
            {availableDomains.length > 1 ? (
              <select value={selectedDomain} onChange={e => setSelectedDomain(e.target.value)} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "9px 12px", fontFamily: "var(--font-mono)", fontSize: 13, color: "#e2e8f0", outline: "none", cursor: "pointer" }}>
                {availableDomains.map(d => <option key={d} value={d} style={{ background: "#0f0f1e" }}>{d}</option>)}
              </select>
            ) : <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "rgba(255,255,255,0.6)" }}>{selectedDomain}</span>}
          </div>
          {customError && <div style={{ color: "#f87171", fontSize: 11, fontFamily: "var(--font-mono)", marginTop: 6 }}>{customError}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button onClick={handleCustomSubmit} style={btnStyle("primary")}><Icon.Check size={13} /> Use this address</button>
            <button onClick={() => { setCustomMode(false); setCustomError(""); }} style={btnStyle("ghost")}>Cancel</button>
          </div>
        </div>
      )}
    </Glass>
  );
}

// ─── Cooldown button ──────────────────────────────────────────────────────────
function CooldownButton({ icon, label, onClick, cooldown, limitMs, disabled, primary, brutalist }) {
  const pct = cooldown > 0 ? Math.round((1 - cooldown / limitMs) * 100) : 100;
  const isBlocked = cooldown > 0;
  const secs = Math.ceil(cooldown / 1000);
  const baseStyle = brutalist ? brutalistBtn(primary ? "primary" : "") : btnStyle(primary ? "primary" : "ghost");
  return (
    <button onClick={!isBlocked && !disabled ? onClick : undefined} disabled={isBlocked || disabled}
      style={{ ...baseStyle, position: "relative", overflow: "hidden", opacity: isBlocked || disabled ? 0.55 : 1, cursor: isBlocked || disabled ? "not-allowed" : "pointer" }}>
      {isBlocked && !brutalist && <span style={{ position: "absolute", inset: 0, left: 0, background: "rgba(99,102,241,0.18)", width: pct + "%", transition: "width 0.5s linear", borderRadius: "inherit" }} />}
      <span style={{ position: "relative", display: "flex", alignItems: "center", gap: 6 }}>
        {isBlocked ? <><Icon.Clock size={13} /> {secs}s</> : <>{icon} {label}</>}
      </span>
    </button>
  );
}

// ─── Search bar ───────────────────────────────────────────────────────────────
function SearchBar({ value, onChange, brutalist }) {
  return (
    <div style={{ position: "relative" }}>
      <div style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: brutalist ? "#888" : "rgba(255,255,255,0.3)", pointerEvents: "none" }}>
        <Icon.Search size={14} />
      </div>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder="Search messages…" style={brutalist ? {
        width: "100%", background: "#fff", border: "2px solid #ccc", borderRadius: 0,
        padding: "9px 12px 9px 34px", fontFamily: "var(--font-mono)", fontSize: 13, color: "#111", outline: "none",
      } : {
        width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12, padding: "10px 14px 10px 36px", fontFamily: "var(--font-mono)", fontSize: 13, color: "#e2e8f0", outline: "none",
      }} />
    </div>
  );
}

// ─── Inbox view ───────────────────────────────────────────────────────────────
function InboxView({ messages, onOpen, onDelete, onStar, onMarkRead, loading, starredIds, search, brutalist }) {
  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: brutalist ? "#555" : "rgba(255,255,255,0.3)", gap: 10, fontFamily: "var(--font-mono)", fontSize: 13 }}>
        <Spinner dark={brutalist} /> Loading messages…
      </div>
    );
  }

  const filtered = messages.filter(m => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (m.from?.address || "").toLowerCase().includes(q) || (m.subject || "").toLowerCase().includes(q);
  });

  if (!filtered.length) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "56px 24px", color: brutalist ? "#888" : "rgba(255,255,255,0.25)" }}>
        <div style={{ opacity: 0.4, animation: brutalist ? "none" : "terminalPulse 3s ease-in-out infinite" }}><Icon.Mail size={36} /></div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 700, color: brutalist ? "#555" : "rgba(255,255,255,0.4)" }}>
          {search ? "No matching messages" : "Waiting for mail"}
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, textAlign: "center", lineHeight: 1.7, maxWidth: 280, color: brutalist ? "#888" : "rgba(255,255,255,0.28)" }}>
          {search ? "Try a different search term." : "Copy your address above and paste it anywhere."}
          {!search && !brutalist && <><br /><span style={{ color: "rgba(129,140,248,0.5)" }}>inbox listening<span className="term-cursor" /></span></>}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {filtered.map((m, i) => (
        <MessageRow key={m.id} msg={m} onClick={() => onOpen(m.id)} delay={i * 40}
          onDelete={e => { e.stopPropagation(); onDelete(m.id); }}
          onStar={e => { e.stopPropagation(); onStar(m.id); }}
          onMarkRead={e => { e.stopPropagation(); onMarkRead(m.id); }}
          starred={starredIds.has(m.id)} brutalist={brutalist} />
      ))}
    </div>
  );
}

// ─── Message row — NO AVATAR ──────────────────────────────────────────────────
function MessageRow({ msg, onClick, delay, onDelete, onStar, onMarkRead, starred, brutalist }) {
  const [hover, setHover] = useState(false);

  if (brutalist) {
    return (
      <div onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{
        display: "grid", gridTemplateColumns: "1fr auto", gridTemplateRows: "auto auto",
        columnGap: 12, rowGap: 3, alignItems: "start",
        padding: "13px 18px",
        borderBottom: "2px solid #e8e4dc",
        cursor: "pointer",
        background: hover ? "#fffdf5" : (msg.seen ? "#fff" : "#fffbf0"),
        borderLeft: msg.seen ? "none" : "4px solid #111",
        paddingLeft: msg.seen ? 18 : 14,
        transition: "background 0.1s",
        animation: `fadeUp 0.3s ${delay}ms both ease`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          {!msg.seen && <div style={{ width: 7, height: 7, background: "#111", flexShrink: 0, border: "1px solid #111" }} />}
          {starred && <span style={{ color: "#cc8800", flexShrink: 0 }}><Icon.StarFilled size={11} /></span>}
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: msg.seen ? 400 : 700, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {msg.from?.address || "Unknown sender"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, gridRow: "1", flexShrink: 0 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#888", whiteSpace: "nowrap" }}>{timeAgo(msg.createdAt)}</span>
          {hover && (
            <div style={{ display: "flex", gap: 2 }}>
              <button onClick={onStar} title={starred ? "Unstar" : "Star"} style={{ ...brutalistIconBtn(), width: 22, height: 22 }}>{starred ? <Icon.StarFilled size={11} /> : <Icon.Star size={11} />}</button>
              {!msg.seen && <button onClick={onMarkRead} title="Mark read" style={{ ...brutalistIconBtn(), width: 22, height: 22 }}><Icon.MarkRead size={11} /></button>}
              <button onClick={onDelete} title="Delete" style={{ ...brutalistIconBtn(), width: 22, height: 22, color: "#cc0000" }}><Icon.Delete size={11} /></button>
            </div>
          )}
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: msg.seen ? "#888" : "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {msg.subject || "(no subject)"}
        </div>
      </div>
    );
  }

  return (
    <div onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{
      display: "grid", gridTemplateColumns: "1fr auto", gridTemplateRows: "auto auto",
      columnGap: 12, rowGap: 2, alignItems: "start",
      padding: "14px 20px",
      borderBottom: "1px solid rgba(255,255,255,0.05)",
      cursor: "pointer",
      background: hover ? "rgba(255,255,255,0.04)" : "transparent",
      borderLeft: msg.seen ? "none" : "3px solid rgba(99,102,241,0.7)",
      paddingLeft: msg.seen ? 20 : 17,
      transition: "background 0.15s",
      animation: `fadeUp 0.35s ${delay}ms both ease`,
      position: "relative",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        {starred && <span style={{ color: "#fbbf24", flexShrink: 0 }}><Icon.StarFilled size={11} /></span>}
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: msg.seen ? 400 : 600, color: msg.seen ? "rgba(255,255,255,0.65)" : "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {msg.from?.address || "Unknown sender"}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, gridRow: "1", flexShrink: 0 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "rgba(255,255,255,0.3)", whiteSpace: "nowrap" }}>{timeAgo(msg.createdAt)}</span>
        {hover && (
          <div style={{ display: "flex", gap: 2 }}>
            <button onClick={onStar} title={starred ? "Unstar" : "Star"} style={iconBtn(starred ? "#fbbf24" : "rgba(255,255,255,0.4)")}>{starred ? <Icon.StarFilled size={12} /> : <Icon.Star size={12} />}</button>
            {!msg.seen && <button onClick={onMarkRead} title="Mark as read" style={iconBtn("rgba(255,255,255,0.4)")}><Icon.MarkRead size={12} /></button>}
            <button onClick={onDelete} title="Delete" style={iconBtn("rgba(248,113,113,0.7)")}><Icon.Delete size={12} /></button>
          </div>
        )}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: msg.seen ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.6)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {msg.subject || "(no subject)"}
      </div>
    </div>
  );
}

function iconBtn(color) {
  return { display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: 6, border: "none", background: "rgba(255,255,255,0.07)", cursor: "pointer", color, transition: "background 0.15s" };
}

// ─── Message viewer ───────────────────────────────────────────────────────────
function MessageViewer({ msg, onClose, onDelete, onStar, starred, brutalist }) {
  const iframeRef = useRef(null);

  useEffect(() => {
    if (!msg || !iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    const html = msg.html ? (Array.isArray(msg.html) ? msg.html.join("") : msg.html) : null;
    if (html) {
      doc.open();
      doc.write(`<base target="_blank"><style>body{margin:0;padding:16px;font-family:sans-serif;font-size:14px;line-height:1.6;background:#fff;color:#111;}img{max-width:100%;}</style>${html}`);
      doc.close();
      setTimeout(() => { try { iframeRef.current.style.height = doc.body.scrollHeight + 32 + "px"; } catch {} }, 300);
    }
  }, [msg]);

  if (!msg) return null;
  const html = msg.html ? (Array.isArray(msg.html) ? msg.html.join("") : msg.html) : null;
  const downloadText = () => {
    const blob = new Blob([msg.text || msg.subject || ""], { type: "text/plain" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `email-${msg.id}.txt`; a.click();
  };

  if (brutalist) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "#f5f0e8", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", background: "#fff", borderBottom: "3px solid #111", flexWrap: "wrap", rowGap: 8 }}>
          <button onClick={onClose} style={brutalistBtn()}><Icon.Back size={14} /> Back</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 900, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{msg.subject || "(no subject)"}</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#555", marginTop: 2 }}>From: {msg.from?.address || "Unknown"}</div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#888", whiteSpace: "nowrap" }}>{new Date(msg.createdAt).toLocaleString()}</span>
            <button onClick={onStar} style={{ ...brutalistBtn(), color: starred ? "#cc8800" : "#111", padding: "7px 10px" }}>{starred ? <Icon.StarFilled size={13} /> : <Icon.Star size={13} />}</button>
            <button onClick={downloadText} style={{ ...brutalistBtn(), padding: "7px 10px" }}><Icon.Download size={13} /></button>
            <button onClick={() => onDelete(msg.id)} style={{ ...brutalistBtn(), color: "#cc0000", padding: "7px 10px" }}><Icon.Delete size={13} /></button>
          </div>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "24px" }}>
          <div style={{ maxWidth: 720, margin: "0 auto", background: "#fff", border: "3px solid #111", boxShadow: "6px 6px 0 #111" }}>
            {html ? <iframe ref={iframeRef} sandbox="allow-same-origin" style={{ width: "100%", border: "none", minHeight: 300, display: "block", background: "#fff" }} /> : (
              <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.8, color: "#111", padding: 24, margin: 0 }}>
                {msg.text || "(empty message)"}
              </pre>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(6,6,16,0.88)", backdropFilter: "blur(8px)", display: "flex", flexDirection: "column", animation: "msgOverlayIn 0.28s cubic-bezier(0.32,0.72,0,1)" }}>
      <style>{`
        @keyframes msgOverlayIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes msgPanelIn { from { opacity: 0; transform: translateY(40px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
      `}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", background: "rgba(10,10,24,0.85)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.07)", animation: "msgPanelIn 0.35s cubic-bezier(0.32,0.72,0,1)", flexWrap: "wrap", rowGap: 8 }}>
        <button onClick={onClose} style={btnStyle("ghost")}><Icon.Back size={14} /> Back</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 700, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{msg.subject || "(no subject)"}</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>From: {msg.from?.address || "Unknown"}</div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "rgba(255,255,255,0.3)", whiteSpace: "nowrap" }}>{new Date(msg.createdAt).toLocaleString()}</span>
          <button onClick={onStar} style={{ ...btnStyle("ghost"), color: starred ? "#fbbf24" : undefined, padding: "7px 10px" }}>{starred ? <Icon.StarFilled size={13} /> : <Icon.Star size={13} />}</button>
          <button onClick={downloadText} style={{ ...btnStyle("ghost"), padding: "7px 10px" }}><Icon.Download size={13} /></button>
          <button onClick={() => onDelete(msg.id)} style={{ ...btnStyle("ghost"), color: "#f87171", padding: "7px 10px" }}><Icon.Delete size={13} /></button>
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "24px", animation: "msgPanelIn 0.4s 0.05s cubic-bezier(0.32,0.72,0,1) both" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, overflow: "hidden" }}>
          {html ? <iframe ref={iframeRef} sandbox="allow-same-origin" style={{ width: "100%", border: "none", minHeight: 300, display: "block", background: "#fff" }} /> : (
            <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.8, color: "rgba(255,255,255,0.75)", padding: 24, margin: 0 }}>
              {msg.text || "(empty message)"}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Guide view ───────────────────────────────────────────────────────────────
const GuideView = memo(function GuideView({ brutalist }) {
  const steps = [
    { icon: <Icon.Shield size={20} />, title: "Auto-generated address", body: "A random temporary email is created the moment you open the app. No sign-up required." },
    { icon: <Icon.Edit size={20} />, title: "Or pick your own username", body: "Hit Custom to enter your preferred username and choose from available domains." },
    { icon: <Icon.Copy size={20} />, title: "Copy & use it anywhere", body: "Hit Copy and paste it into any site asking for your email — sign-ups, verifications, free trials." },
    { icon: <Icon.Inbox size={20} />, title: "Emails arrive automatically", body: "Your inbox auto-refreshes every 15 seconds. New emails show an unread indicator." },
    { icon: <Icon.Star size={20} />, title: "Star & manage emails", body: "Hover a message to star it, mark it read, or delete it." },
    { icon: <Icon.Search size={20} />, title: "Search your inbox", body: "Use the search bar to filter messages by sender or subject instantly." },
    { icon: <Icon.Hamburger size={20} />, title: "Multiple inboxes", body: "Tap the menu icon to manage multiple addresses and switch between them." },
    { icon: <Icon.User size={20} />, title: "Sign in to sync", body: "Create a free account to save your inboxes to Cloudflare KV — access them on any device." },
    { icon: <Icon.New size={20} />, title: "Need a fresh address?", body: "Hit New Address for a brand-new random one. Once per minute to prevent abuse." },
  ];

  if (brutalist) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 900, color: "#111", marginBottom: 4, letterSpacing: "-0.5px" }}>HOW TO USE</div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#555", marginBottom: 16, borderBottom: "2.5px solid #111", paddingBottom: 12 }}>A disposable inbox with zero setup.</div>
        {steps.map((s, i) => (
          <div key={i} style={{ padding: "16px 18px", display: "flex", gap: 14, alignItems: "flex-start", background: "#fff", border: "2.5px solid #111", boxShadow: "4px 4px 0 #111", marginBottom: 8 }}>
            <div style={{ color: "#111", flexShrink: 0, marginTop: 1 }}>{s.icon}</div>
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 900, color: "#111", marginBottom: 4, letterSpacing: "-0.2px" }}>{s.title}</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#555", lineHeight: 1.7 }}>{s.body}</div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 800, color: "#e2e8f0", marginBottom: 4 }}>How to use BurnerMail</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>A disposable inbox with zero setup.</div>
      {steps.map((s, i) => (
        <Glass key={i} style={{ padding: "20px 22px", display: "flex", gap: 16, alignItems: "flex-start" }}>
          <div style={{ color: "rgba(129,140,248,0.85)", flexShrink: 0, marginTop: 2 }}>{s.icon}</div>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>{s.title}</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.7 }}>{s.body}</div>
          </div>
        </Glass>
      ))}
    </div>
  );
});

// ─── Sun / Moon / Brutalist icons ─────────────────────────────────────────────
const SunIcon = () => <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>;
const MoonIcon = () => <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>;

// ─── Settings view ────────────────────────────────────────────────────────────
function SettingsView({ address, onClearCookies, onNew, newCooldown, theme, onSetTheme, authedUser, onSignIn, onSignOut, brutalist }) {
  const lbl = brutalist
    ? { fontSize: 10, letterSpacing: "2.5px", textTransform: "uppercase", color: "#888", fontFamily: "var(--font-mono)", marginBottom: 10, fontWeight: 700 }
    : { fontSize: 10, letterSpacing: "2px", textTransform: "uppercase", color: "rgba(255,255,255,0.3)", fontFamily: "var(--font-mono)", marginBottom: 12 };
  const bodyTxt = brutalist
    ? { fontFamily: "var(--font-mono)", fontSize: 12, color: "#555", lineHeight: 1.7 }
    : { fontFamily: "var(--font-mono)", fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.7 };

  const themes = [
    { id: "dark",     label: "Dark",       desc: "Default deep dark with glows" },
    { id: "light",    label: "Light",      desc: "Soft ambient light mode" },
    { id: "brutalist",label: "Neo-Brutal", desc: "Cream & black, stark borders" },
  ];

  if (brutalist) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 26, fontWeight: 900, color: "#111", marginBottom: 4, letterSpacing: "-0.5px" }}>SETTINGS</div>

        {/* Theme */}
        <div style={{ background: "#fff", border: "2.5px solid #111", boxShadow: "5px 5px 0 #111", padding: "20px 22px", marginBottom: 8 }}>
          <div style={lbl}>THEME</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {themes.map(t => (
              <div key={t.id} onClick={() => onSetTheme(t.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", cursor: "pointer", border: theme === t.id ? "2.5px solid #111" : "2px solid #ccc", background: theme === t.id ? "#f5f0e8" : "#fff", boxShadow: theme === t.id ? "3px 3px 0 #111" : "none", transition: "all 0.1s" }}>
                <div style={{ width: 18, height: 18, border: "2px solid #111", background: theme === t.id ? "#111" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {theme === t.id && <div style={{ width: 8, height: 8, background: "#f5f0e8" }} />}
                </div>
                <div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 13, fontWeight: 900, color: "#111" }}>{t.label}</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#666" }}>{t.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Account */}
        <div style={{ background: "#fff", border: "2.5px solid #111", boxShadow: "5px 5px 0 #111", padding: "20px 22px", marginBottom: 8 }}>
          <div style={lbl}>ACCOUNT</div>
          {authedUser ? (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, padding: "10px 12px", background: "#c8f7c5", border: "2px solid #111" }}>
                <Icon.User size={15} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, color: "#111" }}>{authedUser}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "#007722", letterSpacing: "1px", fontWeight: 700 }}>SIGNED IN</span>
              </div>
              <div style={bodyTxt}>Your inboxes are synced to Cloudflare.</div>
              <button onClick={onSignOut} style={{ ...brutalistBtn(), color: "#cc0000", marginTop: 10 }}><Icon.LogOut size={13} /> Sign out</button>
            </div>
          ) : (
            <div>
              <div style={bodyTxt}>Sign in to save your inboxes across devices via Cloudflare KV.</div>
              <button onClick={onSignIn} style={{ ...brutalistBtn("primary"), marginTop: 10 }}><Icon.User size={13} /> Sign in / Register</button>
            </div>
          )}
        </div>

        {/* Address */}
        <div style={{ background: "#fff", border: "2.5px solid #111", boxShadow: "5px 5px 0 #111", padding: "20px 22px", marginBottom: 8 }}>
          <div style={lbl}>CURRENT ADDRESS</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "#111", wordBreak: "break-all", marginBottom: 14, borderBottom: "1.5px solid #e8e4dc", paddingBottom: 12, fontWeight: 700 }}>{address || "Not generated yet"}</div>
          <CooldownButton icon={<Icon.New size={13} />} label="Generate new" onClick={onNew} cooldown={newCooldown} limitMs={NEW_ADDR_LIMIT} primary brutalist />
        </div>

        {/* Storage */}
        <div style={{ background: "#fff", border: "2.5px solid #111", boxShadow: "5px 5px 0 #111", padding: "20px 22px" }}>
          <div style={lbl}>STORAGE & LIMITS</div>
          <div style={{ ...bodyTxt, marginBottom: 14 }}>Session saved in cookie for 30 days. Rate limits: 60s new address, 10s refresh, 15s auto-poll.</div>
          <button onClick={onClearCookies} style={{ ...brutalistBtn(), color: "#cc0000" }}><Icon.Delete size={13} /> Clear all data</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, animation: "fadeUp 0.4s ease" }}>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 800, color: "#e2e8f0", marginBottom: 4 }}>Settings</div>

      {/* Theme picker */}
      <Glass style={{ padding: "20px 22px" }}>
        <div style={lbl}>Theme</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {themes.map(t => (
            <div key={t.id} onClick={() => onSetTheme(t.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10, cursor: "pointer", background: theme === t.id ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.03)", border: theme === t.id ? "1px solid rgba(99,102,241,0.4)" : "1px solid rgba(255,255,255,0.07)", transition: "all 0.18s" }}>
              <div style={{ width: 16, height: 16, borderRadius: "50%", border: theme === t.id ? "2px solid #818cf8" : "2px solid rgba(255,255,255,0.2)", background: theme === t.id ? "#818cf8" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {theme === t.id && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} />}
              </div>
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{t.label}</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "rgba(255,255,255,0.4)" }}>{t.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </Glass>

      {/* Account */}
      <Glass style={{ padding: "20px 22px" }}>
        <div style={lbl}>Account</div>
        {authedUser ? (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, padding: "10px 14px", background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.25)", borderRadius: 10 }}>
              <Icon.User size={15} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, color: "#4ade80" }}>{authedUser}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "rgba(74,222,128,0.6)", letterSpacing: "1px" }}>SIGNED IN</span>
            </div>
            <div style={{ ...bodyTxt, marginBottom: 12 }}>Your inboxes are synced to Cloudflare KV.</div>
            <button onClick={onSignOut} style={{ ...btnStyle("ghost"), color: "#f87171", borderColor: "rgba(248,113,113,0.3)" }}><Icon.LogOut size={13} /> Sign out</button>
          </div>
        ) : (
          <div>
            <div style={{ ...bodyTxt, marginBottom: 14 }}>Sign in to save your inboxes to Cloudflare — access them on any device.</div>
            <button onClick={onSignIn} style={btnStyle("primary")}><Icon.User size={13} /> Sign in / Register</button>
          </div>
        )}
      </Glass>

      <Glass style={{ padding: "20px 22px" }}>
        <div style={lbl}>Current address</div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "#c7d2fe", wordBreak: "break-all", marginBottom: 16 }}>{address || "Not generated yet"}</div>
        <CooldownButton icon={<Icon.New size={13} />} label="Generate new" onClick={onNew} cooldown={newCooldown} limitMs={NEW_ADDR_LIMIT} primary />
      </Glass>

      <Glass style={{ padding: "20px 22px" }}>
        <div style={lbl}>Storage</div>
        <div style={{ ...bodyTxt, marginBottom: 14 }}>Session cookie: 30 days. Rate: 60s new / 10s refresh / 15s auto-poll.</div>
        <button onClick={onClearCookies} style={{ ...btnStyle("ghost"), borderColor: "rgba(248,113,113,0.3)", color: "#f87171" }}><Icon.Delete size={13} /> Clear all data</button>
      </Glass>
    </div>
  );
}

// ─── Shared button styles ─────────────────────────────────────────────────────
function btnStyle(variant = "ghost") {
  const base = { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 500, transition: "all 0.18s", whiteSpace: "nowrap", border: "none" };
  if (variant === "primary") return { ...base, background: "linear-gradient(135deg,rgba(99,102,241,0.8),rgba(139,92,246,0.7))", border: "1px solid rgba(99,102,241,0.4)", color: "#fff", boxShadow: "0 2px 12px rgba(99,102,241,0.25)" };
  return { ...base, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.7)" };
}

function brutalistBtn(variant = "") {
  const base = { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", transition: "all 0.1s", border: "none" };
  if (variant === "primary") return { ...base, background: "#111", color: "#f5f0e8", border: "2.5px solid #111", boxShadow: "3px 3px 0 #555" };
  return { ...base, background: "#f5f0e8", color: "#111", border: "2.5px solid #111", boxShadow: "3px 3px 0 #999" };
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
function Spinner({ dark = false }) {
  return <span style={{ display: "inline-block", width: 13, height: 13, border: `2px solid ${dark ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.15)"}`, borderTopColor: dark ? "#111" : "#818cf8", borderRadius: "50%", animation: "spin 0.65s linear infinite", flexShrink: 0 }} />;
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState("inbox");

  // theme: "dark" | "light" | "brutalist"
  const [theme, setTheme] = useState(() => localStorage.getItem("bm_theme") || "dark");

  const [address, setAddress] = useState(null);
  const [token, setToken] = useState(null);
  const [messages, setMessages] = useState([]);
  const [openMsg, setOpenMsg] = useState(null);
  const [loadingAddr, setLoadingAddr] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [newCooldown, setNewCooldown] = useState(0);
  const [refreshCooldown, setRefreshCooldown] = useState(0);
  const [availableDomains, setAvailableDomains] = useState([]);
  const [starredIds, setStarredIds] = useState(() => new Set(JSON.parse(localStorage.getItem("bm_stars") || "[]")));
  const [search, setSearch] = useState("");
  const [deletedIds, setDeletedIds] = useState(() => new Set(JSON.parse(localStorage.getItem("bm_deleted") || "[]")));

  // Auth state
  const [authedUser, setAuthedUser] = useState(() => localStorage.getItem("bm_auth_user") || null);
  const [authedToken, setAuthedToken] = useState(() => localStorage.getItem("bm_auth_token") || null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  // Multi-account
  const [accounts, setAccounts] = useState(() => {
    try { return JSON.parse(localStorage.getItem("bm_accounts") || "[]"); } catch { return []; }
  });
  const [drawerOpen, setDrawerOpen] = useState(false);

  const brutalist = theme === "brutalist";
  const pollRef = useRef(null);
  const cdRef = useRef(null);

  const showToast = useCallback((msg, type = "") => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);

  // Persist theme
  useEffect(() => { localStorage.setItem("bm_theme", theme); }, [theme]);

  useEffect(() => {
    cdRef.current = setInterval(() => {
      setNewCooldown(RateLimit.check("rl_new", NEW_ADDR_LIMIT));
      setRefreshCooldown(RateLimit.check("rl_refresh", REFRESH_LIMIT));
    }, 250);
    return () => clearInterval(cdRef.current);
  }, []);

  const fetchMessages = useCallback(async (tok) => {
    if (!tok) return;
    try {
      const data = await apiFetch("/messages?page=1", {}, tok);
      setMessages(data["hydra:member"] || []);
    } catch {}
  }, []);

  const startPolling = useCallback((tok) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => fetchMessages(tok), 15000);
  }, [fetchMessages]);

  const fetchDomains = useCallback(async () => {
    try {
      const data = await apiFetch("/domains?page=1");
      const doms = data["hydra:member"] || [];
      setAvailableDomains(doms.map(d => d.domain));
      return doms;
    } catch { return []; }
  }, []);

  // ── Cloud sync helpers ─────────────────────────────────────────────────────
  const syncAddressToCloud = useCallback(async (addr, pass) => {
    if (!authedToken || !WORKER) return;
    try {
      await workerFetch("/user/addresses", { method: "POST", body: JSON.stringify({ address: addr, password: pass }) }, authedToken);
    } catch (e) {
      console.warn("Cloud sync failed:", e.message);
    }
  }, [authedToken]);

  const loadCloudAddresses = useCallback(async (tok) => {
    if (!tok || !WORKER) return [];
    try {
      const data = await workerFetch("/user/addresses", {}, tok);
      return data.addresses || [];
    } catch { return []; }
  }, []);

  const saveAccount = useCallback((addr, pass, tok) => {
    setAccounts(prev => {
      const filtered = prev.filter(a => a.address !== addr);
      const next = [...filtered, { address: addr, password: pass, token: tok }].slice(-10);
      localStorage.setItem("bm_accounts", JSON.stringify(next));
      return next;
    });
    // also sync to cloud if signed in
    syncAddressToCloud(addr, pass);
  }, [syncAddressToCloud]);

  const switchAccount = useCallback(async (acc) => {
    if (pollRef.current) clearInterval(pollRef.current);
    setLoadingMsgs(true); setMessages([]); setOpenMsg(null);
    try {
      const { token: tok } = await apiFetch("/token", { method: "POST", body: JSON.stringify({ address: acc.address, password: acc.password }) });
      Cookies.set("bm", { address: acc.address, password: acc.password, token: tok });
      setAddress(acc.address); setToken(tok);
      saveAccount(acc.address, acc.password, tok);
      await fetchMessages(tok); startPolling(tok);
      showToast(`Switched to ${acc.address.split("@")[0]}@…`, "success");
    } catch { showToast("Could not switch — token expired?", "error"); }
    setLoadingMsgs(false);
  }, [fetchMessages, startPolling, saveAccount, showToast]);

  const deleteAccount = useCallback((addr) => {
    setAccounts(prev => {
      const next = prev.filter(a => a.address !== addr);
      localStorage.setItem("bm_accounts", JSON.stringify(next));
      return next;
    });
    if (addr === address) {
      Cookies.del("bm");
      if (pollRef.current) clearInterval(pollRef.current);
      setAddress(null); setToken(null); setMessages([]);
    }
    showToast("Inbox removed", "");
  }, [address, showToast]);

  const createAddress = useCallback(async (silent = false) => {
    const wait = RateLimit.check("rl_new", NEW_ADDR_LIMIT);
    if (wait > 0) { showToast(`Wait ${Math.ceil(wait / 1000)}s`, "error"); return; }
    if (pollRef.current) clearInterval(pollRef.current);
    setLoadingAddr(true); setMessages([]); setAddress(null); setToken(null); Cookies.del("bm");
    try {
      const doms = await fetchDomains();
      if (!doms?.length) throw new Error("No domains available");
      const domain = doms[Math.floor(Math.random() * doms.length)].domain;
      const addr = rand(10) + "@" + domain;
      const pass = rand(18);
      await apiFetch("/accounts", { method: "POST", body: JSON.stringify({ address: addr, password: pass }) });
      const { token: tok } = await apiFetch("/token", { method: "POST", body: JSON.stringify({ address: addr, password: pass }) });
      Cookies.set("bm", { address: addr, password: pass, token: tok });
      RateLimit.mark("rl_new");
      saveAccount(addr, pass, tok);
      setAddress(addr); setToken(tok); setLoadingAddr(false);
      if (!silent) showToast("New address created", "success");
      await fetchMessages(tok); startPolling(tok);
    } catch (e) { setLoadingAddr(false); showToast("Failed: " + e.message, "error"); }
  }, [fetchDomains, fetchMessages, startPolling, saveAccount, showToast]);

  const createCustomAddress = useCallback(async (customAddr) => {
    const wait = RateLimit.check("rl_new", NEW_ADDR_LIMIT);
    if (wait > 0) { showToast(`Wait ${Math.ceil(wait / 1000)}s`, "error"); return; }
    if (pollRef.current) clearInterval(pollRef.current);
    setLoadingAddr(true); setMessages([]); setAddress(null); setToken(null); Cookies.del("bm");
    try {
      const pass = rand(18);
      await apiFetch("/accounts", { method: "POST", body: JSON.stringify({ address: customAddr, password: pass }) });
      const { token: tok } = await apiFetch("/token", { method: "POST", body: JSON.stringify({ address: customAddr, password: pass }) });
      Cookies.set("bm", { address: customAddr, password: pass, token: tok });
      RateLimit.mark("rl_new");
      saveAccount(customAddr, pass, tok);
      setAddress(customAddr); setToken(tok); setLoadingAddr(false);
      showToast("Custom address created!", "success");
      await fetchMessages(tok); startPolling(tok);
    } catch (e) {
      setLoadingAddr(false);
      if (e.message.includes("already") || e.message.includes("exist") || e.message.includes("422")) {
        showToast("That address is already taken — try another.", "error");
      } else { showToast("Failed: " + e.message, "error"); }
    }
  }, [fetchMessages, startPolling, saveAccount, showToast]);

  const handleRefresh = useCallback(async () => {
    const wait = RateLimit.check("rl_refresh", REFRESH_LIMIT);
    if (wait > 0) { showToast(`Wait ${Math.ceil(wait / 1000)}s`, "error"); return; }
    RateLimit.mark("rl_refresh");
    setLoadingMsgs(true); await fetchMessages(token); setLoadingMsgs(false);
    showToast("Inbox refreshed", "success");
  }, [token, fetchMessages, showToast]);

  const handleOpen = useCallback(async (id) => {
    try {
      const msg = await apiFetch("/messages/" + id, {}, token);
      apiFetch("/messages/" + id, { method: "PATCH", headers: { "Content-Type": "application/merge-patch+json" }, body: JSON.stringify({ seen: true }) }, token).catch(() => {});
      setMessages(ms => ms.map(m => m.id === id ? { ...m, seen: true } : m));
      setOpenMsg(msg);
    } catch { showToast("Could not load message", "error"); }
  }, [token, showToast]);

  const handleDelete = useCallback((id) => {
    apiFetch("/messages/" + id, { method: "DELETE" }, token).catch(() => {});
    setMessages(ms => ms.filter(m => m.id !== id));
    setDeletedIds(prev => {
      const next = new Set(prev); next.add(id);
      localStorage.setItem("bm_deleted", JSON.stringify([...next]));
      return next;
    });
    if (openMsg?.id === id) setOpenMsg(null);
    showToast("Message deleted", "");
  }, [token, openMsg, showToast]);

  const handleStar = useCallback((id) => {
    setStarredIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); showToast("Unstarred", ""); }
      else { next.add(id); showToast("Starred", "success"); }
      localStorage.setItem("bm_stars", JSON.stringify([...next]));
      return next;
    });
  }, [showToast]);

  const handleMarkRead = useCallback((id) => {
    apiFetch("/messages/" + id, { method: "PATCH", headers: { "Content-Type": "application/merge-patch+json" }, body: JSON.stringify({ seen: true }) }, token).catch(() => {});
    setMessages(ms => ms.map(m => m.id === id ? { ...m, seen: true } : m));
  }, [token]);

  const handleClearCookies = useCallback(() => {
    Cookies.del("bm"); localStorage.clear();
    if (pollRef.current) clearInterval(pollRef.current);
    setAddress(null); setToken(null); setMessages([]);
    setStarredIds(new Set()); setDeletedIds(new Set()); setAccounts([]);
    setAuthedUser(null); setAuthedToken(null);
    showToast("All data cleared", "success");
  }, [showToast]);

  const handleCopy = useCallback(async () => {
    if (!address) return;
    try { await navigator.clipboard.writeText(address); }
    catch { const el = document.createElement("input"); el.value = address; document.body.appendChild(el); el.select(); document.execCommand("copy"); el.remove(); }
    showToast("Copied to clipboard!", "success");
  }, [address, showToast]);

  // ── Auth handlers ──────────────────────────────────────────────────────────
  const handleAuthSuccess = useCallback(async (tok, user) => {
    setAuthedUser(user); setAuthedToken(tok);
    localStorage.setItem("bm_auth_user", user);
    localStorage.setItem("bm_auth_token", tok);
    setShowAuthModal(false);
    showToast(`Welcome, ${user}!`, "success");

    // Load cloud addresses and merge into local accounts
    const cloudAddresses = await loadCloudAddresses(tok);
    if (cloudAddresses.length > 0) {
      setAccounts(prev => {
        const merged = [...prev];
        cloudAddresses.forEach(ca => {
          if (!merged.find(a => a.address === ca.address)) {
            merged.push({ address: ca.address, password: ca.password, token: null });
          }
        });
        const trimmed = merged.slice(-10);
        localStorage.setItem("bm_accounts", JSON.stringify(trimmed));
        return trimmed;
      });
      showToast(`Loaded ${cloudAddresses.length} saved inbox${cloudAddresses.length > 1 ? "es" : ""}`, "success");
    }
  }, [loadCloudAddresses, showToast]);

  const handleSignOut = useCallback(() => {
    setAuthedUser(null); setAuthedToken(null);
    localStorage.removeItem("bm_auth_user");
    localStorage.removeItem("bm_auth_token");
    showToast("Signed out", "");
  }, [showToast]);

  const boot = useCallback(async () => {
    await fetchDomains();
    const saved = Cookies.get("bm");
    if (saved?.address && saved?.token) {
      try {
        const data = await apiFetch("/messages?page=1", {}, saved.token);
        setAddress(saved.address); setToken(saved.token);
        setMessages(data["hydra:member"] || []);
        if (saved.password) saveAccount(saved.address, saved.password, saved.token);
        startPolling(saved.token); return;
      } catch {}
    }
    await createAddress(true);
  }, [createAddress, startPolling, fetchDomains, saveAccount]);

  const handleLoadingDone = useCallback(() => { setReady(true); boot(); }, [boot]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { setOpenMsg(null); setDrawerOpen(false); setShowAuthModal(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visibleMessages = messages.filter(m => !deletedIds.has(m.id));
  const unread = visibleMessages.filter(m => !m.seen).length;

  // ── Derived colors for text/bg from theme ─────────────────────────────────
  const textColor = brutalist ? "#111" : "#e2e8f0";
  const headerBg = brutalist ? "rgba(245,240,232,0.97)" : theme === "light" ? "rgba(240,240,255,0.55)" : "rgba(6,6,16,0.45)";
  const headerBorder = brutalist ? "3px solid #111" : theme === "light" ? "1px solid rgba(0,0,0,0.07)" : "1px solid rgba(255,255,255,0.06)";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;700;800;900&family=JetBrains+Mono:wght@300;400;500&display=swap');
        :root { --font-display: 'Outfit', sans-serif; --font-mono: 'JetBrains Mono', 'Fira Mono', monospace; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; }
        body { font-family: var(--font-mono); -webkit-font-smoothing: antialiased; overflow-x: hidden; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:none; } }
        @keyframes livePulse { 0%,100%{box-shadow:0 0 0 3px rgba(74,222,128,0.2)} 50%{box-shadow:0 0 0 6px rgba(74,222,128,0.05)} }
        .term-cursor { display:inline-block; width:7px; height:12px; background:rgba(129,140,248,0.7); margin-left:3px; vertical-align:middle; animation:termBlink 1s steps(1) infinite; }
        @keyframes termBlink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes terminalPulse { 0%,100%{opacity:0.35;transform:scale(1)} 50%{opacity:0.55;transform:scale(1.06)} }
        .glitch-text { position:relative; }
        .glitch-text::before,.glitch-text::after { content:attr(data-text); position:absolute; top:0; left:0; width:100%; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
        .glitch-text::before { color:#818cf8; animation:glitch1 8s infinite; clip-path:polygon(0 0,100% 0,100% 35%,0 35%); opacity:0; }
        .glitch-text::after  { color:#f472b6; animation:glitch2 8s infinite; clip-path:polygon(0 65%,100% 65%,100% 100%,0 100%); opacity:0; }
        @keyframes glitch1 { 0%,94%,100%{opacity:0;transform:none} 95%{opacity:0.6;transform:translateX(-2px)} 96%{opacity:0;transform:translateX(2px)} 97%{opacity:0.4;transform:translateX(0)} }
        @keyframes glitch2 { 0%,92%,100%{opacity:0;transform:none} 93%{opacity:0.5;transform:translateX(2px)} 94%{opacity:0;transform:translateX(-1px)} 95%{opacity:0.3;transform:translateX(0)} }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.2); border-radius: 4px; }
        button:focus-visible { outline: 2px solid rgba(99,102,241,0.6); outline-offset: 2px; }
        input:focus { border-color: rgba(99,102,241,0.5) !important; }
        select option { background: #0f0f1e; }
        @media (max-width: 540px) { .nav-label { display: none !important; } .logo-wordmark { display: none; } }
        @media (min-width: 541px) { .nav-label { display: inline; } .logo-wordmark { display: inline; } }
      `}</style>

      {!ready && <LoadingScreen onDone={handleLoadingDone} />}

      {ready && (
        <div style={{ position: "relative", minHeight: "100vh", color: textColor, transition: "color 0.3s ease" }}>
          <SpotlightBg theme={theme} />

          <div style={{ position: "relative", zIndex: 1, minHeight: "100vh", display: "flex", flexDirection: "column" }}>

            {/* ── Header ── */}
            <header style={{
              display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center",
              gap: 8, padding: "12px 16px",
              borderBottom: headerBorder, background: headerBg,
              backdropFilter: brutalist ? "none" : "blur(20px)",
              WebkitBackdropFilter: brutalist ? "none" : "blur(20px)",
              position: "sticky", top: 0, zIndex: 100,
              animation: "fadeUp 0.4s ease", transition: "background 0.3s ease",
              boxShadow: brutalist ? "0 3px 0 #111" : "none",
            }}>

              {/* Left: hamburger + logo */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => setDrawerOpen(true)} title="Switch inbox" style={brutalist ? {
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 36, height: 36, border: "2.5px solid #111", cursor: "pointer",
                  background: "#f5f0e8", color: "#111", position: "relative",
                } : {
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 36, height: 36, borderRadius: 10, border: "none", cursor: "pointer",
                  background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.6)",
                  transition: "all 0.18s", position: "relative",
                }}>
                  <Icon.Hamburger size={16} />
                  {accounts.length > 1 && (
                    <span style={{ position: "absolute", top: -5, right: -5, background: brutalist ? "#111" : "linear-gradient(135deg,#818cf8,#a78bfa)", color: brutalist ? "#f5f0e8" : "#fff", fontSize: 9, fontWeight: 700, width: 16, height: 16, borderRadius: brutalist ? 0 : "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-mono)", border: brutalist ? "1.5px solid #111" : "1.5px solid rgba(6,6,16,0.8)" }}>
                      {accounts.length}
                    </span>
                  )}
                </button>

                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <img src="/mail.png" alt="BurnerMail" width={26} height={26} style={{ borderRadius: brutalist ? 4 : 6, display: "block" }} onError={e => e.target.style.display = "none"} />
                  <span className="logo-wordmark" style={{ fontFamily: "var(--font-display)", fontWeight: 900, fontSize: 18, letterSpacing: "-0.5px", whiteSpace: "nowrap" }}>
                    {brutalist ? (
                      <span style={{ color: "#111" }}>Burner<span style={{ fontWeight: 400, color: "#888" }}>Mail</span></span>
                    ) : (
                      <><span style={{ background: "linear-gradient(135deg,#818cf8,#f472b6,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Burner</span><span style={{ color: "rgba(255,255,255,0.38)", fontWeight: 400 }}>Mail</span></>
                    )}
                  </span>
                </div>
              </div>

              {/* Center nav */}
              <div style={{ display: "flex", justifyContent: "center" }}>
                <PillNav tab={tab} setTab={setTab} unread={unread} brutalist={brutalist} />
              </div>

              {/* Right: sign-in button + status dot */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                {/* Sign-in / user button */}
                <button
                  onClick={() => authedUser ? setTab("settings") : setShowAuthModal(true)}
                  title={authedUser ? `Signed in as ${authedUser}` : "Sign in to sync inboxes"}
                  style={brutalist ? {
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "6px 12px", border: "2.5px solid #111",
                    background: authedUser ? "#c8f7c5" : "#f5f0e8",
                    cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, color: "#111",
                    boxShadow: "2px 2px 0 #111", whiteSpace: "nowrap",
                  } : {
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "6px 12px", borderRadius: 999,
                    background: authedUser ? "rgba(74,222,128,0.12)" : "rgba(255,255,255,0.07)",
                    border: authedUser ? "1px solid rgba(74,222,128,0.3)" : "1px solid rgba(255,255,255,0.12)",
                    cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 500,
                    color: authedUser ? "#4ade80" : "rgba(255,255,255,0.55)", whiteSpace: "nowrap",
                    transition: "all 0.18s",
                  }}
                >
                  <Icon.User size={13} />
                  <span className="nav-label">{authedUser ? authedUser : "Sign in"}</span>
                </button>

                {/* Status dot */}
                <div style={{ width: 9, height: 9, borderRadius: brutalist ? 0 : "50%", background: address && !loadingAddr ? "#4ade80" : "rgba(128,128,128,0.3)", boxShadow: !brutalist && address && !loadingAddr ? "0 0 0 3px rgba(74,222,128,0.2)" : "none", animation: !brutalist && address && !loadingAddr ? "livePulse 2s infinite" : "none", flexShrink: 0, border: brutalist ? "1.5px solid #111" : "none" }} />
              </div>
            </header>

            {/* ── Main content ── */}
            <main style={{ flex: 1, maxWidth: 760, width: "100%", margin: "0 auto", padding: "28px 16px 40px" }}>
              {tab === "inbox" && (
                <div style={{ display: "flex", flexDirection: "column", gap: brutalist ? 14 : 20 }}>
                  <AddressCard
                    address={address} availableDomains={availableDomains} loading={loadingAddr}
                    onCopy={handleCopy} onNew={() => createAddress(false)} onRefresh={handleRefresh}
                    onSetCustom={createCustomAddress} newCooldown={newCooldown} refreshCooldown={refreshCooldown}
                    brutalist={brutalist}
                  />

                  <Glass brutalist={brutalist} style={{ overflow: "hidden", animation: "fadeUp 0.5s 80ms both ease" }}>
                    <div style={brutalist ? {
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "12px 18px", borderBottom: "2.5px solid #111", background: "#fff",
                    } : {
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)",
                    }}>
                      <div style={{ fontFamily: brutalist ? "var(--font-display)" : "var(--font-display)", fontWeight: brutalist ? 900 : 700, fontSize: 14, display: "flex", alignItems: "center", gap: 10, color: brutalist ? "#111" : "inherit", letterSpacing: brutalist ? "-0.2px" : 0 }}>
                        <Icon.Inbox size={14} />
                        {brutalist ? "INBOX" : "Inbox"}
                        {unread > 0 && (
                          <span style={brutalist ? { background: "#111", color: "#f5f0e8", fontSize: 10, fontWeight: 700, padding: "2px 7px", letterSpacing: "1px" } : { background: "linear-gradient(135deg,#818cf8,#a78bfa)", color: "#fff", fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 999, lineHeight: "16px" }}>
                            {unread} new
                          </span>
                        )}
                      </div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: brutalist ? "#888" : "rgba(255,255,255,0.25)", letterSpacing: 1 }}>AUTO · 15s</div>
                    </div>

                    <div style={{ padding: "10px 16px", borderBottom: brutalist ? "2px solid #e8e4dc" : "1px solid rgba(255,255,255,0.05)" }}>
                      <SearchBar value={search} onChange={setSearch} brutalist={brutalist} />
                    </div>

                    <InboxView
                      messages={visibleMessages} onOpen={handleOpen} onDelete={handleDelete}
                      onStar={handleStar} onMarkRead={handleMarkRead} loading={loadingMsgs}
                      starredIds={starredIds} search={search} brutalist={brutalist}
                    />
                  </Glass>
                </div>
              )}

              {tab === "guide" && <GuideView brutalist={brutalist} />}

              {tab === "settings" && (
                <SettingsView
                  address={address} onClearCookies={handleClearCookies}
                  onNew={() => { createAddress(false); setTab("inbox"); }}
                  newCooldown={newCooldown} theme={theme} onSetTheme={setTheme}
                  authedUser={authedUser} onSignIn={() => setShowAuthModal(true)} onSignOut={handleSignOut}
                  brutalist={brutalist}
                />
              )}
            </main>
          </div>

          <AccountsDrawer
            open={drawerOpen} onClose={() => setDrawerOpen(false)}
            accounts={accounts} activeAddress={address}
            onSwitch={switchAccount} onDeleteAccount={deleteAccount}
            onAddNew={() => createAddress(false)} newCooldown={newCooldown}
            loadingAddr={loadingAddr} brutalist={brutalist}
          />

          {openMsg && (
            <MessageViewer
              msg={openMsg} onClose={() => setOpenMsg(null)}
              onDelete={handleDelete} onStar={() => handleStar(openMsg.id)}
              starred={starredIds.has(openMsg.id)} brutalist={brutalist}
            />
          )}
        </div>
      )}

      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={handleAuthSuccess}
          brutalist={brutalist}
        />
      )}

      <Toast toasts={toasts} brutalist={brutalist} />
    </>
  );
}
