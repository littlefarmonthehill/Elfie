import { useState, useEffect, useRef, useCallback } from "react";
import { Settings, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import elfieRobot from "@assets/PlanetBrick_good_robot_1760672362080.png";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";

interface HeaderProps {
  onSettingsClick: () => void;
  onElfieClick: () => void;
  supportNotification?: boolean;
  hideSettings?: boolean;
}

export default function Header({ onSettingsClick, onElfieClick, supportNotification, hideSettings }: HeaderProps) {
  const { user, superAdmin } = useAuth();
  const logoutMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/logout'),
    onSuccess: () => { window.location.href = '/'; },
  });
  const { data: org } = useQuery<any>({
    queryKey: ['/api/org'],
  });

  const { data: supportQueueCount } = useQuery<{ count: number }>({
    queryKey: ['/api/platform-admin/support-queue/count'],
    enabled: !!superAdmin,
    refetchInterval: 15000,
  });

  const prevCountRef = useRef<number>(-1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>('default');

  useEffect(() => {
    if (!superAdmin) return;
    if ('Notification' in window) {
      setNotifPermission(Notification.permission);
      if (Notification.permission === 'default') {
        Notification.requestPermission().then(setNotifPermission);
      }
    }
  }, [superAdmin]);

  const playAlert = useCallback(() => {
    try {
      if (!audioRef.current) {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.value = 0.15;
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.stop(ctx.currentTime + 0.4);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!superAdmin || !supportQueueCount) return;
    const current = supportQueueCount.count || 0;
    const prev = prevCountRef.current;
    if (prev === -1) {
      prevCountRef.current = current;
      return;
    }
    if (current > prev) {
      playAlert();
      if ('vibrate' in navigator) {
        try { navigator.vibrate([200, 100, 200]); } catch {}
      }
      if (notifPermission === 'granted' && document.hidden) {
        try {
          new Notification('E.L.F.I.E. Support', {
            body: `${current} open support ticket${current !== 1 ? 's' : ''} waiting`,
            icon: elfieRobot,
            tag: 'support-queue',
          });
        } catch {}
      }
    }
    prevCountRef.current = current;
  }, [supportQueueCount?.count, superAdmin, notifPermission, playAlert]);

  const openTicketCount = supportQueueCount?.count || 0;

  return (
    <header className="border-b border-gray-800 bg-gradient-to-r from-blue-950 to-black relative">
      {/* iOS Safe Area spacer */}
      <div style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }} />
      
      {/* Header content */}
      <div className="h-12 md:h-14 lg:h-16 flex items-center justify-between px-4 md:px-6 lg:px-8 relative">
        {/* Elfie Icon - Left */}
        <div className="flex items-center gap-4">
          <button
            onClick={onElfieClick}
            data-testid="button-elfie"
            className="relative group cursor-pointer flex items-center justify-center"
          >
            {/* Glow effect */}
            <div className="absolute inset-0 rounded-full bg-purple-500/30 blur-lg animate-pulse group-hover:bg-purple-400/40 transition-all duration-300" />
            
            {/* Robot icon */}
            <div className="relative w-9 h-9 md:w-10 md:h-10 lg:w-11 lg:h-11 rounded-full bg-purple-500/20 border-2 border-purple-500/50 flex items-center justify-center group-hover:border-purple-400/70 group-hover:scale-110 transition-all duration-300">
              <img 
                src={elfieRobot} 
                alt="E.L.F.I.E. AI Assistant" 
                className="w-7 h-7 md:w-8 md:h-8 lg:w-9 lg:h-9 object-contain"
              />
            </div>
            
            {/* Ripple effect on hover */}
            <div className="absolute inset-0 rounded-full border-2 border-purple-500/0 group-hover:border-purple-500/30 group-hover:scale-150 transition-all duration-500 opacity-0 group-hover:opacity-100" />

            {supportNotification && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 md:h-5 md:w-5 z-10">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-4 w-4 md:h-5 md:w-5 bg-green-500 border-2 border-black items-center justify-center">
                  <span className="text-[8px] md:text-[9px] font-bold text-white">!</span>
                </span>
              </span>
            )}
          </button>

        </div>

        {/* App Name - Centered */}
        <h1 className="absolute left-1/2 transform -translate-x-1/2 text-sm md:text-base lg:text-lg font-bold text-foreground">
          {org?.name ?? 'E.L.F.I.E.'}
        </h1>

        {/* Settings / Sign-out - Right */}
        <div className="flex items-center gap-2">
          {hideSettings ? (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              data-testid="button-signout-header"
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          ) : (
            <div className="relative">
              <Button
                size="icon"
                variant="ghost"
                onClick={onSettingsClick}
                data-testid="button-settings"
                title="Settings"
              >
                <Settings className="h-4 w-4" />
              </Button>
              {superAdmin && openTicketCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-red-500 border-2 border-black text-[10px] font-bold text-white px-1 z-10" data-testid="badge-support-count">
                  {openTicketCount > 9 ? '9+' : openTicketCount}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
