import { Link } from "wouter";
import { Sparkles, Calendar, Gift, Users } from "lucide-react";
import planetBrickLogo from "@assets/PlanetBrick_with_planet_1761236028491.png";

export default function Landing() {
  const planets = [
    {
      id: "showroom",
      name: "Showroom",
      path: "/showroom",
      icon: Sparkles,
      color: "from-cyan-500 to-blue-600",
      position: "top-[10%] left-[50%] -translate-x-1/2",
      orbitDelay: "0s",
      description: "Browse our LEGO® collection"
    },
    {
      id: "events",
      name: "Events",
      path: "/events",
      icon: Calendar,
      color: "from-amber-500 to-orange-600",
      position: "top-[50%] right-[10%] -translate-y-1/2",
      orbitDelay: "0.75s",
      description: "Workshops & special events"
    },
    {
      id: "deals",
      name: "Deals",
      path: "/deals",
      icon: Gift,
      color: "from-purple-500 to-pink-600",
      position: "bottom-[10%] left-[50%] -translate-x-1/2",
      orbitDelay: "1.5s",
      description: "Exclusive bundles & offers"
    },
    {
      id: "community",
      name: "Community",
      path: "/community",
      icon: Users,
      color: "from-emerald-500 to-teal-600",
      position: "top-[50%] left-[10%] -translate-y-1/2",
      orbitDelay: "2.25s",
      description: "Videos, blogs & news"
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

      {/* Orbital paths */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative w-[90vmin] h-[90vmin]">
          {/* Outer orbit ring */}
          <div className="absolute inset-0 rounded-full border border-cyan-500/20 animate-spin-slow" style={{ animationDuration: '60s' }} />
          <div className="absolute inset-[10%] rounded-full border border-purple-500/20 animate-spin-slow" style={{ animationDuration: '45s', animationDirection: 'reverse' }} />
          <div className="absolute inset-[20%] rounded-full border border-blue-500/20 animate-spin-slow" style={{ animationDuration: '30s' }} />
        </div>
      </div>

      {/* Center logo */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative z-10">
          <div className="relative">
            {/* Glow effect */}
            <div className="absolute -inset-8 bg-gradient-to-r from-cyan-500/20 via-blue-500/20 to-purple-500/20 rounded-full blur-3xl animate-pulse" style={{ animationDuration: '4s' }} />
            
            {/* Logo */}
            <img 
              src={planetBrickLogo} 
              alt="PlanetBrick"
              className="relative w-48 h-48 md:w-64 md:h-64 object-contain drop-shadow-2xl"
              data-testid="img-logo-center"
            />
          </div>
        </div>
      </div>

      {/* Planet navigation buttons */}
      <div className="absolute inset-0">
        <div className="relative w-full h-full">
          {planets.map((planet) => (
            <Link
              key={planet.id}
              href={planet.path}
              className={`absolute ${planet.position} group`}
              data-testid={`link-${planet.id}`}
            >
              <div className="relative">
                {/* Orbit animation */}
                <div 
                  className="absolute -inset-4 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{
                    background: `radial-gradient(circle, ${planet.color.split(' ')[1]} 0%, transparent 70%)`,
                    filter: 'blur(20px)'
                  }}
                />
                
                {/* Planet button */}
                <div 
                  className={`relative w-24 h-24 md:w-32 md:h-32 rounded-full bg-gradient-to-br ${planet.color} 
                    hover:scale-110 transition-all duration-300 cursor-pointer
                    flex flex-col items-center justify-center gap-1 md:gap-2
                    border-2 border-white/20 shadow-2xl
                    hover-elevate active-elevate-2`}
                  style={{
                    animation: `float 3s ease-in-out infinite`,
                    animationDelay: planet.orbitDelay
                  }}
                >
                  <planet.icon className="w-8 h-8 md:w-10 md:h-10 text-white drop-shadow-lg" />
                  <span className="text-xs md:text-sm font-bold text-white drop-shadow-lg">
                    {planet.name}
                  </span>
                </div>

                {/* Description tooltip */}
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  <div className="bg-black/90 backdrop-blur-sm border border-white/20 rounded-lg px-3 py-1.5 whitespace-nowrap">
                    <p className="text-xs text-gray-300">{planet.description}</p>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Bottom tagline */}
      <div className="absolute bottom-8 left-0 right-0 text-center z-10">
        <p className="text-sm md:text-base text-gray-400 drop-shadow-lg">
          Your Universe of LEGO® Parts & Community
        </p>
      </div>

      {/* Custom CSS for animations */}
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-spin-slow {
          animation: spin-slow 60s linear infinite;
        }
      `}</style>
    </div>
  );
}
