import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import { Zap, ScanLine, Globe } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import logoUrl from "@assets/PlanetBrick_dotcom_with_planet_and_robot_400_1760672362080.png";

type ChId = "home" | "ops" | "tools" | "pricing" | "live";

const CHANNELS: { id: ChId; num: string; label: string; slides: number }[] = [
  { id: "home",    num: "01", label: "INTRO",   slides: 1 },
  { id: "ops",     num: "02", label: "OPS",     slides: 4 },
  { id: "tools",   num: "03", label: "TOOLS",   slides: 3 },
  { id: "pricing", num: "04", label: "PRICING", slides: 1 },
  { id: "live",    num: "05", label: "ON AIR",  slides: 1 },
];

const TIERS = [
  {
    name: "Trial", price: "Free", period: "", highlight: false,
    description: "Kick the tires. No card required.",
    features: ["Full inventory access", "BrickSpotter (25 scans/mo)", "Basic pricing tools", "Single marketplace"],
  },
  {
    name: "Foundation", price: "$29", period: "/mo", highlight: false,
    description: "For solo sellers ready to get serious.",
    features: ["Up to 5,000 lots", "BrickSpotter (250 scans/mo)", "Price-o-Matic automation", "BrickLink sync", "Warehouse manager"],
  },
  {
    name: "Core", price: "$79", period: "/mo", highlight: true,
    description: "For growing stores managing real volume.",
    features: ["Up to 25,000 lots", "BrickSpotter (unlimited)", "Full POM automation", "2 marketplace channels", "Team access (3 seats)", "Priority support"],
  },
];

const TOOLS_SLIDES = [
  {
    Icon: Zap, color: "#FFD600", rgb: "255,214,0",
    title: "Price-o-Matic",
    tagline: "AI-powered repricing",
    desc: "Monitors the market 24/7 and reprices your catalog automatically. Underpriced? Fixed. Overpriced? Corrected.",
    bullets: ["Market price tracking", "Auto-adjust rules", "Floor/ceiling guards"],
  },
  {
    Icon: ScanLine, color: "#00FFEE", rgb: "0,255,238",
    title: "BrickSpotter",
    tagline: "AI part identification",
    desc: "Point your camera at any LEGO piece. AI identifies it instantly across 130k+ parts — color, condition, value.",
    bullets: ["130k+ parts catalog", "Color recognition", "Instant valuation"],
  },
  {
    Icon: Globe, color: "#CC88FF", rgb: "204,136,255",
    title: "Multichannel Sync",
    tagline: "Unified inventory control",
    desc: "BrickLink, BrickOwl and beyond — inventory and orders unified in one command center. No double-selling.",
    bullets: ["Real-time sync", "Multi-platform orders", "No overselling"],
  },
];

const OPS_SLIDES = [
  {
    label: "Product", color: "#00FFEE", rgb: "0,255,238",
    metrics: [
      { label: "Lots",       value: "47,312" },
      { label: "Parts",      value: "1.2M"   },
      { label: "Categories", value: "128"    },
      { label: "Sync",       value: "Live"   },
    ],
    tools: ["BrickSpotter", "Inventory Sync", "Warehouse"],
  },
  {
    label: "Orders", color: "#A855F7", rgb: "168,85,247",
    metrics: [
      { label: "To Fulfill", value: "12"     },
      { label: "Shipped",    value: "3 today" },
      { label: "On Hold",    value: "1"      },
      { label: "Revenue",    value: "$4,891" },
    ],
    tools: ["Fulfillment", "Picklist", "Order Sync"],
  },
  {
    label: "Marketing", color: "#FF00CC", rgb: "255,0,204",
    metrics: [
      { label: "Channels",      value: "2 live"  },
      { label: "Discrepancies", value: "0"       },
      { label: "Last Sync",     value: "2h ago"  },
      { label: "Listings",      value: "12,847"  },
    ],
    tools: ["Channel Sync", "Price-o-Matic", "Platforms"],
  },
  {
    label: "Insights", color: "#FFD600", rgb: "255,214,0",
    metrics: [
      { label: "This Week", value: "$1,247" },
      { label: "Growth",    value: "+18%"  },
      { label: "Avg Order", value: "$22"   },
      { label: "Orders",    value: "847"   },
    ],
    tools: ["Analytics", "POM Pricing", "Reports"],
  },
];

function starField(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const x = ((i * 137.508) % 100).toFixed(1);
    const y = ((i * 97.316) % 100).toFixed(1);
    const size = i % 9 === 0 ? 2.5 : i % 4 === 0 ? 1.5 : 1;
    const opacity = 0.25 + (i % 6) * 0.12;
    return { x: `${x}%`, y: `${y}%`, size, opacity };
  });
}
const STARS = starField(70);

const TEAL   = "#00FFEE";
const MGNT   = "#FF00CC";
const PURP   = "#A855F7";
const SCR_BG = "#04060F";

const GLOBAL_CSS = `
  @keyframes pb-float    { 0%,100%{transform:translateY(0px)} 50%{transform:translateY(-10px)} }
  @keyframes pb-twinkle  { 0%,100%{opacity:var(--so)} 50%{opacity:calc(var(--so)*0.35)} }
  @keyframes pb-orbit    { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
  @keyframes pb-orbit-r  { from{transform:rotate(0deg)} to{transform:rotate(-360deg)} }
  @keyframes pb-scan     { 0%{top:-2px;opacity:0} 4%{opacity:1} 96%{opacity:0.7} 100%{top:100%;opacity:0} }
  @keyframes pb-saucer   { 0%,100%{opacity:0.3;filter:blur(5px)} 50%{opacity:0.65;filter:blur(8px)} }
  @keyframes pb-chglow   { 0%,100%{box-shadow:0 0 12px #00FFEE44,inset 0 0 8px #00FFEE11} 50%{box-shadow:0 0 24px #00FFEE77,inset 0 0 14px #00FFEE22} }
  @keyframes pb-ledpulse { 0%,100%{text-shadow:0 0 10px #00FFEE} 50%{text-shadow:0 0 20px #00FFEE,0 0 40px #00FFEE66} }
  @keyframes pb-pulse    { 0%,100%{opacity:1;box-shadow:0 0 16px #FF00CC,0 0 32px #FF00CC44} 50%{opacity:0.5;box-shadow:0 0 4px #FF00CC} }
  @keyframes pb-bgring   { from{transform:translate(-50%,-50%) rotate(0deg)} to{transform:translate(-50%,-50%) rotate(360deg)} }
  @keyframes pb-bgring-r { from{transform:translate(-50%,-50%) rotate(0deg)} to{transform:translate(-50%,-50%) rotate(-360deg)} }
  @keyframes pb-slidein    { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
  @keyframes pb-radiowave  { 0%{opacity:0} 8%{opacity:0.85} 100%{opacity:0} }
  @keyframes pb-swipehint  { 0%,100%{opacity:0;transform:translateX(0)} 20%{opacity:0.7} 50%{opacity:0.9;transform:translateX(6px)} 80%{opacity:0.7} }
`;

function HomeScreen({ tune }: { tune: (id: ChId) => void }) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: "clamp(18px,2.5vw,36px) clamp(22px,3vw,44px)", color: "#E8F4FF", animation: "pb-slidein 0.3s ease-out" }}>
      <img src={logoUrl} alt="PlanetBrick" style={{ height: "clamp(22px,2.8vw,34px)", width: "auto", objectFit: "contain", objectPosition: "left", marginBottom: "clamp(10px,1.8vw,18px)", opacity: 0.95 }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ fontSize: "clamp(8px,0.75vw,11px)", fontFamily: "monospace", color: TEAL, letterSpacing: "0.35em", marginBottom: "10px", textTransform: "uppercase" }}>
          ▸ Broadcasting from Orbit
        </div>
        <h1 style={{ fontSize: "clamp(22px,2.8vw,42px)", fontWeight: 900, lineHeight: 1.08, color: "#FFFFFF", margin: "0 0 clamp(10px,1.5vw,16px) 0" }}>
          Your LEGO business,<br />
          <span style={{ color: TEAL, textShadow: `0 0 20px ${TEAL}55` }}>on the air.</span>
        </h1>
        <p style={{ fontSize: "clamp(12px,1.1vw,15px)", color: "rgba(210,230,255,0.88)", maxWidth: "460px", lineHeight: 1.7, marginBottom: "clamp(14px,2vw,24px)" }}>
          AI-powered repricing, instant part identification, and multichannel sync —
          PlanetBrick runs your back office while you build.
        </p>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button onClick={() => tune("ops")} style={{
            background: `linear-gradient(135deg, ${TEAL}CC, #00BBDD)`,
            border: "none", borderRadius: "100px",
            padding: "clamp(8px,1vw,12px) clamp(18px,2vw,28px)",
            cursor: "pointer", color: "#04060F", fontWeight: 800,
            fontSize: "clamp(11px,1.1vw,14px)", letterSpacing: "0.05em",
            boxShadow: `0 0 24px ${TEAL}55`,
          }}>
            See Dashboards →
          </button>
        </div>
      </div>
      <div style={{ display: "flex", gap: "clamp(16px,3vw,36px)", borderTop: `1px solid ${TEAL}28`, paddingTop: "clamp(10px,1.5vw,14px)", flexWrap: "wrap" }}>
        {[["130k+", "Parts"], ["10×", "Faster"], ["24/7", "Pricing"], ["100%", "Synced"]].map(([v, l]) => (
          <div key={l}>
            <div style={{ fontSize: "clamp(14px,1.6vw,22px)", fontWeight: 900, color: TEAL, fontFamily: "monospace", textShadow: `0 0 12px ${TEAL}66` }}>{v}</div>
            <div style={{ fontSize: "clamp(7px,0.65vw,9px)", color: "rgba(190,215,255,0.65)", letterSpacing: "0.22em", textTransform: "uppercase" }}>{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ToolsScreen({ slideIndex }: { slideIndex: number }) {
  const t = TOOLS_SLIDES[slideIndex] ?? TOOLS_SLIDES[0];
  return (
    <div key={slideIndex} style={{ height: "100%", display: "flex", flexDirection: "column", padding: "clamp(14px,2vw,26px) clamp(18px,2.5vw,32px)", color: "#E8F4FF", gap: "clamp(10px,1.4vw,16px)", animation: "pb-slidein 0.25s ease-out" }}>
      <div>
        <div style={{ fontSize: "clamp(8px,0.7vw,10px)", fontFamily: "monospace", color: TEAL, letterSpacing: "0.3em", marginBottom: "5px" }}>CH 03 — TOOLS · {slideIndex + 1}/{TOOLS_SLIDES.length}</div>
        <h2 style={{ fontSize: "clamp(16px,1.8vw,22px)", fontWeight: 900, color: "#FFF", margin: 0 }}>Your toolkit, always on.</h2>
      </div>
      <div style={{
        flex: 1,
        background: `rgba(${t.rgb},0.06)`,
        border: `1px solid rgba(${t.rgb},0.3)`,
        borderRadius: "14px",
        padding: "clamp(14px,1.8vw,22px) clamp(12px,1.5vw,18px)",
        display: "flex", flexDirection: "column", gap: "clamp(8px,1vw,12px)",
        boxShadow: `0 0 28px rgba(${t.rgb},0.08) inset`,
        position: "relative", overflow: "hidden",
      }}>
        <div style={{ position: "absolute", inset: 0, background: `radial-gradient(ellipse 60% 50% at 15% 20%, rgba(${t.rgb},0.09), transparent)`, pointerEvents: "none" }} />
        <div style={{ display: "flex", alignItems: "center", gap: "clamp(10px,1.2vw,14px)" }}>
          <div style={{
            width: "clamp(32px,3.5vw,46px)", height: "clamp(32px,3.5vw,46px)", borderRadius: "50%",
            background: `rgba(${t.rgb},0.15)`, border: `1px solid rgba(${t.rgb},0.4)`,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            boxShadow: `0 0 20px rgba(${t.rgb},0.3)`,
          }}>
            <t.Icon size={18} color={t.color} />
          </div>
          <div>
            <div style={{ fontSize: "clamp(9px,0.8vw,11px)", fontFamily: "monospace", color: t.color, letterSpacing: "0.2em", opacity: 0.8 }}>{t.tagline.toUpperCase()}</div>
            <div style={{ fontSize: "clamp(18px,2vw,26px)", fontWeight: 900, color: "#FFF", lineHeight: 1.1 }}>{t.title}</div>
          </div>
        </div>
        <p style={{ fontSize: "clamp(11px,1vw,14px)", color: "rgba(210,230,255,0.85)", lineHeight: 1.65, margin: 0 }}>{t.desc}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "clamp(5px,0.7vw,8px)", marginTop: "auto" }}>
          {t.bullets.map(b => (
            <div key={b} style={{
              padding: "3px 10px", borderRadius: "100px",
              background: `rgba(${t.rgb},0.12)`, border: `1px solid rgba(${t.rgb},0.3)`,
              fontSize: "clamp(9px,0.82vw,11px)", color: t.color, fontWeight: 600,
            }}>{b}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function OpsScreen({ slideIndex }: { slideIndex: number }) {
  const s = OPS_SLIDES[slideIndex] ?? OPS_SLIDES[0];
  return (
    <div key={slideIndex} style={{ height: "100%", display: "flex", flexDirection: "column", padding: "clamp(12px,1.8vw,22px) clamp(14px,2vw,26px)", color: "#E8F4FF", gap: "clamp(8px,1.2vw,12px)", animation: "pb-slidein 0.25s ease-out" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: "clamp(8px,0.7vw,10px)", fontFamily: "monospace", color: TEAL, letterSpacing: "0.3em", marginBottom: "3px" }}>CH 02 — OPS · {slideIndex + 1}/{OPS_SLIDES.length}</div>
          <h2 style={{ fontSize: "clamp(14px,1.6vw,20px)", fontWeight: 900, margin: 0 }}>
            <span style={{ color: s.color, textShadow: `0 0 14px rgba(${s.rgb},0.5)` }}>{s.label}</span>
            <span style={{ color: "#fff" }}> Dashboard</span>
          </h2>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "5px", background: `rgba(${s.rgb},0.08)`, border: `1px solid rgba(${s.rgb},0.3)`, borderRadius: "100px", padding: "3px 8px 3px 5px" }}>
          <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: s.color, boxShadow: `0 0 5px ${s.color}`, animation: "pb-pulse 1.5s ease-in-out infinite" }} />
          <span style={{ fontSize: "clamp(7px,0.6vw,9px)", fontFamily: "monospace", color: s.color, fontWeight: 700, letterSpacing: "0.12em" }}>LIVE</span>
        </div>
      </div>

      {/* Metrics section */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontSize: "clamp(7px,0.62vw,9px)", fontFamily: "monospace", color: `rgba(${s.rgb},0.7)`, letterSpacing: "0.25em", marginBottom: "clamp(4px,0.6vw,6px)" }}>METRICS</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "clamp(4px,0.6vw,7px)" }}>
          {s.metrics.map(m => (
            <div key={m.label} style={{
              background: `rgba(${s.rgb},0.05)`,
              border: `1px solid rgba(${s.rgb},0.2)`,
              borderRadius: "10px",
              padding: "clamp(6px,0.8vw,10px) clamp(6px,0.7vw,8px)",
              textAlign: "center",
            }}>
              <div style={{ fontSize: "clamp(13px,1.4vw,18px)", fontWeight: 900, color: s.color, fontFamily: "monospace", textShadow: `0 0 10px rgba(${s.rgb},0.5)` }}>{m.value}</div>
              <div style={{ fontSize: "clamp(7px,0.62vw,9px)", color: "rgba(200,220,255,0.55)", letterSpacing: "0.12em", marginTop: "2px" }}>{m.label.toUpperCase()}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tools section */}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "clamp(7px,0.62vw,9px)", fontFamily: "monospace", color: `rgba(${s.rgb},0.7)`, letterSpacing: "0.25em", marginBottom: "clamp(4px,0.6vw,6px)" }}>TOOLS</div>
        <div style={{ display: "flex", gap: "clamp(6px,0.8vw,10px)", flexWrap: "wrap" }}>
          {s.tools.map((tool, i) => (
            <div key={tool} style={{
              flex: 1, minWidth: "28%",
              background: i === 0 ? `rgba(${s.rgb},0.13)` : "rgba(255,255,255,0.04)",
              border: `1px solid ${i === 0 ? `rgba(${s.rgb},0.45)` : "rgba(200,220,255,0.14)"}`,
              borderRadius: "10px",
              padding: "clamp(8px,1vw,12px) clamp(8px,0.9vw,10px)",
              display: "flex", alignItems: "center", gap: "6px",
            }}>
              <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: i === 0 ? s.color : "rgba(200,220,255,0.3)", flexShrink: 0 }} />
              <span style={{ fontSize: "clamp(9px,0.88vw,12px)", color: i === 0 ? s.color : "rgba(210,230,255,0.75)", fontWeight: i === 0 ? 700 : 500 }}>{tool}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PricingScreen({ tune }: { tune: (id: ChId) => void }) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: "clamp(12px,1.8vw,22px) clamp(14px,2vw,26px)", color: "#E8F4FF", gap: "clamp(8px,1.2vw,13px)", overflow: "hidden", animation: "pb-slidein 0.3s ease-out" }}>
      <div>
        <div style={{ fontSize: "clamp(8px,0.7vw,10px)", fontFamily: "monospace", color: TEAL, letterSpacing: "0.3em", marginBottom: "5px" }}>CH 04 — PRICING</div>
        <h2 style={{ fontSize: "clamp(16px,1.8vw,22px)", fontWeight: 900, color: "#FFF", margin: 0 }}>Simple, honest pricing</h2>
      </div>
      <div style={{ display: "flex", gap: "clamp(8px,1.2vw,12px)", flex: 1, overflow: "hidden" }}>
        {TIERS.map(t => (
          <div key={t.name} style={{
            flex: 1,
            background: t.highlight ? `rgba(0,255,238,0.07)` : "rgba(255,255,255,0.04)",
            border: `1px solid ${t.highlight ? "rgba(0,255,238,0.4)" : "rgba(200,220,255,0.15)"}`,
            borderRadius: "14px",
            padding: "clamp(10px,1.4vw,16px) clamp(10px,1.2vw,14px)",
            display: "flex", flexDirection: "column", gap: "clamp(5px,0.7vw,8px)",
            position: "relative",
            boxShadow: t.highlight ? `0 0 30px rgba(0,255,238,0.08) inset` : "none",
          }}>
            {t.highlight && (
              <div style={{
                position: "absolute", top: "-1px", left: "50%", transform: "translateX(-50%)",
                background: TEAL, color: SCR_BG, fontSize: "clamp(7px,0.6vw,9px)",
                fontWeight: 800, padding: "2px 12px", borderRadius: "0 0 8px 8px",
                letterSpacing: "0.2em", textTransform: "uppercase",
                boxShadow: `0 4px 12px ${TEAL}55`,
              }}>POPULAR</div>
            )}
            <div style={{ fontSize: "clamp(12px,1.1vw,15px)", fontWeight: 700, color: "#FFF" }}>{t.name}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "2px" }}>
              <span style={{ fontSize: "clamp(20px,2.2vw,30px)", fontWeight: 900, color: t.highlight ? TEAL : "#FFF", fontFamily: "monospace", textShadow: t.highlight ? `0 0 16px ${TEAL}66` : "none" }}>{t.price}</span>
              <span style={{ fontSize: "clamp(10px,0.9vw,12px)", color: "rgba(200,220,255,0.55)" }}>{t.period}</span>
            </div>
            <div style={{ fontSize: "clamp(9px,0.82vw,11px)", color: "rgba(200,220,255,0.72)" }}>{t.description}</div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "clamp(3px,0.5vw,5px)", marginTop: "2px" }}>
              {t.features.map(f => (
                <div key={f} style={{ display: "flex", alignItems: "flex-start", gap: "5px", fontSize: "clamp(9px,0.88vw,11px)", color: "rgba(210,230,255,0.88)" }}>
                  <span style={{ color: TEAL, flexShrink: 0, fontSize: "9px", marginTop: "2px", textShadow: `0 0 8px ${TEAL}` }}>✦</span>
                  {f}
                </div>
              ))}
            </div>
            <Link href="/signup">
              <button style={{
                width: "100%", marginTop: "6px",
                background: t.highlight ? TEAL : "transparent",
                border: `1px solid ${t.highlight ? TEAL : "rgba(200,220,255,0.3)"}`,
                borderRadius: "100px", padding: "clamp(6px,0.8vw,10px)",
                color: t.highlight ? SCR_BG : "rgba(210,230,255,0.9)",
                fontSize: "clamp(10px,0.95vw,12px)", fontWeight: 700, cursor: "pointer",
                boxShadow: t.highlight ? `0 0 16px ${TEAL}55` : "none",
              }}>
                {t.name === "Trial" ? "Start Free" : "Get Started"}
              </button>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

function RetroShip({ size = 80, glow = TEAL }: { size?: number; glow?: string }) {
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
        <radialGradient id="cockpit" cx="60" cy="38" r="14" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={glow} stopOpacity="0.9" />
          <stop offset="70%" stopColor={glow} stopOpacity="0.3" />
          <stop offset="100%" stopColor="#001122" stopOpacity="0.8" />
        </radialGradient>
      </defs>
      <g>
        <ellipse cx="60" cy="98" rx="18" ry="4" fill={`${MGNT}33`} style={{ animation: "pb-saucer 2s ease-in-out infinite" }} />
        <rect x="55" y="88" width="10" height="12" rx="2" fill="#2A3055" stroke={`${glow}44`} strokeWidth="0.5" />
        <rect x="50" y="92" width="20" height="6" rx="1" fill="#2A3055" stroke={`${MGNT}44`} strokeWidth="0.5" />
        <circle cx="56" cy="95" r="1.5" fill={MGNT} style={{ animation: "pb-pulse 1.5s ease-in-out infinite" }} />
        <circle cx="64" cy="95" r="1.5" fill={glow} style={{ animation: "pb-pulse 1.5s ease-in-out 0.5s infinite" }} />
        <path d="M40 75 L60 20 L80 75 Z" fill="url(#hull)" stroke={`${glow}55`} strokeWidth="1" strokeLinejoin="round" />
        <path d="M45 68 L60 28 L75 68" fill="none" stroke={`${glow}22`} strokeWidth="0.5" />
        <rect x="52" y="55" width="16" height="3" rx="1" fill="#2A3055" stroke={`${glow}33`} strokeWidth="0.5" />
        <rect x="54" y="60" width="12" height="2" rx="0.5" fill="#2A3055" stroke={`${glow}22`} strokeWidth="0.5" />
        <rect x="56" y="64" width="8" height="2" rx="0.5" fill="#2A3055" stroke={`${glow}22`} strokeWidth="0.5" />
        <ellipse cx="60" cy="38" rx="8" ry="10" fill="url(#cockpit)" stroke={glow} strokeWidth="1" style={{ animation: "pb-chglow 3s ease-in-out infinite" }} />
        <ellipse cx="60" cy="36" rx="4" ry="5" fill={`${glow}22`} />
        <path d="M40 75 L15 85 L18 70 L40 65 Z" fill="url(#wing)" stroke={`${MGNT}66`} strokeWidth="0.8" />
        <path d="M80 75 L105 85 L102 70 L80 65 Z" fill="url(#wing)" stroke={`${MGNT}66`} strokeWidth="0.8" />
        <circle cx="22" cy="80" r="2" fill={MGNT} style={{ animation: "pb-pulse 1s ease-in-out infinite" }} />
        <circle cx="98" cy="80" r="2" fill={MGNT} style={{ animation: "pb-pulse 1s ease-in-out 0.3s infinite" }} />
        <path d="M55 75 L52 90 L58 90 Z" fill={`${glow}55`} />
        <path d="M65 75 L62 90 L68 90 Z" fill={`${glow}55`} />
        <line x1="55" y1="85" x2="55" y2="105" stroke={`${MGNT}44`} strokeWidth="2" strokeLinecap="round" style={{ animation: "pb-pulse 0.8s ease-in-out infinite" }} />
        <line x1="60" y1="88" x2="60" y2="110" stroke={`${glow}33`} strokeWidth="3" strokeLinecap="round" style={{ animation: "pb-pulse 0.8s ease-in-out 0.2s infinite" }} />
        <line x1="65" y1="85" x2="65" y2="105" stroke={`${MGNT}44`} strokeWidth="2" strokeLinecap="round" style={{ animation: "pb-pulse 0.8s ease-in-out 0.4s infinite" }} />
        <circle cx="60" cy="22" r="2" fill={glow} style={{ animation: "pb-pulse 2s ease-in-out infinite" }} />
      </g>
    </svg>
  );
}

function LiveScreen({ onSignIn, canInstall, isInstalled, isInstalling, onInstall }: {
  onSignIn: () => void;
  canInstall: boolean;
  isInstalled: boolean;
  isInstalling: boolean;
  onInstall: () => void;
}) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "clamp(16px,3vw,36px)", color: "#E8F4FF", textAlign: "center", gap: "clamp(8px,1.2vw,14px)", animation: "pb-slidein 0.3s ease-out" }}>
      <div style={{ position: "relative", marginBottom: "2px" }}>
        <div style={{ animation: "pb-float 4s ease-in-out infinite" }}>
          <RetroShip size={70} />
        </div>
      </div>

      {isInstalled ? (
        <>
          <div style={{ fontSize: "clamp(8px,0.75vw,10px)", fontFamily: "monospace", color: "#66FFB2", letterSpacing: "0.3em", textShadow: "0 0 12px #66FFB266" }}>DOCKED</div>
          <h2 style={{ fontSize: "clamp(16px,2vw,28px)", fontWeight: 900, color: "#FFFFFF", lineHeight: 1.2, margin: 0 }}>
            App installed
          </h2>
          <p style={{ fontSize: "clamp(10px,0.9vw,13px)", color: "rgba(210,230,255,0.75)", maxWidth: "360px", lineHeight: 1.6, margin: 0 }}>
            PlanetBrick is on your home screen. Launch it anytime for the full experience.
          </p>
        </>
      ) : (
        <>
          <div style={{ fontSize: "clamp(8px,0.75vw,10px)", fontFamily: "monospace", color: MGNT, letterSpacing: "0.3em", textShadow: `0 0 12px ${MGNT}` }}>LAUNCH PAD</div>
          <h2 style={{ fontSize: "clamp(16px,2vw,28px)", fontWeight: 900, color: "#FFFFFF", lineHeight: 1.2, margin: 0 }}>
            {canInstall ? "Add to Home Screen" : "Ready to broadcast\nyour LEGO store?"}
          </h2>
          <p style={{ fontSize: "clamp(10px,0.9vw,13px)", color: "rgba(210,230,255,0.75)", maxWidth: "360px", lineHeight: 1.6, margin: 0 }}>
            {canInstall
              ? "Install PlanetBrick for instant access — works offline, launches like a native app."
              : "Join PlanetBrick and get access to every tool — free during your trial. No credit card. No commitment."}
          </p>
        </>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%", maxWidth: "260px" }}>
        {canInstall && !isInstalled && (
          <button
            onClick={onInstall}
            disabled={isInstalling}
            data-testid="button-install-pwa"
            style={{
              width: "100%",
              background: `linear-gradient(135deg, ${MGNT}DD, ${PURP})`,
              border: `1px solid ${MGNT}66`,
              borderRadius: "100px",
              padding: "clamp(9px,1vw,12px) 20px", cursor: isInstalling ? "wait" : "pointer",
              color: "#FFFFFF", fontWeight: 800, fontSize: "clamp(11px,1.1vw,14px)",
              boxShadow: `0 0 24px ${MGNT}44, 0 0 8px ${PURP}33`,
              letterSpacing: "0.05em",
              opacity: isInstalling ? 0.7 : 1,
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
            {isInstalling ? "Installing..." : "Install App"}
          </button>
        )}

        {!isInstalled && (
          <>
            <Link href="/signup">
              <button data-testid="button-start-trial" style={{
                width: "100%",
                background: `linear-gradient(135deg, ${TEAL}DD, #00BBDD)`,
                border: "none", borderRadius: "100px",
                padding: "clamp(9px,1vw,12px) 20px", cursor: "pointer",
                color: SCR_BG, fontWeight: 800, fontSize: "clamp(11px,1.1vw,14px)",
                boxShadow: `0 0 24px ${TEAL}44`, letterSpacing: "0.03em",
              }}>Start Free Trial</button>
            </Link>
            <button onClick={onSignIn} data-testid="button-sign-in" style={{
              width: "100%", background: "transparent",
              border: `1px solid ${TEAL}44`, borderRadius: "100px",
              padding: "clamp(7px,0.8vw,10px)", cursor: "pointer",
              color: "rgba(210,230,255,0.85)", fontSize: "clamp(10px,0.9vw,12px)",
            }}>Sign In to Existing Account</button>
          </>
        )}
      </div>

      {!isInstalled && (
        <div style={{ fontSize: "clamp(8px,0.7vw,10px)", color: "rgba(200,220,255,0.4)" }}>
          Full inventory access · No credit card required
        </div>
      )}
    </div>
  );
}

function TVLoginScreen({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"email" | "password">("email");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCheckEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/check-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) throw new Error("check failed");
      const data = await res.json();
      if (data.exists === true) {
        setStep("password");
      } else {
        window.location.href = `/signup?email=${encodeURIComponent(email.trim())}`;
      }
    } catch {
      setError("Could not verify email. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      await apiRequest("POST", "/api/login", { email: email.trim(), password });
      window.location.href = "/";
    } catch {
      setError("Invalid password");
      setIsLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    background: `rgba(0,255,238,0.05)`,
    border: `1px solid ${TEAL}44`,
    borderRadius: "6px",
    padding: "clamp(7px,0.9vw,11px) clamp(10px,1.2vw,14px)",
    color: "#E8F4FF",
    fontSize: "clamp(11px,1vw,14px)",
    outline: "none",
    fontFamily: "monospace",
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: "clamp(12px,1.8vw,22px) clamp(16px,2.2vw,28px)", color: "#E8F4FF", gap: "clamp(8px,1.1vw,14px)", animation: "pb-slidein 0.3s ease-out" }}>

      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: "clamp(7px,0.65vw,9px)", fontFamily: "monospace", color: TEAL, letterSpacing: "0.3em" }}>CH 00 — {step === "email" ? "IDENTIFY" : "SIGN IN"}</div>
        <button onClick={step === "password" ? () => { setStep("email"); setPassword(""); setError(null); } : onBack} style={{ background: "transparent", border: `1px solid ${TEAL}33`, borderRadius: "4px", padding: "2px 8px", cursor: "pointer", color: `${TEAL}99`, fontSize: "clamp(7px,0.65vw,9px)", fontFamily: "monospace", letterSpacing: "0.15em" }}>{step === "password" ? "← BACK" : "✕ CANCEL"}</button>
      </div>

      {/* Title */}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "clamp(18px,2.2vw,30px)", fontWeight: 900, color: "#FFFFFF", letterSpacing: "0.08em", lineHeight: 1.1 }}>OPERATOR<br />ACCESS</div>
        <div style={{ fontSize: "clamp(7px,0.65vw,9px)", color: `${TEAL}88`, fontFamily: "monospace", letterSpacing: "0.3em", marginTop: "5px" }}>{step === "email" ? "ENTER YOUR EMAIL" : "ENTER PASSWORD"}</div>
      </div>

      {step === "email" ? (
        <form onSubmit={handleCheckEmail} style={{ display: "flex", flexDirection: "column", gap: "clamp(8px,1vw,12px)", flex: 1, justifyContent: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ fontSize: "clamp(7px,0.62vw,9px)", fontFamily: "monospace", color: `${TEAL}88`, letterSpacing: "0.25em", textTransform: "uppercase" }}>Email</div>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus
              placeholder="operator@domain.com" style={{ ...inputStyle, borderColor: error ? "rgba(255,100,100,0.5)" : `${TEAL}44` }}
            />
          </div>

          {error && (
            <div style={{ background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.3)", borderRadius: "6px", padding: "6px 10px", fontSize: "clamp(9px,0.8vw,11px)", color: "#FF8888", textAlign: "center", fontFamily: "monospace" }}>
              {error}
            </div>
          )}

          <button
            type="submit" disabled={isLoading}
            style={{
              background: isLoading ? `rgba(0,255,238,0.12)` : `linear-gradient(135deg, ${TEAL}DD, #00BBDD)`,
              border: "none", borderRadius: "100px",
              padding: "clamp(9px,1vw,13px) 24px",
              cursor: isLoading ? "wait" : "pointer",
              color: isLoading ? TEAL : "#030A0A",
              fontWeight: 800, fontSize: "clamp(12px,1.1vw,15px)", letterSpacing: "0.1em",
              boxShadow: isLoading ? "none" : `0 0 22px ${TEAL}44`,
              marginTop: "4px",
            }}
          >
            {isLoading ? "CHECKING..." : "CONTINUE →"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "clamp(8px,1vw,12px)", flex: 1, justifyContent: "center" }}>
          <div style={{ background: `rgba(0,255,238,0.06)`, borderRadius: "6px", padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "clamp(10px,0.9vw,13px)", fontFamily: "monospace", color: TEAL }}>{email}</span>
            <button type="button" onClick={() => { setStep("email"); setPassword(""); setError(null); }} style={{ background: "transparent", border: "none", color: `${TEAL}88`, cursor: "pointer", fontSize: "clamp(8px,0.7vw,10px)", fontFamily: "monospace" }}>CHANGE</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ fontSize: "clamp(7px,0.62vw,9px)", fontFamily: "monospace", color: `${TEAL}88`, letterSpacing: "0.25em", textTransform: "uppercase" }}>Password</div>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)} required autoFocus
              placeholder="••••••••" style={{ ...inputStyle, borderColor: error ? "rgba(255,100,100,0.5)" : `${TEAL}44` }}
            />
          </div>

          {error && (
            <div style={{ background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.3)", borderRadius: "6px", padding: "6px 10px", fontSize: "clamp(9px,0.8vw,11px)", color: "#FF8888", textAlign: "center", fontFamily: "monospace" }}>
              {error}
            </div>
          )}

          <button
            type="submit" disabled={isLoading}
            style={{
              background: isLoading ? `rgba(0,255,238,0.12)` : `linear-gradient(135deg, ${TEAL}DD, #00BBDD)`,
              border: "none", borderRadius: "100px",
              padding: "clamp(9px,1vw,13px) 24px",
              cursor: isLoading ? "wait" : "pointer",
              color: isLoading ? TEAL : "#030A0A",
              fontWeight: 800, fontSize: "clamp(12px,1.1vw,15px)", letterSpacing: "0.1em",
              boxShadow: isLoading ? "none" : `0 0 22px ${TEAL}44`,
              marginTop: "4px",
            }}
          >
            {isLoading ? "CONNECTING..." : "SIGN IN →"}
          </button>
        </form>
      )}

      {/* Footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: "clamp(8px,0.72vw,10px)", color: "rgba(200,220,255,0.4)", fontFamily: "monospace" }}>
          No account?{" "}<a href="/signup" style={{ color: `${TEAL}BB`, textDecoration: "none" }}>Free Trial →</a>
        </div>
        <div style={{ fontSize: "clamp(7px,0.62vw,9px)", color: "rgba(200,220,255,0.2)", fontFamily: "monospace" }}>CH 00</div>
      </div>

    </div>
  );
}

export default function Landing() {
  const [ch, setCh] = useState<ChId>("home");
  const [flash, setFlash] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const [showLogin, setShowLogin] = useState(false);
  const touchStartX = useRef(0);
  const isDragging = useRef(false);
  const { canInstall, isInstalled, isInstalling, install } = usePwaInstall();

  const activeCh = CHANNELS.find(c => c.id === ch)!;
  const totalSlides = activeCh.slides;

  const tune = (next: ChId) => {
    if (next === ch || flash) return;
    setFlash(true);
    setSlideIndex(0);
    setTimeout(() => { setCh(next); setFlash(false); }, 200);
  };

  const goSlide = (dir: 1 | -1) => {
    setSlideIndex(i => Math.min(Math.max(i + dir, 0), totalSlides - 1));
  };

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 36) goSlide(dx < 0 ? 1 : -1);
  };
  const onMouseDown = (e: React.MouseEvent) => {
    touchStartX.current = e.clientX;
    isDragging.current = true;
  };
  const onMouseUp = (e: React.MouseEvent) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    const dx = e.clientX - touchStartX.current;
    if (Math.abs(dx) > 36) goSlide(dx < 0 ? 1 : -1);
  };

  // Reset slide when channel changes via tune
  useEffect(() => { setSlideIndex(0); }, [ch]);

  return (
    <div style={{
      minHeight: "100vh", maxHeight: "100vh", overflow: "hidden",
      background: "#05030F",
      backgroundImage: `
        radial-gradient(ellipse 1000px 600px at 50% 50%, rgba(10,5,50,0.8) 0%, transparent 70%),
        radial-gradient(ellipse 600px 800px at 15% 60%, rgba(80,0,160,0.18) 0%, transparent 55%),
        radial-gradient(ellipse 500px 600px at 85% 40%, rgba(0,180,200,0.12) 0%, transparent 55%)
      `,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "system-ui, sans-serif", position: "relative",
    }}>
      <style>{GLOBAL_CSS}</style>

      {/* Star field */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none" }}>
        {STARS.map((s, i) => (
          <div key={i} style={{
            position: "absolute", left: s.x, top: s.y,
            width: s.size, height: s.size, borderRadius: "50%",
            background: "#fff",
            "--so": s.opacity,
            opacity: s.opacity,
            animation: `pb-twinkle ${2 + (i % 5) * 0.6}s ease-in-out ${(i % 7) * 0.3}s infinite`,
          } as any} />
        ))}
      </div>

      {/* Decorative background orbital rings */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        <div style={{
          position: "absolute", left: "50%", top: "50%", width: "160vw", height: "90vh",
          border: `1px solid ${TEAL}08`, borderRadius: "50%",
          animation: "pb-bgring 80s linear infinite",
        }} />
        <div style={{
          position: "absolute", left: "50%", top: "50%", width: "130vw", height: "70vh",
          border: `1px solid ${PURP}08`, borderRadius: "50%",
          transform: "translate(-50%,-50%) rotate(30deg)",
          animation: "pb-bgring-r 55s linear infinite",
        }} />
        <div style={{
          position: "absolute", left: "50%", top: "50%", width: "110vw", height: "50vh",
          border: `1px solid ${MGNT}06`, borderRadius: "50%",
          transform: "translate(-50%,-50%) rotate(-20deg)",
          animation: "pb-bgring 40s linear infinite",
        }} />
      </div>

      {/* Background planet (large, partial) */}
      <div style={{
        position: "fixed", right: "-12vw", bottom: "-10vh",
        width: "45vw", height: "45vw", borderRadius: "50%",
        background: "radial-gradient(circle at 30% 30%, rgba(80,20,180,0.35), rgba(20,5,80,0.6) 60%, rgba(5,3,15,0.9))",
        border: "1px solid rgba(120,60,200,0.15)",
        boxShadow: "0 0 60px rgba(80,0,180,0.12) inset",
        pointerEvents: "none",
      }} />

      {/* Small distant planet */}
      <div style={{
        position: "fixed", left: "4vw", top: "10vh",
        width: "clamp(36px,5.5vw,72px)", height: "clamp(36px,5.5vw,72px)", borderRadius: "50%",
        background: "radial-gradient(circle at 35% 30%, rgba(0,220,200,0.4), rgba(0,100,120,0.6) 60%, rgba(0,40,60,0.9))",
        border: "1px solid rgba(0,200,180,0.18)",
        pointerEvents: "none",
      }} />

      {/* ── TV SET (floating animation) ── */}
      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", zIndex: 10, animation: "pb-float 5s ease-in-out infinite" }}>

        {/* Antenna orbs + between-antenna area */}
        <div style={{ display: "flex", justifyContent: "center", gap: "clamp(120px,16vw,220px)", marginBottom: "-4px", position: "relative", zIndex: 2 }}>
          {([-12, 12] as const).map((deg, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div style={{
                width: "clamp(7px,0.9vw,10px)", height: "clamp(7px,0.9vw,10px)", borderRadius: "50%",
                background: `radial-gradient(circle at 35% 35%, #FFFFFF, ${TEAL}AA)`,
                boxShadow: `0 0 8px ${TEAL}BB, 0 0 16px ${TEAL}55`,
                marginBottom: "-1px",
              }} />
              <div style={{
                width: "clamp(2px,0.25vw,3px)", height: "clamp(32px,5vh,56px)",
                background: `linear-gradient(to bottom, #D0E8FF 0%, #5060A0 100%)`,
                transform: `rotate(${deg}deg)`, transformOrigin: "bottom center",
                borderRadius: "2px 2px 0 0",
              }} />
            </div>
          ))}

          {/* ── Centered between antennas: Sign In above radio waves ── */}
          <div style={{
            position: "absolute", left: "50%", top: 0,
            transform: "translate(-50%, -80%)",
            display: "flex", flexDirection: "column", alignItems: "center",
            pointerEvents: "auto",
          }}>
            {/* Radio wave arcs — topmost, above the antenna orbs */}
            <div style={{ position: "relative", width: "clamp(52px,7vw,84px)", height: "clamp(26px,3.5vh,42px)", flexShrink: 0, marginBottom: "clamp(4px,0.6vh,8px)" }}>
              {([
                { w: "30%",  h: "30%",  delay: "0s"    },
                { w: "62%",  h: "58%",  delay: "0.42s" },
                { w: "100%", h: "100%", delay: "0.84s" },
              ]).map(({ w, h, delay }, n) => (
                <div key={n} style={{
                  position: "absolute",
                  bottom: 0, left: 0, right: 0,
                  margin: "0 auto",
                  width: w, height: h,
                  border: `1.5px solid ${TEAL}`,
                  borderBottom: "none",
                  borderRadius: "50% 50% 0 0",
                  boxShadow: `0 0 5px ${TEAL}55`,
                  opacity: 0,
                  animation: `pb-radiowave 1.68s ease-out ${delay} infinite`,
                }} />
              ))}
            </div>

            {/* Sign In pill — between waves and antenna orbs */}
            <button
              onClick={() => setShowLogin(v => !v)}
              style={{
                background: showLogin ? `rgba(0,255,238,0.22)` : "rgba(0,255,238,0.12)",
                border: `1px solid ${showLogin ? TEAL : TEAL + "88"}`,
                borderRadius: "100px",
                padding: "clamp(4px,0.6vh,7px) clamp(12px,1.6vw,20px)",
                cursor: "pointer", color: TEAL,
                fontSize: "clamp(9px,0.9vw,12px)", fontWeight: 700,
                letterSpacing: "0.08em",
                backdropFilter: "blur(10px)",
                boxShadow: `0 0 18px ${TEAL}30, 0 0 6px ${TEAL}20 inset`,
                whiteSpace: "nowrap",
              }}
            >{showLogin ? "← BACK" : "Sign In / Free Trial"}</button>
          </div>
        </div>

        {/* TV Body */}
        <div style={{
          position: "relative",
          width: "min(920px, 96vw)",
          background: "linear-gradient(165deg, #1E1E3A 0%, #161628 35%, #101020 70%, #0C0C1A 100%)",
          borderRadius: "clamp(20px,3vw,36px)",
          padding: "clamp(14px,2vw,22px) clamp(16px,2.2vw,26px) clamp(12px,1.8vw,18px)",
          display: "flex",
          flexDirection: "column",
          gap: "clamp(10px,1.4vw,16px)",
          boxShadow: `
            0 0 0 1px rgba(100,120,220,0.25) inset,
            0 0 0 2px rgba(60,80,160,0.15) inset,
            0 20px 60px rgba(0,0,0,0.8),
            0 0 80px ${TEAL}18,
            0 0 160px ${TEAL}08
          `,
        }}>

          {/* Top highlight edge */}
          <div style={{
            position: "absolute", top: 0, left: "8%", right: "8%", height: "1px",
            background: `linear-gradient(90deg, transparent, ${TEAL}44, transparent)`,
            pointerEvents: "none",
          }} />

          {/* Corner accent marks */}
          {[
            { top: "12px", left: "16px" },
            { top: "12px", right: "16px" },
            { bottom: "12px", left: "16px" },
            { bottom: "12px", right: "16px" },
          ].map((pos, i) => (
            <div key={i} style={{
              position: "absolute", ...pos,
              width: "16px", height: "16px",
              border: `1px solid ${TEAL}33`,
              borderRadius: "3px",
              pointerEvents: "none",
            }} />
          ))}

          {/* Screen */}
          <div>
            {/* Chrome bezel */}
            <div style={{
              background: "linear-gradient(145deg, #3A3A5A 0%, #555578 20%, #2A2A44 55%, #404068 80%, #222238 100%)",
              borderRadius: "clamp(10px,1.6vw,20px)",
              padding: "clamp(5px,0.7vw,8px)",
              boxShadow: `inset 0 3px 8px rgba(0,0,0,0.7), 0 2px 6px rgba(0,0,0,0.5), 0 0 0 1px ${TEAL}22`,
            }}>
              <div style={{
                background: SCR_BG,
                borderRadius: "clamp(7px,1.1vw,14px)",
                overflow: "hidden",
                position: "relative",
                height: "clamp(300px,42vh,520px)",
                cursor: showLogin ? "default" : totalSlides > 1 ? "grab" : "default",
                userSelect: "none",
              }}
                onTouchStart={showLogin ? undefined : onTouchStart}
                onTouchEnd={showLogin ? undefined : onTouchEnd}
                onMouseDown={showLogin ? undefined : onMouseDown}
                onMouseUp={showLogin ? undefined : onMouseUp}
                onMouseLeave={() => { isDragging.current = false; }}
              >
                {/* Scanlines */}
                <div style={{
                  position: "absolute", inset: 0, zIndex: 15, pointerEvents: "none",
                  backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 2px, rgba(0,0,0,0.18) 2px, rgba(0,0,0,0.18) 4px)",
                }} />
                {/* Teal phosphor glow */}
                <div style={{
                  position: "absolute", inset: 0, zIndex: 14, pointerEvents: "none",
                  background: `radial-gradient(ellipse 75% 60% at 50% 40%, ${TEAL}0E 0%, transparent 70%)`,
                }} />
                {/* Animated scan line sweep */}
                <div style={{
                  position: "absolute", left: 0, right: 0, height: "2px", zIndex: 17, pointerEvents: "none",
                  background: `linear-gradient(90deg, transparent 0%, ${TEAL}40 30%, ${TEAL}88 50%, ${TEAL}40 70%, transparent 100%)`,
                  animation: "pb-scan 7s ease-in-out 2s infinite",
                  top: 0,
                }} />
                {/* Glass reflection */}
                <div style={{
                  position: "absolute", top: 0, left: 0, right: 0, height: "20%", zIndex: 16, pointerEvents: "none",
                  background: "linear-gradient(to bottom, rgba(255,255,255,0.03), transparent)",
                  borderRadius: "14px 14px 0 0",
                }} />
                {/* Channel flash static */}
                {flash && (
                  <div style={{
                    position: "absolute", inset: 0, zIndex: 20,
                    backgroundImage: `
                      repeating-linear-gradient(0deg, ${TEAL}22 0px, transparent 1px, rgba(0,0,0,0.5) 3px, rgba(255,255,255,0.12) 5px),
                      repeating-linear-gradient(90deg, rgba(255,255,255,0.04) 0px, transparent 2px)
                    `,
                    opacity: 0.9,
                  }} />
                )}

                {/* Content */}
                <div style={{
                  position: "relative", zIndex: 5, height: "100%",
                  opacity: flash ? 0 : 1, transition: "opacity 0.1s ease",
                  overflow: "hidden",
                }}>
                  {showLogin ? (
                    <TVLoginScreen onBack={() => setShowLogin(false)} />
                  ) : (
                    <>
                      {ch === "home"    && <HomeScreen tune={tune} />}
                      {ch === "ops"     && <OpsScreen slideIndex={slideIndex} />}
                      {ch === "tools"   && <ToolsScreen slideIndex={slideIndex} />}
                      {ch === "pricing" && <PricingScreen tune={tune} />}
                      {ch === "live"    && <LiveScreen onSignIn={() => setShowLogin(true)} canInstall={canInstall} isInstalled={isInstalled} isInstalling={isInstalling} onInstall={install} />}
                    </>
                  )}

                  {/* Slide dots + swipe hint — overlay at bottom */}
                  {!showLogin && totalSlides > 1 && !flash && (
                    <div style={{
                      position: "absolute", bottom: "clamp(8px,1.2vw,14px)", left: 0, right: 0, zIndex: 18,
                      display: "flex", flexDirection: "column", alignItems: "center", gap: "5px",
                      pointerEvents: "none",
                    }}>
                      {/* Swipe hint — fades in/out */}
                      <div style={{
                        display: "flex", alignItems: "center", gap: "5px",
                        fontSize: "clamp(7px,0.62vw,9px)", fontFamily: "monospace",
                        color: `${TEAL}88`, letterSpacing: "0.15em",
                        animation: "pb-swipehint 3s ease-in-out 1s 2",
                      }}>
                        <span style={{ fontSize: "8px" }}>‹</span>
                        SWIPE
                        <span style={{ fontSize: "8px" }}>›</span>
                      </div>
                      {/* Dots */}
                      <div style={{ display: "flex", gap: "5px" }}>
                        {Array.from({ length: totalSlides }).map((_, i) => (
                          <div key={i} style={{
                            width: i === slideIndex ? "18px" : "5px",
                            height: "5px",
                            borderRadius: "3px",
                            background: i === slideIndex ? TEAL : `${TEAL}44`,
                            boxShadow: i === slideIndex ? `0 0 6px ${TEAL}` : "none",
                            transition: "width 0.25s ease, background 0.25s ease",
                          }} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Bottom controls strip */}
          <div style={{
            display: "flex", alignItems: "center",
            gap: "clamp(8px,1.2vw,16px)",
            paddingTop: "clamp(6px,0.9vw,10px)",
            borderTop: `1px solid ${TEAL}18`,
          }}>
            {/* LED channel display */}
            <div style={{
              background: "#060612",
              border: `1px solid ${TEAL}55`,
              borderRadius: "10px",
              padding: "clamp(4px,0.6vw,7px) clamp(8px,1vw,14px)",
              textAlign: "center", fontFamily: "monospace",
              color: TEAL, fontWeight: 900, lineHeight: 1,
              fontSize: "clamp(16px,1.8vw,22px)",
              boxShadow: `0 0 14px ${TEAL}33, inset 0 0 12px rgba(0,0,0,0.95)`,
              animation: "pb-ledpulse 2.5s ease-in-out infinite",
              flexShrink: 0,
              display: "flex", flexDirection: "column", alignItems: "center", gap: "2px",
            }}>
              {showLogin ? "00" : activeCh.num}
              <div style={{ fontSize: "clamp(5px,0.5vw,7px)", letterSpacing: "0.2em", color: `${TEAL}BB` }}>CH</div>
            </div>

            {/* Channel buttons */}
            <div style={{ display: "flex", gap: "clamp(5px,0.8vw,10px)", flex: 1, justifyContent: "center" }}>
              {CHANNELS.map(c => {
                const isActive = ch === c.id;
                return (
                  <button key={c.id} onClick={() => tune(c.id)} style={{
                    background: isActive ? `${TEAL}18` : "rgba(255,255,255,0.04)",
                    border: `1px solid ${isActive ? TEAL : "rgba(200,220,255,0.2)"}`,
                    borderRadius: "8px",
                    padding: "clamp(5px,0.7vw,9px) clamp(10px,1.4vw,18px)",
                    cursor: "pointer",
                    color: isActive ? TEAL : "rgba(215,230,255,0.82)",
                    fontFamily: "monospace", fontWeight: 700,
                    letterSpacing: "0.08em",
                    transition: "all 0.15s",
                    animation: isActive ? "pb-chglow 2s ease-in-out infinite" : "none",
                    textAlign: "center", lineHeight: 1.3,
                    textShadow: isActive ? `0 0 8px ${TEAL}` : "none",
                    display: "flex", flexDirection: "column", alignItems: "center", gap: "2px",
                    flex: 1, minWidth: 0,
                  }}>
                    <div style={{ fontSize: "clamp(10px,1.1vw,14px)" }}>{c.num}</div>
                    <div style={{ fontSize: "clamp(7px,0.65vw,9px)", opacity: 0.85 }}>{c.label}</div>
                  </button>
                );
              })}
            </div>

            {/* Decorative orb dials */}
            <div style={{ display: "flex", gap: "clamp(8px,1vw,14px)", flexShrink: 0, alignItems: "center" }}>
              {([
                { label: "PWR", color: TEAL },
                { label: "HUE", color: PURP },
              ] as const).map((k) => (
                <div key={k.label} style={{ textAlign: "center" }}>
                  <div style={{
                    width: "clamp(22px,2.4vw,32px)", height: "clamp(22px,2.4vw,32px)", borderRadius: "50%",
                    background: `radial-gradient(circle at 35% 30%, rgba(100,100,180,0.3), rgba(10,10,40,0.95))`,
                    border: `1px solid ${k.color}44`,
                    boxShadow: `0 0 10px ${k.color}33, inset 0 0 8px rgba(0,0,0,0.9)`,
                    margin: "0 auto", position: "relative", cursor: "default",
                  }}>
                    <div style={{
                      position: "absolute", width: "2px", height: "36%",
                      background: k.color, top: "14%", left: "50%",
                      transform: "translateX(-50%)", borderRadius: "2px",
                      boxShadow: `0 0 4px ${k.color}`,
                    }} />
                  </div>
                  <div style={{ fontSize: "clamp(5px,0.48vw,7px)", color: `${k.color}88`, letterSpacing: "0.15em", marginTop: "3px" }}>{k.label}</div>
                </div>
              ))}
            </div>

            {/* Signal bars */}
            <div style={{ display: "flex", alignItems: "flex-end", gap: "2px", flexShrink: 0 }}>
              {[3, 5, 7, 9, 11].map((h, i) => (
                <div key={i} style={{
                  width: "clamp(2px,0.28vw,4px)", height: `${h}px`, borderRadius: "1px",
                  background: i < 3 ? TEAL : `${TEAL}30`,
                  boxShadow: i < 3 ? `0 0 4px ${TEAL}` : "none",
                }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
