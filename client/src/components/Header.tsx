import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";

interface HeaderProps {
  onSettingsClick: () => void;
}

export default function Header({ onSettingsClick }: HeaderProps) {
  return (
    <header className="h-14 border-b border-gray-800 flex items-center justify-between px-4 bg-gradient-to-r from-blue-950 to-black">
      <h1 className="text-base font-bold text-foreground">PlanetBrick</h1>
      <Button
        size="icon"
        variant="ghost"
        onClick={onSettingsClick}
        data-testid="button-settings"
      >
        <Settings className="h-4 w-4" />
      </Button>
    </header>
  );
}
