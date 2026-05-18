import { useState, useEffect, useRef, useCallback, memo } from "react";

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

// ─── API ──────────────────────────────────────────────────────────────────────
const API = "https://api.mail.tm";

async function apiFetch(path, opts = {}, token = null) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(API + path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err["hydra:description"] || err.message || `HTTP ${res.status}`);
  }
  return res.json();
}

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
  ExternalLink: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  ),
  Search: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  QR: ({ size = 14 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="5" height="5" /><rect x="16" y="3" width="5" height="5" /><rect x="3" y="16" width="5" height="5" />
      <line x1="21" y1="16" x2="21" y2="21" /><line x1="16" y1="21" x2="21" y2="21" /><line x1="16" y1="16" x2="16" y2="16" />
      <line x1="12" y1="3" x2="12" y2="6" /><line x1="12" y1="9" x2="12" y2="12" /><line x1="3" y1="12" x2="6" y2="12" /><line x1="9" y1="12" x2="12" y2="12" />
    </svg>
  ),
  // Hamburger icon for accounts drawer
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
};

// ─── Animated spotlight background ────────────────────────────────────────────
function SpotlightBg({ lightMode }) {
  const ref = useRef(null);
  const colorRef = useRef({ t: 0 });

  useEffect(() => {
    const el = ref.current;
    let mx = 50, my = 40;
    let animFrame;

    const move = (e) => {
      mx = e.clientX / window.innerWidth * 100;
      my = e.clientY / window.innerHeight * 100;
    };
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
  }, [lightMode]);

  return (
    <div ref={ref} style={{ position: "fixed", inset: 0, zIndex: 0, overflow: "hidden", "--mx": "50%", "--my": "40%", "--orb1-color": "rgba(99,102,241,0.13)", "--orb2-color": "rgba(139,92,246,0.10)", "--orb3-color": "rgba(59,130,246,0.09)" }}>
      <div style={{ position: "absolute", inset: 0, background: lightMode ? "radial-gradient(ellipse 120% 80% at 50% 0%, #f0f0ff 0%, #e8eaf6 100%)" : "radial-gradient(ellipse 120% 80% at 50% 0%, #0d0d1a 0%, #060610 100%)", transition: "background 0.4s ease" }} />
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle 700px at var(--mx) var(--my), var(--orb1-color) 0%, transparent 70%)" }} />
      <div style={{ position: "absolute", width: 800, height: 800, top: -200, left: -150, background: "radial-gradient(circle, var(--orb2-color) 0%, transparent 65%)", borderRadius: "50%", animation: "orb1 18s ease-in-out infinite alternate" }} />
      <div style={{ position: "absolute", width: 700, height: 700, bottom: -150, right: -100, background: "radial-gradient(circle, var(--orb3-color) 0%, transparent 65%)", borderRadius: "50%", animation: "orb2 22s ease-in-out infinite alternate" }} />
      <div style={{ position: "absolute", width: 500, height: 500, top: "40%", left: "60%", background: "radial-gradient(circle, rgba(244,114,182,0.06) 0%, transparent 65%)", borderRadius: "50%", animation: "orb3 14s ease-in-out infinite alternate" }} />
      {/* nano-mail inspired: subtle scanlines */}
      <div className="scanlines" />
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px)", backgroundSize: "60px 60px" }} />
      <div style={{ position: "absolute", inset: 0, opacity: 0.3, backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E")` }} />
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
function Toast({ toasts }) {
  return (
    <div style={{ position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)", zIndex: 9999, display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
      {toasts.map(t => (
        <div key={t.id} style={{
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

// ─── Loading phrases ──────────────────────────────────────────────────────────
const LOADING_PHRASES = [
  "SETTING UP YOUR INBOX…",
  "SPAWNING A FRESH ADDRESS…",
  "WARMING UP THE SERVERS…",
  "ALMOST THERE…",
  "JUST A MOMENT…",
];

// ─── Loading screen ───────────────────────────────────────────────────────────
function LoadingScreen({ onDone }) {
  const TOTAL = 5;
  const [count, setCount] = useState(TOTAL);
  const [phase, setPhase] = useState("loading");
  const [phraseIdx, setPhraseIdx] = useState(0);

  useEffect(() => {
    const phraseInterval = setInterval(() => setPhraseIdx(i => (i + 1) % LOADING_PHRASES.length), 1800);
    return () => clearInterval(phraseInterval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setCount(c => {
        if (c <= 1) { clearInterval(interval); setPhase("ready"); return 0; }
        return c - 1;
      });
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
          <circle cx="48" cy="48" r="45" fill="none" stroke="url(#lg)" strokeWidth="4"
            strokeDasharray="283" strokeDashoffset={283 - pct}
            strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(0.4,0,0.2,1)" }} />
          <defs>
            <linearGradient id="lg" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#818cf8" /><stop offset="100%" stopColor="#f472b6" />
            </linearGradient>
          </defs>
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ color: "#e2e8f0", fontSize: 24, fontFamily: "var(--font-display)", fontWeight: 800, lineHeight: 1 }}>
            {phase === "ready" ? <Icon.Check size={24} /> : count}
          </div>
        </div>
      </div>
      {/* nano-mail inspired tagline under loader */}
      <div style={{ fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 900, letterSpacing: "-0.8px", marginBottom: 8, zIndex: 1 }}>
        <span style={{ background: "linear-gradient(135deg,#818cf8,#f472b6,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Burner</span>
        <span style={{ color: "rgba(255,255,255,0.45)", fontWeight: 400 }}>Mail</span>
      </div>
      <p style={{ color: "rgba(255,255,255,0.18)", fontSize: 10, fontFamily: "var(--font-mono)", letterSpacing: "3px", zIndex: 1, marginBottom: 6 }}>
        FAST · PRIVATE · DISPOSABLE
      </p>
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

// ─── Pill nav ─────────────────────────────────────────────────────────────────
function PillNav({ tab, setTab, unread }) {
  const tabs = [
    { id: "inbox", label: "Inbox", icon: <Icon.Inbox size={17} /> },
    { id: "guide", label: "How to Use", icon: <Icon.Guide size={17} /> },
    { id: "settings", label: "Settings", icon: <Icon.Settings size={17} /> },
  ];
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 3,
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.11)",
      borderRadius: 999, padding: "5px",
      backdropFilter: "blur(20px)",
      boxShadow: "0 4px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.08)",
    }}>
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          title={t.label}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
            padding: "10px 18px", borderRadius: 999, border: "none", cursor: "pointer",
            transition: "all 0.2s cubic-bezier(0.4,0,0.2,1)",
            background: tab === t.id ? "linear-gradient(135deg,rgba(99,102,241,0.8),rgba(139,92,246,0.7))" : "transparent",
            color: tab === t.id ? "#fff" : "rgba(255,255,255,0.45)",
            boxShadow: tab === t.id ? "0 2px 14px rgba(99,102,241,0.4), inset 0 1px 0 rgba(255,255,255,0.15)" : "none",
            position: "relative",
            fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 500,
          }}
        >
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

// ─── Glass card ───────────────────────────────────────────────────────────────
function Glass({ children, style = {}, ...props }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.04)",
      backdropFilter: "blur(24px) saturate(180%)",
      WebkitBackdropFilter: "blur(24px) saturate(180%)",
      border: "1px solid rgba(255,255,255,0.09)",
      borderRadius: 20,
      boxShadow: "0 8px 40px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.07)",
      ...style,
    }} {...props}>
      {children}
    </div>
  );
}

// ─── Accounts Drawer ──────────────────────────────────────────────────────────
function AccountsDrawer({ open, onClose, accounts, activeAddress, onSwitch, onDeleteAccount, onAddNew, newCooldown, loadingAddr }) {
  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(6,6,16,0.6)", backdropFilter: "blur(4px)", animation: "fadeIn 0.2s ease" }}
      />
      {/* Drawer */}
      <div style={{
        position: "fixed", top: 0, left: 0, bottom: 0, width: 300, maxWidth: "85vw",
        zIndex: 401, display: "flex", flexDirection: "column",
        background: "rgba(10,10,24,0.97)",
        backdropFilter: "blur(30px) saturate(180%)",
        borderRight: "1px solid rgba(255,255,255,0.09)",
        boxShadow: "4px 0 40px rgba(0,0,0,0.6)",
        animation: "drawerSlideIn 0.28s cubic-bezier(0.32,0.72,0,1)",
      }}>
        {/* Drawer header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 16, color: "#e2e8f0" }}>Inboxes</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: "1.5px", marginTop: 2 }}>
              {accounts.length} ADDRESS{accounts.length !== 1 ? "ES" : ""}
            </div>
          </div>
          <button onClick={onClose} style={{ ...iconBtnBase("rgba(255,255,255,0.4)"), width: 32, height: 32, borderRadius: 8 }}>
            <Icon.Close size={15} />
          </button>
        </div>

        {/* Account list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }}>
          {accounts.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 16px", color: "rgba(255,255,255,0.25)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
              No saved inboxes yet
            </div>
          )}
          {accounts.map((acc, i) => {
            const isActive = acc.address === activeAddress;
            const hue = hashStr(acc.address) % 360;
            const initials = acc.address[0].toUpperCase();
            return (
              <div
                key={acc.address}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 10px", borderRadius: 12, marginBottom: 4,
                  background: isActive ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.03)",
                  border: isActive ? "1px solid rgba(99,102,241,0.35)" : "1px solid transparent",
                  transition: "all 0.15s",
                  animation: `fadeUp 0.3s ${i * 50}ms both ease`,
                  cursor: isActive ? "default" : "pointer",
                }}
                onClick={() => !isActive && onSwitch(acc)}
              >
                {/* Avatar */}
                <div style={{ width: 36, height: 36, borderRadius: "50%", flexShrink: 0, background: `hsl(${hue},40%,24%)`, border: `1px solid hsl(${hue},40%,34%)`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontSize: 13, fontWeight: 700, color: `hsl(${hue},60%,75%)`, userSelect: "none" }}>
                  {initials}
                </div>
                {/* Address info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: isActive ? "#c7d2fe" : "rgba(255,255,255,0.6)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: isActive ? 500 : 400 }}>
                    {acc.address}
                  </div>
                  {isActive && (
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "#818cf8", letterSpacing: "1px", marginTop: 2 }}>● ACTIVE</div>
                  )}
                </div>
                {/* Actions */}
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  {!isActive && (
                    <button
                      onClick={e => { e.stopPropagation(); onSwitch(acc); }}
                      title="Switch to this inbox"
                      style={iconBtnBase("rgba(129,140,248,0.8)")}
                    >
                      <Icon.SwitchHoriz size={12} />
                    </button>
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); onDeleteAccount(acc.address); }}
                    title="Remove this inbox"
                    style={iconBtnBase("rgba(248,113,113,0.6)")}
                  >
                    <Icon.Delete size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Add new */}
        <div style={{ padding: "14px 16px", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <CooldownButton
            icon={<Icon.New size={13} />}
            label="Add new inbox"
            onClick={() => { onAddNew(); onClose(); }}
            cooldown={newCooldown}
            limitMs={NEW_ADDR_LIMIT}
            disabled={loadingAddr}
            primary
          />
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "rgba(255,255,255,0.2)", marginTop: 10, textAlign: "center", letterSpacing: "1px" }}>
            FAST · PRIVATE · DISPOSABLE
          </div>
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
  return {
    display: "flex", alignItems: "center", justifyContent: "center",
    width: 28, height: 28, borderRadius: 7, border: "none",
    background: "rgba(255,255,255,0.06)", cursor: "pointer",
    color, transition: "background 0.15s",
  };
}

// ─── Address card with custom email support ───────────────────────────────────
function AddressCard({ address, availableDomains, onCopy, onNew, onRefresh, onSetCustom, newCooldown, refreshCooldown, loading }) {
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
    setCustomMode(false);
    setCustomLocal("");
  };

  return (
    <Glass style={{ padding: "28px 28px 24px", position: "relative", overflow: "hidden", animation: "fadeUp 0.5s ease" }}>
      <div style={{ position: "absolute", top: -80, right: -80, width: 280, height: 280, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.10), transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: -60, left: -40, width: 200, height: 200, borderRadius: "50%", background: "radial-gradient(circle, rgba(244,114,182,0.06), transparent 70%)", pointerEvents: "none" }} />

      {/* nano-mail inspired: "FAST · PRIVATE · DISPOSABLE" tag */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 10, letterSpacing: "2.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.35)", fontFamily: "var(--font-mono)" }}>
          Your temporary address
        </div>
        <div style={{ fontSize: 9, letterSpacing: "2px", color: "rgba(129,140,248,0.5)", fontFamily: "var(--font-mono)", display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: "rgba(74,222,128,0.7)", animation: "livePulse 2s infinite" }} />
          DISPOSABLE
        </div>
      </div>

      {!customMode ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{
              flex: 1, minWidth: 0,
              fontFamily: "var(--font-mono)", fontSize: "clamp(13px,3vw,18px)", fontWeight: 500,
              color: loading ? "rgba(255,255,255,0.3)" : "#e2e8f0",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              fontStyle: loading ? "italic" : "normal",
            }}>
              {loading
                ? <span style={{ display: "flex", alignItems: "center", gap: 8 }}><Spinner /> generating…</span>
                : address
                  ? <span className="glitch-text" data-text={address}>{address}</span>
                  : "—"
              }
            </div>
            {address && !loading && (
              <button onClick={onCopy} style={btnStyle("ghost")}><Icon.Copy size={13} /> Copy</button>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
            <CooldownButton icon={<Icon.New size={13} />} label="New address" onClick={onNew} cooldown={newCooldown} limitMs={NEW_ADDR_LIMIT} disabled={loading} primary />
            <CooldownButton icon={<Icon.Refresh size={13} />} label="Refresh" onClick={onRefresh} cooldown={refreshCooldown} limitMs={REFRESH_LIMIT} disabled={loading || !address} />
            <button onClick={() => setCustomMode(true)} style={btnStyle("ghost")} disabled={loading || !availableDomains.length}>
              <Icon.Edit size={13} /> Custom
            </button>
          </div>
        </>
      ) : (
        <div style={{ animation: "fadeUp 0.25s ease" }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontFamily: "var(--font-mono)", marginBottom: 10 }}>Choose your own username:</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              autoFocus
              value={customLocal}
              onChange={e => { setCustomLocal(e.target.value); setCustomError(""); }}
              onKeyDown={e => e.key === "Enter" && handleCustomSubmit()}
              placeholder="username"
              style={{ flex: 1, minWidth: 120, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "9px 14px", fontFamily: "var(--font-mono)", fontSize: 14, color: "#e2e8f0", outline: "none" }}
            />
            <span style={{ color: "rgba(255,255,255,0.4)", fontFamily: "var(--font-mono)", fontSize: 14, whiteSpace: "nowrap" }}>@</span>
            {availableDomains.length > 1 ? (
              <select value={selectedDomain} onChange={e => setSelectedDomain(e.target.value)} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10, padding: "9px 12px", fontFamily: "var(--font-mono)", fontSize: 13, color: "#e2e8f0", outline: "none", cursor: "pointer" }}>
                {availableDomains.map(d => <option key={d} value={d} style={{ background: "#0f0f1e" }}>{d}</option>)}
              </select>
            ) : (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "rgba(255,255,255,0.6)" }}>{selectedDomain}</span>
            )}
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
function CooldownButton({ icon, label, onClick, cooldown, limitMs, disabled, primary }) {
  const pct = cooldown > 0 ? Math.round((1 - cooldown / limitMs) * 100) : 100;
  const isBlocked = cooldown > 0;
  const secs = Math.ceil(cooldown / 1000);
  return (
    <button onClick={!isBlocked && !disabled ? onClick : undefined} disabled={isBlocked || disabled}
      style={{ ...btnStyle(primary ? "primary" : "ghost"), position: "relative", overflow: "hidden", opacity: isBlocked || disabled ? 0.55 : 1, cursor: isBlocked || disabled ? "not-allowed" : "pointer" }}>
      {isBlocked && <span style={{ position: "absolute", inset: 0, left: 0, background: "rgba(99,102,241,0.18)", width: pct + "%", transition: "width 0.5s linear", borderRadius: "inherit" }} />}
      <span style={{ position: "relative", display: "flex", alignItems: "center", gap: 6 }}>
        {isBlocked ? <><Icon.Clock size={13} /> {secs}s</> : <>{icon} {label}</>}
      </span>
    </button>
  );
}

// ─── Search bar ───────────────────────────────────────────────────────────────
function SearchBar({ value, onChange }) {
  return (
    <div style={{ position: "relative", marginBottom: 0 }}>
      <div style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.3)", pointerEvents: "none" }}>
        <Icon.Search size={14} />
      </div>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Search messages…"
        style={{
          width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 12, padding: "10px 14px 10px 36px",
          fontFamily: "var(--font-mono)", fontSize: 13, color: "#e2e8f0",
          outline: "none", transition: "border 0.2s",
        }}
      />
    </div>
  );
}

// ─── Inbox view ───────────────────────────────────────────────────────────────
function InboxView({ messages, onOpen, onDelete, onStar, onMarkRead, loading, starredIds, search }) {
  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "rgba(255,255,255,0.3)", gap: 10, fontFamily: "var(--font-mono)", fontSize: 13 }}>
        <Spinner /> Loading messages…
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
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "56px 24px", color: "rgba(255,255,255,0.25)" }}>
        <div style={{ opacity: 0.35, animation: "terminalPulse 3s ease-in-out infinite" }}><Icon.Mail size={40} /></div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 700, color: "rgba(255,255,255,0.4)" }}>
          {search ? "No matching messages" : "Waiting for mail"}
        </div>
        {/* nano-mail inspired terminal cursor empty state */}
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, textAlign: "center", lineHeight: 1.7, maxWidth: 280, color: "rgba(255,255,255,0.28)" }}>
          {search
            ? "Try a different search term."
            : <>Copy your address above and paste it anywhere.<br /><span style={{ color: "rgba(129,140,248,0.5)" }}>inbox listening<span className="term-cursor" /></span></>
          }
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {filtered.map((m, i) => (
        <MessageRow
          key={m.id} msg={m} onClick={() => onOpen(m.id)} delay={i * 40}
          onDelete={e => { e.stopPropagation(); onDelete(m.id); }}
          onStar={e => { e.stopPropagation(); onStar(m.id); }}
          onMarkRead={e => { e.stopPropagation(); onMarkRead(m.id); }}
          starred={starredIds.has(m.id)}
        />
      ))}
    </div>
  );
}

function MessageRow({ msg, onClick, delay, onDelete, onStar, onMarkRead, starred }) {
  const [hover, setHover] = useState(false);
  const initials = (msg.from?.address || "?")[0].toUpperCase();
  const hue = hashStr(msg.from?.address || "") % 360;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "grid", gridTemplateColumns: "40px 1fr auto", gridTemplateRows: "auto auto",
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
      }}
    >
      <div style={{ gridRow: "span 2", width: 38, height: 38, borderRadius: "50%", flexShrink: 0, background: `hsl(${hue},40%,28%)`, border: `1px solid hsl(${hue},40%,38%)`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 700, color: `hsl(${hue},60%,80%)`, userSelect: "none" }}>
        {initials}
      </div>
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
            <button onClick={onStar} title={starred ? "Unstar" : "Star"} style={iconBtn(starred ? "#fbbf24" : "rgba(255,255,255,0.4)")}>
              {starred ? <Icon.StarFilled size={12} /> : <Icon.Star size={12} />}
            </button>
            {!msg.seen && (
              <button onClick={onMarkRead} title="Mark as read" style={iconBtn("rgba(255,255,255,0.4)")}><Icon.MarkRead size={12} /></button>
            )}
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
function MessageViewer({ msg, onClose, onDelete, onStar, starred }) {
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
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `email-${msg.id}.txt`; a.click();
  };

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
          <button onClick={onStar} title={starred ? "Unstar" : "Star"} style={{ ...btnStyle("ghost"), color: starred ? "#fbbf24" : undefined, padding: "7px 10px" }}>
            {starred ? <Icon.StarFilled size={13} /> : <Icon.Star size={13} />}
          </button>
          <button onClick={downloadText} title="Download as .txt" style={{ ...btnStyle("ghost"), padding: "7px 10px" }}><Icon.Download size={13} /></button>
          <button onClick={() => onDelete(msg.id)} title="Delete" style={{ ...btnStyle("ghost"), color: "#f87171", padding: "7px 10px" }}><Icon.Delete size={13} /></button>
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "24px", animation: "msgPanelIn 0.4s 0.05s cubic-bezier(0.32,0.72,0,1) both" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, overflow: "hidden" }}>
          {html ? (
            <iframe ref={iframeRef} sandbox="allow-same-origin" style={{ width: "100%", border: "none", minHeight: 300, display: "block", background: "#fff" }} />
          ) : (
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
const GuideView = memo(function GuideView() {
  const steps = [
    { icon: <Icon.Shield size={20} />, title: "Auto-generated address", body: "A random temporary email is created the moment you open the app. No sign-up, no personal data required." },
    { icon: <Icon.Edit size={20} />, title: "Or pick your own username", body: "Hit Custom to enter your preferred username and choose from available domains." },
    { icon: <Icon.Copy size={20} />, title: "Copy & use it anywhere", body: "Hit Copy and paste it into any site asking for your email — sign-ups, verifications, free trials." },
    { icon: <Icon.Inbox size={20} />, title: "Emails arrive automatically", body: "Your inbox auto-refreshes every 15 seconds. New emails show an unread indicator — click any to open." },
    { icon: <Icon.Star size={20} />, title: "Star & manage emails", body: "Hover a message to star it, mark it read, or delete it. Inside a message you can also download the content." },
    { icon: <Icon.Search size={20} />, title: "Search your inbox", body: "Use the search bar to filter messages by sender or subject instantly." },
    { icon: <Icon.Hamburger size={20} />, title: "Multiple inboxes", body: "Tap the menu icon (top-left) to manage multiple addresses. Switch between them instantly — each keeps its own session." },
    { icon: <Icon.New size={20} />, title: "Need a fresh address?", body: "Hit New Address for a brand-new random one. Once per minute to prevent abuse." },
    { icon: <Icon.Settings size={20} />, title: "Your session is saved", body: "Your address and token are stored in a cookie for 30 days so you don't lose access on page refresh." },
  ];
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

// ─── Sun / Moon ───────────────────────────────────────────────────────────────
const SunIcon = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
);
const MoonIcon = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
  </svg>
);

// ─── Settings view ────────────────────────────────────────────────────────────
function SettingsView({ address, onClearCookies, onNew, newCooldown, lightMode, onToggleLight }) {
  const lbl = { fontSize: 10, letterSpacing: "2px", textTransform: "uppercase", color: lightMode ? "rgba(0,0,0,0.38)" : "rgba(255,255,255,0.3)", fontFamily: "var(--font-mono)", marginBottom: 12 };
  const bodyTxt = { fontFamily: "var(--font-mono)", fontSize: 12, color: lightMode ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.5)", lineHeight: 1.7 };
  const glassLight = lightMode ? { background: "rgba(255,255,255,0.75)", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 4px 20px rgba(0,0,0,0.06)" } : {};

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, animation: "fadeUp 0.4s ease" }}>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 800, color: lightMode ? "#1a1a2e" : "#e2e8f0", marginBottom: 4 }}>Settings</div>

      <Glass style={{ padding: "20px 22px", ...glassLight }}>
        <div style={lbl}>Appearance</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 600, color: lightMode ? "#1a1a2e" : "#e2e8f0", marginBottom: 3 }}>{lightMode ? "Light mode" : "Dark mode"}</div>
            <div style={bodyTxt}>Switch between light and dark themes.</div>
          </div>
          <div onClick={onToggleLight} style={{ width: 50, height: 27, borderRadius: 999, cursor: "pointer", flexShrink: 0, marginLeft: 20, background: lightMode ? "linear-gradient(135deg,#818cf8,#a78bfa)" : "rgba(255,255,255,0.1)", border: lightMode ? "none" : "1px solid rgba(255,255,255,0.14)", position: "relative", transition: "all 0.25s ease", boxShadow: lightMode ? "0 2px 10px rgba(99,102,241,0.4)" : "none" }}>
            <div style={{ position: "absolute", top: 3, left: lightMode ? 23 : 3, width: 21, height: 21, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.2)", transition: "left 0.25s cubic-bezier(0.34,1.56,0.64,1)", display: "flex", alignItems: "center", justifyContent: "center", color: lightMode ? "#818cf8" : "#64748b" }}>
              {lightMode ? <SunIcon /> : <MoonIcon />}
            </div>
          </div>
        </div>
      </Glass>

      <Glass style={{ padding: "20px 22px", ...glassLight }}>
        <div style={lbl}>Current address</div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: lightMode ? "#4f46e5" : "#c7d2fe", wordBreak: "break-all", marginBottom: 16 }}>{address || "Not generated yet"}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <CooldownButton icon={<Icon.New size={13} />} label="Generate new" onClick={onNew} cooldown={newCooldown} limitMs={NEW_ADDR_LIMIT} primary />
        </div>
      </Glass>

      <Glass style={{ padding: "20px 22px", ...glassLight }}>
        <div style={lbl}>Storage</div>
        <div style={{ ...bodyTxt, marginBottom: 14 }}>Your address and session token are saved in a cookie for 30 days so you don't lose access on refresh.</div>
        <button onClick={onClearCookies} style={{ ...btnStyle("ghost"), borderColor: "rgba(248,113,113,0.3)", color: "#f87171" }}>
          <Icon.Delete size={13} /> Clear all data
        </button>
      </Glass>

      <Glass style={{ padding: "20px 22px", ...glassLight }}>
        <div style={lbl}>Rate limits</div>
        <div style={bodyTxt}>
          New address — 60 second cooldown<br />
          Inbox refresh — 10 second cooldown<br />
          Auto-poll interval — every 15 seconds<br />
          <span style={{ color: lightMode ? "rgba(0,0,0,0.28)" : "rgba(255,255,255,0.3)" }}>Powered by api.mail.tm (max 8 req/s)</span>
        </div>
      </Glass>
    </div>
  );
}

// ─── Shared button style ──────────────────────────────────────────────────────
function btnStyle(variant = "ghost") {
  const base = { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 500, transition: "all 0.18s", whiteSpace: "nowrap" };
  if (variant === "primary") return { ...base, background: "linear-gradient(135deg,rgba(99,102,241,0.8),rgba(139,92,246,0.7))", border: "1px solid rgba(99,102,241,0.4)", color: "#fff", boxShadow: "0 2px 12px rgba(99,102,241,0.25)" };
  return { ...base, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.7)" };
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
function Spinner() {
  return <span style={{ display: "inline-block", width: 13, height: 13, border: "2px solid rgba(255,255,255,0.15)", borderTopColor: "#818cf8", borderRadius: "50%", animation: "spin 0.65s linear infinite", flexShrink: 0 }} />;
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState("inbox");
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
  const [lightMode, setLightMode] = useState(false);
  const [starredIds, setStarredIds] = useState(() => new Set(JSON.parse(localStorage.getItem("bm_stars") || "[]")));
  const [search, setSearch] = useState("");
  const [deletedIds, setDeletedIds] = useState(() => new Set(JSON.parse(localStorage.getItem("bm_deleted") || "[]")));

  // ── Multi-account state ──────────────────────────────────────────────────
  const [accounts, setAccounts] = useState(() => {
    try { return JSON.parse(localStorage.getItem("bm_accounts") || "[]"); } catch { return []; }
  });
  const [drawerOpen, setDrawerOpen] = useState(false);

  const pollRef = useRef(null);
  const cdRef = useRef(null);

  const showToast = useCallback((msg, type = "") => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);

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

  // ── Save an account to the accounts array ────────────────────────────────
  const saveAccount = useCallback((addr, pass, tok) => {
    setAccounts(prev => {
      const filtered = prev.filter(a => a.address !== addr);
      const next = [...filtered, { address: addr, password: pass, token: tok }];
      // keep max 10
      const trimmed = next.slice(-10);
      localStorage.setItem("bm_accounts", JSON.stringify(trimmed));
      return trimmed;
    });
  }, []);

  // ── Switch to a saved account ─────────────────────────────────────────────
  const switchAccount = useCallback(async (acc) => {
    if (pollRef.current) clearInterval(pollRef.current);
    setLoadingMsgs(true);
    setMessages([]); setOpenMsg(null);
    try {
      // Re-auth to get fresh token
      const { token: tok } = await apiFetch("/token", { method: "POST", body: JSON.stringify({ address: acc.address, password: acc.password }) });
      Cookies.set("bm", { address: acc.address, password: acc.password, token: tok });
      setAddress(acc.address); setToken(tok);
      saveAccount(acc.address, acc.password, tok);
      await fetchMessages(tok);
      startPolling(tok);
      showToast(`Switched to ${acc.address.split("@")[0]}@…`, "success");
    } catch {
      showToast("Could not switch inbox — token may have expired.", "error");
    }
    setLoadingMsgs(false);
  }, [fetchMessages, startPolling, saveAccount, showToast]);

  // ── Remove a saved account ────────────────────────────────────────────────
  const deleteAccount = useCallback((addr) => {
    setAccounts(prev => {
      const next = prev.filter(a => a.address !== addr);
      localStorage.setItem("bm_accounts", JSON.stringify(next));
      return next;
    });
    // if deleting active, clear it
    if (addr === address) {
      Cookies.del("bm");
      if (pollRef.current) clearInterval(pollRef.current);
      setAddress(null); setToken(null); setMessages([]);
    }
    showToast("Inbox removed", "");
  }, [address, showToast]);

  const createAddress = useCallback(async (silent = false) => {
    const wait = RateLimit.check("rl_new", NEW_ADDR_LIMIT);
    if (wait > 0) { showToast(`Wait ${Math.ceil(wait / 1000)}s before generating a new address`, "error"); return; }
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
      await fetchMessages(tok);
      startPolling(tok);
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
      await fetchMessages(tok);
      startPolling(tok);
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
    setLoadingMsgs(true);
    await fetchMessages(token);
    setLoadingMsgs(false);
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
    Cookies.del("bm"); localStorage.removeItem("rl_new"); localStorage.removeItem("rl_refresh");
    localStorage.removeItem("bm_stars"); localStorage.removeItem("bm_deleted");
    localStorage.removeItem("bm_accounts");
    if (pollRef.current) clearInterval(pollRef.current);
    setAddress(null); setToken(null); setMessages([]);
    setStarredIds(new Set()); setDeletedIds(new Set()); setAccounts([]);
    showToast("All data cleared", "success");
  }, [showToast]);

  const handleCopy = useCallback(async () => {
    if (!address) return;
    try { await navigator.clipboard.writeText(address); }
    catch { const el = document.createElement("input"); el.value = address; document.body.appendChild(el); el.select(); document.execCommand("copy"); el.remove(); }
    showToast("Copied to clipboard!", "success");
  }, [address, showToast]);

  const boot = useCallback(async () => {
    await fetchDomains();
    const saved = Cookies.get("bm");
    if (saved?.address && saved?.token) {
      try {
        const data = await apiFetch("/messages?page=1", {}, saved.token);
        setAddress(saved.address); setToken(saved.token);
        setMessages(data["hydra:member"] || []);
        // ensure this account is in the list
        if (saved.password) saveAccount(saved.address, saved.password, saved.token);
        startPolling(saved.token); return;
      } catch {}
    }
    await createAddress(true);
  }, [createAddress, startPolling, fetchDomains, saveAccount]);

  const handleLoadingDone = useCallback(() => { setReady(true); boot(); }, [boot]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { setOpenMsg(null); setDrawerOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visibleMessages = messages.filter(m => !deletedIds.has(m.id));
  const unread = visibleMessages.filter(m => !m.seen).length;

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

        /* nano-mail inspired: terminal cursor blink */
        .term-cursor { display:inline-block; width:7px; height:12px; background:rgba(129,140,248,0.7); margin-left:3px; vertical-align:middle; animation:termBlink 1s steps(1) infinite; }
        @keyframes termBlink { 0%,100%{opacity:1} 50%{opacity:0} }

        /* nano-mail inspired: terminal pulse on mail icon */
        @keyframes terminalPulse { 0%,100%{opacity:0.35;transform:scale(1)} 50%{opacity:0.55;transform:scale(1.06)} }

        /* nano-mail inspired: subtle glitch on the address text */
        .glitch-text { position:relative; }
        .glitch-text::before,.glitch-text::after { content:attr(data-text); position:absolute; top:0; left:0; width:100%; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
        .glitch-text::before { color:#818cf8; animation:glitch1 8s infinite; clip-path:polygon(0 0,100% 0,100% 35%,0 35%); opacity:0; }
        .glitch-text::after  { color:#f472b6; animation:glitch2 8s infinite; clip-path:polygon(0 65%,100% 65%,100% 100%,0 100%); opacity:0; }
        @keyframes glitch1 { 0%,94%,100%{opacity:0;transform:none} 95%{opacity:0.6;transform:translateX(-2px)} 96%{opacity:0;transform:translateX(2px)} 97%{opacity:0.4;transform:translateX(0)} }
        @keyframes glitch2 { 0%,92%,100%{opacity:0;transform:none} 93%{opacity:0.5;transform:translateX(2px)} 94%{opacity:0;transform:translateX(-1px)} 95%{opacity:0.3;transform:translateX(0)} }

        /* logo glitch */
        .logo-glitch { position:relative; display:inline-block; }
        .logo-glitch::before { content:attr(data-text); position:absolute; inset:0; background:linear-gradient(135deg,#818cf8,#f472b6,#a78bfa); -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; animation:logoGlitch 10s infinite; opacity:0; }
        @keyframes logoGlitch { 0%,88%,100%{opacity:0;transform:none} 89%{opacity:0.8;transform:translateX(-2px) skewX(-2deg)} 90%{opacity:0;transform:translateX(2px)} 91%{opacity:0.5;transform:none} }

        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
        button:focus-visible { outline: 2px solid rgba(99,102,241,0.6); outline-offset: 2px; }
        input:focus { border-color: rgba(99,102,241,0.5) !important; box-shadow: 0 0 0 3px rgba(99,102,241,0.12); }
        select option { background: #0f0f1e; }

        /* Mobile: icons only, no nav labels */
        @media (max-width: 540px) {
          .nav-label { display: none !important; }
          .nav-btn { padding: 10px 12px !important; }
          .logo-wordmark { display: none; }
        }
        @media (min-width: 541px) {
          .nav-label { display: inline; }
          .logo-wordmark { display: inline; }
        }
      `}</style>

      {!ready && <LoadingScreen onDone={handleLoadingDone} />}

      {ready && (
        <div style={{ position: "relative", minHeight: "100vh", color: lightMode ? "#1a1a2e" : "#e2e8f0", transition: "color 0.3s ease" }}>
          <SpotlightBg lightMode={lightMode} />

          <div style={{ position: "relative", zIndex: 1, minHeight: "100vh", display: "flex", flexDirection: "column" }}>

            {/* ── Header — 3-col equal-weight for true center nav ── */}
            <header style={{
              display: "grid",
              gridTemplateColumns: "1fr auto 1fr",
              alignItems: "center",
              gap: 8,
              padding: "12px 16px",
              borderBottom: lightMode ? "1px solid rgba(0,0,0,0.07)" : "1px solid rgba(255,255,255,0.06)",
              background: lightMode ? "rgba(240,240,255,0.55)" : "rgba(6,6,16,0.45)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              position: "sticky", top: 0, zIndex: 100,
              animation: "fadeUp 0.4s ease",
              transition: "background 0.3s ease",
            }}>

              {/* Left: hamburger + logo */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {/* Hamburger button */}
                <button
                  onClick={() => setDrawerOpen(true)}
                  title="Switch inbox"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 36, height: 36, borderRadius: 10, border: "none", cursor: "pointer",
                    background: "rgba(255,255,255,0.06)",
                    color: "rgba(255,255,255,0.6)",
                    transition: "all 0.18s",
                    flexShrink: 0,
                    position: "relative",
                  }}
                >
                  <Icon.Hamburger size={16} />
                  {/* badge: number of saved inboxes */}
                  {accounts.length > 1 && (
                    <span style={{ position: "absolute", top: -4, right: -4, background: "linear-gradient(135deg,#818cf8,#a78bfa)", color: "#fff", fontSize: 9, fontWeight: 700, width: 16, height: 16, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-mono)", border: "1.5px solid rgba(6,6,16,0.8)" }}>
                      {accounts.length}
                    </span>
                  )}
                </button>

                {/* Logo */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <img
                    src="/mail.png" alt="BurnerMail" width={26} height={26}
                    style={{ borderRadius: 6, display: "block" }}
                    onError={e => e.target.style.display = "none"}
                  />
                  <span className="logo-wordmark logo-glitch" data-text="Burner" style={{ fontFamily: "var(--font-display)", fontWeight: 900, fontSize: 18, letterSpacing: "-0.5px", whiteSpace: "nowrap" }}>
                    <span style={{ background: "linear-gradient(135deg,#818cf8,#f472b6,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Burner</span>
                    <span style={{ color: "rgba(255,255,255,0.38)", fontWeight: 400 }}>Mail</span>
                  </span>
                </div>
              </div>

              {/* Center: nav — perfectly centered in its own column */}
              <div style={{ display: "flex", justifyContent: "center" }}>
                <PillNav tab={tab} setTab={setTab} unread={unread} />
              </div>

              {/* Right: status dot */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                <div style={{
                  width: 9, height: 9, borderRadius: "50%",
                  background: address && !loadingAddr ? "#4ade80" : "rgba(255,255,255,0.15)",
                  boxShadow: address && !loadingAddr ? "0 0 0 3px rgba(74,222,128,0.2)" : "none",
                  animation: address && !loadingAddr ? "livePulse 2s infinite" : "none",
                  flexShrink: 0,
                }} />
              </div>
            </header>

            {/* ── Main content ── */}
            <main style={{ flex: 1, maxWidth: 760, width: "100%", margin: "0 auto", padding: "28px 16px 40px" }}>
              {tab === "inbox" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  <AddressCard
                    address={address}
                    availableDomains={availableDomains}
                    loading={loadingAddr}
                    onCopy={handleCopy}
                    onNew={() => createAddress(false)}
                    onRefresh={handleRefresh}
                    onSetCustom={createCustomAddress}
                    newCooldown={newCooldown}
                    refreshCooldown={refreshCooldown}
                  />

                  <Glass style={{ overflow: "hidden", animation: "fadeUp 0.5s 80ms both ease" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
                      <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 10 }}>
                        <Icon.Inbox size={14} />
                        Inbox
                        {unread > 0 && (
                          <span style={{ background: "linear-gradient(135deg,#818cf8,#a78bfa)", color: "#fff", fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 999, lineHeight: "16px" }}>
                            {unread} new
                          </span>
                        )}
                      </div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "rgba(255,255,255,0.25)", letterSpacing: 1 }}>AUTO · 15s</div>
                    </div>

                    <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <SearchBar value={search} onChange={setSearch} />
                    </div>

                    <InboxView
                      messages={visibleMessages}
                      onOpen={handleOpen}
                      onDelete={handleDelete}
                      onStar={handleStar}
                      onMarkRead={handleMarkRead}
                      loading={loadingMsgs}
                      starredIds={starredIds}
                      search={search}
                    />
                  </Glass>
                </div>
              )}

              {tab === "guide" && <GuideView />}
              {tab === "settings" && (
                <SettingsView
                  address={address}
                  onClearCookies={handleClearCookies}
                  onNew={() => { createAddress(false); setTab("inbox"); }}
                  newCooldown={newCooldown}
                  lightMode={lightMode}
                  onToggleLight={() => setLightMode(m => !m)}
                />
              )}
            </main>
          </div>

          {/* Accounts drawer */}
          <AccountsDrawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            accounts={accounts}
            activeAddress={address}
            onSwitch={switchAccount}
            onDeleteAccount={deleteAccount}
            onAddNew={() => createAddress(false)}
            newCooldown={newCooldown}
            loadingAddr={loadingAddr}
          />

          {openMsg && (
            <MessageViewer
              msg={openMsg}
              onClose={() => setOpenMsg(null)}
              onDelete={handleDelete}
              onStar={() => handleStar(openMsg.id)}
              starred={starredIds.has(openMsg.id)}
            />
          )}
        </div>
      )}

      <Toast toasts={toasts} />
    </>
  );
}
