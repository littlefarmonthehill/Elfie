import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Clock, Mail, LogOut, Sparkles } from "lucide-react";
import logoUrl from "@assets/PlanetBrick_dotcom_with_planet_and_robot_400_1760672362080.png";
import elfieUrl from "@assets/PlanetBrick_good_robot_1760672362080.png";

export default function PendingApproval() {
  const { user } = useAuth();

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

      {/* Main card */}
      <div className="relative z-10 w-full max-w-lg">
        {/* Retro-futuristic container with gradient border */}
        <div className="relative bg-gradient-to-br from-purple-600/10 via-pink-600/10 to-cyan-600/10 p-1 rounded-3xl backdrop-blur-xl">
          <div className="bg-gray-900/90 rounded-3xl overflow-hidden border border-white/10">
            {/* Header section with logo */}
            <div className="relative pt-6 md:pt-10 pb-4 md:pb-6 px-4 md:px-8 bg-gradient-to-br from-purple-900/50 via-pink-900/30 to-cyan-900/50">
              {/* Logo */}
              <div className="flex justify-center mb-3 md:mb-4">
                <div className="relative">
                  <img 
                    src={logoUrl} 
                    alt="PlanetBrick.com" 
                    className="w-full max-w-[200px] md:max-w-xs h-auto drop-shadow-2xl"
                  />
                  {/* Glow effect behind logo */}
                  <div className="absolute inset-0 bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 opacity-20 blur-2xl -z-10" />
                </div>
              </div>

              {/* Status badge */}
              <div className="flex justify-center">
                <div className="inline-flex items-center gap-2 px-4 md:px-6 py-2 md:py-3 rounded-full bg-gradient-to-r from-orange-500/20 via-yellow-500/20 to-orange-500/20 border border-orange-400/30">
                  <Clock className="w-4 h-4 md:w-5 md:h-5 text-orange-300 animate-pulse" />
                  <span className="text-sm md:text-base font-semibold bg-gradient-to-r from-orange-300 to-yellow-300 bg-clip-text text-transparent">
                    Access Pending Approval
                  </span>
                </div>
              </div>
            </div>

            {/* Content section */}
            <div className="p-4 md:p-8 space-y-4 md:space-y-6">
              {/* Elfie mascot section */}
              <div className="flex items-center gap-3 md:gap-4 bg-gradient-to-r from-purple-950/50 via-indigo-950/50 to-cyan-950/50 rounded-2xl p-3 md:p-5 border border-purple-500/20">
                {/* Elfie image */}
                <div className="flex-shrink-0">
                  <div className="relative w-16 h-16 md:w-20 md:h-20">
                    <img 
                      src={elfieUrl} 
                      alt="E.L.F.I.E. Mascot" 
                      className="w-full h-full object-contain drop-shadow-2xl"
                    />
                    {/* Rotating signal rings */}
                    <div className="absolute -top-1 md:-top-2 left-1/2 -translate-x-1/2 w-12 h-12 md:w-14 md:h-14 border-2 border-orange-400/40 rounded-full animate-ping" />
                  </div>
                </div>

                {/* Status message */}
                <div className="flex-1 space-y-1">
                  <p className="text-orange-300 font-semibold text-sm md:text-base">
                    Almost there, astronaut! 🚀
                  </p>
                  <p className="text-gray-300 text-xs md:text-sm leading-relaxed">
                    E.L.F.I.E. is standing by while an admin reviews your access request.
                  </p>
                </div>
              </div>

              {/* User info card */}
              <div className="bg-gradient-to-br from-gray-900/80 to-gray-800/80 rounded-xl p-4 md:p-5 border border-gray-700/50 space-y-2" data-testid="text-pending-approval-message">
                <div className="flex items-center gap-2 text-cyan-300 font-medium text-sm md:text-base">
                  <Sparkles className="w-4 h-4" />
                  <span>Logged in as:</span>
                </div>
                <div className="pl-6 space-y-1">
                  <p className="text-sm md:text-base text-white font-semibold" data-testid="text-user-email">
                    {user?.email || "No email"}
                  </p>
                  {user?.firstName && user?.lastName && (
                    <p className="text-sm text-gray-400">
                      {user.firstName} {user.lastName}
                    </p>
                  )}
                </div>
              </div>

              {/* What's next info */}
              <div className="bg-gradient-to-r from-blue-950/50 via-indigo-950/50 to-purple-950/50 rounded-xl p-4 md:p-5 border border-blue-500/20">
                <div className="flex items-start gap-3">
                  <Mail className="w-5 h-5 text-blue-300 mt-0.5 flex-shrink-0" />
                  <div className="space-y-2">
                    <p className="text-sm md:text-base text-blue-200 font-semibold">What happens next?</p>
                    <p className="text-xs md:text-sm text-gray-300 leading-relaxed">
                      A PlanetBrick administrator will review your account and approve access. 
                      You'll be able to access the platform once approved. Hang tight!
                    </p>
                  </div>
                </div>
              </div>

              {/* Contact info */}
              <div className="bg-gradient-to-br from-gray-900/60 to-gray-800/60 rounded-xl p-3 md:p-4 border border-gray-700/30">
                <p className="text-xs md:text-sm text-gray-400 mb-1">
                  <strong className="text-gray-300">Need to contact us?</strong>
                </p>
                <p className="text-xs md:text-sm text-gray-500">
                  Email: <a href="mailto:bhnorby@gmail.com" className="text-cyan-400 hover:text-cyan-300 hover:underline transition-colors">bhnorby@gmail.com</a>
                </p>
              </div>

              {/* Logout button */}
              <Button 
                variant="outline" 
                className="w-full h-11 md:h-12 text-sm md:text-base border-gray-600 hover:border-gray-500 bg-gray-900/50 hover:bg-gray-800/50"
                onClick={() => window.location.href = '/api/logout'}
                data-testid="button-logout"
              >
                <LogOut className="w-4 h-4 md:w-5 md:h-5 mr-2" />
                Log Out
              </Button>
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
