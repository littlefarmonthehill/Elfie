import { Button } from "@/components/ui/button";
import { LogIn, Sparkles } from "lucide-react";
import logoUrl from "@assets/PlanetBrick_dotcom_with_planet_and_robot_400_1760672362080.png";
import elfieUrl from "@assets/PlanetBrick_good_robot_1760672362080.png";

export default function Login() {
  return (
    <div className="min-h-screen flex items-center justify-center p-2 md:p-4 relative overflow-hidden bg-gradient-to-br from-purple-900 via-indigo-900 to-cyan-900">
      {/* Animated background orbitals - Jetsons style */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Large orbital ring */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] border-2 border-purple-500/20 rounded-full animate-[spin_60s_linear_infinite]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] border-2 border-cyan-500/20 rounded-full animate-[spin_40s_linear_infinite_reverse]" />
        
        {/* Floating sparkles */}
        <div className="absolute top-20 left-20 w-2 h-2 bg-yellow-300 rounded-full animate-pulse" />
        <div className="absolute top-40 right-32 w-1 h-1 bg-pink-300 rounded-full animate-pulse delay-75" />
        <div className="absolute bottom-32 left-40 w-1.5 h-1.5 bg-cyan-300 rounded-full animate-pulse delay-150" />
        <div className="absolute top-1/3 right-20 w-1 h-1 bg-purple-300 rounded-full animate-pulse delay-300" />
        <div className="absolute bottom-1/4 right-1/3 w-2 h-2 bg-pink-400 rounded-full animate-pulse delay-500" />
        
        {/* Gradient blobs */}
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-purple-500/30 rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-cyan-500/30 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      {/* Main login card */}
      <div className="relative z-10 w-full max-w-lg">
        {/* Retro-futuristic container with gradient border */}
        <div className="relative bg-gradient-to-br from-purple-600/10 via-pink-600/10 to-cyan-600/10 p-1 rounded-3xl backdrop-blur-xl">
          <div className="bg-gray-900/90 rounded-3xl overflow-hidden border border-white/10">
            {/* Header section with logo */}
            <div className="relative pt-6 md:pt-12 pb-4 md:pb-8 px-4 md:px-8 bg-gradient-to-br from-purple-900/50 via-pink-900/30 to-cyan-900/50">
              {/* Logo */}
              <div className="flex justify-center mb-3 md:mb-6">
                <div className="relative">
                  <img 
                    src={logoUrl} 
                    alt="PlanetBrick.com" 
                    className="w-full max-w-[240px] md:max-w-sm h-auto drop-shadow-2xl"
                  />
                  {/* Glow effect behind logo */}
                  <div className="absolute inset-0 bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 opacity-20 blur-2xl -z-10" />
                </div>
              </div>

              {/* Subtitle */}
              <div className="text-center space-y-1 md:space-y-2">
                <h2 className="text-sm md:text-lg lg:text-xl font-semibold bg-gradient-to-r from-purple-300 via-pink-300 to-cyan-300 bg-clip-text text-transparent">
                  LEGO Business Operations Dashboard
                </h2>
                <div className="flex items-center justify-center gap-2 text-xs md:text-sm text-cyan-300/80">
                  <Sparkles className="w-3 h-3 md:w-4 md:h-4" />
                  <span>Powered by E.L.F.I.E. AI</span>
                  <Sparkles className="w-3 h-3 md:w-4 md:h-4" />
                </div>
              </div>
            </div>

            {/* Content section */}
            <div className="p-4 md:p-8 space-y-4 md:space-y-8">
              {/* Elfie mascot section */}
              <div className="flex items-center gap-3 md:gap-6 bg-gradient-to-r from-purple-950/50 via-indigo-950/50 to-cyan-950/50 rounded-2xl p-3 md:p-6 border border-purple-500/20">
                {/* Elfie image */}
                <div className="flex-shrink-0">
                  <div className="relative w-16 h-16 md:w-24 md:h-24 lg:w-32 lg:h-32">
                    <img 
                      src={elfieUrl} 
                      alt="E.L.F.I.E. Mascot" 
                      className="w-full h-full object-contain drop-shadow-2xl"
                    />
                    {/* Rotating signal rings */}
                    <div className="absolute -top-1 md:-top-2 left-1/2 -translate-x-1/2 w-12 h-12 md:w-16 md:h-16 border-2 border-cyan-400/40 rounded-full animate-ping" />
                  </div>
                </div>

                {/* Welcome message */}
                <div className="flex-1 space-y-1 md:space-y-2">
                  <p className="text-cyan-300 font-semibold text-sm md:text-base lg:text-lg">
                    Welcome back! 🚀
                  </p>
                  <p className="text-gray-300 text-xs md:text-sm leading-relaxed">
                    E.L.F.I.E. is ready to help manage your inventory and grow your business!
                  </p>
                </div>
              </div>

              {/* Login button */}
              <Button 
                className="w-full h-12 md:h-14 text-base md:text-lg font-semibold bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 hover:from-purple-500 hover:via-pink-500 hover:to-cyan-500 border-0 shadow-lg shadow-purple-500/50 transition-all duration-300 hover:shadow-xl hover:shadow-pink-500/50 hover:scale-[1.02]"
                onClick={() => window.location.href = '/api/login'}
                data-testid="button-login"
              >
                <LogIn className="w-5 h-5 md:w-6 md:h-6 mr-2 md:mr-3" />
                Log In with Replit
              </Button>

              {/* Footer note */}
              <div className="text-center space-y-1.5 md:space-y-2">
                <div className="inline-flex items-center gap-2 px-3 md:px-4 py-1.5 md:py-2 rounded-full bg-yellow-500/10 border border-yellow-500/20">
                  <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                  <p className="text-[10px] md:text-xs text-yellow-300/90">
                    Access restricted to approved users
                  </p>
                </div>
                <p className="text-[10px] md:text-xs text-gray-500">
                  First time? You'll be added to the approval queue
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Retro corner accents */}
        <div className="absolute -top-4 -left-4 w-8 h-8 border-t-2 border-l-2 border-purple-400/50 rounded-tl-2xl" />
        <div className="absolute -top-4 -right-4 w-8 h-8 border-t-2 border-r-2 border-cyan-400/50 rounded-tr-2xl" />
        <div className="absolute -bottom-4 -left-4 w-8 h-8 border-b-2 border-l-2 border-pink-400/50 rounded-bl-2xl" />
        <div className="absolute -bottom-4 -right-4 w-8 h-8 border-b-2 border-r-2 border-purple-400/50 rounded-br-2xl" />
      </div>
    </div>
  );
}
