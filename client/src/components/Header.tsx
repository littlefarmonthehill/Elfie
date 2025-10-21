import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import elfieRobot from "@assets/PlanetBrick_good_robot_1760672362080.png";

interface HeaderProps {
  onSettingsClick: () => void;
  onElfieClick: () => void;
}

export default function Header({ onSettingsClick, onElfieClick }: HeaderProps) {
  return (
    <header className="h-14 md:h-20 lg:h-24 border-b border-gray-800 flex items-center justify-between px-4 md:px-8 lg:px-10 bg-gradient-to-r from-blue-950 to-black relative">
      {/* Elfie Icon - Left */}
      <button
        onClick={onElfieClick}
        data-testid="button-elfie"
        className="relative group cursor-pointer flex items-center justify-center"
      >
        {/* Glow effect */}
        <div className="absolute inset-0 rounded-full bg-purple-500/30 blur-lg animate-pulse group-hover:bg-purple-400/40 transition-all duration-300" />
        
        {/* Robot icon */}
        <div className="relative w-10 h-10 md:w-14 md:h-14 lg:w-16 lg:h-16 rounded-full bg-purple-500/20 border-2 border-purple-500/50 flex items-center justify-center group-hover:border-purple-400/70 group-hover:scale-110 transition-all duration-300">
          <img 
            src={elfieRobot} 
            alt="E.L.F.I.E. AI Assistant" 
            className="w-8 h-8 md:w-12 md:h-12 lg:w-14 lg:h-14 object-contain"
          />
        </div>
        
        {/* Ripple effect on hover */}
        <div className="absolute inset-0 rounded-full border-2 border-purple-500/0 group-hover:border-purple-500/30 group-hover:scale-150 transition-all duration-500 opacity-0 group-hover:opacity-100" />
      </button>

      {/* App Name - Centered */}
      <h1 className="absolute left-1/2 transform -translate-x-1/2 text-base md:text-2xl lg:text-3xl font-bold text-foreground">
        PlanetBrick
      </h1>

      {/* Settings - Right */}
      <Button
        size="icon"
        variant="ghost"
        onClick={onSettingsClick}
        data-testid="button-settings"
        className="md:h-12 md:w-12 lg:h-14 lg:w-14"
      >
        <Settings className="h-4 w-4 md:h-6 md:w-6 lg:h-7 lg:w-7" />
      </Button>
    </header>
  );
}
