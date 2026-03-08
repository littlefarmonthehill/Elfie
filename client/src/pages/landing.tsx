import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Zap, Package, Warehouse, RefreshCw, Check, ArrowRight,
  Star, TrendingUp, Scan, BarChart3, ShieldCheck, Globe,
} from "lucide-react";
import logoUrl from "@assets/PlanetBrick_dotcom_with_planet_and_robot_400_1760672362080.png";
import elfieUrl from "@assets/PlanetBrick_good_robot_1760672362080.png";

const features = [
  {
    icon: Zap,
    color: "purple",
    badge: "Price-o-Matic",
    title: "Stop leaving money on the table",
    description:
      "Our AI pricing engine monitors market conditions around the clock and automatically adjusts your prices. Underpriced items get flagged. Overpriced items get fixed. You collect the profit.",
    bullets: ["Real-time market comparison", "Floor price protection", "One-click bulk repricing"],
  },
  {
    icon: Scan,
    color: "amber",
    badge: "BrickSpotter AI",
    title: "Scan parts. Build inventory. In minutes.",
    description:
      "Point your phone at any pile of LEGO and E.L.F.I.E. identifies every piece — part number, color, condition, and current market value. No more manual lookup. No more guessing.",
    bullets: ["Identify 130k+ BrickLink parts", "Instant condition grading", "Auto-adds to inventory"],
  },
  {
    icon: Warehouse,
    color: "teal",
    badge: "Warehouse Manager",
    title: "Know where every piece lives",
    description:
      "Organize your stockroom into aisles, shelves, and bins. Assign inventory to exact locations so any team member can pull, pack, and ship without confusion — even at 10,000+ lots.",
    bullets: ["Aisle → Shelf → Bin hierarchy", "Unassigned item alerts", "Print bin labels"],
  },
  {
    icon: RefreshCw,
    color: "green",
    badge: "List-O-Matic",
    title: "One listing. Every marketplace.",
    description:
      "Push your inventory to BrickLink and other platforms simultaneously. When a piece sells on one channel, stock levels update everywhere else in real time. Overselling becomes a thing of the past.",
    bullets: ["Multi-channel sync", "Real-time stock updates", "Unified order management"],
  },
];

const tiers = [
  {
    name: "Trial",
    price: "Free",
    period: "",
    description: "Kick the tires. No card required.",
    highlight: false,
    features: ["Up to 500 inventory lots", "BrickSpotter (25 scans/mo)", "Basic pricing tools", "Single marketplace"],
  },
  {
    name: "Foundation",
    price: "$29",
    period: "/mo",
    description: "For solo sellers ready to get serious.",
    highlight: false,
    features: ["Up to 5,000 lots", "BrickSpotter (250 scans/mo)", "Price-o-Matic automation", "BrickLink sync", "Warehouse manager"],
  },
  {
    name: "Core",
    price: "$79",
    period: "/mo",
    description: "For growing stores managing real volume.",
    highlight: true,
    features: ["Up to 25,000 lots", "BrickSpotter (unlimited)", "Full POM automation", "2 marketplace channels", "Team access (3 seats)", "Priority support"],
  },
  {
    name: "Flagship",
    price: "$199",
    period: "/mo",
    description: "For serious operations that don't slow down.",
    highlight: false,
    features: ["Unlimited lots", "BrickSpotter (unlimited)", "Full POM + scheduler", "All marketplace channels", "Unlimited team seats", "Dedicated onboarding"],
  },
];

const stats = [
  { value: "130k+", label: "LEGO Parts Recognized" },
  { value: "10×", label: "Faster Inventory Builds" },
  { value: "100%", label: "Multichannel Sync Accuracy" },
  { value: "24/7", label: "Automated Pricing" },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-950 via-indigo-950 to-gray-950 text-white">

      {/* Ambient background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1200px] h-[1200px] border border-purple-500/10 rounded-full" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] border border-cyan-500/10 rounded-full" />
        <div className="absolute -top-60 -right-60 w-[600px] h-[600px] bg-purple-600/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-60 -left-60 w-[600px] h-[600px] bg-cyan-600/10 rounded-full blur-3xl" />
        <div className="absolute top-1/3 left-1/4 w-2 h-2 bg-yellow-300 rounded-full animate-pulse opacity-60" />
        <div className="absolute top-2/3 right-1/4 w-1.5 h-1.5 bg-pink-300 rounded-full animate-pulse opacity-60 delay-300" />
        <div className="absolute top-1/2 right-1/3 w-1 h-1 bg-cyan-300 rounded-full animate-pulse opacity-60 delay-700" />
      </div>

      {/* ── NAVBAR ── */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-gray-950/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-14">
          <img src={logoUrl} alt="PlanetBrick.com" className="h-7 w-auto" />
          <nav className="hidden md:flex items-center gap-6 text-sm text-gray-400">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/signup">
              <Button variant="ghost" size="sm" className="text-gray-300 text-xs md:text-sm" data-testid="link-nav-signup">
                Get Started
              </Button>
            </Link>
            <Link href="/login">
              <Button size="sm" className="bg-gradient-to-r from-purple-600 to-cyan-600 border-0 text-xs md:text-sm" data-testid="link-nav-signin">
                Sign In
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* ── HERO ── */}
      <section className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-300 text-xs font-medium mb-6" data-testid="hero-badge">
          <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
          The complete back-office for LEGO resellers
        </div>

        <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold tracking-tight mb-6 leading-[1.1]" data-testid="hero-headline">
          Your LEGO business,{" "}
          <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">
            on autopilot.
          </span>
        </h1>

        <p className="text-lg sm:text-xl md:text-2xl text-gray-300 max-w-3xl mx-auto mb-10 leading-relaxed" data-testid="hero-subheadline">
          From AI part scanning to automated repricing and multichannel selling — PlanetBrick handles the
          operations so you can focus on sourcing more bricks.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-16">
          <Link href="/signup">
            <Button size="lg" className="bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 border-0 text-base px-8 shadow-lg shadow-purple-500/30" data-testid="button-hero-cta">
              Start for free
              <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </Link>
          <Link href="/login">
            <Button size="lg" variant="outline" className="text-base px-8 border-white/20 text-gray-200 bg-white/5 backdrop-blur-sm" data-testid="button-hero-signin">
              Sign in to your account
            </Button>
          </Link>
        </div>

        {/* E.L.F.I.E. mascot hero block */}
        <div className="relative inline-flex flex-col items-center">
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 opacity-30 blur-3xl rounded-full" />
            <img src={elfieUrl} alt="E.L.F.I.E. — PlanetBrick AI" className="relative w-36 h-36 md:w-48 md:h-48 object-contain drop-shadow-2xl" data-testid="img-elfie" />
            <div className="absolute top-2 left-1/2 -translate-x-1/2 w-28 h-28 md:w-36 md:h-36 border-2 border-cyan-400/30 rounded-full animate-ping" />
          </div>
          <div className="mt-4 px-4 py-2 rounded-full bg-gray-900/60 border border-white/10 backdrop-blur-sm text-sm text-cyan-300 font-medium">
            Meet E.L.F.I.E. — your AI inventory assistant
          </div>
        </div>
      </section>

      {/* ── STATS BAR ── */}
      <section className="relative z-10 border-y border-white/5 bg-white/[0.02] backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          {stats.map((s) => (
            <div key={s.label} data-testid={`stat-${s.label.toLowerCase().replace(/\s+/g, '-')}`}>
              <div className="text-3xl md:text-4xl font-extrabold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                {s.value}
              </div>
              <div className="text-xs md:text-sm text-gray-400 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section id="features" className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4" data-testid="section-features-title">
            Everything your reseller store needs
          </h2>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            Four tightly integrated tools built specifically for the LEGO aftermarket — not duct-taped together from generic software.
          </p>
        </div>

        <div className="space-y-12">
          {features.map((f, i) => {
            const Icon = f.icon;
            const colorMap: Record<string, { badge: string; glow: string; dot: string; border: string }> = {
              purple: { badge: "bg-purple-500/15 text-purple-300 border-purple-500/25", glow: "from-purple-600/20", dot: "bg-purple-400", border: "border-purple-500/20" },
              amber:  { badge: "bg-amber-500/15 text-amber-300 border-amber-500/25",   glow: "from-amber-600/20",  dot: "bg-amber-400",  border: "border-amber-500/20" },
              teal:   { badge: "bg-teal-500/15 text-teal-300 border-teal-500/25",       glow: "from-teal-600/20",   dot: "bg-teal-400",   border: "border-teal-500/20" },
              green:  { badge: "bg-green-500/15 text-green-300 border-green-500/25",    glow: "from-green-600/20",  dot: "bg-green-400",  border: "border-green-500/20" },
            };
            const c = colorMap[f.color];
            return (
              <div
                key={f.badge}
                className={`flex flex-col ${i % 2 === 1 ? "md:flex-row-reverse" : "md:flex-row"} gap-8 md:gap-12 items-center`}
                data-testid={`feature-${f.badge.toLowerCase().replace(/\s+/g, '-')}`}
              >
                {/* Visual panel */}
                <div className={`flex-1 rounded-2xl border ${c.border} bg-white/[0.03] p-8 md:p-10 flex flex-col items-start gap-6 backdrop-blur-sm`}>
                  <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold ${c.badge}`}>
                    <Icon className="w-3.5 h-3.5" />
                    {f.badge}
                  </div>
                  <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${c.glow} to-transparent border ${c.border} flex items-center justify-center`}>
                    <Icon className="w-8 h-8 text-white/70" />
                  </div>
                  <div className="space-y-2">
                    {f.bullets.map((b) => (
                      <div key={b} className="flex items-center gap-2.5 text-sm text-gray-300">
                        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.dot}`} />
                        {b}
                      </div>
                    ))}
                  </div>
                </div>
                {/* Text */}
                <div className="flex-1 space-y-4">
                  <h3 className="text-2xl md:text-3xl font-bold">{f.title}</h3>
                  <p className="text-gray-400 text-base md:text-lg leading-relaxed">{f.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="relative z-10 border-y border-white/5 bg-white/[0.02]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Up and running in minutes</h2>
          <p className="text-gray-400 text-lg mb-16 max-w-xl mx-auto">No training required. No 90-day implementation project.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { step: "01", icon: Globe, title: "Connect your store", desc: "Link your BrickLink credentials and we sync your existing inventory automatically." },
              { step: "02", icon: Scan, title: "Scan or import parts", desc: "Use BrickSpotter to scan new lots, or bulk-import from BrickLink. Everything lands in your dashboard." },
              { step: "03", icon: TrendingUp, title: "Let automation run", desc: "Price-o-Matic watches the market and adjusts prices while you source more inventory." },
            ].map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.step} className="flex flex-col items-center gap-4 p-6 rounded-2xl bg-white/[0.03] border border-white/5" data-testid={`step-${s.step}`}>
                  <div className="relative">
                    <div className="w-14 h-14 rounded-full bg-gradient-to-br from-purple-600/30 to-cyan-600/30 border border-white/10 flex items-center justify-center">
                      <Icon className="w-6 h-6 text-white/70" />
                    </div>
                    <span className="absolute -top-1 -right-1 text-[10px] font-bold text-purple-400 bg-purple-500/20 rounded-full w-5 h-5 flex items-center justify-center border border-purple-500/30">
                      {s.step.slice(1)}
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold">{s.title}</h3>
                  <p className="text-gray-400 text-sm leading-relaxed">{s.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── PRICING ── */}
      <section id="pricing" className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4" data-testid="section-pricing-title">
            Simple, honest pricing
          </h2>
          <p className="text-gray-400 text-lg max-w-xl mx-auto">
            Start free. Upgrade when your volume demands it. No surprises.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {tiers.map((t) => (
            <div
              key={t.name}
              className={`relative rounded-2xl p-6 flex flex-col gap-5 border transition-colors ${
                t.highlight
                  ? "bg-gradient-to-b from-purple-600/20 to-cyan-600/10 border-purple-500/40"
                  : "bg-white/[0.03] border-white/8"
              }`}
              data-testid={`pricing-tier-${t.name.toLowerCase()}`}
            >
              {t.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-gradient-to-r from-purple-600 to-cyan-600 text-[10px] font-bold uppercase tracking-widest">
                  Most Popular
                </div>
              )}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  {t.highlight && <Star className="w-3.5 h-3.5 text-yellow-400" />}
                  <span className="text-sm font-semibold text-gray-200">{t.name}</span>
                </div>
                <div className="flex items-end gap-1">
                  <span className="text-3xl font-extrabold">{t.price}</span>
                  {t.period && <span className="text-gray-400 text-sm mb-1">{t.period}</span>}
                </div>
                <p className="text-xs text-gray-400 mt-1">{t.description}</p>
              </div>
              <ul className="flex-1 space-y-2.5">
                {t.features.map((feat) => (
                  <li key={feat} className="flex items-start gap-2 text-sm text-gray-300">
                    <Check className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-cyan-400" />
                    {feat}
                  </li>
                ))}
              </ul>
              <Link href="/signup">
                <Button
                  className={`w-full ${t.highlight ? "bg-gradient-to-r from-purple-600 to-cyan-600 border-0" : ""}`}
                  variant={t.highlight ? "default" : "outline"}
                  size="sm"
                  data-testid={`button-select-${t.name.toLowerCase()}`}
                >
                  {t.name === "Trial" ? "Start free" : "Get started"}
                </Button>
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="relative z-10 border-t border-white/5">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-24 text-center">
          <div className="inline-flex items-center gap-2 mb-6">
            <ShieldCheck className="w-5 h-5 text-green-400" />
            <span className="text-sm text-gray-400">No credit card required to start</span>
          </div>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-5">
            Ready to run your LEGO store{" "}
            <span className="bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
              like a pro?
            </span>
          </h2>
          <p className="text-gray-400 text-lg mb-10 max-w-xl mx-auto">
            Join the waitlist or sign up today and get access to every tool in PlanetBrick — free, during your trial.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/signup">
              <Button size="lg" className="bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 border-0 text-base px-10 shadow-lg shadow-purple-500/30" data-testid="button-cta-signup">
                Create your free account
                <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="ghost" className="text-gray-300 text-base px-8" data-testid="button-cta-signin">
                Already have an account? Sign in
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="relative z-10 border-t border-white/5 bg-black/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <img src={logoUrl} alt="PlanetBrick.com" className="h-6 w-auto opacity-70" />
          <p className="text-xs text-gray-600 text-center">
            &copy; {new Date().getFullYear()} PlanetBrick.com — LEGO Reseller Operations Platform. LEGO is a trademark of the LEGO Group, which does not sponsor or endorse this product.
          </p>
          <div className="flex items-center gap-4 text-xs text-gray-600">
            <Link href="/login" className="hover:text-gray-400 transition-colors">Sign In</Link>
            <Link href="/signup" className="hover:text-gray-400 transition-colors">Sign Up</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
