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
};

// ─── Animated spotlight background (autonomous, color-shifting) ───────────────
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
    return () => {
      window.removeEventListener("mousemove", move);
      cancelAnimationFrame(animFrame);
    };
  }, [lightMode]);

  return (
    <div ref={ref} style={{
      position: "fixed", inset: 0, zIndex: 0, overflow: "hidden",
      "--mx": "50%", "--my": "40%",
      "--orb1-color": "rgba(99,102,241,0.13)",
      "--orb2-color": "rgba(139,92,246,0.10)",
      "--orb3-color": "rgba(59,130,246,0.09)",
      transition: "background 0.4s ease",
    }}>
      <div style={{ position: "absolute", inset: 0, background: lightMode ? "radial-gradient(ellipse 120% 80% at 50% 0%, #f0f0ff 0%, #e8eaf6 100%)" : "radial-gradient(ellipse 120% 80% at 50% 0%, #0d0d1a 0%, #060610 100%)", transition: "background 0.4s ease" }} />
      {/* Main autonomous orb */}
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(circle 700px at var(--mx) var(--my), var(--orb1-color) 0%, transparent 70%)",
      }} />
      {/* Secondary drifting orb */}
      <div style={{
        position: "absolute", width: 800, height: 800,
        top: -200, left: -150,
        background: "radial-gradient(circle, var(--orb2-color) 0%, transparent 65%)",
        borderRadius: "50%",
        animation: "orb1 18s ease-in-out infinite alternate",
      }} />
      {/* Third orb */}
      <div style={{
        position: "absolute", width: 700, height: 700,
        bottom: -150, right: -100,
        background: "radial-gradient(circle, var(--orb3-color) 0%, transparent 65%)",
        borderRadius: "50%",
        animation: "orb2 22s ease-in-out infinite alternate",
      }} />
      {/* Extra accent orb */}
      <div style={{
        position: "absolute", width: 500, height: 500,
        top: "40%", left: "60%",
        background: "radial-gradient(circle, rgba(244,114,182,0.06) 0%, transparent 65%)",
        borderRadius: "50%",
        animation: "orb3 14s ease-in-out infinite alternate",
      }} />
      <div style={{
        position: "absolute", inset: 0,
        backgroundImage: "linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px)",
        backgroundSize: "60px 60px",
      }} />
      <div style={{
        position: "absolute", inset: 0, opacity: 0.3,
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E")`,
      }} />
      <style>{`
        @keyframes orb1 { from { transform: translate(0,0) scale(1); } to { transform: translate(120px,80px) scale(1.2); } }
        @keyframes orb2 { from { transform: translate(0,0) scale(1); } to { transform: translate(-90px,-100px) scale(1.15); } }
        @keyframes orb3 { from { transform: translate(0,0) scale(1) rotate(0deg); } to { transform: translate(-60px,80px) scale(1.3) rotate(45deg); } }
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
          background: "rgba(18,18,32,0.92)",
          backdropFilter: "blur(20px)",
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

// ─── Loading messages that cycle ──────────────────────────────────────────────
const LOADING_PHRASES = [
  "SETTING UP YOUR INBOX…",
  "SPAWNING A FRESH ADDRESS…",
  "WARMING UP THE SERVERS…",
  "ALMOST THERE…",
  "JUST A MOMENT…",
];

// ─── Loading screen — 5 second countdown ─────────────────────────────────────
function LoadingScreen({ onDone }) {
  const TOTAL = 5;
  const [count, setCount] = useState(TOTAL);
  const [phase, setPhase] = useState("loading");
  const [phraseIdx, setPhraseIdx] = useState(0);

  useEffect(() => {
    // Cycle phrases every ~2s
    const phraseInterval = setInterval(() => {
      setPhraseIdx(i => (i + 1) % LOADING_PHRASES.length);
    }, 1800);
    return () => clearInterval(phraseInterval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setCount(c => {
        if (c <= 1) {
          clearInterval(interval);
          setPhase("ready");
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (phase === "ready") {
      const t = setTimeout(onDone, 600);
      return () => clearTimeout(t);
    }
  }, [phase, onDone]);

  const pct = ((TOTAL - count) / TOTAL) * 283;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9000,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      background: "radial-gradient(ellipse 120% 80% at 50% 0%, #0d0d1a 0%, #060610 100%)",
      transition: "opacity 0.6s ease",
      opacity: phase === "ready" ? 0 : 1,
    }}>
      {/* Animated background blobs on loading screen */}
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
        <div style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{ color: "#e2e8f0", fontSize: 24, fontFamily: "var(--font-display)", fontWeight: 800, lineHeight: 1 }}>
            {phase === "ready" ? <Icon.Check size={24} /> : count}
          </div>
        </div>
      </div>

      <div style={{ fontFamily: "var(--font-display)", fontSize: 32, fontWeight: 900, letterSpacing: "-0.8px", marginBottom: 8, zIndex: 1 }}>
        <span style={{ background: "linear-gradient(135deg,#818cf8,#f472b6,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Burner</span>
        <span style={{ color: "rgba(255,255,255,0.45)", fontWeight: 400 }}>Mail</span>
      </div>

      <p style={{
        color: "rgba(255,255,255,0.3)", fontSize: 11, fontFamily: "var(--font-mono)",
        marginTop: 4, letterSpacing: "2px", zIndex: 1,
        transition: "opacity 0.4s ease",
        animation: "phraseFade 1.8s infinite",
        key: phraseIdx,
      }}>
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

// ─── Icon-only pill nav ───────────────────────────────────────────────────────
function PillNav({ tab, setTab, unread }) {
  const tabs = [
    { id: "inbox", label: "Inbox", icon: <Icon.Inbox size={17} /> },
    { id: "guide", label: "How to Use", icon: <Icon.Guide size={17} /> },
    { id: "settings", label: "Settings", icon: <Icon.Settings size={17} /> },
  ];
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 2,
      background: "rgba(255,255,255,0.05)",
      border: "1px solid rgba(255,255,255,0.11)",
      borderRadius: 999, padding: "4px",
      backdropFilter: "blur(20px)",
      boxShadow: "0 4px 24px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.07)",
    }}>
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          title={t.label}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 40, height: 40, borderRadius: 999, border: "none", cursor: "pointer",
            transition: "all 0.2s cubic-bezier(0.4,0,0.2,1)",
            background: tab === t.id ? "linear-gradient(135deg,rgba(99,102,241,0.8),rgba(139,92,246,0.7))" : "transparent",
            color: tab === t.id ? "#fff" : "rgba(255,255,255,0.45)",
            boxShadow: tab === t.id ? "0 2px 14px rgba(99,102,241,0.4), inset 0 1px 0 rgba(255,255,255,0.15)" : "none",
            position: "relative",
          }}
        >
          {t.icon}
          {t.id === "inbox" && unread > 0 && (
            <span style={{
              position: "absolute", top: 7, right: 7,
              background: "#f472b6", width: 7, height: 7,
              borderRadius: "50%", border: "1.5px solid rgba(6,6,16,0.8)",
            }} />
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

// ─── Address card with custom email support ───────────────────────────────────
function AddressCard({ address, availableDomains, onCopy, onNew, onRefresh, onSetCustom, newCooldown, refreshCooldown, loading }) {
  const [customMode, setCustomMode] = useState(false);
  const [customLocal, setCustomLocal] = useState("");
  const [selectedDomain, setSelectedDomain] = useState("");
  const [customError, setCustomError] = useState("");

  useEffect(() => {
    if (availableDomains.length && !selectedDomain) {
      setSelectedDomain(availableDomains[0]);
    }
  }, [availableDomains]);

  const handleCustomSubmit = () => {
    const local = customLocal.trim().toLowerCase();
    if (!local) { setCustomError("Enter a username."); return; }
    if (!/^[a-z0-9._+-]+$/.test(local)) { setCustomError("Only letters, numbers, . _ + - allowed."); return; }
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

      <div style={{ fontSize: 10, letterSpacing: "2.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.35)", fontFamily: "var(--font-mono)", marginBottom: 10 }}>
        Your temporary address
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
              {loading ? (
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Spinner /> generating…
                </span>
              ) : address || "—"}
            </div>
            {address && !loading && (
              <button onClick={onCopy} style={btnStyle("ghost")}>
                <Icon.Copy size={13} /> Copy
              </button>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
            <CooldownButton
              icon={<Icon.New size={13} />}
              label="New address"
              onClick={onNew}
              cooldown={newCooldown}
              limitMs={NEW_ADDR_LIMIT}
              disabled={loading}
              primary
            />
            <CooldownButton
              icon={<Icon.Refresh size={13} />}
              label="Refresh"
              onClick={onRefresh}
              cooldown={refreshCooldown}
              limitMs={REFRESH_LIMIT}
              disabled={loading || !address}
            />
            <button onClick={() => setCustomMode(true)} style={btnStyle("ghost")} disabled={loading || !availableDomains.length}>
              <Icon.Edit size={13} /> Custom
            </button>
          </div>
        </>
      ) : (
        <div style={{ animation: "fadeUp 0.25s ease" }}>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", fontFamily: "var(--font-mono)", marginBottom: 10 }}>
            Choose your own username:
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              autoFocus
              value={customLocal}
              onChange={e => { setCustomLocal(e.target.value); setCustomError(""); }}
              onKeyDown={e => e.key === "Enter" && handleCustomSubmit()}
              placeholder="username"
              style={{
                flex: 1, minWidth: 120,
                background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 10, padding: "9px 14px",
                fontFamily: "var(--font-mono)", fontSize: 14, color: "#e2e8f0",
                outline: "none",
              }}
            />
            <span style={{ color: "rgba(255,255,255,0.4)", fontFamily: "var(--font-mono)", fontSize: 14, whiteSpace: "nowrap" }}>@</span>
            {availableDomains.length > 1 ? (
              <select
                value={selectedDomain}
                onChange={e => setSelectedDomain(e.target.value)}
                style={{
                  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 10, padding: "9px 12px",
                  fontFamily: "var(--font-mono)", fontSize: 13, color: "#e2e8f0",
                  outline: "none", cursor: "pointer",
                }}
              >
                {availableDomains.map(d => <option key={d} value={d} style={{ background: "#0f0f1e" }}>{d}</option>)}
              </select>
            ) : (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "rgba(255,255,255,0.6)" }}>{selectedDomain}</span>
            )}
          </div>
          {customError && <div style={{ color: "#f87171", fontSize: 11, fontFamily: "var(--font-mono)", marginTop: 6 }}>{customError}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button onClick={handleCustomSubmit} style={btnStyle("primary")}>
              <Icon.Check size={13} /> Use this address
            </button>
            <button onClick={() => { setCustomMode(false); setCustomError(""); }} style={btnStyle("ghost")}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <style>{`@keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:none; } }`}</style>
    </Glass>
  );
}

// ─── Cooldown button ──────────────────────────────────────────────────────────
function CooldownButton({ icon, label, onClick, cooldown, limitMs, disabled, primary }) {
  const pct = cooldown > 0 ? Math.round((1 - cooldown / limitMs) * 100) : 100;
  const isBlocked = cooldown > 0;
  const secs = Math.ceil(cooldown / 1000);

  return (
    <button
      onClick={!isBlocked && !disabled ? onClick : undefined}
      disabled={isBlocked || disabled}
      style={{
        ...btnStyle(primary ? "primary" : "ghost"),
        position: "relative", overflow: "hidden",
        opacity: isBlocked || disabled ? 0.55 : 1,
        cursor: isBlocked || disabled ? "not-allowed" : "pointer",
      }}
    >
      {isBlocked && (
        <span style={{
          position: "absolute", inset: 0, left: 0,
          background: "rgba(99,102,241,0.18)",
          width: pct + "%",
          transition: "width 0.5s linear",
          borderRadius: "inherit",
        }} />
      )}
      <span style={{ position: "relative", display: "flex", alignItems: "center", gap: 6 }}>
        {isBlocked ? <><Icon.Clock size={13} /> {secs}s</> : <>{icon} {label}</>}
      </span>
    </button>
  );
}

// ─── Inbox view ───────────────────────────────────────────────────────────────
function InboxView({ messages, onOpen, loading }) {
  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, color: "rgba(255,255,255,0.3)", gap: 10, fontFamily: "var(--font-mono)", fontSize: 13 }}>
        <Spinner /> Loading messages…
      </div>
    );
  }
  if (!messages.length) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "56px 24px", color: "rgba(255,255,255,0.25)" }}>
        <div style={{ opacity: 0.4 }}><Icon.Mail size={40} /></div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 700, color: "rgba(255,255,255,0.4)" }}>No messages yet</div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, textAlign: "center", lineHeight: 1.7, maxWidth: 260 }}>
          Copy your address above and paste it anywhere — messages appear within seconds.
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {messages.map((m, i) => (
        <MessageRow key={m.id} msg={m} onClick={() => onOpen(m.id)} delay={i * 40} />
      ))}
    </div>
  );
}

function MessageRow({ msg, onClick, delay }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "grid", gridTemplateColumns: "1fr auto", gridTemplateRows: "auto auto",
        gap: "2px 12px", alignItems: "start",
        padding: "16px 24px",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        cursor: "pointer",
        background: hover ? "rgba(255,255,255,0.04)" : "transparent",
        borderLeft: msg.seen ? "none" : "3px solid rgba(99,102,241,0.7)",
        paddingLeft: msg.seen ? 24 : 21,
        transition: "background 0.15s",
        animation: `fadeUp 0.35s ${delay}ms both ease`,
      }}
    >
      <div style={{
        fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: msg.seen ? 400 : 600,
        color: msg.seen ? "rgba(255,255,255,0.65)" : "#e2e8f0",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{msg.from?.address || "Unknown sender"}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "rgba(255,255,255,0.3)", gridRow: "1", whiteSpace: "nowrap" }}>
        {timeAgo(msg.createdAt)}
      </div>
      <div style={{
        fontFamily: "var(--font-mono)", fontSize: 12,
        color: msg.seen ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.6)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{msg.subject || "(no subject)"}</div>
    </div>
  );
}

// ─── Message viewer ───────────────────────────────────────────────────────────
function MessageViewer({ msg, onClose }) {
  const iframeRef = useRef(null);

  useEffect(() => {
    if (!msg || !iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    const html = msg.html ? (Array.isArray(msg.html) ? msg.html.join("") : msg.html) : null;
    if (html) {
      doc.open();
      doc.write(`<base target="_blank"><style>body{margin:0;padding:16px;font-family:sans-serif;font-size:14px;line-height:1.6;background:#fff;color:#111;}img{max-width:100%;}</style>${html}`);
      doc.close();
      setTimeout(() => {
        try { iframeRef.current.style.height = doc.body.scrollHeight + 32 + "px"; } catch {}
      }, 300);
    }
  }, [msg]);

  if (!msg) return null;
  const html = msg.html ? (Array.isArray(msg.html) ? msg.html.join("") : msg.html) : null;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 500,
      background: "rgba(6,6,16,0.88)", backdropFilter: "blur(8px)",
      display: "flex", flexDirection: "column",
      animation: "msgOverlayIn 0.28s cubic-bezier(0.32,0.72,0,1)",
    }}>
      <style>{`
        @keyframes msgOverlayIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes msgPanelIn {
          from { opacity: 0; transform: translateY(40px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
      <div style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "16px 24px",
        background: "rgba(10,10,24,0.85)", backdropFilter: "blur(20px)",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        animation: "msgPanelIn 0.35s cubic-bezier(0.32,0.72,0,1)",
      }}>
        <button onClick={onClose} style={btnStyle("ghost")}>
          <Icon.Back size={14} /> Back
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 700, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {msg.subject || "(no subject)"}
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
            From: {msg.from?.address || "Unknown"}
          </div>
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "rgba(255,255,255,0.3)", whiteSpace: "nowrap" }}>
          {new Date(msg.createdAt).toLocaleString()}
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "24px", animation: "msgPanelIn 0.4s 0.05s cubic-bezier(0.32,0.72,0,1) both" }}>
        <div style={{
          maxWidth: 720, margin: "0 auto",
          background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 16, overflow: "hidden",
        }}>
          {html ? (
            <iframe
              ref={iframeRef}
              sandbox="allow-same-origin"
              style={{ width: "100%", border: "none", minHeight: 300, display: "block", background: "#fff" }}
            />
          ) : (
            <pre style={{
              whiteSpace: "pre-wrap", wordBreak: "break-word",
              fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.8,
              color: "rgba(255,255,255,0.75)", padding: 24, margin: 0,
            }}>{msg.text || "(empty message)"}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Guide view — memoized so tab switches don't re-render/re-animate ─────────
const GuideView = memo(function GuideView() {
  const steps = [
    { icon: <Icon.Shield size={20} />, title: "Auto-generated address", body: "A random temporary email is created the moment you open the app. No sign-up, no personal data required." },
    { icon: <Icon.Edit size={20} />, title: "Or pick your own username", body: "Hit Custom to enter your preferred username and choose from available domains. Great for memorable addresses." },
    { icon: <Icon.Copy size={20} />, title: "Copy & use it anywhere", body: "Hit Copy and paste it into any site asking for your email — sign-ups, verifications, free trials." },
    { icon: <Icon.Inbox size={20} />, title: "Emails arrive automatically", body: "Your inbox auto-refreshes every 15 seconds. New emails appear with an unread indicator — click any to open." },
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

// ─── Sun / Moon icons ─────────────────────────────────────────────────────────
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

      {/* Appearance toggle */}
      <Glass style={{ padding: "20px 22px", ...glassLight }}>
        <div style={lbl}>Appearance</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 600, color: lightMode ? "#1a1a2e" : "#e2e8f0", marginBottom: 3 }}>
              {lightMode ? "Light mode" : "Dark mode"}
            </div>
            <div style={bodyTxt}>Switch the app between light and dark themes.</div>
          </div>
          <div
            onClick={onToggleLight}
            style={{
              width: 50, height: 27, borderRadius: 999, cursor: "pointer", flexShrink: 0, marginLeft: 20,
              background: lightMode ? "linear-gradient(135deg,#818cf8,#a78bfa)" : "rgba(255,255,255,0.1)",
              border: lightMode ? "none" : "1px solid rgba(255,255,255,0.14)",
              position: "relative", transition: "all 0.25s ease",
              boxShadow: lightMode ? "0 2px 10px rgba(99,102,241,0.4)" : "none",
            }}
          >
            <div style={{
              position: "absolute", top: 3, left: lightMode ? 23 : 3,
              width: 21, height: 21, borderRadius: "50%", background: "#fff",
              boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
              transition: "left 0.25s cubic-bezier(0.34,1.56,0.64,1)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: lightMode ? "#818cf8" : "#64748b",
            }}>
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
        <div style={{ ...bodyTxt, marginBottom: 14 }}>
          Your address and session token are saved in a cookie for 30 days so you don't lose access on refresh.
        </div>
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
  const base = {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "8px 14px", borderRadius: 10, cursor: "pointer",
    fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 500,
    transition: "all 0.18s", whiteSpace: "nowrap",
  };
  if (variant === "primary") return {
    ...base,
    background: "linear-gradient(135deg,rgba(99,102,241,0.8),rgba(139,92,246,0.7))",
    border: "1px solid rgba(99,102,241,0.4)",
    color: "#fff",
    boxShadow: "0 2px 12px rgba(99,102,241,0.25)",
  };
  return {
    ...base,
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.10)",
    color: "rgba(255,255,255,0.7)",
  };
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <span style={{
      display: "inline-block", width: 13, height: 13,
      border: "2px solid rgba(255,255,255,0.15)",
      borderTopColor: "#818cf8", borderRadius: "50%",
      animation: "spin 0.65s linear infinite", flexShrink: 0,
    }} />
  );
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
  const pollRef = useRef(null);
  const cdRef = useRef(null);

  const showToast = useCallback((msg, type = "") => {
    const id = Date.now();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);

  // Cooldown ticker
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

  const createAddress = useCallback(async (silent = false) => {
    const wait = RateLimit.check("rl_new", NEW_ADDR_LIMIT);
    if (wait > 0) { showToast(`Wait ${Math.ceil(wait / 1000)}s before generating a new address`, "error"); return; }

    if (pollRef.current) clearInterval(pollRef.current);
    setLoadingAddr(true);
    setMessages([]);
    setAddress(null);
    setToken(null);
    Cookies.del("bm");

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
      setAddress(addr);
      setToken(tok);
      setLoadingAddr(false);
      if (!silent) showToast("New address created", "success");
      await fetchMessages(tok);
      startPolling(tok);
    } catch (e) {
      setLoadingAddr(false);
      showToast("Failed: " + e.message, "error");
    }
  }, [fetchDomains, fetchMessages, startPolling, showToast]);

  // ─── Custom address creation ───────────────────────────────────────────────
  const createCustomAddress = useCallback(async (customAddr) => {
    const wait = RateLimit.check("rl_new", NEW_ADDR_LIMIT);
    if (wait > 0) { showToast(`Wait ${Math.ceil(wait / 1000)}s`, "error"); return; }

    if (pollRef.current) clearInterval(pollRef.current);
    setLoadingAddr(true);
    setMessages([]);
    setAddress(null);
    setToken(null);
    Cookies.del("bm");

    try {
      const pass = rand(18);
      await apiFetch("/accounts", { method: "POST", body: JSON.stringify({ address: customAddr, password: pass }) });
      const { token: tok } = await apiFetch("/token", { method: "POST", body: JSON.stringify({ address: customAddr, password: pass }) });

      Cookies.set("bm", { address: customAddr, password: pass, token: tok });
      RateLimit.mark("rl_new");
      setAddress(customAddr);
      setToken(tok);
      setLoadingAddr(false);
      showToast("Custom address created!", "success");
      await fetchMessages(tok);
      startPolling(tok);
    } catch (e) {
      setLoadingAddr(false);
      if (e.message.includes("already") || e.message.includes("exist") || e.message.includes("422")) {
        showToast("That address is already taken — try another.", "error");
      } else {
        showToast("Failed: " + e.message, "error");
      }
    }
  }, [fetchMessages, startPolling, showToast]);

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
    } catch {
      showToast("Could not load message", "error");
    }
  }, [token, showToast]);

  const handleClearCookies = useCallback(() => {
    Cookies.del("bm");
    localStorage.removeItem("rl_new");
    localStorage.removeItem("rl_refresh");
    if (pollRef.current) clearInterval(pollRef.current);
    setAddress(null); setToken(null); setMessages([]);
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
        setAddress(saved.address);
        setToken(saved.token);
        setMessages(data["hydra:member"] || []);
        startPolling(saved.token);
        return;
      } catch {}
    }
    await createAddress(true);
  }, [createAddress, startPolling, fetchDomains]);

  const handleLoadingDone = useCallback(() => {
    setReady(true);
    boot();
  }, [boot]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") setOpenMsg(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const unread = messages.filter(m => !m.seen).length;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;700;800;900&family=JetBrains+Mono:wght@300;400;500&display=swap');
        :root {
          --font-display: 'Outfit', sans-serif;
          --font-mono: 'JetBrains Mono', 'Fira Mono', monospace;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; }
        body { font-family: var(--font-mono); -webkit-font-smoothing: antialiased; overflow-x: hidden; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:none; } }
        @keyframes livePulse { 0%,100%{box-shadow:0 0 0 3px rgba(74,222,128,0.2)} 50%{box-shadow:0 0 0 6px rgba(74,222,128,0.05)} }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
        button:focus-visible { outline: 2px solid rgba(99,102,241,0.6); outline-offset: 2px; }
        input:focus { border-color: rgba(99,102,241,0.5) !important; box-shadow: 0 0 0 3px rgba(99,102,241,0.12); }
        select option { background: #0f0f1e; }
      `}</style>

      {!ready && <LoadingScreen onDone={handleLoadingDone} />}

      {ready && (
        <div style={{ position: "relative", minHeight: "100vh", color: lightMode ? "#1a1a2e" : "#e2e8f0", transition: "color 0.3s ease" }}>
          <SpotlightBg lightMode={lightMode} />

          <div style={{ position: "relative", zIndex: 1, minHeight: "100vh", display: "flex", flexDirection: "column" }}>
            {/* Top bar — logo left, nav CENTER, status right */}
            <header style={{
              display: "grid",
              gridTemplateColumns: "1fr auto 1fr",
              alignItems: "center",
              padding: "14px 24px",
              borderBottom: lightMode ? "1px solid rgba(0,0,0,0.07)" : "1px solid rgba(255,255,255,0.06)",
              background: lightMode ? "rgba(255,255,255,0.7)" : "rgba(6,6,16,0.65)", backdropFilter: "blur(24px)",
              position: "sticky", top: 0, zIndex: 100,
              animation: "fadeUp 0.4s ease",
              transition: "background 0.3s ease",
            }}>
              {/* Logo — left */}
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 900, fontSize: 18, letterSpacing: "-0.5px", display: "flex", alignItems: "center", gap: 8 }}>
                <img src="/mail.png" alt="" width={22} height={22} style={{ borderRadius: 5 }} onError={e => e.target.style.display = "none"} />
                <span>
                  <span style={{ background: "linear-gradient(135deg,#818cf8,#f472b6,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Burner</span><span style={{ color: "rgba(255,255,255,0.38)", fontWeight: 400 }}>Mail</span>
                </span>
              </div>

              {/* Nav — centered */}
              <PillNav tab={tab} setTab={setTab} unread={unread} />

              {/* Status dot — right */}
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "rgba(255,255,255,0.25)", letterSpacing: 1 }}>
                  {address && !loadingAddr ? "LIVE" : ""}
                </span>
                <div style={{
                  width: 9, height: 9, borderRadius: "50%", flexShrink: 0,
                  background: address && !loadingAddr ? "#4ade80" : "rgba(255,255,255,0.15)",
                  boxShadow: address && !loadingAddr ? "0 0 0 3px rgba(74,222,128,0.2)" : "none",
                  animation: address && !loadingAddr ? "livePulse 2s infinite" : "none",
                }} />
              </div>
            </header>

            {/* Content */}
            <main style={{ flex: 1, maxWidth: 760, width: "100%", margin: "0 auto", padding: "28px 20px 40px" }}>
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
                    <div style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "16px 24px",
                      borderBottom: "1px solid rgba(255,255,255,0.06)",
                      background: "rgba(255,255,255,0.02)",
                    }}>
                      <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 10 }}>
                        <Icon.Inbox size={14} />
                        Inbox
                        {unread > 0 && (
                          <span style={{ background: "linear-gradient(135deg,#818cf8,#a78bfa)", color: "#fff", fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 999, lineHeight: "16px" }}>
                            {unread} new
                          </span>
                        )}
                      </div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "rgba(255,255,255,0.25)", letterSpacing: 1 }}>
                        AUTO-REFRESH · 15s
                      </div>
                    </div>
                    <InboxView messages={messages} onOpen={handleOpen} loading={loadingMsgs} />
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

          {openMsg && <MessageViewer msg={openMsg} onClose={() => setOpenMsg(null)} />}
        </div>
      )}

      <Toast toasts={toasts} />
    </>
  );
}
