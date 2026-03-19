import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScanSearch, Zap, Camera, Star, ChevronRight, CheckCircle2 } from "lucide-react";
import elfieRobot from "@assets/PlanetBrick_good_robot_1760672362080.png";

const STORAGE_KEY = (userId: string) => `bsWelcomeDone_${userId}`;

export function hasCompletedBsWelcome(userId: string): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY(userId)) === 'true';
  } catch {
    return false;
  }
}

function markBsWelcomeDone(userId: string) {
  try {
    localStorage.setItem(STORAGE_KEY(userId), 'true');
  } catch {}
}

interface Props {
  userId: string;
  onComplete: () => void;
}

const FEATURES = [
  { icon: Camera, label: "Snap a photo", detail: "Take a picture of any LEGO part — loose or bagged" },
  { icon: ScanSearch, label: "Instant ID", detail: "E.L.F.I.E. matches it against the entire BrickLink catalog" },
  { icon: Star, label: "Market data", detail: "See current prices and set listings in seconds" },
];

export default function BrickSpotterWelcome({ userId, onComplete }: Props) {
  const [step, setStep] = useState<1 | 2>(1);

  const handleDone = () => {
    markBsWelcomeDone(userId);
    onComplete();
  };

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-md py-8 space-y-6">

        {/* Header — E.L.F.I.E. + title */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-lego-yellow/20 blur-2xl scale-150" />
            <img
              src={elfieRobot}
              alt="E.L.F.I.E."
              className="relative w-24 h-24 object-contain drop-shadow-lg"
            />
          </div>
          <div>
            <div className="inline-flex items-center gap-2 mb-2 px-3 py-1 rounded-full bg-lego-yellow/10 border border-lego-yellow/30">
              <ScanSearch className="w-3.5 h-3.5 text-lego-yellow" />
              <span className="text-xs font-bold text-lego-yellow uppercase tracking-widest">BrickSpotter 3000</span>
            </div>
            <h1 className="text-2xl font-bold text-white">
              {step === 1 ? "Welcome aboard!" : "You're ready to scan!"}
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              {step === 1
                ? "Your BrickSpotter 3000 membership is active. Here's what you can do."
                : "Point your camera at any LEGO part to get started."}
            </p>
          </div>
        </div>

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2">
          <div className={`w-2 h-2 rounded-full transition-colors ${step === 1 ? 'bg-lego-yellow' : 'bg-gray-600'}`} />
          <div className={`w-2 h-2 rounded-full transition-colors ${step === 2 ? 'bg-lego-yellow' : 'bg-gray-600'}`} />
        </div>

        {/* Step 1 — feature overview */}
        {step === 1 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            {FEATURES.map(({ icon: Icon, label, detail }) => (
              <div key={label} className="flex items-start gap-3">
                <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-lego-yellow/10 border border-lego-yellow/20 flex items-center justify-center">
                  <Icon className="w-4 h-4 text-lego-yellow" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{detail}</p>
                </div>
              </div>
            ))}

            <div className="border-t border-gray-800 pt-4">
              <div className="flex items-start gap-2 text-xs text-gray-500">
                <Zap className="w-3.5 h-3.5 text-lego-yellow flex-shrink-0 mt-0.5" />
                <span>Scans run on E.L.F.I.E.'s platform BrickLink account — no API key required from you.</span>
              </div>
            </div>

            <Button
              onClick={() => setStep(2)}
              className="w-full bg-lego-yellow text-gray-900 font-semibold hover:bg-lego-yellow/90"
              data-testid="button-bs-welcome-next"
            >
              Next
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* Step 2 — quick-start tips */}
        {step === 2 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
            <div className="space-y-3">
              {[
                "Open the scanner using the Brick Spotter 3000 panel that opens automatically.",
                "Tap the camera icon and frame the LEGO part clearly in good light.",
                "E.L.F.I.E. returns the part number, name, and current BrickLink market price.",
                "Tap any result to see full detail — colors, availability, and pricing history.",
              ].map((tip, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-lego-yellow flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-gray-300 leading-snug">{tip}</p>
                </div>
              ))}
            </div>

            <Button
              onClick={handleDone}
              className="w-full bg-lego-yellow text-gray-900 font-semibold hover:bg-lego-yellow/90"
              data-testid="button-bs-welcome-start"
            >
              <ScanSearch className="w-4 h-4 mr-1.5" />
              Start Scanning
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
