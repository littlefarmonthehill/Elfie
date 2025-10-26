import { Link, useLocation } from "wouter";
import { ShoppingCart, LogOut, Sparkles, Calendar, Gift, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
    { path: "/showroom", label: "Showroom", icon: Sparkles, color: "text-cyan-400 hover:text-cyan-400 hover:border-cyan-400" },
    { path: "/deals", label: "Deals", icon: Gift, color: "text-purple-400 hover:text-purple-400 hover:border-purple-400" },
    { path: "/events", label: "Events", icon: Calendar, color: "text-amber-400 hover:text-amber-400 hover:border-amber-400" },
    { path: "/community", label: "Community", icon: Users, color: "text-emerald-400 hover:text-emerald-400 hover:border-emerald-400" },
  ];

  const totalLots = statsData?.totalLots || 0;
  const totalParts = statsData?.totalParts || 0;

  return (
    <header className="sticky top-0 z-50 bg-gradient-to-b from-blue-950 via-blue-950/90 to-black/95 backdrop-blur-xl border-b border-white/10">
      {/* Top section with logo, stats, and user controls */}
      <div className="relative pb-12 md:pb-14">
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

        {/* Centered Logo - Compact */}
        <Link href="/" className="absolute left-1/2 -translate-x-1/2 top-1 md:top-2 z-[60] cursor-pointer hover:opacity-80 transition-opacity">
          <img 
            src={planetBrickLogo} 
            alt="PlanetBrick" 
            className="h-12 md:h-14 lg:h-16 w-auto object-contain drop-shadow-2xl"
            data-testid="logo-planetbrick"
          />
        </Link>

        {/* Stats Row - Lower in lighter band, closer to edges */}
        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-4 md:px-8 lg:px-12 z-[50]">
          {/* Lots - Left */}
          <div className="flex items-center gap-2 md:gap-3 relative group">
            <div className="absolute -left-8 top-1/2 -translate-y-1/2 w-32 h-px bg-gradient-to-r from-transparent via-cyan-400/40 to-cyan-500/60 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            <div className="relative">
              <Sparkles className="w-4 h-4 md:w-5 md:h-5 lg:w-6 lg:h-6 text-cyan-400" />
            </div>
            <div className="text-left">
              <div className="text-sm md:text-lg lg:text-xl font-bold text-white">{totalLots.toLocaleString()}</div>
              <div className="text-[9px] md:text-xs lg:text-sm text-gray-400">Unique Lots</div>
            </div>
          </div>

          {/* Parts - Right */}
          <div className="flex items-center gap-2 md:gap-3 group">
            <div className="text-right">
              <div className="text-sm md:text-lg lg:text-xl font-bold text-white">{totalParts.toLocaleString()}</div>
              <div className="text-[9px] md:text-xs lg:text-sm text-gray-400">Total Parts</div>
            </div>
            <div className="relative">
              <Sparkles className="w-4 h-4 md:w-5 md:h-5 lg:w-6 lg:h-6 text-blue-400" />
            </div>
            <div className="absolute -right-8 top-1/2 -translate-y-1/2 w-32 h-px bg-gradient-to-l from-transparent via-blue-400/40 to-blue-500/60 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          </div>
        </div>
      </div>

      {/* Navigation Tabs - Single row, no wrapping */}
      <div className="border-t border-white/10 bg-black/80 py-2">
        <div className="px-3 md:px-6">
          <div className="flex flex-row gap-1.5 md:gap-3 justify-center">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location === item.path;
              return (
                <Link key={item.path} href={item.path}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={`rounded-full border ${
                      isActive 
                        ? `border-current ${item.color.split(' ')[0]} font-bold` 
                        : `border-transparent text-gray-400 hover:text-gray-300`
                    } transition-colors px-3 md:px-4 h-8 md:h-9`}
                    data-testid={`nav-${item.label.toLowerCase()}`}
                  >
                    <Icon className="w-3 h-3 md:w-4 md:h-4 mr-1.5 md:mr-2" />
                    <span className="text-[10px] md:text-sm font-semibold whitespace-nowrap">{item.label}</span>
                  </Button>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </header>
  );
}
