import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, KeyRound, Copy, Check } from "lucide-react";
import logoUrl from "@assets/PlanetBrick_dotcom_with_planet_and_robot_400_1760672362080.png";
import elfieUrl from "@assets/PlanetBrick_good_robot_1760672362080.png";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const res = await fetch("/api/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.status === 503) {
        toast({ title: "Starting up", description: "Server is initializing — please wait a moment and try again.", variant: "destructive" });
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Error", description: data.message || "Something went wrong.", variant: "destructive" });
        return;
      }
      setResetUrl(data.resetUrl);
    } catch {
      toast({ title: "Error", description: "Could not process request. Please try again.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (!resetUrl) return;
    navigator.clipboard.writeText(resetUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-3 md:p-4 lg:p-6 relative overflow-hidden bg-gradient-to-br from-purple-900 via-indigo-900 to-cyan-900">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] border-2 border-purple-500/20 rounded-full animate-[spin_60s_linear_infinite]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] border-2 border-cyan-500/20 rounded-full animate-[spin_40s_linear_infinite_reverse]" />
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-purple-500/30 rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-cyan-500/30 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      <div className="relative z-10 w-full max-w-md md:max-w-lg lg:max-w-xl">
        <div className="relative bg-gradient-to-br from-purple-600/10 via-pink-600/10 to-cyan-600/10 p-1 rounded-3xl backdrop-blur-xl">
          <div className="bg-gray-900/90 rounded-3xl overflow-hidden border border-white/10">
            <div className="p-4 md:p-6 lg:p-8 space-y-3 md:space-y-4 lg:space-y-5">

              <div className="flex justify-center">
                <img src={logoUrl} alt="E.L.F.I.E." className="w-full max-w-[180px] md:max-w-[220px] lg:max-w-[260px] h-auto drop-shadow-2xl" />
              </div>

              <div className="flex items-center gap-2 md:gap-3 bg-gradient-to-r from-purple-950/50 via-indigo-950/50 to-cyan-950/50 rounded-2xl p-2.5 md:p-3 lg:p-4 border border-purple-500/20">
                <div className="flex-shrink-0">
                  <div className="relative w-10 h-10 md:w-14 md:h-14 lg:w-16 lg:h-16">
                    <img src={elfieUrl} alt="E.L.F.I.E." className="w-full h-full object-contain drop-shadow-lg" />
                  </div>
                </div>
                <div className="flex-1">
                  <p className="text-cyan-300 font-semibold text-xs md:text-sm lg:text-base mb-0.5">Reset your password</p>
                  <p className="text-gray-400 text-[10px] md:text-xs lg:text-sm leading-tight">
                    {resetUrl ? "Your reset link is ready below." : "Enter your email and we'll generate a reset link."}
                  </p>
                </div>
              </div>

              {!resetUrl ? (
                <form onSubmit={handleSubmit} className="space-y-2.5 md:space-y-3 lg:space-y-4">
                  <div className="space-y-1">
                    <Label htmlFor="email" className="text-gray-300 text-[10px] md:text-xs lg:text-sm">Email address</Label>
                    <Input
                      id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                      required autoFocus
                      className="bg-gray-800/50 border-gray-700 text-white text-xs md:text-sm h-9 md:h-10 lg:h-11"
                      placeholder="your@email.com"
                      data-testid="input-email"
                    />
                  </div>
                  <Button
                    type="submit" disabled={isLoading}
                    className="w-full h-10 md:h-12 lg:h-14 text-sm md:text-base lg:text-lg font-semibold bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 border-0 shadow-lg shadow-purple-500/50 transition-all duration-300"
                    data-testid="button-request-reset"
                  >
                    <KeyRound className="w-4 h-4 mr-2" />
                    {isLoading ? "Generating..." : "Generate Reset Link"}
                  </Button>
                </form>
              ) : (
                <div className="space-y-3">
                  <p className="text-gray-300 text-xs md:text-sm">Copy this link and open it in your browser to set a new password. It expires in 1 hour.</p>
                  <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 flex items-center gap-2">
                    <span className="flex-1 text-cyan-300 text-[10px] md:text-xs break-all font-mono leading-relaxed">{resetUrl}</span>
                    <Button
                      type="button" size="icon" variant="ghost" onClick={handleCopy}
                      className="flex-shrink-0" data-testid="button-copy-link"
                    >
                      {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-gray-400" />}
                    </Button>
                  </div>
                  <Button
                    type="button"
                    className="w-full h-10 md:h-12 text-sm md:text-base font-semibold bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 border-0"
                    onClick={() => { window.location.href = resetUrl; }}
                    data-testid="button-open-link"
                  >
                    Open Reset Link
                  </Button>
                </div>
              )}

              <div className="text-center">
                <a href="/login" className="text-gray-500 hover:text-gray-300 text-[9px] md:text-[10px] lg:text-xs transition-colors inline-flex items-center gap-1" data-testid="link-back-to-login">
                  <ArrowLeft className="w-3 h-3" /> Back to login
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
