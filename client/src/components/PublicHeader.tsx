import { Link, useLocation } from "wouter";
import { ShoppingCart, LogOut, Sparkles, Calendar, Gift, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import planetBrickLogo from "@assets/PlanetBrick_with_planet_1761236028491.png";

interface PublicHeaderProps {
  cartCount?: number;
  onCartClick?: () => void;
}

export function PublicHeader({ cartCount = 0, onCartClick }: PublicHeaderProps) {
  const [location] = useLocation();
  const { toast } = useToast();

  // Check authentication status
  const { data: user } = useQuery<any>({
    queryKey: ['/api/auth/user'],
    retry: false,
  });

  // Fetch stats
  const { data: statsData } = useQuery<{
    totalLots: number;
    totalParts: number;
  }>({
    queryKey: ['/api/shop/stats'],
  });

  // Logout mutation
  const logoutMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/logout'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      toast({
        title: "Logged out",
        description: "You have been logged out successfully",
      });
    },
  });

  const navItems = [
    { path: "/showroom", label: "Showroom", icon: Sparkles, color: "lego-blue" },
    { path: "/deals", label: "Deals", icon: Gift, color: "lego-red" },
    { path: "/events", label: "Events", icon: Calendar, color: "lego-orange" },
    { path: "/community", label: "Community", icon: Users, color: "lego-green" },
  ];

  const totalLots = statsData?.totalLots || 0;
  const totalParts = statsData?.totalParts || 0;

  return (
    <header className="relative border-b border-white/10">
      {/* Top Banner - Frozen at Top */}
      <div className="sticky top-0 z-50 bg-gradient-to-b from-blue-950 via-blue-950/90 to-black/95 backdrop-blur-xl relative pb-12 md:pb-14 min-h-0">
        <div className="px-4 md:px-8 py-1.5 md:py-2 flex items-start justify-between relative">
          {/* Cart & Login - Top Right */}
          <div className="flex items-center gap-1.5 md:gap-3 ml-auto">
            {onCartClick && (
              <Button 
                size="icon" 
                variant="ghost" 
                className="text-cyan-300 h-8 w-8 md:h-10 md:w-10 relative hover-elevate" 
                onClick={onCartClick}
                data-testid="button-cart"
              >
                <ShoppingCart className="w-4 h-4 md:w-5 md:h-5" />
                {cartCount > 0 && (
                  <Badge className="absolute -top-1 -right-1 h-4 w-4 md:h-5 md:w-5 flex items-center justify-center p-0 text-[8px] md:text-[9px] bg-cyan-500 border-none font-bold">
                    {cartCount}
                  </Badge>
                )}
              </Button>
            )}
            {user ? (
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-cyan-300 text-[9px] md:text-sm h-8 md:h-10 px-2 md:px-3" 
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
                data-testid="button-logout-header"
              >
                <LogOut className="w-3 h-3 md:w-4 md:h-4 mr-1" />
                Logout
              </Button>
            ) : (
              <Link href="/login">
                <Button variant="ghost" size="sm" className="text-cyan-300 text-[9px] md:text-sm h-8 md:h-10 px-2 md:px-3" data-testid="button-login-header">
                  Login
                </Button>
              </Link>
            )}
          </div>
        </div>

        {/* Centered Logo - Vertically centered and prominent */}
        <Link href="/" className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[60] cursor-pointer hover:opacity-80 transition-opacity">
          <img 
            src={planetBrickLogo} 
            alt="PlanetBrick" 
            className="h-14 md:h-16 lg:h-20 w-auto object-contain drop-shadow-2xl"
            data-testid="logo-planetbrick"
          />
        </Link>

        {/* Stats Row - Smaller text */}
        <div className="absolute bottom-2 left-0 right-0 flex items-center justify-between px-4 md:px-8 lg:px-12 z-[50]">
          {/* Lots - Left */}
          <div className="flex items-center gap-2 relative">
            <div className="relative">
              <Sparkles className="w-4 h-4 md:w-5 md:h-5 text-cyan-400" />
            </div>
            <div className="text-left">
              <div className="text-[10px] md:text-xs font-bold text-white">{totalLots.toLocaleString()}</div>
              <div className="text-[10px] md:text-xs text-gray-400">Unique Lots</div>
            </div>
          </div>

          {/* Parts - Right */}
          <div className="flex items-center gap-2">
            <div className="text-right">
              <div className="text-[10px] md:text-xs font-bold text-white">{totalParts.toLocaleString()}</div>
              <div className="text-[10px] md:text-xs text-gray-400">Total Parts</div>
            </div>
            <div className="relative">
              <Sparkles className="w-4 h-4 md:w-5 md:h-5 text-blue-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs - Scrolls with Page */}
      <div className="relative border-t border-white/10 bg-black/95 backdrop-blur-xl py-2">
        <div className="px-3 md:px-6">
          <div className="flex flex-row gap-1.5 md:gap-2 justify-center items-center overflow-x-auto scrollbar-hide">
            {navItems.map((item) => {
              const isActive = location === item.path;
              return (
                <Link key={item.path} href={item.path}>
                  <button
                    className={cn(
                      "px-3 md:px-6 lg:px-8 py-1.5 md:py-2.5 lg:py-3 rounded-full text-sm md:text-base lg:text-lg font-semibold whitespace-nowrap transition-all",
                      isActive && item.color === 'lego-blue' && "bg-lego-blue text-white",
                      !isActive && item.color === 'lego-blue' && "text-lego-blue/60 hover:bg-lego-blue/30",
                      isActive && item.color === 'lego-red' && "bg-lego-red text-white",
                      !isActive && item.color === 'lego-red' && "text-lego-red/60 hover:bg-lego-red/30",
                      isActive && item.color === 'lego-orange' && "bg-lego-orange text-white",
                      !isActive && item.color === 'lego-orange' && "text-lego-orange/60 hover:bg-lego-orange/30",
                      isActive && item.color === 'lego-green' && "bg-lego-green text-white",
                      !isActive && item.color === 'lego-green' && "text-lego-green/60 hover:bg-lego-green/30"
                    )}
                    data-testid={`nav-${item.label.toLowerCase()}`}
                  >
                    {item.label}
                  </button>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </header>
  );
}
