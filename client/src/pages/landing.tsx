import { useState } from "react";
import { Link } from "wouter";
import { Zap, ScanLine, Globe } from "lucide-react";
import logoUrl from "@assets/PlanetBrick_dotcom_with_planet_and_robot_400_1760672362080.png";

type ChId = "home" | "features" | "pricing" | "live";

const CHANNELS: { id: ChId; num: string; label: string }[] = [
  { id: "home",     num: "01", label: "INTRO"    },
  { id: "features", num: "02", label: "FEATURES" },
  { id: "pricing",  num: "03", label: "PRICING"  },
  { id: "live",     num: "04", label: "ON AIR"   },
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

const FEATURES = [
  {
    Icon: Zap, color: "#FFD600", rgb: "255,214,0",
    title: "Price-o-Matic",
    desc: "AI monitors the market 24/7 and reprices your catalog automatically. Underpriced? Fixed. Overpriced? Corrected.",
  },
  {
    Icon: ScanLine, color: "#00FFEE", rgb: "0,255,238",
    title: "BrickSpotter",
    desc: "Point your camera at any LEGO piece. Our AI identifies it instantly across 130k+ parts — color, condition, value.",
  },
  {
    Icon: Globe, color: "#CC88FF", rgb: "204,136,255",
    title: "Multichannel Sync",
    desc: "BrickLink, BrickOwl and beyond — inventory and orders unified in one command center. No double-selling.",
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

const TEAL  = "#00FFEE";
const MGNT  = "#FF00CC";
const PURP  = "#A855F7";
const SCR_BG = "#04060F";

function HomeScreen({ tune }: { tune: (id: ChId) => void }) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: "clamp(18px,2.5vw,36px) clamp(22px,3vw,44px)", color: "#E8F4FF" }}>
      <img src={logoUrl} alt="PlanetBrick" style={{ height: "clamp(22px,2.8vw,34px)", width: "auto", objectFit: "contain", objectPosition: "left", marginBottom: "clamp(10px,1.8vw,18px)", opacity: 0.95 }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ fontSize: "clamp(8px,0.75vw,10px)", fontFamily: "monospace", color: TEAL, letterSpacing: "0.35em", marginBottom: "10px", textTransform: "uppercase" }}>
          ▸ Broadcasting from Orbit
        </div>
        <h1 style={{ fontSize: "clamp(22px,2.8vw,42px)", fontWeight: 900, lineHeight: 1.08, color: "#FFFFFF", margin: "0 0 clamp(10px,1.5vw,16px) 0" }}>
          Your LEGO business,<br />
          <span style={{ color: TEAL, textShadow: `0 0 20px ${TEAL}55` }}>on the air.</span>
        </h1>
        <p style={{ fontSize: "clamp(12px,1.1vw,15px)", color: "rgba(200,220,255,0.72)", maxWidth: "460px", lineHeight: 1.7, marginBottom: "clamp(14px,2vw,24px)" }}>
          AI-powered repricing, instant part identification, and multichannel sync —
          PlanetBrick runs your back office while you build.
        </p>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button onClick={() => tune("features")} style={{
            background: `linear-gradient(135deg, ${TEAL}CC, #00BBDD)`,
            border: "none", borderRadius: "100px",
            padding: "clamp(8px,1vw,12px) clamp(18px,2vw,28px)",
            cursor: "pointer", color: "#04060F", fontWeight: 800,
            fontSize: "clamp(11px,1.1vw,14px)", letterSpacing: "0.05em",
            boxShadow: `0 0 24px ${TEAL}55`,
          }}>
            See Features →
          </button>
          <Link href="/login">
            <button style={{
              background: "transparent",
              border: `1px solid ${TEAL}55`,
              borderRadius: "100px",
              padding: "clamp(8px,1vw,12px) clamp(18px,2vw,28px)",
              cursor: "pointer", color: "rgba(200,220,255,0.7)",
              fontSize: "clamp(11px,1.1vw,14px)",
            }}>Sign In</button>
          </Link>
        </div>
      </div>
      <div style={{ display: "flex", gap: "clamp(16px,3vw,36px)", borderTop: `1px solid ${TEAL}22`, paddingTop: "clamp(10px,1.5vw,14px)", flexWrap: "wrap" }}>
        {[["130k+", "Parts"], ["10×", "Faster"], ["24/7", "Pricing"], ["100%", "Synced"]].map(([v, l]) => (
          <div key={l}>
            <div style={{ fontSize: "clamp(14px,1.6vw,22px)", fontWeight: 900, color: TEAL, fontFamily: "monospace", textShadow: `0 0 12px ${TEAL}66` }}>{v}</div>
            <div style={{ fontSize: "clamp(7px,0.65vw,9px)", color: "rgba(180,210,255,0.4)", letterSpacing: "0.22em", textTransform: "uppercase" }}>{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeaturesScreen() {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: "clamp(14px,2vw,26px) clamp(18px,2.5vw,32px)", color: "#E8F4FF", gap: "clamp(10px,1.4vw,16px)" }}>
      <div>
        <div style={{ fontSize: "clamp(8px,0.7vw,10px)", fontFamily: "monospace", color: TEAL, letterSpacing: "0.3em", marginBottom: "5px" }}>CH 02 — FEATURES</div>
        <h2 style={{ fontSize: "clamp(16px,1.8vw,22px)", fontWeight: 900, color: "#FFF", margin: 0 }}>What PlanetBrick does for you</h2>
      </div>
      <div style={{ display: "flex", gap: "clamp(8px,1.2vw,14px)", flex: 1 }}>
        {FEATURES.map(f => (
          <div key={f.title} style={{
            flex: 1,
            background: `rgba(${f.rgb},0.05)`,
            border: `1px solid rgba(${f.rgb},0.25)`,
            borderRadius: "14px",
            padding: "clamp(12px,1.5vw,18px) clamp(10px,1.2vw,16px)",
            display: "flex", flexDirection: "column", gap: "clamp(7px,0.9vw,10px)",
            boxShadow: `0 0 20px rgba(${f.rgb},0.08) inset`,
          }}>
            <div style={{
              width: "clamp(28px,2.8vw,38px)", height: "clamp(28px,2.8vw,38px)", borderRadius: "50%",
              background: `rgba(${f.rgb},0.12)`, border: `1px solid rgba(${f.rgb},0.3)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: `0 0 14px rgba(${f.rgb},0.2)`,
            }}>
              <f.Icon size={15} color={f.color} />
            </div>
            <div style={{ fontSize: "clamp(12px,1.2vw,15px)", fontWeight: 700, color: "#FFF" }}>{f.title}</div>
            <div style={{ fontSize: "clamp(10px,0.95vw,13px)", color: "rgba(200,220,255,0.65)", lineHeight: 1.6 }}>{f.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PricingScreen({ tune }: { tune: (id: ChId) => void }) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: "clamp(12px,1.8vw,22px) clamp(14px,2vw,26px)", color: "#E8F4FF", gap: "clamp(8px,1.2vw,13px)", overflow: "hidden" }}>
      <div>
        <div style={{ fontSize: "clamp(8px,0.7vw,10px)", fontFamily: "monospace", color: TEAL, letterSpacing: "0.3em", marginBottom: "5px" }}>CH 03 — PRICING</div>
        <h2 style={{ fontSize: "clamp(16px,1.8vw,22px)", fontWeight: 900, color: "#FFF", margin: 0 }}>Simple, honest pricing</h2>
      </div>
      <div style={{ display: "flex", gap: "clamp(8px,1.2vw,12px)", flex: 1, overflow: "hidden" }}>
        {TIERS.map(t => (
          <div key={t.name} style={{
            flex: 1,
            background: t.highlight ? `rgba(0,255,238,0.06)` : "rgba(255,255,255,0.03)",
            border: `1px solid ${t.highlight ? "rgba(0,255,238,0.35)" : "rgba(200,220,255,0.1)"}`,
            borderRadius: "14px",
            padding: "clamp(10px,1.4vw,16px) clamp(10px,1.2vw,14px)",
            display: "flex", flexDirection: "column", gap: "clamp(5px,0.7vw,8px)",
            position: "relative",
            boxShadow: t.highlight ? `0 0 30px rgba(0,255,238,0.07) inset` : "none",
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
              <span style={{ fontSize: "clamp(10px,0.9vw,12px)", color: "rgba(200,220,255,0.38)" }}>{t.period}</span>
            </div>
            <div style={{ fontSize: "clamp(9px,0.82vw,11px)", color: "rgba(200,220,255,0.45)" }}>{t.description}</div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "clamp(3px,0.5vw,5px)", marginTop: "2px" }}>
              {t.features.map(f => (
                <div key={f} style={{ display: "flex", alignItems: "flex-start", gap: "5px", fontSize: "clamp(9px,0.88vw,11px)", color: "rgba(200,220,255,0.7)" }}>
                  <span style={{ color: TEAL, flexShrink: 0, fontSize: "9px", marginTop: "2px", textShadow: `0 0 8px ${TEAL}` }}>✦</span>
                  {f}
                </div>
              ))}
            </div>
            <Link href="/signup">
              <button style={{
                width: "100%", marginTop: "6px",
                background: t.highlight ? TEAL : "transparent",
                border: `1px solid ${t.highlight ? TEAL : "rgba(200,220,255,0.2)"}`,
                borderRadius: "100px", padding: "clamp(6px,0.8vw,10px)",
                color: t.highlight ? SCR_BG : "rgba(200,220,255,0.65)",
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

function LiveScreen() {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "clamp(24px,4vw,48px)", color: "#E8F4FF", textAlign: "center", gap: "clamp(12px,1.8vw,20px)" }}>
      <style>{`@keyframes pb-pulse { 0%,100%{opacity:1;box-shadow:0 0 16px ${MGNT},0 0 32px ${MGNT}44} 50%{opacity:0.5;box-shadow:0 0 4px ${MGNT}} } @keyframes pb-orbit { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
      <div style={{ position: "relative", width: "60px", height: "60px", marginBottom: "4px" }}>
        <div style={{ position: "absolute", inset: 0, border: `1px solid ${TEAL}44`, borderRadius: "50%", animation: "pb-orbit 4s linear infinite" }}>
          <div style={{ position: "absolute", top: "-4px", left: "50%", transform: "translateX(-50%)", width: "8px", height: "8px", borderRadius: "50%", background: TEAL, boxShadow: `0 0 10px ${TEAL}` }} />
        </div>
        <div style={{ position: "absolute", inset: "10px", border: `1px solid ${MGNT}33`, borderRadius: "50%", animation: "pb-orbit 2.5s linear infinite reverse" }}>
          <div style={{ position: "absolute", top: "-3px", left: "50%", transform: "translateX(-50%)", width: "6px", height: "6px", borderRadius: "50%", background: MGNT, boxShadow: `0 0 8px ${MGNT}`, animation: "pb-pulse 1.2s ease-in-out infinite" }} />
        </div>
        <div style={{ position: "absolute", inset: "22px", borderRadius: "50%", background: `radial-gradient(circle, ${TEAL}22, transparent)`, border: `1px solid ${TEAL}44` }} />
      </div>
      <div style={{ fontSize: "clamp(9px,0.9vw,12px)", fontFamily: "monospace", color: MGNT, letterSpacing: "0.3em", textShadow: `0 0 12px ${MGNT}` }}>⬤ ON AIR</div>
      <h2 style={{ fontSize: "clamp(20px,2.5vw,36px)", fontWeight: 900, color: "#FFFFFF", lineHeight: 1.2, margin: 0 }}>
        Ready to broadcast<br />your LEGO store?
      </h2>
      <p style={{ fontSize: "clamp(12px,1.1vw,15px)", color: "rgba(200,220,255,0.62)", maxWidth: "400px", lineHeight: 1.7, margin: 0 }}>
        Join PlanetBrick and get access to every tool — free during your trial.
        No credit card. No commitment.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%", maxWidth: "280px" }}>
        <Link href="/signup">
          <button style={{
            width: "100%",
            background: `linear-gradient(135deg, ${TEAL}DD, #00BBDD)`,
            border: "none", borderRadius: "100px",
            padding: "clamp(10px,1.2vw,14px) 24px", cursor: "pointer",
            color: SCR_BG, fontWeight: 800, fontSize: "clamp(13px,1.3vw,16px)",
            boxShadow: `0 0 28px ${TEAL}55`, letterSpacing: "0.03em",
          }}>Start Free Trial</button>
        </Link>
        <Link href="/login">
          <button style={{
            width: "100%", background: "transparent",
            border: `1px solid ${TEAL}33`, borderRadius: "100px",
            padding: "clamp(8px,1vw,12px)", cursor: "pointer",
            color: "rgba(200,220,255,0.6)", fontSize: "clamp(11px,1vw,14px)",
          }}>Sign In to Existing Account</button>
        </Link>
      </div>
      <div style={{ fontSize: "clamp(9px,0.8vw,11px)", color: "rgba(200,220,255,0.28)" }}>
        Full inventory access · No credit card required
      </div>
    </div>
  );
}

export default function Landing() {
  const [ch, setCh] = useState<ChId>("home");
  const [flash, setFlash] = useState(false);

  const tune = (next: ChId) => {
    if (next === ch || flash) return;
    setFlash(true);
    setTimeout(() => { setCh(next); setFlash(false); }, 200);
  };

  const activeCh = CHANNELS.find(c => c.id === ch)!;

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
      <style>{`
        @keyframes twinkle { 0%,100%{opacity:var(--so)} 50%{opacity:calc(var(--so)*0.4)} }
        @keyframes scanflash { 0%{opacity:0} 20%{opacity:0.9} 80%{opacity:0.85} 100%{opacity:0} }
      `}</style>

      {/* Star field */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none" }}>
        {STARS.map((s, i) => (
          <div key={i} style={{
            position: "absolute", left: s.x, top: s.y,
            width: s.size, height: s.size, borderRadius: "50%",
            background: "#fff",
            "--so": s.opacity,
            opacity: s.opacity,
            animation: `twinkle ${2 + (i % 5) * 0.6}s ease-in-out ${(i % 7) * 0.3}s infinite`,
          } as any} />
        ))}
      </div>

      {/* Background planet (partial) */}
      <div style={{
        position: "fixed", right: "-12vw", bottom: "-10vh",
        width: "45vw", height: "45vw", borderRadius: "50%",
        background: "radial-gradient(circle at 30% 30%, rgba(80,20,180,0.35), rgba(20,5,80,0.6) 60%, rgba(5,3,15,0.9))",
        border: "1px solid rgba(120,60,200,0.2)",
        boxShadow: "0 0 60px rgba(80,0,180,0.15) inset",
        pointerEvents: "none",
      }} />

      {/* Small distant planet */}
      <div style={{
        position: "fixed", left: "4vw", top: "10vh",
        width: "clamp(40px,6vw,80px)", height: "clamp(40px,6vw,80px)", borderRadius: "50%",
        background: "radial-gradient(circle at 35% 30%, rgba(0,220,200,0.4), rgba(0,100,120,0.6) 60%, rgba(0,40,60,0.9))",
        border: "1px solid rgba(0,200,180,0.2)",
        pointerEvents: "none",
      }} />

      {/* ── TV SET ── */}
      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", zIndex: 10 }}>

        {/* Antenna orbs */}
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
                background: `linear-gradient(to bottom, #D0E8FF 0%, #8899BB 100%)`,
                transform: `rotate(${deg}deg)`, transformOrigin: "bottom center",
                borderRadius: "2px 2px 0 0",
              }} />
            </div>
          ))}
        </div>

        {/* TV Body — white/chrome pod */}
        <div style={{
          position: "relative",
          width: "min(920px, 96vw)",
          background: "linear-gradient(165deg, #EEEEFF 0%, #D8DEFA 30%, #C0C8E0 70%, #A8B0CC 100%)",
          borderRadius: "clamp(20px,3vw,36px)",
          padding: "clamp(14px,2vw,22px) clamp(16px,2.2vw,26px) clamp(12px,1.8vw,18px)",
          display: "flex",
          flexDirection: "column",
          gap: "clamp(10px,1.4vw,16px)",
          boxShadow: `
            0 0 0 1px rgba(255,255,255,0.6) inset,
            0 0 0 2px rgba(180,190,220,0.4) inset,
            0 20px 60px rgba(0,0,0,0.7),
            0 0 80px ${TEAL}18,
            0 0 140px ${TEAL}08
          `,
        }}>

          {/* Top chrome strip */}
          <div style={{
            position: "absolute", top: 0, left: "8%", right: "8%", height: "1px",
            background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent)",
            pointerEvents: "none",
          }} />

          {/* Screen + right controls row */}
          <div style={{ display: "flex", gap: "clamp(10px,1.5vw,18px)" }}>

            {/* Screen */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Chrome ring bezel */}
              <div style={{
                background: "linear-gradient(145deg, #CCC 0%, #EEE 25%, #BBB 55%, #DDD 80%, #AAA 100%)",
                borderRadius: "clamp(10px,1.6vw,20px)",
                padding: "clamp(5px,0.7vw,8px)",
                boxShadow: "inset 0 3px 8px rgba(0,0,0,0.5), 0 2px 6px rgba(0,0,0,0.4)",
              }}>
                <div style={{
                  background: SCR_BG,
                  borderRadius: "clamp(7px,1.1vw,14px)",
                  overflow: "hidden",
                  position: "relative",
                  height: "clamp(290px,38vh,460px)",
                }}>
                  {/* Scanlines */}
                  <div style={{
                    position: "absolute", inset: 0, zIndex: 15, pointerEvents: "none",
                    backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 2px, rgba(0,0,0,0.2) 2px, rgba(0,0,0,0.2) 4px)",
                  }} />
                  {/* Teal phosphor glow */}
                  <div style={{
                    position: "absolute", inset: 0, zIndex: 14, pointerEvents: "none",
                    background: `radial-gradient(ellipse 75% 60% at 50% 40%, ${TEAL}0C 0%, transparent 70%)`,
                  }} />
                  {/* Glass reflection */}
                  <div style={{
                    position: "absolute", top: 0, left: 0, right: 0, height: "25%", zIndex: 16, pointerEvents: "none",
                    background: "linear-gradient(to bottom, rgba(255,255,255,0.04), transparent)",
                    borderRadius: "14px 14px 0 0",
                  }} />
                  {/* Channel flash static */}
                  {flash && (
                    <div style={{
                      position: "absolute", inset: 0, zIndex: 20,
                      backgroundImage: `
                        repeating-linear-gradient(0deg, ${TEAL}22 0px, transparent 1px, rgba(0,0,0,0.5) 3px, rgba(255,255,255,0.15) 5px),
                        repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0px, transparent 2px)
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
                    {ch === "home"     && <HomeScreen tune={tune} />}
                    {ch === "features" && <FeaturesScreen />}
                    {ch === "pricing"  && <PricingScreen tune={tune} />}
                    {ch === "live"     && <LiveScreen />}
                  </div>
                </div>
              </div>
            </div>

            {/* Right side — channel dial panel */}
            <div style={{
              width: "clamp(70px,8vw,100px)", flexShrink: 0,
              display: "flex", flexDirection: "column", gap: "clamp(6px,0.9vw,10px)",
              paddingTop: "2px",
            }}>
              {/* Channel LED display */}
              <div style={{
                background: "#0A0A18",
                border: `1px solid ${TEAL}44`,
                borderRadius: "10px", padding: "clamp(6px,0.9vw,10px) 4px",
                textAlign: "center", fontFamily: "monospace",
                color: TEAL, fontSize: "clamp(18px,2.2vw,26px)", fontWeight: 900, lineHeight: 1,
                boxShadow: `0 0 14px ${TEAL}22, inset 0 0 14px rgba(0,0,0,0.9)`,
                textShadow: `0 0 10px ${TEAL}`,
              }}>
                {activeCh.num}
                <div style={{ fontSize: "clamp(6px,0.6vw,8px)", letterSpacing: "0.2em", color: `${TEAL}88`, marginTop: "3px" }}>CH</div>
              </div>

              {/* Channel buttons */}
              {CHANNELS.map(c => {
                const isActive = ch === c.id;
                return (
                  <button key={c.id} onClick={() => tune(c.id)} style={{
                    background: isActive ? `${TEAL}22` : "rgba(10,10,30,0.6)",
                    border: `1px solid ${isActive ? TEAL : "rgba(150,170,220,0.15)"}`,
                    borderRadius: "8px",
                    padding: "clamp(5px,0.7vw,8px) 4px",
                    cursor: "pointer",
                    color: isActive ? TEAL : "rgba(150,180,220,0.45)",
                    fontSize: "clamp(7px,0.7vw,9px)", fontFamily: "monospace",
                    letterSpacing: "0.1em", fontWeight: 700,
                    transition: "all 0.15s",
                    boxShadow: isActive ? `0 0 14px ${TEAL}44, inset 0 0 8px ${TEAL}11` : "none",
                    textAlign: "center", lineHeight: 1.4,
                    textShadow: isActive ? `0 0 8px ${TEAL}` : "none",
                  }}>
                    <div style={{ fontSize: "clamp(9px,1vw,13px)" }}>{c.num}</div>
                    <div style={{ fontSize: "clamp(6px,0.58vw,7px)", opacity: 0.75, marginTop: "1px" }}>{c.label}</div>
                  </button>
                );
              })}

              {/* Decorative orb dial */}
              <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "8px", alignItems: "center" }}>
                {([
                  { label: "PWR", color: TEAL },
                  { label: "HUE", color: PURP },
                ] as const).map((k) => (
                  <div key={k.label} style={{ textAlign: "center" }}>
                    <div style={{
                      width: "clamp(24px,2.8vw,34px)", height: "clamp(24px,2.8vw,34px)", borderRadius: "50%",
                      background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.3), rgba(10,10,40,0.9))`,
                      border: `1px solid ${k.color}55`,
                      boxShadow: `0 0 10px ${k.color}33, inset 0 0 6px rgba(0,0,0,0.8)`,
                      margin: "0 auto", position: "relative", cursor: "default",
                    }}>
                      <div style={{
                        position: "absolute", width: "2px", height: "36%",
                        background: k.color, top: "14%", left: "50%",
                        transform: "translateX(-50%)",
                        transformOrigin: "bottom center",
                        borderRadius: "1px",
                        boxShadow: `0 0 6px ${k.color}`,
                      }} />
                    </div>
                    <div style={{ fontSize: "clamp(5px,0.5vw,7px)", fontFamily: "monospace", color: `${k.color}55`, letterSpacing: "0.12em", marginTop: "3px" }}>{k.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Bottom strip — brand + signal bars */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: "clamp(4px,0.6vw,8px)", borderTop: "1px solid rgba(160,180,220,0.2)" }}>
            <div style={{ fontSize: "clamp(8px,0.65vw,10px)", fontFamily: "monospace", color: "rgba(100,120,180,0.5)", letterSpacing: "0.3em", textTransform: "uppercase" }}>
              PlanetBrick ◆ LEGO Commerce System
            </div>
            {/* Signal / decorative bars */}
            <div style={{ display: "flex", gap: "3px", alignItems: "flex-end" }}>
              {[4, 6, 8, 10, 12].map((h, i) => (
                <div key={i} style={{
                  width: "clamp(3px,0.4vw,5px)", height: `${h}px`,
                  background: i < 4 ? `${TEAL}CC` : `rgba(150,170,220,0.2)`,
                  borderRadius: "1px",
                  boxShadow: i < 4 ? `0 0 4px ${TEAL}66` : "none",
                }} />
              ))}
            </div>
          </div>
        </div>

        {/* Neck — thin chrome column */}
        <div style={{
          width: "clamp(28px,3.5vw,48px)", height: "clamp(32px,5vh,60px)",
          background: "linear-gradient(to bottom, #C8D0E8, #8890A8, #707890)",
          margin: "0 auto", marginTop: "-1px",
          clipPath: "polygon(25% 0%, 75% 0%, 85% 100%, 15% 100%)",
          boxShadow: `0 4px 12px rgba(0,0,0,0.4)`,
          position: "relative", zIndex: 2,
        }} />

        {/* Saucer base */}
        <div style={{
          width: "min(620px, 66vw)",
          height: "clamp(28px,4.5vh,52px)",
          background: "linear-gradient(170deg, #D8E0F0 0%, #B0B8D0 40%, #8890A8 100%)",
          borderRadius: "50%",
          marginTop: "-4px",
          boxShadow: `
            0 0 0 1px rgba(255,255,255,0.4) inset,
            0 8px 24px rgba(0,0,0,0.6),
            0 0 40px ${TEAL}0A
          `,
          position: "relative",
        }}>
          {/* Saucer highlight ring */}
          <div style={{
            position: "absolute", top: "15%", left: "10%", right: "10%", height: "1px",
            background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.7), transparent)",
          }} />
          {/* Saucer teal underline glow */}
          <div style={{
            position: "absolute", bottom: "-4px", left: "20%", right: "20%", height: "4px",
            background: `${TEAL}33`,
            borderRadius: "50%",
            filter: "blur(4px)",
          }} />
        </div>

        {/* Floor glow */}
        <div style={{
          width: "min(400px, 44vw)", height: "clamp(8px,1.5vh,16px)",
          background: `radial-gradient(ellipse, ${TEAL}18 0%, transparent 70%)`,
          marginTop: "2px", filter: "blur(4px)",
        }} />
      </div>
    </div>
  );
}
