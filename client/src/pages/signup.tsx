import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import logoUrl from "@assets/PlanetBrick_dotcom_with_planet_and_robot_400_1760672362080.png";
import elfieUrl from "@assets/PlanetBrick_good_robot_1760672362080.png";

export default function Signup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast({
        title: "Password Mismatch",
        description: "Passwords do not match",
        variant: "destructive",
      });
      return;
    }

    if (password.length < 8) {
      toast({
        title: "Weak Password",
        description: "Password must be at least 8 characters",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      await apiRequest("POST", "/api/signup", {
        email,
        password,
        firstName,
        lastName,
      });

      toast({
        title: "Account Created!",
        description: "Welcome to PlanetBrick",
      });

      window.location.href = "/";
    } catch (error: any) {
      toast({
        title: "Signup Failed",
        description: error.message || "Failed to create account",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-3 md:p-4 lg:p-6 relative overflow-hidden bg-gradient-to-br from-purple-900 via-indigo-900 to-cyan-900">
      {/* Animated background orbitals - Jetsons style */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] border-2 border-purple-500/20 rounded-full animate-[spin_60s_linear_infinite]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] border-2 border-cyan-500/20 rounded-full animate-[spin_40s_linear_infinite_reverse]" />
        
        {/* Floating sparkles */}
        <div className="absolute top-20 left-20 w-2 h-2 bg-yellow-300 rounded-full animate-pulse" />
        <div className="absolute top-40 right-32 w-1 h-1 bg-pink-300 rounded-full animate-pulse delay-75" />
        <div className="absolute bottom-32 left-40 w-1.5 h-1.5 bg-cyan-300 rounded-full animate-pulse delay-150" />
        
        {/* Gradient blobs */}
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-purple-500/30 rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-cyan-500/30 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      {/* Main unified signup card */}
      <div className="relative z-10 w-full max-w-md md:max-w-lg lg:max-w-xl">
        <div className="relative bg-gradient-to-br from-purple-600/10 via-pink-600/10 to-cyan-600/10 p-1 rounded-3xl backdrop-blur-xl">
          <div className="bg-gray-900/90 rounded-3xl overflow-hidden border border-white/10">
            {/* Unified content section */}
            <div className="p-4 md:p-6 lg:p-8 space-y-2.5 md:space-y-3 lg:space-y-4">
              
              {/* Logo - Compact */}
              <div className="flex justify-center">
                <div className="relative">
                  <img 
                    src={logoUrl} 
                    alt="PlanetBrick.com" 
                    className="w-full max-w-[180px] md:max-w-[220px] lg:max-w-[260px] h-auto drop-shadow-2xl"
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 opacity-20 blur-2xl -z-10" />
                </div>
              </div>

              {/* Subtitle with Elfie */}
              <div className="flex items-center gap-2 md:gap-3 bg-gradient-to-r from-purple-950/50 via-indigo-950/50 to-cyan-950/50 rounded-2xl p-2.5 md:p-3 lg:p-4 border border-purple-500/20">
                {/* Compact Elfie */}
                <div className="flex-shrink-0">
                  <div className="relative w-10 h-10 md:w-14 md:h-14 lg:w-16 lg:h-16">
                    <img 
                      src={elfieUrl} 
                      alt="E.L.F.I.E." 
                      className="w-full h-full object-contain drop-shadow-lg"
                    />
                    <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-8 h-8 md:w-10 md:h-10 lg:w-12 lg:h-12 border-2 border-cyan-400/40 rounded-full animate-ping" />
                  </div>
                </div>

                {/* Welcome text */}
                <div className="flex-1">
                  <p className="text-cyan-300 font-semibold text-xs md:text-sm lg:text-base mb-0.5">
                    Join PlanetBrick! 🚀
                  </p>
                  <p className="text-gray-400 text-[10px] md:text-xs lg:text-sm leading-tight">
                    Let's get you set up with E.L.F.I.E.
                  </p>
                </div>
              </div>

              {/* Signup form - Compact */}
              <form onSubmit={handleSignup} className="space-y-2 md:space-y-2.5 lg:space-y-3">
                <div className="grid grid-cols-2 gap-2 md:gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="firstName" className="text-gray-300 text-[10px] md:text-xs lg:text-sm">
                      First Name
                    </Label>
                    <Input
                      id="firstName"
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="bg-gray-800/50 border-gray-700 text-white text-xs md:text-sm h-9 md:h-10 lg:h-11"
                      data-testid="input-firstName"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="lastName" className="text-gray-300 text-[10px] md:text-xs lg:text-sm">
                      Last Name
                    </Label>
                    <Input
                      id="lastName"
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="bg-gray-800/50 border-gray-700 text-white text-xs md:text-sm h-9 md:h-10 lg:h-11"
                      data-testid="input-lastName"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="email" className="text-gray-300 text-[10px] md:text-xs lg:text-sm">
                    Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="bg-gray-800/50 border-gray-700 text-white text-xs md:text-sm h-9 md:h-10 lg:h-11"
                    data-testid="input-email"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="password" className="text-gray-300 text-[10px] md:text-xs lg:text-sm">
                    Password
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    className="bg-gray-800/50 border-gray-700 text-white text-xs md:text-sm h-9 md:h-10 lg:h-11"
                    placeholder="Min. 8 characters"
                    data-testid="input-password"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="confirmPassword" className="text-gray-300 text-[10px] md:text-xs lg:text-sm">
                    Confirm Password
                  </Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={8}
                    className="bg-gray-800/50 border-gray-700 text-white text-xs md:text-sm h-9 md:h-10 lg:h-11"
                    data-testid="input-confirmPassword"
                  />
                </div>

                <Button 
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-10 md:h-12 lg:h-14 text-sm md:text-base lg:text-lg font-semibold bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 hover:from-purple-500 hover:via-pink-500 hover:to-cyan-500 border-0 shadow-lg shadow-purple-500/50 transition-all duration-300 hover:shadow-xl hover:shadow-pink-500/50 hover:scale-[1.02]"
                  data-testid="button-signup"
                >
                  <UserPlus className="w-4 h-4 md:w-5 md:h-5 lg:w-6 lg:h-6 mr-1.5 md:mr-2 lg:mr-3" />
                  {isLoading ? "Creating Account..." : "Create Account"}
                </Button>
              </form>

              {/* Footer - Compact */}
              <div className="text-center space-y-1 md:space-y-1.5">
                <div className="inline-flex items-center gap-1.5 md:gap-2 px-2.5 md:px-3 lg:px-4 py-1 md:py-1.5 rounded-full bg-yellow-500/10 border border-yellow-500/20">
                  <div className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-yellow-400 animate-pulse" />
                  <p className="text-[9px] md:text-[10px] lg:text-xs text-yellow-300/90">
                    Blake & Caleb get instant admin access
                  </p>
                </div>
                <p className="text-[9px] md:text-[10px] lg:text-xs text-gray-500">
                  Already have an account?{" "}
                  <a href="/" className="text-cyan-400 hover:text-cyan-300 underline" data-testid="link-login">
                    Log in
                  </a>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Retro corner accents - Responsive */}
        <div className="absolute -top-3 -left-3 md:-top-4 md:-left-4 w-6 h-6 md:w-8 md:h-8 border-t-2 border-l-2 border-purple-400/50 rounded-tl-2xl" />
        <div className="absolute -top-3 -right-3 md:-top-4 md:-right-4 w-6 h-6 md:w-8 md:h-8 border-t-2 border-r-2 border-cyan-400/50 rounded-tr-2xl" />
        <div className="absolute -bottom-3 -left-3 md:-bottom-4 md:-left-4 w-6 h-6 md:w-8 md:h-8 border-b-2 border-l-2 border-pink-400/50 rounded-bl-2xl" />
        <div className="absolute -bottom-3 -right-3 md:-bottom-4 md:-right-4 w-6 h-6 md:w-8 md:h-8 border-b-2 border-r-2 border-purple-400/50 rounded-br-2xl" />
      </div>
    </div>
  );
}
