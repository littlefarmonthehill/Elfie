import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Zap, ScanLine, Globe, ExternalLink, Wrench, Users, BarChart2, Sparkles } from "lucide-react";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import logoUrl  from "@assets/PlanetBrick_dotcom_with_planet_1774203379040.png";
import elfieUrl from "@assets/PlanetBrick_good_robot_1760672362080.png";

// ─── Types ────────────────────────────────────────────────────────────────────

type Panel = null | "shop" | "studio" | "signin";
type StudioChId = "home" | "ops" | "tools" | "services" | "live";
type ShopChId   = "owl"  | "link";
type ChId = StudioChId | ShopChId;

type LivePlan = { id: number; name: string; basePrice: number; salesPercentage: number; freeSalesThreshold: number; status: string };

// ─── Constants ────────────────────────────────────────────────────────────────

const TEAL   = "#00FFEE";
const MGNT   = "#FF00CC";
const PURP   = "#A855F7";
const AMBER  = "#FFB830";
const SCR_BG = "#04060F";

const STUDIO_CHANNELS: { id: StudioChId; num: string; label: string; slides: number }[] = [
  { id: "home",     num: "01", label: "INTRO",    slides: 1 },
  { id: "ops",      num: "02", label: "OPS",      slides: 4 },
  { id: "tools",    num: "03", label: "TOOLS",    slides: 3 },
  { id: "services", num: "04", label: "SERVICES", slides: 1 },
  { id: "live",     num: "05", label: "ON AIR",   slides: 1 },
];

const SHOP_CHANNELS: { id: ShopChId; num: string; label: string; slides: number }[] = [
  { id: "owl",  num: "01", label: "BRICKOWL",  slides: 1 },
  { id: "link", num: "02", label: "BRICKLINK", slides: 1 },
];

const TOOLS_SLIDES = [
  { Icon: Zap,      color: "#FFD600", rgb: "255,214,0",  title: "Price-o-Matic",   tagline: "AI-powered repricing",      desc: "Monitors the market 24/7 and reprices your catalog automatically. Underpriced? Fixed. Overpriced? Corrected.", bullets: ["Market price tracking", "Auto-adjust rules", "Floor/ceiling guards"] },
  { Icon: ScanLine, color: TEAL,      rgb: "0,255,238",  title: "BrickSpotter",    tagline: "AI part identification",     desc: "Point your camera at any LEGO piece. AI identifies it instantly across 130k+ parts — color, condition, value.", bullets: ["130k+ parts catalog", "Color recognition", "Instant valuation"] },
  { Icon: Globe,    color: PURP,      rgb: "204,136,255", title: "Multichannel Sync", tagline: "Unified inventory control", desc: "BrickLink, BrickOwl and beyond — inventory and orders unified in one command center. No double-selling.", bullets: ["Real-time sync", "Multi-platform orders", "No overselling"] },
];

const OPS_SLIDES = [
  { label: "Product",  color: TEAL,  rgb: "0,255,238",   metrics: [{ label: "Lots", value: "47,312" }, { label: "Parts", value: "1.2M" }, { label: "Categories", value: "128" }, { label: "Sync", value: "Live" }],          tools: ["BrickSpotter", "Inventory Sync", "Warehouse"] },
  { label: "Orders",   color: PURP,  rgb: "168,85,247",  metrics: [{ label: "To Fulfill", value: "12" }, { label: "Shipped", value: "3 today" }, { label: "On Hold", value: "1" }, { label: "Revenue", value: "$4,891" }],     tools: ["Fulfillment", "Picklist", "Order Sync"] },
  { label: "Marketing",color: MGNT,  rgb: "255,0,204",   metrics: [{ label: "Channels", value: "2 live" }, { label: "Discrepancies", value: "0" }, { label: "Last Sync", value: "2h ago" }, { label: "Listings", value: "12,847" }], tools: ["Channel Sync", "Price-o-Matic", "Platforms"] },
  { label: "Insights", color: AMBER, rgb: "255,184,48",  metrics: [{ label: "This Week", value: "$1,247" }, { label: "Growth", value: "+18%" }, { label: "Avg Order", value: "$22" }, { label: "Orders", value: "847" }],       tools: ["Analytics", "POM Pricing", "Reports"] },
];

const SERVICES_ITEMS = [
  { Icon: BarChart2, color: TEAL,  rgb: "0,255,238",  title: "Price Intelligence",    desc: "Market-wide LEGO pricing data for buyers, collectors, and hobbyists" },
  { Icon: Users,     color: PURP,  rgb: "168,85,247", title: "Community Platform",    desc: "Tools for LEGO clubs, LUGs, and community builders" },
  { Icon: Wrench,    color: AMBER, rgb: "255,184,48", title: "Reseller Automation",   desc: "Advanced E.L.F.I.E. workflows for high-volume sellers" },
  { Icon: Sparkles,  color: MGNT,  rgb: "255,0,204",  title: "AI Catalog Assistant",  desc: "Intelligent part discovery and collection planning" },
];

// ─── Animations & Stars ───────────────────────────────────────────────────────

const GLOBAL_CSS = `
  @keyframes pb-float    { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }
  @keyframes pb-twinkle  { 0%,100%{opacity:var(--so)} 50%{opacity:calc(var(--so)*0.3)} }
  @keyframes pb-orbit    { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
  @keyframes pb-orbit-r  { from{transform:rotate(0deg)} to{transform:rotate(-360deg)} }
  @keyframes pb-bgring   { from{transform:translate(-50%,-50%) rotate(0deg)} to{transform:translate(-50%,-50%) rotate(360deg)} }
  @keyframes pb-bgring-r { from{transform:translate(-50%,-50%) rotate(0deg)} to{transform:translate(-50%,-50%) rotate(-360deg)} }
  @keyframes pb-scan     { 0%{top:-2px;opacity:0} 4%{opacity:0.8} 96%{opacity:0.4} 100%{top:100%;opacity:0} }
  @keyframes pb-saucer   { 0%,100%{opacity:0.35;filter:blur(4px)} 50%{opacity:0.6;filter:blur(7px)} }
  @keyframes pb-chglow   { 0%,100%{box-shadow:0 0 12px #00FFEE44,inset 0 0 8px #00FFEE11} 50%{box-shadow:0 0 24px #00FFEE77,inset 0 0 14px #00FFEE22} }
  @keyframes pb-ledpulse { 0%,100%{text-shadow:0 0 10px #00FFEE} 50%{text-shadow:0 0 20px #00FFEE,0 0 40px #00FFEE66} }
  @keyframes pb-pulse    { 0%,100%{opacity:1;box-shadow:0 0 16px #FF00CC,0 0 32px #FF00CC44} 50%{opacity:0.5;box-shadow:0 0 4px #FF00CC} }
  @keyframes pb-slidein  { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
  @keyframes pb-swipehint{ 0%,100%{opacity:0;transform:translateX(0)} 20%{opacity:0.7} 50%{opacity:0.9;transform:translateX(6px)} 80%{opacity:0.7} }
  @keyframes pb-radiowave{ 0%{opacity:0;transform:scale(0.8)} 20%{opacity:0.6} 100%{opacity:0;transform:scale(2.2)} }
  @keyframes pb-herocard { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
  @keyframes pb-bglogo   { 0%,100%{opacity:0.055;transform:scale(1) rotate(-1deg)} 50%{opacity:0.09;transform:scale(1.05) rotate(2deg)} }

  .pb-btn { -webkit-tap-highlight-color:transparent; outline:none; }
  .pb-btn:active { opacity:0.8; transform:scale(0.96); }
  .pb-hero-card { cursor:pointer; transition:border-color 0.2s, background 0.2s; }
  .pb-hero-card:hover  { border-color: rgba(255,255,255,0.3) !important; }
  .pb-hero-card:active { opacity:0.8; transform:scale(0.96); }
  .pb-close-tab:active { opacity:0.65; }
  .pb-store-a { -webkit-tap-highlight-color:transparent; }
  .pb-store-a:active { opacity:0.75; }
`;

function starField(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    x: `${((i * 137.508) % 100).toFixed(1)}%`,
    y: `${((i * 97.316) % 100).toFixed(1)}%`,
    size: i % 9 === 0 ? 2.5 : i % 4 === 0 ? 1.5 : 1,
    opacity: 0.25 + (i % 6) * 0.12,
  }));
}
const STARS = starField(80);

// ─── Shared SVG helpers ────────────────────────────────────────────────────────

function IosShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7" />
      <rect x="4" y="16" width="16" height="5" rx="1" fill="none" />
    </svg>
  );
}

function RetroShip({ size = 70, glow = TEAL }: { size?: number; glow?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" style={{ filter: `drop-shadow(0 0 12px ${glow}66)` }}>
      <defs>
        <linearGradient id="hull" x1="60" y1="20" x2="60" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#5B6EAA" />
          <stop offset="50%" stopColor="#3A4477" />
          <stop offset="100%" stopColor="#1E2344" />
        </linearGradient>
        <linearGradient id="wing" x1="0" y1="70" x2="120" y2="70" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FF00CC" stopOpacity="0.9" />
          <stop offset="50%" stopColor="#8844CC" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#FF00CC" stopOpacity="0.9" />
        </linearGradient>
        <radialGradient id="cockpit2" cx="60" cy="38" r="14" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={glow} stopOpacity="0.9" />
          <stop offset="70%" stopColor={glow} stopOpacity="0.3" />
          <stop offset="100%" stopColor="#001122" stopOpacity="0.8" />
        </radialGradient>
      </defs>
      <ellipse cx="60" cy="98" rx="18" ry="4" fill={`${MGNT}33`} style={{ animation: "pb-saucer 2s ease-in-out infinite" }} />
      <rect x="55" y="88" width="10" height="12" rx="2" fill="#2A3055" stroke={`${glow}44`} strokeWidth="0.5" />
      <rect x="50" y="92" width="20" height="6" rx="1" fill="#2A3055" stroke={`${MGNT}44`} strokeWidth="0.5" />
      <circle cx="56" cy="95" r="1.5" fill={MGNT} style={{ animation: "pb-pulse 1.5s ease-in-out infinite" }} />
      <circle cx="64" cy="95" r="1.5" fill={glow} style={{ animation: "pb-pulse 1.5s ease-in-out 0.5s infinite" }} />
      <path d="M40 75 L60 20 L80 75 Z" fill="url(#hull)" stroke={`${glow}55`} strokeWidth="1" strokeLinejoin="round" />
      <ellipse cx="60" cy="38" rx="8" ry="10" fill="url(#cockpit2)" stroke={glow} strokeWidth="1" style={{ animation: "pb-chglow 3s ease-in-out infinite" }} />
      <ellipse cx="60" cy="36" rx="4" ry="5" fill={`${glow}22`} />
      <path d="M40 75 L15 85 L18 70 L40 65 Z" fill="url(#wing)" stroke={`${MGNT}66`} strokeWidth="0.8" />
      <path d="M80 75 L105 85 L102 70 L80 65 Z" fill="url(#wing)" stroke={`${MGNT}66`} strokeWidth="0.8" />
      <circle cx="22" cy="80" r="2" fill={MGNT} style={{ animation: "pb-pulse 1s ease-in-out infinite" }} />
      <circle cx="98" cy="80" r="2" fill={MGNT} style={{ animation: "pb-pulse 1s ease-in-out 0.3s infinite" }} />
      <path d="M55 75 L52 90 L58 90 Z" fill={`${glow}55`} />
      <path d="M65 75 L62 90 L68 90 Z" fill={`${glow}55`} />
      <line x1="60" y1="88" x2="60" y2="110" stroke={`${glow}33`} strokeWidth="3" strokeLinecap="round" style={{ animation: "pb-pulse 0.8s ease-in-out 0.2s infinite" }} />
    </svg>
  );
}


// ─── Channel Content Screens ──────────────────────────────────────────────────

function StudioHomeScreen({ tune }: { tune: (id: StudioChId) => void }) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: "clamp(14px,3vw,28px)", color: "#E8F4FF", animation: "pb-slidein 0.3s ease-out" }}>
      <img src={logoUrl} alt="PlanetBrick" style={{ height: "clamp(18px,2.5vw,28px)", width: "auto", objectFit: "contain", objectPosition: "left", marginBottom: "clamp(8px,1.5vw,14px)", opacity: 0.9 }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ fontSize: "clamp(8px,1vw,10px)", fontFamily: "monospace", color: TEAL, letterSpacing: "0.35em", marginBottom: "8px" }}>▸ BROADCASTING FROM ORBIT</div>
        <h1 style={{ fontSize: "clamp(20px,2.8vw,38px)", fontWeight: 900, lineHeight: 1.08, color: "#FFFFFF", margin: "0 0 clamp(8px,1.5vw,14px)" }}>
          Your LEGO business,<br /><span style={{ color: TEAL, textShadow: `0 0 20px ${TEAL}55` }}>on the air.</span>
        </h1>
        <p style={{ fontSize: "clamp(11px,1.1vw,14px)", color: "rgba(210,230,255,0.85)", maxWidth: "440px", lineHeight: 1.7, marginBottom: "clamp(12px,2vw,20px)" }}>
          AI-powered repricing, instant part identification, and multichannel sync — E.L.F.I.E. runs your back office while you build.
        </p>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button onClick={() => tune("ops")} className="pb-btn" style={{ background: `linear-gradient(135deg, ${TEAL}CC, #00BBDD)`, border: "none", borderRadius: "100px", padding: "clamp(7px,1vw,11px) clamp(16px,2vw,24px)", cursor: "pointer", color: SCR_BG, fontWeight: 800, fontSize: "clamp(10px,1vw,13px)", letterSpacing: "0.05em", boxShadow: `0 0 20px ${TEAL}55` }}>
            See Dashboards →
          </button>
        </div>
      </div>
      <div style={{ display: "flex", gap: "clamp(14px,3vw,32px)", borderTop: `1px solid ${TEAL}28`, paddingTop: "clamp(8px,1.5vw,12px)", flexWrap: "wrap" }}>
        {[["130k+", "Parts"], ["10×", "Faster"], ["24/7", "Pricing"], ["100%", "Synced"]].map(([v, l]) => (
          <div key={l}>
            <div style={{ fontSize: "clamp(13px,1.6vw,20px)", fontWeight: 900, color: TEAL, fontFamily: "monospace", textShadow: `0 0 10px ${TEAL}66` }}>{v}</div>
            <div style={{ fontSize: "clamp(7px,0.65vw,9px)", color: "rgba(190,215,255,0.6)", letterSpacing: "0.2em", textTransform: "uppercase" }}>{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OpsScreen({ slideIndex }: { slideIndex: number }) {
  const s = OPS_SLIDES[slideIndex] ?? OPS_SLIDES[0];
  return (
    <div key={slideIndex} style={{ height: "100%", display: "flex", flexDirection: "column", padding: "clamp(10px,1.8vw,20px) clamp(12px,2vw,24px)", color: "#E8F4FF", gap: "clamp(6px,1.2vw,10px)", animation: "pb-slidein 0.25s ease-out" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: "clamp(7px,0.7vw,9px)", fontFamily: "monospace", color: TEAL, letterSpacing: "0.3em", marginBottom: "2px" }}>CH 02 — OPS · {slideIndex + 1}/{OPS_SLIDES.length}</div>
          <h2 style={{ fontSize: "clamp(13px,1.6vw,19px)", fontWeight: 900, margin: 0 }}>
            <span style={{ color: s.color, textShadow: `0 0 14px rgba(${s.rgb},0.5)` }}>{s.label}</span>
            <span style={{ color: "#fff" }}> Dashboard</span>
          </h2>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px", background: `rgba(${s.rgb},0.08)`, border: `1px solid rgba(${s.rgb},0.3)`, borderRadius: "100px", padding: "2px 8px 2px 5px" }}>
          <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: s.color, boxShadow: `0 0 5px ${s.color}`, animation: "pb-pulse 1.5s ease-in-out infinite" }} />
          <span style={{ fontSize: "clamp(6px,0.6vw,8px)", fontFamily: "monospace", color: s.color, fontWeight: 700, letterSpacing: "0.12em" }}>LIVE</span>
        </div>
      </div>
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontSize: "clamp(6px,0.62vw,8px)", fontFamily: "monospace", color: `rgba(${s.rgb},0.7)`, letterSpacing: "0.25em", marginBottom: "clamp(3px,0.5vw,5px)" }}>METRICS</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "clamp(3px,0.5vw,6px)" }}>
          {s.metrics.map(m => (
            <div key={m.label} style={{ background: `rgba(${s.rgb},0.05)`, border: `1px solid rgba(${s.rgb},0.2)`, borderRadius: "8px", padding: "clamp(5px,0.8vw,9px) clamp(4px,0.6vw,7px)", textAlign: "center" }}>
              <div style={{ fontSize: "clamp(11px,1.3vw,16px)", fontWeight: 900, color: s.color, fontFamily: "monospace", textShadow: `0 0 8px rgba(${s.rgb},0.5)` }}>{m.value}</div>
              <div style={{ fontSize: "clamp(6px,0.6vw,8px)", color: "rgba(200,220,255,0.5)", letterSpacing: "0.1em", marginTop: "1px" }}>{m.label.toUpperCase()}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "clamp(6px,0.62vw,8px)", fontFamily: "monospace", color: `rgba(${s.rgb},0.7)`, letterSpacing: "0.25em", marginBottom: "clamp(3px,0.5vw,5px)" }}>TOOLS</div>
        <div style={{ display: "flex", gap: "clamp(5px,0.7vw,8px)", flexWrap: "wrap" }}>
          {s.tools.map((tool, i) => (
            <div key={tool} style={{ flex: 1, minWidth: "28%", background: i === 0 ? `rgba(${s.rgb},0.13)` : "rgba(255,255,255,0.04)", border: `1px solid ${i === 0 ? `rgba(${s.rgb},0.45)` : "rgba(200,220,255,0.12)"}`, borderRadius: "8px", padding: "clamp(6px,0.9vw,10px)", display: "flex", alignItems: "center", gap: "5px" }}>
              <div style={{ width: "4px", height: "4px", borderRadius: "50%", background: i === 0 ? s.color : "rgba(200,220,255,0.25)", flexShrink: 0 }} />
              <span style={{ fontSize: "clamp(8px,0.85vw,11px)", color: i === 0 ? s.color : "rgba(210,230,255,0.7)", fontWeight: i === 0 ? 700 : 500 }}>{tool}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ToolsScreen({ slideIndex }: { slideIndex: number }) {
  const t = TOOLS_SLIDES[slideIndex] ?? TOOLS_SLIDES[0];
  return (
    <div key={slideIndex} style={{ height: "100%", display: "flex", flexDirection: "column", padding: "clamp(10px,2vw,22px) clamp(12px,2.5vw,26px)", color: "#E8F4FF", gap: "clamp(8px,1.3vw,14px)", animation: "pb-slidein 0.25s ease-out" }}>
      <div>
        <div style={{ fontSize: "clamp(7px,0.7vw,9px)", fontFamily: "monospace", color: TEAL, letterSpacing: "0.3em", marginBottom: "4px" }}>CH 03 — TOOLS · {slideIndex + 1}/{TOOLS_SLIDES.length}</div>
        <h2 style={{ fontSize: "clamp(14px,1.7vw,20px)", fontWeight: 900, color: "#FFF", margin: 0 }}>Your toolkit, always on.</h2>
      </div>
      <div style={{ flex: 1, background: `rgba(${t.rgb},0.06)`, border: `1px solid rgba(${t.rgb},0.3)`, borderRadius: "12px", padding: "clamp(12px,1.7vw,20px) clamp(10px,1.4vw,16px)", display: "flex", flexDirection: "column", gap: "clamp(7px,1vw,11px)", boxShadow: `0 0 24px rgba(${t.rgb},0.07) inset`, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse 60% 50% at 15% 20%, rgba(${t.rgb},0.08), transparent)`, pointerEvents: "none" }} />
        <div style={{ display: "flex", alignItems: "center", gap: "clamp(8px,1.2vw,12px)" }}>
          <div style={{ width: "clamp(28px,3.5vw,42px)", height: "clamp(28px,3.5vw,42px)", borderRadius: "50%", background: `rgba(${t.rgb},0.15)`, border: `1px solid rgba(${t.rgb},0.4)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: `0 0 18px rgba(${t.rgb},0.3)` }}>
            <t.Icon size={15} color={t.color} />
          </div>
          <div>
            <div style={{ fontSize: "clamp(8px,0.8vw,10px)", fontFamily: "monospace", color: t.color, letterSpacing: "0.2em", opacity: 0.8 }}>{t.tagline.toUpperCase()}</div>
            <div style={{ fontSize: "clamp(16px,1.9vw,24px)", fontWeight: 900, color: "#FFF", lineHeight: 1.1 }}>{t.title}</div>
          </div>
        </div>
        <p style={{ fontSize: "clamp(10px,1vw,13px)", color: "rgba(210,230,255,0.82)", lineHeight: 1.65, margin: 0 }}>{t.desc}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "clamp(4px,0.6vw,7px)", marginTop: "auto" }}>
          {t.bullets.map(b => (
            <div key={b} style={{ padding: "3px 9px", borderRadius: "100px", background: `rgba(${t.rgb},0.12)`, border: `1px solid rgba(${t.rgb},0.3)`, fontSize: "clamp(8px,0.8vw,10px)", color: t.color, fontWeight: 600 }}>{b}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ServicesScreen() {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: "clamp(10px,2vw,22px) clamp(12px,2.5vw,26px)", color: "#E8F4FF", gap: "clamp(8px,1.5vw,14px)", animation: "pb-slidein 0.3s ease-out" }}>
      <div>
        <div style={{ fontSize: "clamp(7px,0.7vw,9px)", fontFamily: "monospace", color: PURP, letterSpacing: "0.3em", marginBottom: "4px" }}>CH 04 — SERVICES</div>
        <h2 style={{ fontSize: "clamp(14px,1.7vw,20px)", fontWeight: 900, color: "#FFF", margin: 0 }}>
          Technology for the<br /><span style={{ color: PURP }}>LEGO community</span>
        </h2>
        <p style={{ fontSize: "clamp(9px,0.9vw,12px)", color: "rgba(210,230,255,0.6)", margin: "5px 0 0", lineHeight: 1.55 }}>
          Beyond the app — tools for every part of the LEGO universe.
        </p>
      </div>
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "clamp(5px,0.8vw,9px)" }}>
        {SERVICES_ITEMS.map(s => (
          <div key={s.title} style={{ background: `rgba(${s.rgb},0.06)`, border: `1px solid rgba(${s.rgb},0.25)`, borderRadius: "10px", padding: "clamp(8px,1.2vw,14px)", display: "flex", flexDirection: "column", gap: "clamp(4px,0.6vw,7px)", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: "6px", right: "8px", fontSize: "clamp(6px,0.6vw,8px)", fontFamily: "monospace", color: `rgba(${s.rgb},0.55)`, letterSpacing: "0.15em" }}>SOON</div>
            <div style={{ width: "clamp(24px,3vw,34px)", height: "clamp(24px,3vw,34px)", borderRadius: "8px", background: `rgba(${s.rgb},0.12)`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 12px rgba(${s.rgb},0.2)` }}>
              <s.Icon size={13} color={s.color} />
            </div>
            <div style={{ fontSize: "clamp(9px,1vw,12px)", fontWeight: 800, color: "#FFF", lineHeight: 1.2 }}>{s.title}</div>
            <div style={{ fontSize: "clamp(8px,0.82vw,10px)", color: "rgba(200,220,255,0.62)", lineHeight: 1.45 }}>{s.desc}</div>
          </div>
        ))}
      </div>
      <div style={{ flexShrink: 0 }}>
        <Link href="/signup">
          <button className="pb-btn" style={{ background: `rgba(${168},${85},${247},0.15)`, border: `1px solid ${PURP}55`, borderRadius: "100px", padding: "clamp(7px,1vw,10px) clamp(16px,2vw,24px)", cursor: "pointer", color: PURP, fontWeight: 700, fontSize: "clamp(10px,1vw,12px)", letterSpacing: "0.05em" }}>
            Join the Waitlist →
          </button>
        </Link>
      </div>
    </div>
  );
}

function LiveScreen({ canPromptInstall, showInstallOption, isInstalled, isInstalling, isIos, onInstall }: {
  canPromptInstall: boolean;
  showInstallOption: boolean;
  isInstalled: boolean;
  isInstalling: boolean;
  isIos: boolean;
  onInstall: () => void;
}) {
  const [step, setStep] = useState<"welcome" | "email" | "password">("welcome");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const showBtn = showInstallOption && !isInstalled;

  const inputStyle: React.CSSProperties = {
    width: "100%", background: "rgba(0,255,238,0.06)", border: `1px solid ${TEAL}44`,
    borderRadius: "8px", padding: "clamp(8px,1vw,11px) 12px", color: "#E8F4FF",
    fontSize: "clamp(11px,1.1vw,14px)", fontFamily: "monospace", outline: "none",
    boxSizing: "border-box",
  };

  async function handleCheckEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setIsLoading(true);
    try {
      const res = await fetch("/api/check-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim() }) });
      if (!res.ok) throw new Error("check failed");
      const data = await res.json();
      if (data.exists) setStep("password");
      else window.location.href = `/signup?email=${encodeURIComponent(email.trim())}`;
    } catch { setError("Could not verify email. Try again."); }
    finally { setIsLoading(false); }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setIsLoading(true);
    try {
      const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim(), password }) });
      if (!res.ok) throw new Error("login failed");
      window.location.href = "/";
    } catch { setError("Invalid password. Please try again."); }
    finally { setIsLoading(false); }
  }

  if (step === "email") return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "clamp(14px,3vw,28px)", gap: "clamp(10px,1.6vw,18px)", animation: "pb-slidein 0.25s ease-out" }}>
      <div>
        <div style={{ fontSize: "clamp(8px,0.9vw,10px)", fontFamily: "monospace", color: MGNT, letterSpacing: "0.35em", marginBottom: "6px" }}>▸ ON AIR — STUDIO ACCESS</div>
        <h2 style={{ fontSize: "clamp(16px,2vw,22px)", fontWeight: 900, color: "#FFF", margin: "0 0 4px" }}>Sign In</h2>
        <p style={{ fontSize: "clamp(10px,1vw,12px)", color: "rgba(210,230,255,0.55)", margin: 0 }}>Enter your email to continue</p>
      </div>
      <form onSubmit={handleCheckEmail} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <div>
          <div style={{ fontSize: "clamp(9px,0.85vw,11px)", fontFamily: "monospace", color: `${TEAL}AA`, letterSpacing: "0.1em", marginBottom: "5px" }}>EMAIL</div>
          <input type="email" required autoFocus value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" style={inputStyle} />
        </div>
        {error && <div style={{ fontSize: "clamp(9px,0.85vw,11px)", color: "#FF6B88", fontFamily: "monospace" }}>{error}</div>}
        <button type="submit" disabled={isLoading} className="pb-btn" style={{ background: `linear-gradient(135deg, ${TEAL}DD, #00BBDD)`, border: "none", borderRadius: "100px", padding: "clamp(9px,1.1vw,13px) 20px", cursor: "pointer", color: SCR_BG, fontWeight: 800, fontSize: "clamp(11px,1.1vw,14px)", boxShadow: `0 0 22px ${TEAL}44` }}>
          {isLoading ? "Checking…" : "Continue →"}
        </button>
        <button type="button" onClick={() => { setStep("welcome"); setError(""); }} className="pb-btn" style={{ background: "transparent", border: "none", color: `${TEAL}88`, fontSize: "clamp(9px,0.9vw,11px)", fontFamily: "monospace", cursor: "pointer", padding: "2px" }}>
          ← Back
        </button>
      </form>
    </div>
  );

  if (step === "password") return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "clamp(14px,3vw,28px)", gap: "clamp(10px,1.6vw,18px)", animation: "pb-slidein 0.25s ease-out" }}>
      <div>
        <div style={{ fontSize: "clamp(8px,0.9vw,10px)", fontFamily: "monospace", color: MGNT, letterSpacing: "0.35em", marginBottom: "6px" }}>▸ ON AIR — STUDIO ACCESS</div>
        <h2 style={{ fontSize: "clamp(16px,2vw,22px)", fontWeight: 900, color: "#FFF", margin: "0 0 4px" }}>Welcome back</h2>
        <div style={{ fontSize: "clamp(9px,0.9vw,11px)", fontFamily: "monospace", color: TEAL, background: `${TEAL}11`, border: `1px solid ${TEAL}33`, borderRadius: "6px", padding: "5px 10px", display: "inline-block" }}>{email}</div>
      </div>
      <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <div>
          <div style={{ fontSize: "clamp(9px,0.85vw,11px)", fontFamily: "monospace", color: `${TEAL}AA`, letterSpacing: "0.1em", marginBottom: "5px" }}>PASSWORD</div>
          <input type="password" required autoFocus value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" style={inputStyle} />
        </div>
        {error && <div style={{ fontSize: "clamp(9px,0.85vw,11px)", color: "#FF6B88", fontFamily: "monospace" }}>{error}</div>}
        <button type="submit" disabled={isLoading} className="pb-btn" style={{ background: `linear-gradient(135deg, ${TEAL}DD, #00BBDD)`, border: "none", borderRadius: "100px", padding: "clamp(9px,1.1vw,13px) 20px", cursor: "pointer", color: SCR_BG, fontWeight: 800, fontSize: "clamp(11px,1.1vw,14px)", boxShadow: `0 0 22px ${TEAL}44` }}>
          {isLoading ? "Signing in…" : "Sign In"}
        </button>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button type="button" onClick={() => { setStep("email"); setError(""); setPassword(""); }} className="pb-btn" style={{ background: "transparent", border: "none", color: `${TEAL}88`, fontSize: "clamp(9px,0.9vw,11px)", fontFamily: "monospace", cursor: "pointer", padding: "2px" }}>
            ← Back
          </button>
          <a href="/forgot-password" style={{ color: `${TEAL}88`, fontSize: "clamp(9px,0.9vw,11px)", fontFamily: "monospace", textDecoration: "none" }}>Forgot password?</a>
        </div>
      </form>
    </div>
  );

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "clamp(14px,3vw,28px)", color: "#E8F4FF", textAlign: "center", gap: "clamp(8px,1.5vw,16px)", animation: "pb-slidein 0.3s ease-out" }}>
      <div style={{ position: "relative", marginBottom: "4px" }}>
        <div style={{ animation: "pb-float 4s ease-in-out infinite" }}>
          <RetroShip size={clampPx(60, 15, 80)} />
        </div>
        {[0, 1, 2].map(i => (
          <div key={i} style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: `${70 + i * 30}px`, height: `${70 + i * 30}px`, borderRadius: "50%", border: `1px solid ${TEAL}${["44", "22", "11"][i]}`, animation: `pb-radiowave ${2 + i * 0.8}s ease-out ${i * 0.6}s infinite` }} />
        ))}
      </div>
      <div>
        <div style={{ fontSize: "clamp(8px,0.9vw,10px)", fontFamily: "monospace", color: MGNT, letterSpacing: "0.35em", marginBottom: "6px" }}>▸ ON AIR — STUDIO ACCESS</div>
        <h2 style={{ fontSize: "clamp(18px,2.2vw,26px)", fontWeight: 900, color: "#FFF", margin: "0 0 6px" }}>Welcome back</h2>
        <p style={{ fontSize: "clamp(10px,1vw,13px)", color: "rgba(210,230,255,0.65)", margin: 0, lineHeight: 1.55 }}>
          Sign in to your PlanetBrick Studio account
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%", maxWidth: "240px" }}>
        <button onClick={() => setStep("email")} className="pb-btn" style={{ background: `linear-gradient(135deg, ${TEAL}DD, #00BBDD)`, border: "none", borderRadius: "100px", padding: "clamp(9px,1.1vw,13px) 20px", cursor: "pointer", color: SCR_BG, fontWeight: 800, fontSize: "clamp(11px,1.1vw,14px)", boxShadow: `0 0 22px ${TEAL}44`, letterSpacing: "0.04em" }}>
          Sign In
        </button>
        <Link href="/signup">
          <button className="pb-btn" style={{ width: "100%", background: "transparent", border: `1px solid ${TEAL}44`, borderRadius: "100px", padding: "clamp(8px,1vw,11px) 20px", cursor: "pointer", color: TEAL, fontWeight: 700, fontSize: "clamp(10px,1vw,13px)" }}>
            Create Account
          </button>
        </Link>
        {showBtn && (
          <button onClick={onInstall} disabled={isInstalling} className="pb-btn" style={{ background: "transparent", border: `1px solid ${MGNT}44`, borderRadius: "100px", padding: "clamp(7px,0.9vw,10px) 16px", cursor: "pointer", color: MGNT, fontWeight: 600, fontSize: "clamp(9px,0.9vw,12px)", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
            {isInstalling ? "Installing…" : isIos ? <><IosShareIcon /> Add to Home Screen</> : "Install App"}
          </button>
        )}
        {isInstalled && <p style={{ fontSize: "clamp(9px,0.9vw,11px)", color: `${TEAL}88`, fontFamily: "monospace", margin: 0 }}>✓ App installed</p>}
      </div>
    </div>
  );
}

// Shop channel screens
function ShopStoreScreen({ store }: { store: "owl" | "link" }) {
  const config = {
    owl: {
      name: "BrickOwl", chNum: "01", color: AMBER, rgb: "255,184,48",
      url: "https://planetbrick.brickowl.com", display: "planetbrick.brickowl.com",
      tagline: "Our primary storefront",
      desc: "Browse our full catalog of authentic LEGO parts, minifigs, and sets. 47,000+ lots with fast shipping.",
      stats: [["47k+", "Lots"], ["128", "Categories"], ["4.9★", "Rating"], ["Fast", "Shipping"]],
    },
    link: {
      name: "BrickLink", chNum: "02", color: "#5CA8FF", rgb: "92,168,255",
      url: "https://store.bricklink.com/PlanetBrick?p=PlanetBrick#/terms", display: "store.bricklink.com/PlanetBrick",
      tagline: "World's largest LEGO marketplace",
      desc: "Find our complete inventory on BrickLink, trusted by millions of LEGO buyers and sellers worldwide.",
      stats: [["#1", "Marketplace"], ["5★", "Seller"], ["Verified", "Store"], ["Global", "Shipping"]],
    },
  }[store];

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: "clamp(12px,2.5vw,24px)", color: "#E8F4FF", gap: "clamp(8px,1.5vw,14px)", animation: "pb-slidein 0.25s ease-out" }}>
      <div>
        <div style={{ fontSize: "clamp(7px,0.7vw,9px)", fontFamily: "monospace", color: config.color, letterSpacing: "0.3em", marginBottom: "3px" }}>CH {config.chNum} — {config.name.toUpperCase()}</div>
        <h2 style={{ fontSize: "clamp(16px,2vw,24px)", fontWeight: 900, color: config.color, margin: 0, textShadow: `0 0 20px rgba(${config.rgb},0.4)` }}>{config.name}</h2>
        <div style={{ fontSize: "clamp(8px,0.85vw,11px)", fontFamily: "monospace", color: `rgba(${config.rgb},0.6)`, marginTop: "2px" }}>{config.display}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "clamp(4px,0.6vw,7px)", flexShrink: 0 }}>
        {config.stats.map(([v, l]) => (
          <div key={l} style={{ background: `rgba(${config.rgb},0.05)`, border: `1px solid rgba(${config.rgb},0.2)`, borderRadius: "8px", padding: "clamp(5px,0.8vw,9px) 4px", textAlign: "center" }}>
            <div style={{ fontSize: "clamp(10px,1.2vw,15px)", fontWeight: 900, color: config.color, fontFamily: "monospace" }}>{v}</div>
            <div style={{ fontSize: "clamp(6px,0.6vw,8px)", color: "rgba(200,220,255,0.5)", letterSpacing: "0.08em", marginTop: "1px" }}>{l}</div>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, background: `rgba(${config.rgb},0.05)`, border: `1px solid rgba(${config.rgb},0.2)`, borderRadius: "12px", padding: "clamp(12px,1.8vw,18px)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <p style={{ fontSize: "clamp(11px,1.1vw,14px)", color: "rgba(210,230,255,0.82)", lineHeight: 1.65, margin: 0 }}>
          <span style={{ color: config.color, fontWeight: 700 }}>{config.tagline}.</span><br />{config.desc}
        </p>
        <a href={config.url} target="_blank" rel="noopener noreferrer" className="pb-store-a" style={{ textDecoration: "none", marginTop: "clamp(10px,1.5vw,16px)", display: "inline-flex", alignItems: "center", gap: "6px", background: `rgba(${config.rgb},0.15)`, border: `1px solid rgba(${config.rgb},0.45)`, borderRadius: "100px", padding: "clamp(8px,1vw,12px) clamp(14px,1.8vw,22px)", color: config.color, fontWeight: 700, fontSize: "clamp(11px,1.1vw,14px)", alignSelf: "flex-start", boxShadow: `0 0 16px rgba(${config.rgb},0.15)` }}>
          Visit Store <ExternalLink size={12} />
        </a>
      </div>
    </div>
  );
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function clampPx(min: number, vw: number, max: number): number {
  if (typeof window === "undefined") return Math.round((min + max) / 2);
  const vwPx = window.innerWidth * (vw / 100);
  return Math.min(Math.max(Math.round(vwPx), min), max);
}

// ─── TV Drop Panel ────────────────────────────────────────────────────────────

function TvPanel({
  panel, onClose,
  canPromptInstall, showInstallOption, isInstalled, isInstalling, isIos, onInstall,
}: {
  panel: Panel; onClose: () => void;
  canPromptInstall: boolean; showInstallOption: boolean;
  isInstalled: boolean; isInstalling: boolean; isIos: boolean; onInstall: () => void;
}) {
  const isOpen = panel !== null;

  // Per-panel channel state
  const [studioCh, setStudioCh]   = useState<StudioChId>("home");
  const [shopCh,   setShopCh]     = useState<ShopChId>("owl");
  const [slideIdx, setSlideIdx]   = useState(0);
  const [flash,    setFlash]      = useState(false);
  const touchX = useRef(0);

  // Snap to live channel when opened via signin hero card
  useEffect(() => {
    if (panel === "signin") setStudioCh("live");
    else if (panel === "studio") setStudioCh("home");
    else if (panel === "shop")   setShopCh("owl");
    setSlideIdx(0);
    setFlash(false);
  }, [panel]);

  const channels     = panel === "shop" ? SHOP_CHANNELS   : STUDIO_CHANNELS;
  const activeCh     = panel === "shop" ? (SHOP_CHANNELS.find(c => c.id === shopCh) ?? SHOP_CHANNELS[0]) : (STUDIO_CHANNELS.find(c => c.id === studioCh) ?? STUDIO_CHANNELS[0]);
  const totalSlides  = activeCh.slides;
  const chNum        = activeCh.num;
  const chLabel      = activeCh.label;
  const panelColor   = panel === "shop" ? AMBER : (studioCh === "live" ? MGNT : studioCh === "services" ? PURP : TEAL);

  function tune(id: ChId) {
    if (flash) return;
    if (panel === "shop") {
      if (id === shopCh) return;
      setFlash(true); setSlideIdx(0);
      setTimeout(() => { setShopCh(id as ShopChId); setFlash(false); }, 180);
    } else {
      if (id === studioCh) return;
      setFlash(true); setSlideIdx(0);
      setTimeout(() => { setStudioCh(id as StudioChId); setFlash(false); }, 180);
    }
  }

  function goSlide(dir: 1 | -1) {
    setSlideIdx(i => Math.min(Math.max(i + dir, 0), totalSlides - 1));
  }

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }} />
      )}

      {/* Panel wrapper — drops from top */}
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0,
        height: "90dvh",
        transform: isOpen ? "translateY(0)" : "translateY(-102%)",
        transition: isOpen
          ? "transform 0.52s cubic-bezier(0.34, 1.42, 0.64, 1)"
          : "transform 0.3s cubic-bezier(0.55, 0, 0.95, 0.45)",
        zIndex: 100, display: "flex", flexDirection: "column", willChange: "transform",
      }}>

        {/* Antennae row (visible as TV descends first) */}
        <div style={{ display: "flex", justifyContent: "center", gap: "clamp(100px,22vw,200px)", flexShrink: 0, zIndex: 2, marginBottom: "-2px", position: "relative" }}>
          {/* Radio waves between antennae */}
          <div style={{ position: "absolute", left: "50%", top: "2px", transform: "translateX(-50%)", pointerEvents: "none" }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: `${40 + i * 22}px`, height: `${26 + i * 14}px`, borderRadius: "50%", border: `1px solid ${TEAL}`, opacity: 0, animation: `pb-radiowave ${1.4 + i * 0.45}s ease-out ${i * 0.4}s infinite` }} />
            ))}
          </div>
          {([-12, 12] as const).map((deg, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{ width: "clamp(6px,1vw,10px)", height: "clamp(6px,1vw,10px)", borderRadius: "50%", background: `radial-gradient(circle at 35% 35%, #FFFFFF, ${TEAL}AA)`, boxShadow: `0 0 8px ${TEAL}BB, 0 0 16px ${TEAL}55`, marginBottom: "-1px" }} />
              <div style={{ width: "clamp(2px,0.25vw,3px)", height: "clamp(28px,5vh,50px)", background: `linear-gradient(to bottom, #D0E8FF 0%, #5060A0 100%)`, transform: `rotate(${deg}deg)`, transformOrigin: "bottom center", borderRadius: "2px 2px 0 0" }} />
            </div>
          ))}
        </div>

        {/* TV body */}
        <div style={{
          flex: 1, display: "flex", flexDirection: "column",
          background: "linear-gradient(165deg, #1E1E3A 0%, #161628 35%, #101020 70%, #0C0C1A 100%)",
          borderRadius: "0 0 clamp(20px,4vw,32px) clamp(20px,4vw,32px)",
          border: `2px solid rgba(255,255,255,0.07)`,
          borderTop: "none",
          boxShadow: `0 0 0 1px rgba(100,120,220,0.22) inset, 0 0 0 2px rgba(60,80,160,0.12) inset, 0 24px 80px rgba(0,0,0,0.85), 0 0 80px ${TEAL}14, 0 0 160px ${TEAL}07`,
          position: "relative",
          padding: "clamp(10px,1.8vw,18px) clamp(14px,2.2vw,24px) clamp(8px,1.2vw,14px)",
          gap: "clamp(8px,1.2vw,12px)",
        }}>

          {/* Top highlight edge */}
          <div style={{ position: "absolute", top: 0, left: "8%", right: "8%", height: "1px", background: `linear-gradient(90deg, transparent, ${TEAL}44, transparent)`, pointerEvents: "none" }} />

          {/* Corner accent marks */}
          {([{ top: "10px", left: "14px" }, { top: "10px", right: "14px" }, { bottom: "10px", left: "14px" }, { bottom: "10px", right: "14px" }] as const).map((pos, i) => (
            <div key={i} style={{ position: "absolute", ...pos, width: "14px", height: "14px", border: `1px solid ${TEAL}33`, borderRadius: "3px", pointerEvents: "none" }} />
          ))}

          {/* Chrome bezel + screen */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <div style={{
              flex: 1, display: "flex", flexDirection: "column",
              background: "linear-gradient(145deg, #3A3A5A 0%, #555578 20%, #2A2A44 55%, #404068 80%, #222238 100%)",
              borderRadius: "clamp(12px,2vw,20px)",
              padding: "clamp(5px,0.8vw,9px)",
              boxShadow: `inset 0 3px 8px rgba(0,0,0,0.7), 0 2px 6px rgba(0,0,0,0.5), 0 0 0 1px ${TEAL}22`,
            }}>
              {/* Glass screen */}
              <div style={{
                flex: 1, position: "relative",
                background: SCR_BG,
                borderRadius: "clamp(8px,1.4vw,16px)",
                overflow: "hidden",
              }}>
                {/* Repeating scanlines */}
                <div style={{ position: "absolute", inset: 0, zIndex: 15, pointerEvents: "none", backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px)" }} />
                {/* Teal phosphor glow */}
                <div style={{ position: "absolute", inset: 0, zIndex: 14, pointerEvents: "none", background: `radial-gradient(ellipse 75% 60% at 50% 40%, ${panelColor}0C 0%, transparent 70%)` }} />
                {/* Glass reflection */}
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "18%", zIndex: 16, pointerEvents: "none", background: "linear-gradient(to bottom, rgba(255,255,255,0.035), transparent)", borderRadius: "14px 14px 0 0" }} />
                {/* Animated scan line sweep */}
                <div style={{ position: "absolute", left: 0, right: 0, height: "2px", background: `linear-gradient(90deg, transparent 0%, ${panelColor}44 30%, ${panelColor}88 50%, ${panelColor}44 70%, transparent 100%)`, animation: "pb-scan 7s ease-in-out 2s infinite", pointerEvents: "none", zIndex: 17 }} />
                {/* Inner orbital rings */}
                <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
                  <div style={{ position: "absolute", left: "50%", top: "50%", width: "180%", height: "180%", border: `1px solid ${TEAL}07`, borderRadius: "50%", animation: "pb-bgring 80s linear infinite" }} />
                  <div style={{ position: "absolute", left: "50%", top: "50%", width: "140%", height: "140%", border: `1px solid ${PURP}06`, borderRadius: "50%", transform: "translate(-50%,-50%) rotate(30deg)", animation: "pb-bgring-r 55s linear infinite" }} />
                  <div style={{ position: "absolute", left: "50%", top: "50%", width: "110%", height: "110%", border: `1px solid ${MGNT}05`, borderRadius: "50%", transform: "translate(-50%,-50%) rotate(-20deg)", animation: "pb-bgring 40s linear infinite" }} />
                </div>
                {/* Channel flash static */}
                {flash && (
                  <div style={{ position: "absolute", inset: 0, zIndex: 20, backgroundImage: `repeating-linear-gradient(0deg, ${TEAL}1A 0px, transparent 1px, rgba(0,0,0,0.5) 3px, rgba(255,255,255,0.1) 5px), repeating-linear-gradient(90deg, rgba(255,255,255,0.03) 0px, transparent 2px)`, opacity: 0.9 }} />
                )}
                {/* Channel content */}
                <div style={{ position: "absolute", inset: "clamp(4px,0.8vw,8px)", zIndex: 5, opacity: flash ? 0 : 1, transition: "opacity 0.1s ease", overflow: "hidden" }}>
                  {!flash && panel === "shop" && shopCh === "owl"  && <ShopStoreScreen store="owl"  />}
                  {!flash && panel === "shop" && shopCh === "link" && <ShopStoreScreen store="link" />}
                  {!flash && (panel === "studio" || panel === "signin") && studioCh === "home"     && <StudioHomeScreen tune={id => tune(id as ChId)} />}
                  {!flash && (panel === "studio" || panel === "signin") && studioCh === "ops"      && <OpsScreen slideIndex={slideIdx} />}
                  {!flash && (panel === "studio" || panel === "signin") && studioCh === "tools"    && <ToolsScreen slideIndex={slideIdx} />}
                  {!flash && (panel === "studio" || panel === "signin") && studioCh === "services" && <ServicesScreen />}
                  {!flash && (panel === "studio" || panel === "signin") && studioCh === "live"     && <LiveScreen canPromptInstall={canPromptInstall} showInstallOption={showInstallOption} isInstalled={isInstalled} isInstalling={isInstalling} isIos={isIos} onInstall={onInstall} />}
                </div>
                {/* Slide dots */}
                {totalSlides > 1 && !flash && (
                  <div style={{ position: "absolute", bottom: "clamp(6px,1.2vw,10px)", left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: "5px", pointerEvents: "none", zIndex: 18 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "clamp(6px,0.6vw,8px)", fontFamily: "monospace", color: `${TEAL}88`, letterSpacing: "0.15em", animation: "pb-swipehint 3s ease-in-out 1s 2" }}>
                      <span>‹</span>SWIPE<span>›</span>
                    </div>
                    <div style={{ display: "flex", gap: "5px" }}>
                      {Array.from({ length: totalSlides }).map((_, i) => (
                        <div key={i} style={{ width: i === slideIdx ? "18px" : "5px", height: "5px", borderRadius: "3px", background: i === slideIdx ? TEAL : `${TEAL}44`, boxShadow: i === slideIdx ? `0 0 6px ${TEAL}` : "none", transition: "width 0.25s ease, background 0.25s ease" }} />
                      ))}
                    </div>
                  </div>
                )}
                {/* Touch/swipe handlers */}
                {totalSlides > 1 && (
                  <div style={{ position: "absolute", inset: 0, zIndex: 5 }} onTouchStart={e => { touchX.current = e.touches[0].clientX; }} onTouchEnd={e => { const dx = e.changedTouches[0].clientX - touchX.current; if (Math.abs(dx) > 36) goSlide(dx < 0 ? 1 : -1); }} />
                )}
              </div>
            </div>
          </div>

          {/* Bottom controls strip */}
          <div style={{ display: "flex", alignItems: "center", gap: "clamp(8px,1.2vw,16px)", flexShrink: 0, flexWrap: "nowrap", paddingTop: "clamp(6px,0.9vw,10px)", borderTop: `1px solid ${TEAL}18` }}>
            {/* LED channel display */}
            <div style={{ background: "#060612", border: `1px solid ${panelColor}55`, borderRadius: "10px", padding: "clamp(4px,0.6vw,7px) clamp(8px,1vw,14px)", textAlign: "center", fontFamily: "monospace", color: panelColor, fontWeight: 900, lineHeight: 1, fontSize: "clamp(15px,1.8vw,22px)", boxShadow: `0 0 14px ${panelColor}33, inset 0 0 12px rgba(0,0,0,0.95)`, animation: "pb-ledpulse 2.5s ease-in-out infinite", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
              {chNum}
              <div style={{ fontSize: "clamp(5px,0.5vw,7px)", letterSpacing: "0.2em", color: `${panelColor}BB` }}>CH</div>
            </div>

            {/* Channel buttons */}
            <div style={{ display: "flex", gap: "clamp(4px,0.7vw,9px)", flex: 1, justifyContent: "center", minWidth: 0 }}>
              {(channels as { id: ChId; num: string; label: string }[]).map(c => {
                const isActive = panel === "shop" ? c.id === shopCh : c.id === studioCh;
                return (
                  <button key={c.id} onClick={() => tune(c.id)} className="pb-btn" style={{ background: isActive ? `${panelColor}18` : "rgba(255,255,255,0.04)", border: `1px solid ${isActive ? panelColor : "rgba(200,220,255,0.2)"}`, borderRadius: "8px", padding: "clamp(5px,0.7vw,9px) clamp(8px,1.2vw,16px)", cursor: "pointer", color: isActive ? panelColor : "rgba(215,230,255,0.82)", fontFamily: "monospace", fontWeight: 700, letterSpacing: "0.08em", animation: isActive ? "pb-chglow 2s ease-in-out infinite" : "none", transition: "all 0.15s", textAlign: "center", lineHeight: 1.3, textShadow: isActive ? `0 0 8px ${panelColor}` : "none", display: "flex", flexDirection: "column", alignItems: "center", gap: "2px", flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "clamp(9px,1.1vw,14px)" }}>{c.num}</div>
                    <div style={{ fontSize: "clamp(6px,0.6vw,9px)", opacity: 0.85, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{c.label}</div>
                  </button>
                );
              })}
            </div>

            {/* PWR/HUE knobs */}
            <div style={{ display: "flex", gap: "clamp(6px,0.9vw,12px)", flexShrink: 0, alignItems: "center" }}>
              {[{ label: "PWR", color: TEAL }, { label: "HUE", color: PURP }].map(k => (
                <div key={k.label} style={{ textAlign: "center" }}>
                  <div style={{ width: "clamp(22px,2.4vw,32px)", height: "clamp(22px,2.4vw,32px)", borderRadius: "50%", background: `radial-gradient(circle at 35% 30%, rgba(100,100,180,0.3), rgba(10,10,40,0.95))`, border: `1px solid ${k.color}44`, boxShadow: `0 0 10px ${k.color}33, inset 0 0 8px rgba(0,0,0,0.9)`, margin: "0 auto", position: "relative" }}>
                    <div style={{ position: "absolute", width: "2px", height: "36%", background: k.color, top: "14%", left: "50%", transform: "translateX(-50%)", borderRadius: "2px", boxShadow: `0 0 4px ${k.color}` }} />
                  </div>
                  <div style={{ fontSize: "clamp(4px,0.45vw,6px)", color: `${k.color}88`, letterSpacing: "0.15em", marginTop: "2px" }}>{k.label}</div>
                </div>
              ))}
            </div>

            {/* Signal bars */}
            <div style={{ display: "flex", alignItems: "flex-end", gap: "2px", flexShrink: 0 }}>
              {[3, 5, 7, 9, 11].map((h, i) => (
                <div key={i} style={{ width: "clamp(2px,0.28vw,4px)", height: `${h}px`, borderRadius: "1px", background: i < 3 ? TEAL : `${TEAL}28`, boxShadow: i < 3 ? `0 0 4px ${TEAL}` : "none" }} />
              ))}
            </div>
          </div>
        </div>

        {/* Pull-close handle tab */}
        <div onClick={onClose} className="pb-close-tab" style={{ alignSelf: "center", marginTop: "-1px", background: "linear-gradient(160deg, #0e1340, #090f28)", border: `2px solid rgba(255,255,255,0.06)`, borderTop: "none", borderRadius: "0 0 clamp(12px,3vw,18px) clamp(12px,3vw,18px)", padding: "clamp(5px,1.2vw,8px) clamp(20px,5vw,34px) clamp(7px,1.5vw,11px)", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px", color: "rgba(180,200,255,0.35)", fontSize: "clamp(7px,1.8vw,10px)", fontFamily: "monospace", letterSpacing: "0.22em", userSelect: "none", WebkitUserSelect: "none" }}>
          ∧ CLOSE ∧
        </div>
      </div>
    </>
  );
}

// ─── Hero Page ────────────────────────────────────────────────────────────────

const HERO_CARDS = [
  { id: "shop"   as Panel, label: "Shop",    sub: "LEGO parts stores",  color: AMBER, rgb: "255,184,48",  delay: "0s"    },
  { id: "studio" as Panel, label: "Studio",  sub: "Seller platform",    color: TEAL,  rgb: "0,255,238",   delay: "0.07s" },
  { id: "signin" as Panel, label: "Sign In", sub: "Studio access",      color: MGNT,  rgb: "255,0,204",   delay: "0.14s" },
];

function Hero({ onSelect, tagline }: { onSelect: (p: NonNullable<Panel>) => void; tagline?: string | null }) {
  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 1,
      display: "flex", flexDirection: "column",
      padding: "max(env(safe-area-inset-top,0px) + 14px, 18px) clamp(16px,4vw,28px) max(env(safe-area-inset-bottom,0px) + 12px, 14px)",
    }}>

      {/* Center content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: "clamp(8px,2vw,16px)" }}>

        {/* Brand composition — logo stacked above Elfie, both prominent */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
          {/* PlanetBrick logo — large, full-opacity, centered */}
          <img
            src={logoUrl}
            alt="PlanetBrick"
            style={{
              width: "clamp(180px,48vw,340px)",
              height: "auto",
              objectFit: "contain",
              opacity: 0.95,
              filter: `drop-shadow(0 0 24px ${TEAL}33)`,
              userSelect: "none",
              pointerEvents: "none",
            }}
          />
          {/* E.L.F.I.E. — directly below, slightly overlapping to feel connected */}
          <img
            src={elfieUrl}
            alt="E.L.F.I.E."
            style={{
              width: "clamp(80px,20vw,130px)",
              height: "auto",
              marginTop: "clamp(-14px,-3vw,-20px)",
              animation: "pb-float 4s ease-in-out infinite",
              filter: `drop-shadow(0 0 28px ${TEAL}66)`,
              position: "relative",
              zIndex: 1,
            }}
          />
        </div>

        <div>
          <div style={{ fontSize: "clamp(7px,1.8vw,10px)", fontFamily: "monospace", color: TEAL, letterSpacing: "0.4em", marginBottom: "clamp(6px,1.5vw,10px)", textTransform: "uppercase" }}>
            ▸ Broadcasting from Orbit
          </div>
          <h1 style={{ fontSize: "clamp(22px,5.5vw,48px)", fontWeight: 900, lineHeight: 1.05, color: "#FFF", margin: 0, letterSpacing: "-0.01em" }}>
            The LEGO universe,<br />
            <span style={{ color: TEAL, textShadow: `0 0 32px ${TEAL}55` }}>engineered.</span>
          </h1>
          {(tagline || "Authentic bricks. AI-powered tools.\nOne brand, two worlds.").split("\n").map((line, i) => (
            <p key={i} style={{ fontSize: "clamp(11px,2.6vw,15px)", color: "rgba(200,220,255,0.6)", margin: i === 0 ? "clamp(6px,1.5vw,10px) auto 0" : "0 auto", maxWidth: "400px", lineHeight: 1.55 }}>
              {line}
            </p>
          ))}
        </div>
      </div>

      {/* Hero cards */}
      <div style={{ flexShrink: 0, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "clamp(8px,2vw,14px)" }}>
        {HERO_CARDS.map(c => (
          <button
            key={c.id!}
            onClick={() => onSelect(c.id!)}
            className="pb-hero-card"
            data-testid={`button-nav-${c.id}`}
            style={{
              background: `rgba(${c.rgb},0.07)`,
              border: `1px solid rgba(${c.rgb},0.3)`,
              borderRadius: "clamp(12px,3vw,18px)",
              padding: "clamp(12px,3vw,20px) clamp(6px,1.5vw,10px)",
              cursor: "pointer",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: "clamp(5px,1.3vw,9px)", textAlign: "center",
              animation: `pb-herocard 0.5s ease-out ${c.delay} both`,
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <div style={{ width: "clamp(36px,9vw,50px)", height: "clamp(36px,9vw,50px)", borderRadius: "50%", background: `rgba(${c.rgb},0.12)`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 16px rgba(${c.rgb},0.3)` }}>
              <div style={{ width: "clamp(16px,4vw,22px)", height: "clamp(16px,4vw,22px)", borderRadius: "50%", background: c.color, boxShadow: `0 0 8px ${c.color}` }} />
            </div>
            <div>
              <div style={{ fontSize: "clamp(11px,2.8vw,15px)", fontWeight: 800, color: "#FFF", lineHeight: 1.2 }}>{c.label}</div>
              <div style={{ fontSize: "clamp(8px,1.8vw,10px)", color: `rgba(${c.rgb},0.7)`, fontFamily: "monospace", marginTop: "2px", lineHeight: 1.3 }}>{c.sub}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const [panel, setPanel] = useState<Panel>(null);
  const { canPromptInstall, showInstallOption, isInstalled, isInstalling, isIos, install } = usePwaInstall();

  const { data: publicInfo } = useQuery<{ tagline: string | null }>({
    queryKey: ['/api/public/platform-info'],
    staleTime: 5 * 60 * 1000,
    retry: 0,
  });

  return (
    <div style={{ height: "100dvh", width: "100%", overflow: "hidden", background: "#05030F", backgroundImage: `radial-gradient(ellipse 900px 600px at 50% 50%, rgba(10,5,50,0.8) 0%, transparent 70%), radial-gradient(ellipse 500px 700px at 15% 60%, rgba(80,0,160,0.15) 0%, transparent 55%), radial-gradient(ellipse 400px 600px at 85% 40%, rgba(0,180,200,0.1) 0%, transparent 55%)`, position: "relative", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif" }}>
      <style>{GLOBAL_CSS}</style>

      {/* Stars */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none" }}>
        {STARS.map((s, i) => (
          <div key={i} style={{ position: "absolute", left: s.x, top: s.y, width: `${s.size}px`, height: `${s.size}px`, borderRadius: "50%", background: "#fff", ["--so" as any]: s.opacity, opacity: s.opacity, animation: `pb-twinkle ${2 + (i % 5) * 0.6}s ease-in-out ${(i % 7) * 0.3}s infinite` }} />
        ))}
      </div>

      {/* Background orbital rings */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        <div style={{ position: "absolute", left: "50%", top: "50%", width: "160vw", height: "90vh", border: `1px solid ${TEAL}07`, borderRadius: "50%", animation: "pb-bgring 80s linear infinite" }} />
        <div style={{ position: "absolute", left: "50%", top: "50%", width: "130vw", height: "70vh", border: `1px solid ${PURP}06`, borderRadius: "50%", transform: "translate(-50%,-50%) rotate(30deg)", animation: "pb-bgring-r 55s linear infinite" }} />
        <div style={{ position: "absolute", left: "50%", top: "50%", width: "110vw", height: "50vh", border: `1px solid ${MGNT}05`, borderRadius: "50%", transform: "translate(-50%,-50%) rotate(-20deg)", animation: "pb-bgring 40s linear infinite" }} />
      </div>

      {/* Background planet */}
      <div style={{ position: "fixed", right: "-12vw", bottom: "-10vh", width: "45vw", height: "45vw", borderRadius: "50%", background: "radial-gradient(circle at 30% 30%, rgba(80,20,180,0.35), rgba(20,5,80,0.6) 60%, rgba(5,3,15,0.9))", border: "1px solid rgba(120,60,200,0.12)", pointerEvents: "none" }} />
      <div style={{ position: "fixed", left: "4vw", top: "10vh", width: "clamp(32px,5.5vw,64px)", height: "clamp(32px,5.5vw,64px)", borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, rgba(0,220,200,0.4), rgba(0,100,120,0.6) 60%, rgba(0,40,60,0.9))", border: "1px solid rgba(0,200,180,0.15)", pointerEvents: "none" }} />

      {/* TV Drop Panel */}
      <TvPanel
        panel={panel} onClose={() => setPanel(null)}
        canPromptInstall={canPromptInstall} showInstallOption={showInstallOption}
        isInstalled={isInstalled} isInstalling={isInstalling} isIos={isIos} onInstall={install}
      />

      {/* Hero */}
      <Hero onSelect={setPanel} tagline={publicInfo?.tagline} />
    </div>
  );
}
