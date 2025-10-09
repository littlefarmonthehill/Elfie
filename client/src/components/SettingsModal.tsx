import { X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px] bg-gray-900 border-gray-700">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">Settings</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="bricklink-key" className="text-xs text-gray-400">BrickLink API Key</Label>
            <Input
              id="bricklink-key"
              placeholder="Enter BrickLink API Key"
              className="text-xs"
              data-testid="input-bricklink-key"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="bricklink-secret" className="text-xs text-gray-400">BrickLink Secret</Label>
            <Input
              id="bricklink-secret"
              type="password"
              placeholder="Enter BrickLink Secret"
              className="text-xs"
              data-testid="input-bricklink-secret"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="shipstation-key" className="text-xs text-gray-400">ShipStation API Key</Label>
            <Input
              id="shipstation-key"
              placeholder="Enter ShipStation API Key"
              className="text-xs"
              data-testid="input-shipstation-key"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="shipstation-secret" className="text-xs text-gray-400">ShipStation Secret</Label>
            <Input
              id="shipstation-secret"
              type="password"
              placeholder="Enter ShipStation Secret"
              className="text-xs"
              data-testid="input-shipstation-secret"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="openrouter-key" className="text-xs text-gray-400">OpenRouter API Key</Label>
            <Input
              id="openrouter-key"
              type="password"
              placeholder="Enter OpenRouter API Key"
              className="text-xs"
              data-testid="input-openrouter-key"
            />
          </div>
        </div>
        
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} data-testid="button-cancel">
            Cancel
          </Button>
          <Button size="sm" onClick={onClose} data-testid="button-save">
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
