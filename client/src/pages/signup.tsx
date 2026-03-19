import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, Building2, Users, ArrowLeft, Search, ScanSearch, CheckCircle2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { TOS_SECTIONS, TOS_LAST_UPDATED } from "@/lib/constants";
import logoUrl from "@assets/PlanetBrick_dotcom_with_planet_and_robot_400_1760672362080.png";
import elfieUrl from "@assets/PlanetBrick_good_robot_1760672362080.png";

type SignupMode = "choose" | "business" | "employee" | "brickspotter";

interface PublicOrg {
  id: string;
  name: string;
}

function BackgroundDecor() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] border-2 border-purple-500/20 rounded-full animate-[spin_60s_linear_infinite]" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] border-2 border-cyan-500/20 rounded-full animate-[spin_40s_linear_infinite_reverse]" />
      <div className="absolute top-20 left-20 w-2 h-2 bg-yellow-300 rounded-full animate-pulse" />
      <div className="absolute top-40 right-32 w-1 h-1 bg-pink-300 rounded-full animate-pulse delay-75" />
      <div className="absolute bottom-32 left-40 w-1.5 h-1.5 bg-cyan-300 rounded-full animate-pulse delay-150" />
      <div className="absolute -top-40 -right-40 w-96 h-96 bg-purple-500/30 rounded-full blur-3xl animate-pulse" />
      <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-cyan-500/30 rounded-full blur-3xl animate-pulse delay-1000" />
    </div>
  );
}

function CornerAccents() {
  return (
    <>
      <div className="absolute -top-3 -left-3 md:-top-4 md:-left-4 w-6 h-6 md:w-8 md:h-8 border-t-2 border-l-2 border-purple-400/50 rounded-tl-2xl" />
      <div className="absolute -top-3 -right-3 md:-top-4 md:-right-4 w-6 h-6 md:w-8 md:h-8 border-t-2 border-r-2 border-cyan-400/50 rounded-tr-2xl" />
      <div className="absolute -bottom-3 -left-3 md:-bottom-4 md:-left-4 w-6 h-6 md:w-8 md:h-8 border-b-2 border-l-2 border-pink-400/50 rounded-bl-2xl" />
      <div className="absolute -bottom-3 -right-3 md:-bottom-4 md:-right-4 w-6 h-6 md:w-8 md:h-8 border-b-2 border-r-2 border-purple-400/50 rounded-br-2xl" />
    </>
  );
}

function LogoHeader() {
  return (
    <div className="flex justify-center">
      <div className="relative">
        <img
          src={logoUrl}
          alt="E.L.F.I.E."
          className="w-full max-w-[180px] md:max-w-[220px] lg:max-w-[260px] h-auto drop-shadow-2xl"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 opacity-20 blur-2xl -z-10" />
      </div>
    </div>
  );
}

function ElfieWelcome({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-2 md:gap-3 bg-gradient-to-r from-purple-950/50 via-indigo-950/50 to-cyan-950/50 rounded-2xl p-2.5 md:p-3 lg:p-4 border border-purple-500/20">
      <div className="flex-shrink-0">
        <div className="relative w-10 h-10 md:w-14 md:h-14 lg:w-16 lg:h-16">
          <img src={elfieUrl} alt="E.L.F.I.E." className="w-full h-full object-contain drop-shadow-lg" />
          <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-8 h-8 md:w-10 md:h-10 lg:w-12 lg:h-12 border-2 border-cyan-400/40 rounded-full animate-ping" />
        </div>
      </div>
      <div className="flex-1">
        <p className="text-cyan-300 font-semibold text-xs md:text-sm lg:text-base mb-0.5">{title}</p>
        <p className="text-gray-400 text-[10px] md:text-xs lg:text-sm leading-tight">{subtitle}</p>
      </div>
    </div>
  );
}

export default function Signup() {
  const [mode, setMode] = useState<SignupMode>("choose");
  const [email, setEmail] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("email") || "";
  });
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<PublicOrg[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(false);
  const [orgSearch, setOrgSearch] = useState("");
  const [tosAccepted, setTosAccepted] = useState(false);
  const [showTos, setShowTos] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (mode === "employee") {
      setOrgsLoading(true);
      fetch("/api/public/organizations")
        .then(r => { if (!r.ok) throw new Error("Failed to load"); return r.json(); })
        .then(data => { if (Array.isArray(data)) setOrgs(data); else throw new Error("Invalid response"); })
        .catch(() => toast({ title: "Error", description: "Could not load organizations", variant: "destructive" }))
        .finally(() => setOrgsLoading(false));
    }
  }, [mode]);

  const filteredOrgs = orgs.filter(o =>
    o.name.toLowerCase().includes(orgSearch.toLowerCase())
  );

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast({ title: "Password Mismatch", description: "Passwords do not match", variant: "destructive" });
      return;
    }
    if (password.length < 8) {
      toast({ title: "Weak Password", description: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }
    if (mode === "employee" && !selectedOrgId) {
      toast({ title: "Select a Business", description: "Please choose which business you work for", variant: "destructive" });
      return;
    }
    if (mode === "brickspotter" && !tosAccepted) {
      toast({ title: "Terms Required", description: "Please accept the Terms of Service to continue", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      const body: Record<string, unknown> = { email, password, firstName, lastName };
      if (mode === "employee" && selectedOrgId) {
        body.joinOrgId = selectedOrgId;
      }
      if (mode === "brickspotter") {
        body.brickspotterSignup = true;
      }
      await apiRequest("POST", "/api/signup", body);
      const successMsg =
        mode === "employee" ? "Your company admin will review and approve your access." :
        mode === "brickspotter" ? "Welcome to BrickSpotter 3000! Start scanning your bricks." :
        "Welcome to E.L.F.I.E.";
      toast({ title: "Account Created!", description: successMsg });
      window.location.href = "/";
    } catch (error: any) {
      // Try to extract a clean message from "503: {"error":"..."}" style throws
      let description = error.message || "Failed to create account";
      try {
        const jsonStart = description.indexOf('{');
        if (jsonStart !== -1) {
          const parsed = JSON.parse(description.slice(jsonStart));
          if (parsed?.error) description = parsed.error;
        }
      } catch {}
      toast({ title: "Signup Failed", description, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    setMode("choose");
    setSelectedOrgId(null);
    setOrgSearch("");
    setTosAccepted(false);
    setShowTos(false);
  };

  const elfieTitle =
    mode === "business" ? "Set Up Your Business" :
    mode === "employee" ? "Join a Team" :
    "Become a BrickSpotter Member";

  const elfieSubtitle =
    mode === "business" ? "Let's get your store set up with E.L.F.I.E." :
    mode === "employee" ? "Select your employer, then create your account" :
    "Snap a photo of any LEGO part — E.L.F.I.E. identifies it instantly.";

  const submitLabel =
    mode === "employee" ? "Join Team" :
    mode === "brickspotter" ? "Activate Membership" :
    "Create Account";

  return (
    <div className="min-h-screen flex items-center justify-center p-3 md:p-4 lg:p-6 relative overflow-hidden bg-gradient-to-br from-purple-900 via-indigo-900 to-cyan-900">
      <BackgroundDecor />

      <div className="relative z-10 w-full max-w-md md:max-w-lg lg:max-w-xl">
        <div className="relative bg-gradient-to-br from-purple-600/10 via-pink-600/10 to-cyan-600/10 p-1 rounded-3xl backdrop-blur-xl">
          <div className="bg-gray-900/90 rounded-3xl overflow-hidden border border-white/10">
            <div className="p-4 md:p-6 lg:p-8 space-y-2.5 md:space-y-3 lg:space-y-4">
              <LogoHeader />

              {/* ── Mode chooser ── */}
              {mode === "choose" && (
                <>
                  <ElfieWelcome title="Welcome to E.L.F.I.E.!" subtitle="How would you like to get started?" />
                  <div className="space-y-2.5 md:space-y-3">
                    <button
                      onClick={() => setMode("business")}
                      className="w-full flex items-center gap-3 md:gap-4 p-3 md:p-4 rounded-xl bg-gradient-to-r from-purple-900/60 to-indigo-900/60 border border-purple-500/30 hover:border-purple-400/50 transition-all group"
                      data-testid="button-setup-business"
                    >
                      <div className="flex-shrink-0 w-10 h-10 md:w-12 md:h-12 rounded-xl bg-purple-500/20 flex items-center justify-center group-hover:bg-purple-500/30 transition-colors">
                        <Building2 className="w-5 h-5 md:w-6 md:h-6 text-purple-300" />
                      </div>
                      <div className="flex-1 text-left">
                        <p className="text-white font-semibold text-sm md:text-base">Set Up My Business</p>
                        <p className="text-gray-400 text-[10px] md:text-xs">Create a new store and start your free trial</p>
                      </div>
                    </button>

                    <button
                      onClick={() => setMode("employee")}
                      className="w-full flex items-center gap-3 md:gap-4 p-3 md:p-4 rounded-xl bg-gradient-to-r from-cyan-900/60 to-blue-900/60 border border-cyan-500/30 hover:border-cyan-400/50 transition-all group"
                      data-testid="button-join-team"
                    >
                      <div className="flex-shrink-0 w-10 h-10 md:w-12 md:h-12 rounded-xl bg-cyan-500/20 flex items-center justify-center group-hover:bg-cyan-500/30 transition-colors">
                        <Users className="w-5 h-5 md:w-6 md:h-6 text-cyan-300" />
                      </div>
                      <div className="flex-1 text-left">
                        <p className="text-white font-semibold text-sm md:text-base">Join an Existing Business</p>
                        <p className="text-gray-400 text-[10px] md:text-xs">Sign up as an employee of a business already on E.L.F.I.E.</p>
                      </div>
                    </button>

                    <button
                      onClick={() => setMode("brickspotter")}
                      className="w-full flex items-center gap-3 md:gap-4 p-3 md:p-4 rounded-xl bg-gradient-to-r from-yellow-900/60 to-amber-900/60 border border-yellow-500/30 hover:border-yellow-400/50 transition-all group"
                      data-testid="button-brickspotter-signup"
                    >
                      <div className="flex-shrink-0 w-10 h-10 md:w-12 md:h-12 rounded-xl bg-yellow-500/20 flex items-center justify-center group-hover:bg-yellow-500/30 transition-colors">
                        <ScanSearch className="w-5 h-5 md:w-6 md:h-6 text-yellow-300" />
                      </div>
                      <div className="flex-1 text-left">
                        <p className="text-white font-semibold text-sm md:text-base">Become a BrickSpotter 3000 Member</p>
                        <p className="text-gray-400 text-[10px] md:text-xs">Identify any LEGO part instantly with your camera</p>
                      </div>
                    </button>
                  </div>
                </>
              )}

              {/* ── Forms (business / employee / brickspotter) ── */}
              {mode !== "choose" && (
                <>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleBack}
                      className="flex items-center gap-1 text-gray-400 hover:text-white text-xs transition-colors"
                      data-testid="button-back"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Back</span>
                    </button>
                  </div>

                  <ElfieWelcome title={elfieTitle} subtitle={elfieSubtitle} />

                  {/* BrickSpotter feature highlights */}
                  {mode === "brickspotter" && (
                    <div className="bg-yellow-950/30 border border-yellow-500/20 rounded-xl p-3 space-y-2">
                      {[
                        "No store setup — just scan and go",
                        "E.L.F.I.E. uses the platform BrickLink account (no API key needed)",
                        "Get real-time prices and part IDs from any photo",
                      ].map((item) => (
                        <div key={item} className="flex items-center gap-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />
                          <span className="text-xs text-gray-300">{item}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Employer selector (employee mode) */}
                  {mode === "employee" && (
                    <div className="space-y-2">
                      <Label className="text-gray-300 text-[10px] md:text-xs lg:text-sm">Select Your Business</Label>
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                        <Input
                          type="text"
                          placeholder="Search businesses..."
                          value={orgSearch}
                          onChange={(e) => setOrgSearch(e.target.value)}
                          className="bg-gray-800/50 border-gray-700 text-white text-xs md:text-sm h-9 md:h-10 pl-8"
                          data-testid="input-org-search"
                        />
                      </div>
                      <div className="max-h-36 md:max-h-44 overflow-y-auto rounded-lg border border-gray-700/50 bg-gray-800/30">
                        {orgsLoading ? (
                          <div className="p-3 text-center text-gray-500 text-xs">Loading businesses...</div>
                        ) : filteredOrgs.length === 0 ? (
                          <div className="p-3 text-center text-gray-500 text-xs">
                            {orgSearch ? "No matching businesses found" : "No businesses available"}
                          </div>
                        ) : (
                          filteredOrgs.map(org => (
                            <button
                              key={org.id}
                              type="button"
                              onClick={() => setSelectedOrgId(org.id)}
                              className={`w-full text-left px-3 py-2 text-xs md:text-sm transition-colors flex items-center gap-2 ${
                                selectedOrgId === org.id
                                  ? "bg-cyan-600/30 text-cyan-200 border-l-2 border-cyan-400"
                                  : "text-gray-300 hover:bg-gray-700/40"
                              }`}
                              data-testid={`button-org-${org.id}`}
                            >
                              <Building2 className="w-3.5 h-3.5 flex-shrink-0 text-gray-500" />
                              <span className="truncate">{org.name}</span>
                            </button>
                          ))
                        )}
                      </div>
                      {selectedOrgId && (
                        <p className="text-[10px] md:text-xs text-cyan-400/80">
                          Your admin will assign your role after you join.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Account form */}
                  <form onSubmit={handleSignup} className="space-y-2 md:space-y-2.5 lg:space-y-3">
                    <div className="grid grid-cols-2 gap-2 md:gap-3">
                      <div className="space-y-1">
                        <Label htmlFor="firstName" className="text-gray-300 text-[10px] md:text-xs lg:text-sm">First Name</Label>
                        <Input id="firstName" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="bg-gray-800/50 border-gray-700 text-white text-xs md:text-sm h-9 md:h-10 lg:h-11" data-testid="input-firstName" />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="lastName" className="text-gray-300 text-[10px] md:text-xs lg:text-sm">Last Name</Label>
                        <Input id="lastName" type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} className="bg-gray-800/50 border-gray-700 text-white text-xs md:text-sm h-9 md:h-10 lg:h-11" data-testid="input-lastName" />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="email" className="text-gray-300 text-[10px] md:text-xs lg:text-sm">Email</Label>
                      <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="bg-gray-800/50 border-gray-700 text-white text-xs md:text-sm h-9 md:h-10 lg:h-11" data-testid="input-email" />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="password" className="text-gray-300 text-[10px] md:text-xs lg:text-sm">Password</Label>
                      <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className="bg-gray-800/50 border-gray-700 text-white text-xs md:text-sm h-9 md:h-10 lg:h-11" placeholder="Min. 8 characters" data-testid="input-password" />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="confirmPassword" className="text-gray-300 text-[10px] md:text-xs lg:text-sm">Confirm Password</Label>
                      <Input id="confirmPassword" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} className="bg-gray-800/50 border-gray-700 text-white text-xs md:text-sm h-9 md:h-10 lg:h-11" data-testid="input-confirmPassword" />
                    </div>

                    {/* Terms of Service — required for BrickSpotter signups */}
                    {mode === "brickspotter" && (
                      <div className="space-y-2 border-t border-gray-800 pt-3">
                        <label className="flex items-start gap-2.5 cursor-pointer" data-testid="label-tos-accept">
                          <input
                            type="checkbox"
                            checked={tosAccepted}
                            onChange={(e) => setTosAccepted(e.target.checked)}
                            className="mt-0.5 h-4 w-4 rounded border-gray-600 bg-gray-800 text-yellow-500 focus:ring-yellow-500/30 cursor-pointer"
                            data-testid="checkbox-tos-accept"
                          />
                          <span className="text-xs text-gray-400 leading-relaxed">
                            I agree to the{" "}
                            <button
                              type="button"
                              onClick={() => setShowTos(!showTos)}
                              className="text-yellow-400 hover:text-yellow-300 underline underline-offset-2"
                              data-testid="button-view-tos"
                            >
                              Terms of Service
                            </button>
                          </span>
                        </label>
                        {showTos && (
                          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 max-h-40 overflow-y-auto text-[11px] text-gray-400 leading-relaxed space-y-3">
                            <p className="text-xs font-semibold text-gray-300">E.L.F.I.E. Terms of Service</p>
                            <p>Last updated: {TOS_LAST_UPDATED}</p>
                            {TOS_SECTIONS.map(s => (
                              <p key={s.num}><strong className="text-gray-300">{s.num}. {s.title}.</strong> {s.text}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <Button
                      type="submit"
                      disabled={
                        isLoading ||
                        (mode === "employee" && !selectedOrgId) ||
                        (mode === "brickspotter" && !tosAccepted)
                      }
                      className={`w-full h-10 md:h-12 lg:h-14 text-sm md:text-base lg:text-lg font-semibold border-0 shadow-lg transition-all duration-300 hover:scale-[1.02] ${
                        mode === "brickspotter"
                          ? "bg-gradient-to-r from-yellow-500 via-amber-500 to-orange-500 hover:from-yellow-400 hover:via-amber-400 hover:to-orange-400 text-gray-900 shadow-yellow-500/50 hover:shadow-xl hover:shadow-amber-500/50"
                          : "bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 hover:from-purple-500 hover:via-pink-500 hover:to-cyan-500 shadow-purple-500/50 hover:shadow-xl hover:shadow-pink-500/50"
                      }`}
                      data-testid="button-signup"
                    >
                      {mode === "brickspotter"
                        ? <ScanSearch className="w-4 h-4 md:w-5 md:h-5 lg:w-6 lg:h-6 mr-1.5 md:mr-2 lg:mr-3" />
                        : <UserPlus className="w-4 h-4 md:w-5 md:h-5 lg:w-6 lg:h-6 mr-1.5 md:mr-2 lg:mr-3" />
                      }
                      {isLoading ? "Creating Account..." : submitLabel}
                    </Button>
                  </form>
                </>
              )}

              <div className="text-center space-y-1 md:space-y-1.5">
                {mode === "choose" && (
                  <div className="inline-flex items-center gap-1.5 md:gap-2 px-2.5 md:px-3 lg:px-4 py-1 md:py-1.5 rounded-full bg-yellow-500/10 border border-yellow-500/20">
                    <div className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-yellow-400 animate-pulse" />
                    <p className="text-[9px] md:text-[10px] lg:text-xs text-yellow-300/90">
                      Blake & Caleb get instant admin access
                    </p>
                  </div>
                )}
                <p className="text-[9px] md:text-[10px] lg:text-xs text-gray-500">
                  Already have an account?{" "}
                  <a href="/" className="text-cyan-400 hover:text-cyan-300 underline" data-testid="link-login">Log in</a>
                </p>
              </div>
            </div>
          </div>
        </div>
        <CornerAccents />
      </div>
    </div>
  );
}
