import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Smartphone, Share2, PlusSquare, ArrowRight, Sparkles } from "lucide-react";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import type { User } from "@shared/schema";

interface Props {
  user: User;
  orgName: string;
  onComplete: () => void;
}

const STORAGE_KEY = "pb_employee_onboarded";

export function hasCompletedEmployeeWelcome(userId: string): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const ids: string[] = JSON.parse(raw);
    return ids.includes(userId);
  } catch {
    return false;
  }
}

function markEmployeeWelcomeComplete(userId: string) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const ids: string[] = raw ? JSON.parse(raw) : [];
    if (!ids.includes(userId)) ids.push(userId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {}
}

export default function EmployeeWelcome({ user, orgName, onComplete }: Props) {
  const { status: installStatus, promptInstall } = useInstallPrompt();
  const [done, setDone] = useState(false);

  const handleFinish = () => {
    markEmployeeWelcomeComplete(user.id);
    onComplete();
  };

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">

        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 mb-3">
            <Sparkles className="w-5 h-5 text-lego-yellow" />
            <span className="text-sm font-semibold uppercase tracking-widest text-gray-400">Welcome</span>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">
            Welcome to {orgName}
          </h1>
          <p className="text-sm text-gray-400">
            Hi {user.firstName || "there"}! You're all set to start using PlanetBrick with your team.
          </p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-5">

          <div className="text-center py-2">
            <div className="w-14 h-14 rounded-full bg-green-500/10 border-2 border-green-500/30 flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="w-7 h-7 text-green-400" />
            </div>
            <p className="text-sm text-gray-300">
              Your account has been approved. You can now access the dashboard and all the tools your team uses.
            </p>
          </div>

          {installStatus !== "installed" && installStatus !== "unsupported" && (
            <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-blue-400 flex-shrink-0" />
                <p className="text-xs font-medium text-gray-300">Add PlanetBrick to your home screen</p>
              </div>
              {installStatus === "promptable" ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] text-gray-500">Get one-tap access from any device.</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await promptInstall();
                      setDone(true);
                    }}
                    data-testid="button-employee-install"
                  >
                    Add now
                  </Button>
                </div>
              ) : installStatus === "ios" ? (
                <ol className="space-y-1 pl-1">
                  <li className="flex items-start gap-2 text-[11px] text-gray-400">
                    <span className="flex-shrink-0 w-4 h-4 rounded-full bg-gray-700 flex items-center justify-center text-[9px] font-bold text-gray-300 mt-0.5">1</span>
                    <span>Tap <Share2 className="inline w-3 h-3 mb-0.5" /> Share at the bottom of Safari</span>
                  </li>
                  <li className="flex items-start gap-2 text-[11px] text-gray-400">
                    <span className="flex-shrink-0 w-4 h-4 rounded-full bg-gray-700 flex items-center justify-center text-[9px] font-bold text-gray-300 mt-0.5">2</span>
                    <span>Tap <PlusSquare className="inline w-3 h-3 mb-0.5" /> <strong className="text-gray-300">Add to Home Screen</strong>, then <strong className="text-gray-300">Add</strong></span>
                  </li>
                </ol>
              ) : null}
            </div>
          )}

          <div className="flex justify-center pt-1">
            <Button onClick={handleFinish} size="lg" data-testid="button-employee-welcome-done">
              Go to dashboard
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
