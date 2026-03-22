import { useState } from "react";
import { Link } from "wouter";
import {
  ShoppingBag, Cpu, LogIn, ExternalLink, ChevronUp,
  Zap, ScanLine, Globe, X,
} from "lucide-react";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import logoUrl from "@assets/PlanetBrick_dotcom_with_planet_and_robot_400_1760672362080.png";

type Panel = null | "shop" | "studio" | "signin";

const TEAL  = "#00FFEE";
const MGNT  = "#FF00CC";
const PURP  = "#A855F7";
const AMBER = "#FFB830";
const SCR_BG = "#04060F";
const NAVY  = "#080E1F";

const GLOBAL_CSS = `
  @keyframes pb-float    { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }
  @keyframes pb-twinkle  { 0%,100%{opacity:var(--so)} 50%{opacity:calc(var(--so)*0.3)} }
  @keyframes pb-pulse    { 0%,100%{opacity:1} 50%{opacity:0.4} }
  @keyframes pb-ledpulse { 0%,100%{text-shadow:0 0 10px #00FFEE} 50%{text-shadow:0 0 22px #00FFEE,0 0 44px #00FFEE44} }
  @keyframes pb-scan     { 0%{top:0%;opacity:0} 4%{opacity:0.5} 96%{opacity:0.2} 100%{top:100%;opacity:0} }
  @keyframes pb-slidein  { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
  @keyframes pb-orb      { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }

  .pb-card-btn {
    -webkit-tap-highlight-color: transparent;
    outline: none;
  }
  .pb-card-btn:active {
    opacity: 0.82;
    transform: scale(0.97);
  }
  .pb-close-handle:active { opacity: 0.7; }
  .pb-store-link:active   { opacity: 0.75; }
`;

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

function IosShareIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7" />
      <rect x="4" y="16" width="16" height="5" rx="1" fill="none" />
    </svg>
  );
}

function ElfieRobot() {
  return (
    <svg width="100%" height="100%" viewBox="0 0 100 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="eg-slate" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#78909C" />
          <stop offset="100%" stopColor="#546E7A" />
        </linearGradient>
        <linearGradient id="eg-beige" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#E8C4A0" />
          <stop offset="100%" stopColor="#D4A574" />
        </linearGradient>
        <linearGradient id="eg-wheel" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#A04545" />
          <stop offset="100%" stopColor="#8B3A3A" />
        </linearGradient>
      </defs>

      {/* Antenna */}
      <rect x="48" y="4" width="4" height="10" rx="2" fill="#37474F" />
      <circle cx="50" cy="4" r="3.5" fill={TEAL} style={{ animation: "pb-pulse 2s ease-in-out infinite" }} />
      <ellipse cx="50" cy="4" rx="9" ry="3.5" fill="none" stroke={TEAL} strokeWidth="1" opacity="0.35"
        style={{ animation: "pb-pulse 2s ease-in-out 0.6s infinite" }} />
      <ellipse cx="50" cy="4" rx="14" ry="5.5" fill="none" stroke={TEAL} strokeWidth="0.7" opacity="0.18"
        style={{ animation: "pb-pulse 2s ease-in-out 1.2s infinite" }} />

      {/* Head */}
      <ellipse cx="50" cy="22" rx="12" ry="3" fill="#546E7A" />
      <rect x="38" y="19" width="24" height="20" fill="url(#eg-slate)" />
      <ellipse cx="50" cy="39" rx="12" ry="3" fill="#37474F" />
      <rect x="41" y="23" width="18" height="14" rx="1" fill="url(#eg-beige)" />
      <circle cx="46" cy="29" r="3" fill="#37474F" />
      <circle cx="46" cy="29" r="2" fill="#E8A84D">
        <animate attributeName="opacity" values="1;0.25;1" dur="3s" repeatCount="indefinite" />
      </circle>
      <circle cx="54" cy="29" r="3" fill="#37474F" />
      <circle cx="54" cy="29" r="2" fill="#E8A84D">
        <animate attributeName="opacity" values="1;0.25;1" dur="3s" begin="0.5s" repeatCount="indefinite" />
      </circle>
      <path d="M44 33 Q50 36 56 33" stroke="#37474F" strokeWidth="1.5" fill="none" strokeLinecap="round" />

      {/* Neck */}
      <ellipse cx="50" cy="40" rx="8" ry="2" fill="#546E7A" />

      {/* Body */}
      <ellipse cx="50" cy="50" rx="20" ry="6" fill="#546E7A" />
      <rect x="30" y="50" width="40" height="28" fill="url(#eg-slate)" />
      <ellipse cx="50" cy="78" rx="20" ry="6" fill="#37474F" />
      <ellipse cx="50" cy="64" rx="12" ry="8" fill="url(#eg-beige)" />
      <circle cx="50" cy="64" r="4" fill="#37474F" opacity="0.3" />

      {/* Arms */}
      <rect x="22" y="56" width="6" height="14" rx="3" fill="#546E7A" stroke="#37474F" strokeWidth="1" />
      <circle cx="25" cy="71" r="3" fill="#78909C" />
      <rect x="72" y="56" width="6" height="14" rx="3" fill="#546E7A" stroke="#37474F" strokeWidth="1" />
      <circle cx="75" cy="71" r="3" fill="#78909C" />

      {/* Wheel base */}
      <rect x="28" y="82" width="44" height="7" rx="2" fill="url(#eg-wheel)" stroke="#37474F" strokeWidth="1" />

      {/* Left wheel */}
      <ellipse cx="36" cy="95" rx="10" ry="12" fill="#37474F" stroke="#546E7A" strokeWidth="2" />
      <ellipse cx="36" cy="95" rx="7" ry="9" fill="#546E7A" />
      <ellipse cx="36" cy="95" rx="4" ry="6" fill="#E8C4A0" />

      {/* Right wheel */}
      <ellipse cx="64" cy="95" rx="10" ry="12" fill="#37474F" stroke="#546E7A" strokeWidth="2" />
      <ellipse cx="64" cy="95" rx="7" ry="9" fill="#546E7A" />
      <ellipse cx="64" cy="95" rx="4" ry="6" fill="#E8C4A0" />
    </svg>
  );
}

// ─── PANEL SCREENS ────────────────────────────────────────────────────────────

function ShopScreen() {
  const stores = [
    {
      name: "BrickOwl",
      url: "https://planetbrick.brickowl.com",
      display: "planetbrick.brickowl.com",
      desc: "Our primary storefront. Browse 47k+ lots — parts, minifigs, sets. Fast shipping.",
      color: AMBER,
      rgb: "255,184,48",
    },
    {
      name: "BrickLink",
      url: "https://store.bricklink.com/PlanetBrick?p=PlanetBrick#/terms",
      display: "store.bricklink.com/PlanetBrick",
      desc: "Find us on the world's largest LEGO marketplace.",
      color: "#5CA8FF",
      rgb: "92,168,255",
    },
  ];

  return (
    <div style={{
      height: "100%", display: "flex", flexDirection: "column",
      padding: "clamp(14px,3.5vw,24px)",
      gap: "clamp(10px,2.5vw,16px)",
      animation: "pb-slidein 0.3s ease-out",
    }}>
      <div>
        <div style={{ fontSize: "clamp(9px,2vw,11px)", fontFamily: "monospace", color: AMBER, letterSpacing: "0.35em", marginBottom: "4px" }}>
          ▸ PLANETBRICK STORES
        </div>
        <h2 style={{ fontSize: "clamp(18px,4.5vw,26px)", fontWeight: 900, color: "#FFF", margin: 0, lineHeight: 1.1 }}>
          Shop LEGO bricks
        </h2>
        <p style={{ fontSize: "clamp(11px,2.5vw,13px)", color: "rgba(200,220,255,0.55)", margin: "4px 0 0", fontFamily: "monospace" }}>
          100% authentic · 47,000+ lots · fast shipping
        </p>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "clamp(8px,2vw,12px)", minHeight: 0 }}>
        {stores.map(s => (
          <a
            key={s.name}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="pb-store-link"
            style={{
              flex: 1,
              display: "flex", flexDirection: "column",
              background: `rgba(${s.rgb},0.06)`,
              border: `1px solid rgba(${s.rgb},0.3)`,
              borderRadius: "clamp(12px,3vw,18px)",
              padding: "clamp(12px,3vw,20px)",
              textDecoration: "none",
              position: "relative", overflow: "hidden",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <div style={{
              position: "absolute", top: 0, right: 0, bottom: 0, width: "50%",
              background: `radial-gradient(ellipse at 80% 30%, rgba(${s.rgb},0.07), transparent)`,
              pointerEvents: "none",
            }} />
            <div style={{ fontSize: "clamp(17px,4vw,22px)", fontWeight: 900, color: s.color, marginBottom: "2px" }}>
              {s.name}
            </div>
            <div style={{ fontSize: "clamp(9px,2vw,10px)", fontFamily: "monospace", color: `rgba(${s.rgb},0.55)`, marginBottom: "clamp(6px,1.5vw,10px)" }}>
              {s.display}
            </div>
            <p style={{ fontSize: "clamp(11px,2.5vw,13px)", color: "rgba(200,220,255,0.72)", margin: 0, lineHeight: 1.5, flex: 1 }}>
              {s.desc}
            </p>
            <div style={{
              marginTop: "clamp(8px,2vw,12px)",
              display: "inline-flex", alignItems: "center", gap: "5px",
              background: `rgba(${s.rgb},0.12)`,
              border: `1px solid rgba(${s.rgb},0.4)`,
              borderRadius: "100px",
              padding: "clamp(5px,1.2vw,8px) clamp(10px,2.5vw,14px)",
              fontSize: "clamp(11px,2.5vw,13px)", fontWeight: 700, color: s.color,
              alignSelf: "flex-start",
            }}>
              Visit Store <ExternalLink size={11} />
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

const STUDIO_FEATURES = [
  { Icon: Zap,      color: "#FFD600", rgb: "255,214,0",   title: "Price-o-Matic", desc: "24/7 AI repricing" },
  { Icon: ScanLine, color: TEAL,      rgb: "0,255,238",   title: "BrickSpotter",  desc: "AI part scanner"  },
  { Icon: Globe,    color: PURP,      rgb: "168,85,247",  title: "Multichannel",  desc: "Sync everywhere"  },
];

function StudioScreen({ onGoSignIn }: { onGoSignIn: () => void }) {
  return (
    <div style={{
      height: "100%", display: "flex", flexDirection: "column",
      padding: "clamp(14px,3.5vw,24px)",
      gap: "clamp(10px,2.5vw,18px)",
      animation: "pb-slidein 0.3s ease-out",
    }}>
      <div>
        <div style={{ fontSize: "clamp(9px,2vw,11px)", fontFamily: "monospace", color: TEAL, letterSpacing: "0.35em", marginBottom: "4px" }}>
          ▸ PLANETBRICK STUDIO
        </div>
        <h2 style={{ fontSize: "clamp(18px,4.5vw,26px)", fontWeight: 900, color: "#FFF", margin: 0, lineHeight: 1.1 }}>
          Built for LEGO<br />
          <span style={{ color: TEAL }}>resellers & hobbyists</span>
        </h2>
        <p style={{ fontSize: "clamp(11px,2.5vw,13px)", color: "rgba(200,220,255,0.65)", margin: "clamp(6px,1.5vw,10px) 0 0", lineHeight: 1.55 }}>
          E.L.F.I.E. manages your back office — repricing, scanning, syncing — so you build more and stress less.
        </p>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: "clamp(6px,1.8vw,10px)",
      }}>
        {STUDIO_FEATURES.map(f => (
          <div key={f.title} style={{
            background: `rgba(${f.rgb},0.07)`,
            border: `1px solid rgba(${f.rgb},0.28)`,
            borderRadius: "clamp(10px,2.5vw,14px)",
            padding: "clamp(10px,2.5vw,16px) clamp(6px,1.5vw,10px)",
            textAlign: "center",
            display: "flex", flexDirection: "column", alignItems: "center", gap: "clamp(5px,1.2vw,8px)",
          }}>
            <div style={{
              width: "clamp(32px,8vw,44px)", height: "clamp(32px,8vw,44px)", borderRadius: "50%",
              background: `rgba(${f.rgb},0.12)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: `0 0 14px rgba(${f.rgb},0.25)`,
            }}>
              <f.Icon size={16} color={f.color} />
            </div>
            <div>
              <div style={{ fontSize: "clamp(10px,2.3vw,13px)", fontWeight: 800, color: "#FFF", lineHeight: 1.2 }}>{f.title}</div>
              <div style={{ fontSize: "clamp(8px,1.8vw,10px)", color: `rgba(${f.rgb},0.7)`, fontFamily: "monospace", marginTop: "2px" }}>{f.desc}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: "clamp(8px,2vw,12px)" }}>
        <button
          onClick={onGoSignIn}
          className="pb-card-btn"
          style={{
            background: `linear-gradient(135deg, ${TEAL}CC, #00BBDD)`,
            border: "none", borderRadius: "100px",
            padding: "clamp(13px,3.2vw,17px)",
            color: "#04060F", fontWeight: 800,
            fontSize: "clamp(13px,3vw,16px)", cursor: "pointer",
            boxShadow: `0 0 24px ${TEAL}44`,
            letterSpacing: "0.04em",
            transition: "opacity 0.15s",
          }}
        >
          Sign In to Studio →
        </button>
        <Link href="/signup">
          <button
            className="pb-card-btn"
            style={{
              width: "100%",
              background: "transparent",
              border: `1px solid rgba(0,255,238,0.35)`,
              borderRadius: "100px",
              padding: "clamp(12px,3vw,15px)",
              color: TEAL, fontWeight: 700,
              fontSize: "clamp(12px,2.8vw,14px)", cursor: "pointer",
            }}
          >
            Request Access
          </button>
        </Link>
      </div>
    </div>
  );
}

function SignInScreen({
  canPromptInstall, showInstallOption, isInstalled, isInstalling, isIos, onInstall,
}: {
  canPromptInstall: boolean;
  showInstallOption: boolean;
  isInstalled: boolean;
  isInstalling: boolean;
  isIos: boolean;
  onInstall: () => void;
}) {
  const showInstBtn = showInstallOption && !isInstalled;

  return (
    <div style={{
      height: "100%", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: "clamp(16px,4vw,28px)",
      gap: "clamp(14px,3.5vw,24px)",
      animation: "pb-slidein 0.3s ease-out",
    }}>
      {/* Floating E.L.F.I.E. */}
      <div style={{ width: "clamp(60px,16vw,90px)", aspectRatio: "100 / 120", animation: "pb-float 4s ease-in-out infinite" }}>
        <ElfieRobot />
      </div>

      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "clamp(9px,2vw,11px)", fontFamily: "monospace", color: MGNT, letterSpacing: "0.35em", marginBottom: "8px" }}>
          ▸ STUDIO ACCESS
        </div>
        <h2 style={{ fontSize: "clamp(20px,5vw,28px)", fontWeight: 900, color: "#FFF", margin: "0 0 6px" }}>
          Welcome back
        </h2>
        <p style={{ fontSize: "clamp(12px,2.8vw,14px)", color: "rgba(200,220,255,0.6)", margin: 0, lineHeight: 1.5 }}>
          Sign in to your PlanetBrick Studio account
        </p>
      </div>

      <div style={{ width: "100%", maxWidth: "320px", display: "flex", flexDirection: "column", gap: "clamp(8px,2vw,12px)" }}>
        <Link href="/login" style={{ width: "100%" }}>
          <button
            className="pb-card-btn"
            style={{
              width: "100%",
              background: `linear-gradient(135deg, ${TEAL}CC, #00BBDD)`,
              border: "none", borderRadius: "100px",
              padding: "clamp(13px,3.5vw,17px)",
              color: "#04060F", fontWeight: 800,
              fontSize: "clamp(13px,3vw,16px)", cursor: "pointer",
              boxShadow: `0 0 24px ${TEAL}44`,
              letterSpacing: "0.04em",
            }}
          >
            Sign In
          </button>
        </Link>
        <Link href="/signup" style={{ width: "100%" }}>
          <button
            className="pb-card-btn"
            style={{
              width: "100%",
              background: "transparent",
              border: `1px solid rgba(0,255,238,0.35)`,
              borderRadius: "100px",
              padding: "clamp(13px,3.5vw,17px)",
              color: TEAL, fontWeight: 700,
              fontSize: "clamp(12px,2.8vw,15px)", cursor: "pointer",
            }}
          >
            Create Account
          </button>
        </Link>

        {showInstBtn && (
          <button
            onClick={onInstall}
            disabled={isInstalling}
            className="pb-card-btn"
            style={{
              background: "transparent",
              border: `1px solid rgba(255,0,204,0.35)`,
              borderRadius: "100px",
              padding: "clamp(10px,2.8vw,13px)",
              color: MGNT, fontWeight: 600,
              fontSize: "clamp(11px,2.5vw,13px)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "7px",
            }}
          >
            {isInstalling ? "Installing…" : isIos ? <><IosShareIcon /> Add to Home Screen</> : "Install App"}
          </button>
        )}
        {isInstalled && (
          <p style={{ textAlign: "center", fontSize: "clamp(10px,2.2vw,11px)", color: `${TEAL}88`, fontFamily: "monospace", margin: 0 }}>
            ✓ App installed
          </p>
        )}
      </div>
    </div>
  );
}

// ─── TV DROP PANEL ────────────────────────────────────────────────────────────

const PANEL_META: Record<NonNullable<Panel>, { label: string; color: string; num: string }> = {
  shop:   { label: "SHOP",   color: AMBER, num: "02" },
  studio: { label: "STUDIO", color: TEAL,  num: "03" },
  signin: { label: "ON AIR", color: MGNT,  num: "04" },
};

function TvPanel({
  panel, onClose, onChangePanel,
  canPromptInstall, showInstallOption, isInstalled, isInstalling, isIos, onInstall,
}: {
  panel: Panel;
  onClose: () => void;
  onChangePanel: (p: Panel) => void;
  canPromptInstall: boolean;
  showInstallOption: boolean;
  isInstalled: boolean;
  isInstalling: boolean;
  isIos: boolean;
  onInstall: () => void;
}) {
  const isOpen = panel !== null;
  const meta = panel ? PANEL_META[panel] : PANEL_META.shop;

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          onClick={onClose}
          style={{
            position: "fixed", inset: 0, zIndex: 90,
            background: "rgba(0,0,0,0.45)",
            backdropFilter: "blur(3px)",
            WebkitBackdropFilter: "blur(3px)",
          }}
        />
      )}

      {/* TV wrapper — slides from top */}
      <div
        style={{
          position: "fixed",
          top: 0, left: 0, right: 0,
          height: "88dvh",
          transform: isOpen ? "translateY(0)" : "translateY(-102%)",
          transition: isOpen
            ? "transform 0.48s cubic-bezier(0.34, 1.45, 0.64, 1)"
            : "transform 0.32s cubic-bezier(0.55, 0, 0.95, 0.45)",
          zIndex: 100,
          display: "flex",
          flexDirection: "column",
          willChange: "transform",
        }}
      >
        {/* TV Frame */}
        <div style={{
          flex: 1,
          background: `linear-gradient(165deg, #141836 0%, ${NAVY} 100%)`,
          borderRadius: "0 0 clamp(18px,4.5vw,28px) clamp(18px,4.5vw,28px)",
          border: `1px solid rgba(255,255,255,0.07)`,
          borderTop: "none",
          boxShadow: `
            0 24px 80px rgba(0,0,0,0.75),
            0 0 0 1px rgba(255,255,255,0.03),
            inset 0 1px 0 rgba(255,255,255,0.06)
          `,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          position: "relative",
        }}>

          {/* Bezel top bar */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "clamp(8px,2vw,13px) clamp(14px,3.5vw,22px)",
            borderBottom: `1px solid rgba(255,255,255,0.05)`,
            flexShrink: 0,
            background: "rgba(0,0,0,0.2)",
          }}>
            {/* Channel LED */}
            <div style={{ display: "flex", alignItems: "center", gap: "clamp(7px,1.8vw,11px)" }}>
              <div style={{
                background: "#060612",
                border: `1px solid ${meta.color}55`,
                borderRadius: "7px",
                padding: "3px 9px",
                fontFamily: "monospace", fontWeight: 900,
                color: meta.color,
                fontSize: "clamp(11px,2.8vw,15px)", lineHeight: 1,
                boxShadow: `0 0 10px ${meta.color}33, inset 0 0 8px rgba(0,0,0,0.9)`,
                animation: "pb-ledpulse 2.5s ease-in-out infinite",
                textAlign: "center",
              }}>
                {meta.num}
                <div style={{ fontSize: "clamp(5px,1.3vw,7px)", letterSpacing: "0.2em", color: `${meta.color}99`, marginTop: "1px" }}>CH</div>
              </div>
              <span style={{
                fontFamily: "monospace", fontWeight: 700,
                fontSize: "clamp(10px,2.5vw,13px)", color: meta.color,
                letterSpacing: "0.3em",
              }}>
                {meta.label}
              </span>
            </div>

            {/* Right: live dot + close */}
            <div style={{ display: "flex", alignItems: "center", gap: "clamp(10px,2.5vw,16px)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <div style={{
                  width: "5px", height: "5px", borderRadius: "50%",
                  background: meta.color,
                  boxShadow: `0 0 6px ${meta.color}`,
                  animation: "pb-pulse 1.5s ease-in-out infinite",
                }} />
                <span style={{ fontFamily: "monospace", fontSize: "clamp(7px,1.7vw,9px)", color: `${meta.color}99`, letterSpacing: "0.15em" }}>
                  LIVE
                </span>
              </div>
              <button
                onClick={onClose}
                className="pb-card-btn"
                data-testid="button-tv-close"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "50%",
                  width: "clamp(30px,7.5vw,38px)", height: "clamp(30px,7.5vw,38px)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", color: "rgba(200,220,255,0.6)",
                  flexShrink: 0,
                }}
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* CRT scan line */}
          <div style={{
            position: "absolute", left: 0, right: 0, height: "2px",
            background: `linear-gradient(90deg, transparent, ${meta.color}44, transparent)`,
            animation: "pb-scan 5s linear infinite",
            pointerEvents: "none", zIndex: 10,
          }} />

          {/* Screen content */}
          <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
            {panel === "shop"   && <ShopScreen />}
            {panel === "studio" && <StudioScreen onGoSignIn={() => onChangePanel("signin")} />}
            {panel === "signin" && (
              <SignInScreen
                canPromptInstall={canPromptInstall}
                showInstallOption={showInstallOption}
                isInstalled={isInstalled}
                isInstalling={isInstalling}
                isIos={isIos}
                onInstall={onInstall}
              />
            )}
          </div>

          {/* Bottom bezel — decorative controls */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            gap: "clamp(8px,2vw,13px)",
            padding: "clamp(7px,1.5vw,11px) clamp(14px,3.5vw,22px)",
            borderTop: `1px solid rgba(255,255,255,0.04)`,
            background: "rgba(0,0,0,0.15)",
            flexShrink: 0,
          }}>
            {[TEAL, PURP, MGNT].map((c, i) => (
              <div key={i} style={{
                width: "clamp(15px,3.8vw,20px)", height: "clamp(15px,3.8vw,20px)", borderRadius: "50%",
                background: `radial-gradient(circle at 35% 30%, rgba(80,80,160,0.35), rgba(6,8,24,0.97))`,
                border: `1px solid ${c}44`,
                boxShadow: `0 0 7px ${c}22`,
                position: "relative", flexShrink: 0,
              }}>
                <div style={{
                  position: "absolute", width: "2px", height: "35%",
                  background: c, top: "14%", left: "50%",
                  transform: "translateX(-50%)", borderRadius: "1px",
                  boxShadow: `0 0 3px ${c}`,
                }} />
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "flex-end", gap: "2px", marginLeft: "auto" }}>
              {[3, 5, 7, 9, 11].map((h, i) => (
                <div key={i} style={{
                  width: "clamp(2px,0.5vw,3px)", height: `${h}px`, borderRadius: "1px",
                  background: i < 3 ? TEAL : `${TEAL}28`,
                  boxShadow: i < 3 ? `0 0 3px ${TEAL}` : "none",
                }} />
              ))}
            </div>
          </div>
        </div>

        {/* Pull-down close handle */}
        <div
          onClick={onClose}
          className="pb-close-handle"
          data-testid="button-tv-handle"
          style={{
            alignSelf: "center",
            marginTop: "-1px",
            background: NAVY,
            border: `1px solid rgba(255,255,255,0.07)`,
            borderTop: "none",
            borderRadius: "0 0 clamp(14px,3.5vw,20px) clamp(14px,3.5vw,20px)",
            padding: "clamp(6px,1.5vw,9px) clamp(22px,5.5vw,36px) clamp(8px,2vw,12px)",
            cursor: "pointer",
            display: "flex", alignItems: "center", gap: "5px",
            color: "rgba(180,200,255,0.4)",
            fontSize: "clamp(8px,2vw,10px)", fontFamily: "monospace",
            letterSpacing: "0.22em",
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
        >
          <ChevronUp size={9} />
          CLOSE
          <ChevronUp size={9} />
        </div>
      </div>
    </>
  );
}

// ─── HERO ─────────────────────────────────────────────────────────────────────

const HERO_CARDS: Array<{ id: NonNullable<Panel>; Icon: typeof ShoppingBag; label: string; sub: string; color: string; rgb: string }> = [
  { id: "shop",   Icon: ShoppingBag, label: "Shop",    sub: "LEGO parts stores",  color: AMBER, rgb: "255,184,48"  },
  { id: "studio", Icon: Cpu,         label: "Studio",  sub: "Seller platform",    color: TEAL,  rgb: "0,255,238"   },
  { id: "signin", Icon: LogIn,       label: "Sign In", sub: "Studio access",      color: MGNT,  rgb: "255,0,204"   },
];

function Hero({ onSelect }: { onSelect: (p: NonNullable<Panel>) => void }) {
  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 1,
      display: "flex", flexDirection: "column",
      padding: [
        "max(env(safe-area-inset-top,0px) + 16px, 20px)",
        "clamp(16px,4vw,28px)",
        "max(env(safe-area-inset-bottom,0px) + 12px, 16px)",
        "clamp(16px,4vw,28px)",
      ].join(" "),
    }}>
      {/* Logo */}
      <div style={{ flexShrink: 0 }}>
        <img
          src={logoUrl}
          alt="PlanetBrick"
          style={{
            height: "clamp(22px,5.5vw,34px)", width: "auto",
            objectFit: "contain", objectPosition: "left",
            opacity: 0.92,
          }}
        />
      </div>

      {/* Center — E.L.F.I.E. + tagline */}
      <div style={{
        flex: 1, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        textAlign: "center",
        gap: "clamp(10px,2.5vw,18px)",
      }}>
        {/* Floating E.L.F.I.E. */}
        <div style={{
          width: "clamp(80px,20vw,120px)",
          aspectRatio: "100 / 120",
          animation: "pb-float 4s ease-in-out infinite",
          filter: `drop-shadow(0 0 18px ${TEAL}44)`,
        }}>
          <ElfieRobot />
        </div>

        <div>
          <div style={{
            fontSize: "clamp(8px,1.9vw,10px)", fontFamily: "monospace",
            color: TEAL, letterSpacing: "0.4em",
            marginBottom: "clamp(8px,2vw,13px)",
            textTransform: "uppercase",
          }}>
            ▸ Broadcasting from Orbit
          </div>
          <h1 style={{
            fontSize: "clamp(24px,6vw,52px)",
            fontWeight: 900, lineHeight: 1.05,
            color: "#FFF", margin: 0,
            letterSpacing: "-0.01em",
          }}>
            The LEGO universe,<br />
            <span style={{ color: TEAL, textShadow: `0 0 32px ${TEAL}55` }}>engineered.</span>
          </h1>
          <p style={{
            fontSize: "clamp(12px,3vw,16px)",
            color: "rgba(200,220,255,0.6)",
            margin: "clamp(8px,2vw,13px) auto 0",
            maxWidth: "380px", lineHeight: 1.55,
          }}>
            Authentic bricks. AI-powered tools.<br />One brand, two worlds.
          </p>
        </div>
      </div>

      {/* Bottom — 3 nav cards */}
      <div style={{
        flexShrink: 0,
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: "clamp(8px,2vw,14px)",
      }}>
        {HERO_CARDS.map(c => (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className="pb-card-btn"
            data-testid={`button-nav-${c.id}`}
            style={{
              background: `rgba(${c.rgb},0.07)`,
              border: `1px solid rgba(${c.rgb},0.32)`,
              borderRadius: "clamp(12px,3vw,18px)",
              padding: "clamp(12px,3vw,20px) clamp(6px,1.5vw,10px)",
              cursor: "pointer",
              display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              gap: "clamp(6px,1.5vw,10px)",
              textAlign: "center",
              transition: "border-color 0.2s, background 0.2s",
            }}
          >
            <div style={{
              width: "clamp(36px,9vw,50px)", height: "clamp(36px,9vw,50px)", borderRadius: "50%",
              background: `rgba(${c.rgb},0.12)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: `0 0 16px rgba(${c.rgb},0.3)`,
            }}>
              <c.Icon size={18} color={c.color} />
            </div>
            <div>
              <div style={{ fontSize: "clamp(11px,2.8vw,15px)", fontWeight: 800, color: "#FFF", lineHeight: 1.2 }}>
                {c.label}
              </div>
              <div style={{ fontSize: "clamp(8px,1.9vw,10px)", color: `rgba(${c.rgb},0.72)`, fontFamily: "monospace", marginTop: "2px", lineHeight: 1.3 }}>
                {c.sub}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const [panel, setPanel] = useState<Panel>(null);
  const { canPromptInstall, showInstallOption, isInstalled, isInstalling, isIos, install } = usePwaInstall();

  return (
    <div style={{
      height: "100dvh", width: "100%",
      overflow: "hidden",
      background: SCR_BG,
      position: "relative",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
    }}>
      <style>{GLOBAL_CSS}</style>

      {/* Star field */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {STARS.map((s, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: s.x, top: s.y,
              width: `${s.size}px`, height: `${s.size}px`,
              borderRadius: "50%",
              background: "#fff",
              ["--so" as any]: s.opacity,
              opacity: s.opacity,
              animation: `pb-twinkle ${2 + (i % 5)}s ease-in-out ${(i * 0.3) % 4}s infinite`,
            }}
          />
        ))}
      </div>

      {/* TV drop panel */}
      <TvPanel
        panel={panel}
        onClose={() => setPanel(null)}
        onChangePanel={setPanel}
        canPromptInstall={canPromptInstall}
        showInstallOption={showInstallOption}
        isInstalled={isInstalled}
        isInstalling={isInstalling}
        isIos={isIos}
        onInstall={install}
      />

      {/* Hero */}
      <Hero onSelect={setPanel} />
    </div>
  );
}
