import { Link } from "wouter";
import { ArrowLeft, Calendar, Clock, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function Events() {
  return (
    <div className="min-h-screen bg-black">
      {/* Header with Navigation */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-black/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 py-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-3">
            <Link href="/">
              <Button variant="ghost" size="sm" data-testid="button-back-home">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Home
              </Button>
            </Link>
            
            {/* Navigation Links */}
            <nav className="flex flex-wrap items-center justify-center gap-2 md:gap-3">
              <Link href="/showroom">
                <Button variant="ghost" size="sm" className="text-cyan-400 hover:text-cyan-300" data-testid="nav-showroom">
                  Showroom
                </Button>
              </Link>
              <Link href="/events">
                <Button variant="ghost" size="sm" className="text-amber-400 hover:text-amber-300 font-bold" data-testid="nav-events">
                  Events
                </Button>
              </Link>
              <Link href="/deals">
                <Button variant="ghost" size="sm" className="text-purple-400 hover:text-purple-300" data-testid="nav-deals">
                  Deals
                </Button>
              </Link>
              <Link href="/community">
                <Button variant="ghost" size="sm" className="text-emerald-400 hover:text-emerald-300" data-testid="nav-community">
                  Community
                </Button>
              </Link>
            </nav>
          </div>
        </div>
      </header>

      {/* Coming Soon Content */}
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          {/* Icon */}
          <div className="flex justify-center">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-amber-500/20 to-orange-500/20 rounded-full blur-3xl animate-pulse" />
              <div className="relative w-32 h-32 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center border-4 border-white/20">
                <Calendar className="w-16 h-16 text-white" />
              </div>
            </div>
          </div>

          {/* Title */}
          <div className="space-y-4">
            <h1 className="text-4xl md:text-6xl font-bold bg-gradient-to-r from-amber-400 via-orange-500 to-red-500 bg-clip-text text-transparent">
              Upcoming Events
            </h1>
            <p className="text-xl md:text-2xl text-gray-400">
              Workshops, Building Classes & Special Events
            </p>
          </div>

          {/* Coming Soon Badge */}
          <div className="inline-block">
            <div className="px-6 py-3 rounded-full bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/30">
              <p className="text-amber-400 font-semibold">Coming Soon</p>
            </div>
          </div>

          {/* Description */}
          <Card className="p-8 bg-gray-900/60 border-amber-500/30">
            <div className="space-y-6 text-left">
              <p className="text-gray-300 text-lg">
                We're planning exciting LEGO® building workshops and community events!
              </p>
              
              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <Users className="w-6 h-6 text-amber-400 shrink-0 mt-1" />
                  <div>
                    <h3 className="font-bold text-white mb-1">Building Workshops</h3>
                    <p className="text-gray-400">Hands-on sessions for builders of all skill levels</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4">
                  <Clock className="w-6 h-6 text-orange-400 shrink-0 mt-1" />
                  <div>
                    <h3 className="font-bold text-white mb-1">Special Events</h3>
                    <p className="text-gray-400">Community gatherings, competitions, and showcases</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4">
                  <Calendar className="w-6 h-6 text-red-400 shrink-0 mt-1" />
                  <div>
                    <h3 className="font-bold text-white mb-1">Regular Schedule</h3>
                    <p className="text-gray-400">Monthly events to bring the community together</p>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* CTA */}
          <div className="pt-8">
            <p className="text-gray-500 mb-4">Check back soon for our event calendar!</p>
            <Link href="/showroom">
              <Button size="lg" className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700" data-testid="button-visit-showroom">
                <Sparkles className="w-4 h-4 mr-2" />
                Visit Showroom
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function Sparkles({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 3v18M3 12h18M6.343 6.343l11.314 11.314M17.657 6.343L6.343 17.657" />
    </svg>
  );
}
