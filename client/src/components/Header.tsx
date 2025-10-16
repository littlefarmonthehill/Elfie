import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HeaderProps {
  onSettingsClick: () => void;
}

export default function Header({ onSettingsClick }: HeaderProps) {
  return (
    <header className="h-14 md:h-16 lg:h-20 border-b border-gray-800 flex items-center justify-between px-4 md:px-6 lg:px-8 bg-gradient-to-r from-blue-950 to-black">
      <h1 className="text-base md:text-lg lg:text-xl font-bold text-foreground">PlanetBrick</h1>
      <Button
        size="icon"
        variant="ghost"
        onClick={onSettingsClick}
        data-testid="button-settings"
        className="md:h-10 md:w-10 lg:h-12 lg:w-12"
      >
        <Settings className="h-4 w-4 md:h-5 md:w-5 lg:h-6 lg:w-6" />
      </Button>
    </header>
  );
}
