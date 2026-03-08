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
    Icon: Zap, color: "#FFB300", rgb: "255,179,0",
    title: "Price-o-Matic",
    desc: "AI monitors the market 24/7 and reprices your entire catalog automatically. Underpriced? Fixed. Overpriced? Corrected.",
  },
  {
    Icon: ScanLine, color: "#00CED1", rgb: "0,206,209",
    title: "BrickSpotter",
    desc: "Point your camera at any LEGO piece. Our AI identifies it instantly across 130k+ parts — condition, color, current value.",
  },
  {
    Icon: Globe, color: "#A78BFA", rgb: "167,139,250",
    title: "Multichannel Sync",
    desc: "BrickLink, BrickOwl and beyond — inventory and orders unified in one command center. No double-selling, ever.",
  },
];

const tv = {
  body: "linear-gradient(150deg, #4A2B0E 0%, #2C1605 45%, #3D2208 100%)",
  bodyClip: "polygon(8% 0%, 96% 1%, 100% 8%, 99% 92%, 92% 100%, 6% 100%, 0% 92%, 1% 7%)",
  chrome: "linear-gradient(145deg, #999 0%, #ddd 30%, #aaa 55%, #ccc 80%, #888 100%)",
  knobFace: "radial-gradient(circle at 35% 30%, #6A4400, #2A1A00)",
  legColor: "linear-gradient(to bottom, #3A2208, #1A0A02)",
};

function Scanlines() {
  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 15, pointerEvents: "none",
      backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 2px, rgba(0,0,0,0.28) 2px, rgba(0,0,0,0.28) 4px)",
    }} />
  );
}

function ScreenGlow() {
  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 14, pointerEvents: "none",
      background: "radial-gradient(ellipse 80% 65% at 50% 40%, rgba(20,80,200,0.13) 0%, transparent 70%)",
    }} />
  );
}

function Reflection() {
  return (
    <div style={{
      position: "absolute", top: 0, left: 0, right: 0, height: "28%", zIndex: 16, pointerEvents: "none",
      background: "linear-gradient(to bottom, rgba(255,255,255,0.04), transparent)",
      borderRadius: "8px 8px 0 0",
    }} />
  );
}

function HomeScreen({ tune }: { tune: (id: ChId) => void }) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: "clamp(20px,3vw,40px) clamp(24px,4vw,48px)", color: "#E8DCC8" }}>
      <img src={logoUrl} alt="PlanetBrick" style={{ height: "clamp(24px,3vw,36px)", width: "auto", objectFit: "contain", objectPosition: "left", marginBottom: "clamp(12px,2vw,20px)", opacity: 0.92 }} />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ fontSize: "clamp(8px,0.8vw,11px)", fontFamily: "monospace", color: "#FF8C00", letterSpacing: "0.3em", marginBottom: "10px" }}>
          ◆ BROADCASTING LIVE FROM THE FUTURE ◆
        </div>
        <h1 style={{ fontSize: "clamp(22px,2.8vw,42px)", fontWeight: 900, lineHeight: 1.1, color: "#F5E8D0", marginBottom: "clamp(10px,1.5vw,18px)", margin: "0 0 clamp(10px,1.5vw,18px) 0" }}>
          Your LEGO business,<br />
          <span style={{ color: "#00CED1" }}>on the air.</span>
        </h1>
        <p style={{ fontSize: "clamp(12px,1.2vw,15px)", color: "rgba(232,220,200,0.68)", maxWidth: "480px", lineHeight: 1.65, marginBottom: "clamp(16px,2.5vw,28px)" }}>
          From AI-powered repricing to instant part identification and multichannel sync —
          PlanetBrick runs your back office while you build.
        </p>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button
            onClick={() => tune("features")}
            style={{
              background: "linear-gradient(135deg, #C85000, #FF6A00)",
              border: "none", borderRadius: "6px",
              padding: "clamp(8px,1vw,12px) clamp(16px,2vw,24px)",
              cursor: "pointer", color: "#fff", fontWeight: 700,
              fontSize: "clamp(11px,1.1vw,14px)", letterSpacing: "0.05em",
              boxShadow: "0 0 20px rgba(255,100,0,0.3)",
            }}
          >
            See Features →
          </button>
          <Link href="/login">
            <button style={{
              background: "transparent",
              border: "1px solid rgba(232,220,200,0.28)",
              borderRadius: "6px",
              padding: "clamp(8px,1vw,12px) clamp(16px,2vw,24px)",
              cursor: "pointer", color: "rgba(232,220,200,0.65)",
              fontSize: "clamp(11px,1.1vw,14px)",
            }}>
              Sign In
            </button>
          </Link>
        </div>
      </div>

      <div style={{ display: "flex", gap: "clamp(16px,3vw,36px)", borderTop: "1px solid rgba(232,220,200,0.1)", paddingTop: "clamp(10px,1.5vw,16px)", flexWrap: "wrap" }}>
        {[["130k+", "Parts"], ["10×", "Faster"], ["24/7", "Pricing"], ["100%", "Synced"]].map(([v, l]) => (
          <div key={l}>
            <div style={{ fontSize: "clamp(14px,1.6vw,22px)", fontWeight: 900, color: "#00CED1", fontFamily: "monospace" }}>{v}</div>
            <div style={{ fontSize: "clamp(7px,0.7vw,10px)", color: "rgba(232,220,200,0.38)", letterSpacing: "0.2em", textTransform: "uppercase" }}>{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeaturesScreen() {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: "clamp(16px,2.5vw,28px) clamp(20px,3vw,34px)", color: "#E8DCC8", gap: "clamp(10px,1.5vw,16px)" }}>
      <div>
        <div style={{ fontSize: "clamp(8px,0.7vw,10px)", fontFamily: "monospace", color: "#FF8C00", letterSpacing: "0.3em", marginBottom: "6px" }}>CH 02 — FEATURES</div>
        <h2 style={{ fontSize: "clamp(16px,1.8vw,22px)", fontWeight: 900, color: "#F5E8D0", margin: 0 }}>What PlanetBrick does for you</h2>
      </div>
      <div style={{ display: "flex", gap: "clamp(8px,1.2vw,14px)", flex: 1 }}>
        {FEATURES.map(f => (
          <div key={f.title} style={{
            flex: 1,
            background: "rgba(255,255,255,0.04)",
            border: `1px solid rgba(${f.rgb},0.22)`,
            borderRadius: "10px",
            padding: "clamp(12px,1.5vw,18px) clamp(10px,1.3vw,16px)",
            display: "flex", flexDirection: "column", gap: "clamp(6px,0.8vw,10px)",
          }}>
            <div style={{
              width: "clamp(28px,2.8vw,36px)", height: "clamp(28px,2.8vw,36px)", borderRadius: "8px",
              background: `rgba(${f.rgb},0.14)`, border: `1px solid rgba(${f.rgb},0.28)`,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <f.Icon size={16} color={f.color} />
            </div>
            <div style={{ fontSize: "clamp(12px,1.2vw,15px)", fontWeight: 700, color: "#F5E8D0" }}>{f.title}</div>
            <div style={{ fontSize: "clamp(10px,1vw,13px)", color: "rgba(232,220,200,0.62)", lineHeight: 1.55 }}>{f.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PricingScreen({ tune }: { tune: (id: ChId) => void }) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", padding: "clamp(14px,2vw,24px) clamp(16px,2.5vw,28px)", color: "#E8DCC8", gap: "clamp(8px,1.2vw,14px)", overflow: "hidden" }}>
      <div>
        <div style={{ fontSize: "clamp(8px,0.7vw,10px)", fontFamily: "monospace", color: "#FF8C00", letterSpacing: "0.3em", marginBottom: "6px" }}>CH 03 — PRICING</div>
        <h2 style={{ fontSize: "clamp(16px,1.8vw,22px)", fontWeight: 900, color: "#F5E8D0", margin: 0 }}>Simple, honest pricing</h2>
      </div>
      <div style={{ display: "flex", gap: "clamp(8px,1.2vw,12px)", flex: 1, overflow: "hidden" }}>
        {TIERS.map(t => (
          <div key={t.name} style={{
            flex: 1,
            background: t.highlight ? "rgba(0,206,209,0.08)" : "rgba(255,255,255,0.03)",
            border: `1px solid ${t.highlight ? "rgba(0,206,209,0.35)" : "rgba(232,220,200,0.1)"}`,
            borderRadius: "10px",
            padding: "clamp(10px,1.4vw,16px) clamp(10px,1.2vw,14px)",
            display: "flex", flexDirection: "column", gap: "clamp(5px,0.7vw,8px)",
            position: "relative",
          }}>
            {t.highlight && (
              <div style={{
                position: "absolute", top: "-1px", left: "50%", transform: "translateX(-50%)",
                background: "#00CED1", color: "#050A14", fontSize: "clamp(7px,0.6vw,9px)",
                fontWeight: 800, padding: "2px 10px", borderRadius: "0 0 6px 6px",
                letterSpacing: "0.2em", textTransform: "uppercase",
              }}>POPULAR</div>
            )}
            <div style={{ fontSize: "clamp(12px,1.1vw,14px)", fontWeight: 700, color: "#F5E8D0" }}>{t.name}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "2px" }}>
              <span style={{ fontSize: "clamp(20px,2.2vw,28px)", fontWeight: 900, color: t.highlight ? "#00CED1" : "#F5E8D0", fontFamily: "monospace" }}>{t.price}</span>
              <span style={{ fontSize: "clamp(10px,0.9vw,12px)", color: "rgba(232,220,200,0.38)" }}>{t.period}</span>
            </div>
            <div style={{ fontSize: "clamp(9px,0.85vw,11px)", color: "rgba(232,220,200,0.48)" }}>{t.description}</div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "clamp(3px,0.5vw,5px)", marginTop: "2px" }}>
              {t.features.map(f => (
                <div key={f} style={{ display: "flex", alignItems: "flex-start", gap: "5px", fontSize: "clamp(9px,0.9vw,11px)", color: "rgba(232,220,200,0.68)" }}>
                  <span style={{ color: "#00CED1", fontSize: "9px", marginTop: "2px", flexShrink: 0 }}>✓</span>
                  {f}
                </div>
              ))}
            </div>
            <Link href="/signup">
              <button style={{
                width: "100%", marginTop: "6px",
                background: t.highlight ? "#00CED1" : "transparent",
                border: `1px solid ${t.highlight ? "#00CED1" : "rgba(232,220,200,0.22)"}`,
                borderRadius: "6px", padding: "clamp(6px,0.8vw,9px)",
                color: t.highlight ? "#050A14" : "rgba(232,220,200,0.65)",
                fontSize: "clamp(10px,0.95vw,12px)", fontWeight: 700, cursor: "pointer",
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
    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "clamp(24px,4vw,48px)", color: "#E8DCC8", textAlign: "center", gap: "clamp(12px,1.8vw,20px)" }}>
      <style>{`@keyframes pb-pulse { 0%,100%{opacity:1;box-shadow:0 0 12px #FF3030} 50%{opacity:0.5;box-shadow:0 0 4px #FF3030} }`}</style>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#FF3030", animation: "pb-pulse 1.2s ease-in-out infinite" }} />
        <span style={{ fontSize: "clamp(9px,0.9vw,12px)", fontFamily: "monospace", color: "#FF8C00", letterSpacing: "0.3em" }}>ON AIR</span>
      </div>
      <h2 style={{ fontSize: "clamp(20px,2.5vw,36px)", fontWeight: 900, color: "#F5E8D0", lineHeight: 1.2, margin: 0 }}>
        Ready to broadcast<br />your LEGO store?
      </h2>
      <p style={{ fontSize: "clamp(12px,1.1vw,15px)", color: "rgba(232,220,200,0.62)", maxWidth: "420px", lineHeight: 1.65, margin: 0 }}>
        Join PlanetBrick and get access to every tool — free during your trial.
        No credit card. No commitment.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%", maxWidth: "280px" }}>
        <Link href="/signup">
          <button style={{
            width: "100%",
            background: "linear-gradient(135deg, #C85000, #FF6A00)",
            border: "none", borderRadius: "8px",
            padding: "clamp(10px,1.2vw,14px) 24px", cursor: "pointer",
            color: "#fff", fontWeight: 800, fontSize: "clamp(13px,1.3vw,16px)",
            boxShadow: "0 0 24px rgba(255,100,0,0.35)", letterSpacing: "0.03em",
          }}>
            Start Free Trial
          </button>
        </Link>
        <Link href="/login">
          <button style={{
            width: "100%", background: "transparent",
            border: "1px solid rgba(232,220,200,0.2)", borderRadius: "8px",
            padding: "clamp(8px,1vw,12px)", cursor: "pointer",
            color: "rgba(232,220,200,0.58)", fontSize: "clamp(11px,1vw,14px)",
          }}>
            Sign In to Existing Account
          </button>
        </Link>
      </div>
      <div style={{ fontSize: "clamp(9px,0.8vw,11px)", color: "rgba(232,220,200,0.28)", marginTop: "4px" }}>
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
    setTimeout(() => { setCh(next); setFlash(false); }, 220);
  };

  const active = CHANNELS.find(c => c.id === ch)!;

  return (
    <div style={{
      minHeight: "100vh", maxHeight: "100vh", overflow: "hidden",
      background: "#C4A87A",
      backgroundImage: `
        radial-gradient(ellipse 900px 700px at 12% 50%, rgba(210,155,0,0.18) 0%, transparent 55%),
        radial-gradient(ellipse 700px 500px at 88% 50%, rgba(0,150,170,0.14) 0%, transparent 55%)
      `,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "system-ui, sans-serif",
      position: "relative",
    }}>

      {/* Atomic age decorations */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        {/* Left atomic circles */}
        {[200, 140, 80].map((r, i) => (
          <div key={`lc${i}`} style={{
            position: "absolute", left: "7%", top: "22%",
            width: r * 2, height: r * 2, borderRadius: "50%",
            border: "1px solid rgba(90,50,0,0.13)",
            transform: "translate(-50%,-50%)",
          }} />
        ))}
        {/* Left starburst */}
        {Array.from({ length: 10 }, (_, i) => (
          <div key={`ls${i}`} style={{
            position: "absolute", left: "7%", top: "22%",
            width: "180px", height: "1px",
            background: "rgba(90,50,0,0.07)",
            transformOrigin: "0 50%",
            transform: `rotate(${i * 18}deg)`,
          }} />
        ))}
        {/* Right atomic circles */}
        {[240, 170, 100].map((r, i) => (
          <div key={`rc${i}`} style={{
            position: "absolute", right: "7%", bottom: "22%",
            width: r * 2, height: r * 2, borderRadius: "50%",
            border: "1px solid rgba(0,100,120,0.1)",
            transform: "translate(50%,50%)",
          }} />
        ))}
        {/* Right starburst */}
        {Array.from({ length: 10 }, (_, i) => (
          <div key={`rs${i}`} style={{
            position: "absolute", right: "7%", bottom: "22%",
            width: "200px", height: "1px",
            background: "rgba(0,100,120,0.06)",
            transformOrigin: "100% 50%",
            transform: `rotate(${i * 18}deg)`,
          }} />
        ))}
      </div>

      {/* ── TV SET ── */}
      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center" }}>

        {/* Antennas */}
        <div style={{ display: "flex", width: "60%", justifyContent: "space-between", paddingLeft: "25%", paddingRight: "25%", position: "relative", zIndex: 2, marginBottom: "-3px" }}>
          {([-18, 18] as const).map((deg, i) => (
            <div key={i} style={{
              width: "clamp(3px,0.4vw,5px)", height: "clamp(40px,6vh,70px)",
              background: "linear-gradient(to bottom, #AAA 0%, #666 100%)",
              transform: `rotate(${deg}deg)`, transformOrigin: "bottom center",
              borderRadius: "3px 3px 0 0",
              boxShadow: "0 0 6px rgba(0,0,0,0.25)",
            }} />
          ))}
        </div>

        {/* TV Body */}
        <div style={{
          position: "relative",
          width: "min(940px, 96vw)",
          background: tv.body,
          clipPath: tv.bodyClip,
          padding: "clamp(16px,2.5vw,30px)",
          display: "flex",
          flexDirection: "row",
          gap: "clamp(10px,1.5vw,20px)",
          alignItems: "stretch",
          filter: "drop-shadow(0 28px 56px rgba(0,0,0,0.55)) drop-shadow(0 6px 12px rgba(0,0,0,0.38))",
        }}>

          {/* Wood grain */}
          <div style={{
            position: "absolute", inset: 0, pointerEvents: "none",
            clipPath: tv.bodyClip,
            backgroundImage: "repeating-linear-gradient(82deg, transparent, transparent 4px, rgba(0,0,0,0.035) 4px, rgba(0,0,0,0.035) 5px)",
          }} />

          {/* Top highlight edge */}
          <div style={{
            position: "absolute", top: 0, left: "8%", right: "8%", height: "1px",
            background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)",
            pointerEvents: "none",
          }} />

          {/* ── Screen section ── */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "clamp(6px,1vw,10px)", minWidth: 0 }}>

            {/* Chrome bezel */}
            <div style={{
              background: tv.chrome,
              borderRadius: "clamp(8px,1.2vw,14px)",
              padding: "clamp(4px,0.7vw,8px)",
              boxShadow: "inset 0 3px 8px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.35)",
              flex: 1,
              display: "flex",
              flexDirection: "column",
            }}>
              {/* CRT screen */}
              <div style={{
                background: "#04090F",
                borderRadius: "clamp(5px,0.8vw,9px)",
                overflow: "hidden",
                position: "relative",
                flex: 1,
                minHeight: "clamp(300px,42vh,480px)",
              }}>
                <Scanlines />
                <ScreenGlow />
                <Reflection />

                {/* Channel-change static */}
                {flash && (
                  <div style={{
                    position: "absolute", inset: 0, zIndex: 20,
                    background: "repeating-linear-gradient(0deg, rgba(255,255,255,0.6) 0px, rgba(255,255,255,0) 1px, rgba(0,0,0,0.4) 3px, rgba(255,255,255,0.3) 5px)",
                    opacity: 0.85,
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

            {/* Brandplate under screen */}
            <div style={{
              textAlign: "center", color: "rgba(255,175,55,0.42)",
              fontSize: "clamp(8px,0.65vw,10px)", letterSpacing: "0.38em",
              textTransform: "uppercase", fontFamily: "monospace",
            }}>
              PlanetBrick ◆ Professional LEGO Commerce
            </div>
          </div>

          {/* ── Controls panel (right) ── */}
          <div style={{ width: "clamp(80px,9vw,112px)", display: "flex", flexDirection: "column", gap: "clamp(8px,1vw,12px)", paddingTop: "4px", flexShrink: 0 }}>

            {/* Channel number LED display */}
            <div style={{
              background: "#000",
              border: "2px solid #2A1400",
              borderRadius: "6px",
              padding: "clamp(6px,0.9vw,10px) 6px",
              textAlign: "center",
              fontFamily: "monospace",
              color: "#FF8C00",
              fontSize: "clamp(18px,2.2vw,26px)",
              fontWeight: 900,
              lineHeight: 1,
              boxShadow: "0 0 14px rgba(255,140,0,0.22), inset 0 0 14px rgba(0,0,0,0.9)",
              textShadow: "0 0 10px rgba(255,140,0,0.85)",
            }}>
              {active.num}
              <div style={{ fontSize: "clamp(6px,0.6vw,8px)", letterSpacing: "0.2em", color: "rgba(255,140,0,0.55)", marginTop: "3px" }}>CH</div>
            </div>

            {/* Channel selector buttons */}
            <div style={{ display: "flex", flexDirection: "column", gap: "clamp(3px,0.5vw,5px)" }}>
              {CHANNELS.map(c => {
                const isActive = ch === c.id;
                return (
                  <button key={c.id} onClick={() => tune(c.id)} style={{
                    background: isActive
                      ? "linear-gradient(135deg, #B84800, #FF6000)"
                      : "linear-gradient(135deg, #1C0900, #2E1200)",
                    border: `1px solid ${isActive ? "rgba(255,110,0,0.7)" : "rgba(80,30,0,0.55)"}`,
                    borderRadius: "4px",
                    padding: "clamp(5px,0.7vw,8px) clamp(4px,0.5vw,6px)",
                    cursor: "pointer",
                    color: isActive ? "#FFF" : "rgba(255,110,0,0.4)",
                    fontSize: "clamp(7px,0.7vw,9px)", fontFamily: "monospace",
                    letterSpacing: "0.1em", fontWeight: 700,
                    transition: "all 0.12s",
                    boxShadow: isActive ? "0 0 14px rgba(255,90,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08)" : "none",
                    textAlign: "center", lineHeight: 1.4,
                  }}>
                    <div style={{ fontSize: "clamp(9px,0.9vw,12px)" }}>{c.num}</div>
                    <div style={{ fontSize: "clamp(6px,0.6vw,7px)", opacity: 0.75, marginTop: "1px" }}>{c.label}</div>
                  </button>
                );
              })}
            </div>

            {/* Separator */}
            <div style={{ borderTop: "1px solid rgba(255,170,50,0.1)" }} />

            {/* Decorative knobs */}
            <div style={{ display: "flex", flexDirection: "column", gap: "clamp(8px,1.1vw,14px)", alignItems: "center" }}>
              {([
                { label: "BRIGHT", rot: -35 },
                { label: "VOLUME", rot:  50 },
                { label: "UHF",    rot:  15, sm: true },
              ] as const).map((k) => (
                <div key={k.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "3px" }}>
                  <div style={{
                    width: k.sm ? "clamp(20px,2.2vw,28px)" : "clamp(26px,2.8vw,36px)",
                    height: k.sm ? "clamp(20px,2.2vw,28px)" : "clamp(26px,2.8vw,36px)",
                    borderRadius: "50%", background: tv.knobFace,
                    border: "2px solid #3A2400",
                    boxShadow: "0 4px 8px rgba(0,0,0,0.7), inset 0 1px 2px rgba(255,255,255,0.07)",
                    position: "relative", cursor: "default",
                  }}>
                    <div style={{
                      position: "absolute", width: "2px", height: "38%",
                      background: "#C8A030", top: "14%", left: "50%",
                      transform: `translateX(-50%) rotate(${k.rot}deg)`,
                      transformOrigin: "bottom center", borderRadius: "1px",
                    }} />
                  </div>
                  <div style={{ fontSize: "clamp(5px,0.55vw,7px)", fontFamily: "monospace", color: "rgba(255,175,55,0.32)", letterSpacing: "0.1em" }}>
                    {k.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Legs */}
        <div style={{
          display: "flex", justifyContent: "space-between",
          width: "min(700px,74vw)", marginTop: "-2px",
          paddingLeft: "clamp(20px,3vw,40px)", paddingRight: "clamp(20px,3vw,40px)",
        }}>
          {([true, false] as const).map((left) => (
            <div key={String(left)} style={{
              width: "clamp(28px,4vw,48px)", height: "clamp(40px,7vh,72px)",
              background: tv.legColor,
              clipPath: left
                ? "polygon(12% 0%, 88% 0%, 100% 100%, 0% 100%)"
                : "polygon(12% 0%, 88% 0%, 100% 100%, 0% 100%)",
              transform: `skewX(${left ? "6deg" : "-6deg"})`,
            }} />
          ))}
        </div>

        {/* Foot rail */}
        <div style={{
          width: "min(740px,78vw)", height: "clamp(6px,0.8vh,10px)",
          background: "linear-gradient(to bottom, #1E0E03, #120902)",
          borderRadius: "0 0 6px 6px", marginTop: "-2px",
        }} />
      </div>
    </div>
  );
}
