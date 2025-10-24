import { Link } from "wouter";
import { Sparkles, Calendar, Gift, Users, ArrowRight } from "lucide-react";
import planetBrickLogo from "@assets/PlanetBrick_with_planet_1761236028491.png";

export default function Landing() {
  const signs = [
    {
      id: "showroom",
      name: "Showroom",
      path: "/showroom",
      icon: Sparkles,
      neonColor: "#06B6D4",
      glowColor: "rgba(6, 182, 212, 0.6)",
      position: "top-[25%] right-[18%]",
      rotation: "-3deg",
      swayDelay: "0s"
    },
    {
      id: "events",
      name: "Events",
      path: "/events",
      icon: Calendar,
      neonColor: "#F59E0B",
      glowColor: "rgba(245, 158, 11, 0.6)",
      position: "bottom-[35%] right-[12%]",
      rotation: "4deg",
      swayDelay: "0.5s"
    },
    {
      id: "deals",
      name: "Deals",
      path: "/deals",
      icon: Gift,
      neonColor: "#A855F7",
      glowColor: "rgba(168, 85, 247, 0.6)",
      position: "bottom-[25%] left-[18%]",
      rotation: "-4deg",
      swayDelay: "1s"
    },
    {
      id: "community",
      name: "Community",
      path: "/community",
      icon: Users,
      neonColor: "#10B981",
      glowColor: "rgba(16, 185, 129, 0.6)",
      position: "top-[25%] left-[15%]",
      rotation: "3deg",
      swayDelay: "1.5s"
    }
  ];

  return (
    <div className="min-h-screen bg-black relative overflow-hidden">
      {/* Starfield background */}
      <div className="absolute inset-0">
        {[...Array(100)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-white rounded-full animate-pulse"
            style={{
              top: `${Math.random() * 100}%`,
              left: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 3}s`,
              animationDuration: `${2 + Math.random() * 3}s`,
              opacity: 0.3 + Math.random() * 0.7
            }}
          />
        ))}
      </div>

      {/* Atomic age decorative rings */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="relative w-[85vmin] h-[85vmin]">
          <div className="absolute inset-0 rounded-full border-2 border-cyan-400/10" />
          <div className="absolute inset-[15%] rounded-full border border-purple-400/10" />
          <div className="absolute inset-[30%] rounded-full border border-pink-400/10" />
        </div>
      </div>

      {/* Center logo with soft glow (no border) */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="relative z-10 pointer-events-auto">
          <div className="relative">
            {/* Multi-layer soft glow effect */}
            <div className="absolute -inset-8 md:-inset-12 rounded-full blur-3xl opacity-60" 
              style={{ 
                background: 'radial-gradient(circle, rgba(6, 182, 212, 0.3), rgba(168, 85, 247, 0.2), rgba(245, 158, 11, 0.15), transparent)',
                animation: 'gentlePulse 4s ease-in-out infinite'
              }} 
            />
            <div className="absolute -inset-6 md:-inset-10 rounded-full blur-2xl opacity-40" 
              style={{ 
                background: 'radial-gradient(circle, rgba(16, 185, 129, 0.3), rgba(6, 182, 212, 0.2), transparent)',
                animation: 'gentlePulse 4s ease-in-out infinite 0.5s'
              }} 
            />
            
            {/* Logo - LARGER */}
            <img 
              src={planetBrickLogo} 
              alt="PlanetBrick"
              className="relative w-48 h-48 md:w-72 md:h-72 lg:w-80 lg:h-80 object-contain"
              data-testid="img-logo-center"
              style={{ 
                animation: 'gentleFloat 6s ease-in-out infinite',
                filter: 'drop-shadow(0 0 30px rgba(6, 182, 212, 0.4)) drop-shadow(0 0 60px rgba(168, 85, 247, 0.3))'
              }}
            />
          </div>
        </div>
      </div>

      {/* Mid-century signage navigation */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="relative w-full h-full">
          {signs.map((sign) => (
            <Link
              key={sign.id}
              href={sign.path}
              className={`absolute ${sign.position} group pointer-events-auto`}
              data-testid={`link-${sign.id}`}
            >
              <div className="relative">
                {/* Sign post/pole */}
                <div 
                  className="absolute left-1/2 top-full w-1 md:w-1.5 h-8 md:h-12 -translate-x-1/2 opacity-70"
                  style={{
                    background: `linear-gradient(to bottom, ${sign.neonColor}, transparent)`,
                    boxShadow: `0 0 10px ${sign.glowColor}`,
                    animation: sign.id === 'showroom' ? 'postGlow 2s ease-in-out infinite' : 'none'
                  }}
                />

                {/* Jetsons-style angled sign plaque */}
                <div
                  className="relative hover-elevate active-elevate-2 transition-all duration-300"
                  style={{
                    transform: `rotate(${sign.rotation})`,
                    animation: `sway 4s ease-in-out infinite`,
                    animationDelay: sign.swayDelay
                  }}
                >
                  {/* Neon glow effect with flicker */}
                  <div 
                    className="absolute -inset-2 rounded-lg opacity-60 group-hover:opacity-100 transition-opacity blur-md"
                    style={{
                      background: sign.glowColor,
                      boxShadow: `0 0 20px ${sign.glowColor}, 0 0 40px ${sign.glowColor}`,
                      animation: 'neonFlicker 4s ease-in-out infinite'
                    }}
                  />

                  {/* Main sign plaque with chrome trim - SMALLER */}
                  <div 
                    className="relative px-2 py-1.5 md:px-4 md:py-2.5 rounded-lg border-2 group-hover:scale-105 transition-transform cursor-pointer"
                    style={{
                      background: `linear-gradient(135deg, #1a1a1a 0%, #000000 100%)`,
                      borderColor: sign.neonColor,
                      boxShadow: sign.id === 'showroom' 
                        ? `inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -1px 0 rgba(0,0,0,0.5), 0 0 20px ${sign.glowColor}, 0 0 40px ${sign.glowColor}`
                        : `inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -1px 0 rgba(0,0,0,0.5), 0 0 15px ${sign.glowColor}`,
                      animation: sign.id === 'showroom' ? 'primaryPulse 3s ease-in-out infinite' : 'fadeIn 0.8s ease-out forwards',
                      animationDelay: sign.id === 'showroom' ? '0s' : `${parseFloat(sign.swayDelay) + 0.2}s`,
                      opacity: sign.id === 'showroom' ? 1 : 0
                    }}
                  >
                    {/* Chrome accent bar */}
                    <div 
                      className="absolute top-0 left-0 right-0 h-0.5 rounded-t-lg opacity-40"
                      style={{
                        background: `linear-gradient(90deg, transparent, ${sign.neonColor}, transparent)`
                      }}
                    />

                    <div className="flex items-center gap-1.5 md:gap-2">
                      {/* Icon with neon effect */}
                      <sign.icon 
                        className="w-4 h-4 md:w-5 md:h-5 shrink-0" 
                        style={{ 
                          color: sign.neonColor,
                          filter: `drop-shadow(0 0 4px ${sign.glowColor})`
                        }}
                      />
                      
                      {/* Sign text - name only */}
                      <span 
                        className="text-xs md:text-base font-black uppercase tracking-wider"
                        style={{ 
                          color: sign.neonColor,
                          textShadow: `0 0 10px ${sign.glowColor}, 0 0 20px ${sign.glowColor}`
                        }}
                      >
                        {sign.name}
                      </span>

                      {/* Arrow pointer */}
                      <ArrowRight 
                        className="w-3 h-3 md:w-4 md:h-4 shrink-0 opacity-60 group-hover:opacity-100 group-hover:translate-x-1 transition-all"
                        style={{ color: sign.neonColor }}
                      />
                    </div>

                    {/* Starburst accent (optional decorative element) */}
                    <div 
                      className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 md:w-2 md:h-2 rounded-full opacity-80 animate-pulse"
                      style={{
                        background: sign.neonColor,
                        boxShadow: `0 0 8px ${sign.glowColor}`
                      }}
                    />
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Enhanced tagline with better prominence */}
      <div className="absolute bottom-12 md:bottom-16 left-0 right-0 text-center z-10 px-4">
        <div className="relative inline-block max-w-2xl">
          {/* Glow effects */}
          <div className="absolute -inset-4 bg-gradient-to-r from-cyan-500/10 via-purple-500/10 to-pink-500/10 blur-2xl opacity-60 animate-pulse" style={{ animationDuration: '3s' }} />
          
          {/* Main tagline */}
          <p className="relative text-base md:text-xl lg:text-2xl text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 font-bold tracking-wide">
            Your Universe of LEGO® Parts & Community
          </p>
        </div>
      </div>

      {/* Custom CSS for animations */}
      <style>{`
        @keyframes sway {
          0%, 100% { 
            transform: rotate(var(--base-rotation)) translateY(0px); 
          }
          50% { 
            transform: rotate(var(--base-rotation)) translateY(-5px); 
          }
        }
        
        @keyframes gentlePulse {
          0%, 100% { 
            opacity: 0.6;
            transform: scale(1);
          }
          50% { 
            opacity: 0.8;
            transform: scale(1.05);
          }
        }
        
        @keyframes gentleFloat {
          0%, 100% { transform: translateY(0px) scale(1); }
          50% { transform: translateY(-8px) scale(1.02); }
        }
        
        @keyframes neonFlicker {
          0%, 100% { opacity: 0.6; }
          5%, 95% { opacity: 0.5; }
          10%, 90% { opacity: 0.65; }
          15%, 85% { opacity: 0.55; }
          20%, 80% { opacity: 0.7; }
          50% { opacity: 0.8; }
        }
        
        @keyframes fadeIn {
          from { 
            opacity: 0; 
            transform: translateY(10px);
          }
          to { 
            opacity: 1; 
            transform: translateY(0);
          }
        }
        
        @keyframes primaryPulse {
          0%, 100% { 
            transform: scale(1);
            filter: brightness(1);
          }
          50% { 
            transform: scale(1.03);
            filter: brightness(1.1);
          }
        }
        
        @keyframes postGlow {
          0%, 100% { 
            opacity: 0.5;
          }
          50% { 
            opacity: 0.9;
          }
        }
        
        ${signs.map(sign => `
          [data-testid="link-${sign.id}"] > div > div:first-child {
            --base-rotation: ${sign.rotation};
          }
        `).join('\n')}
      `}</style>
    </div>
  );
}
