import { Link } from "wouter";
import { Users, Video, BookOpen, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PublicHeader } from "@/components/PublicHeader";

export default function Community() {
  return (
    <div className="min-h-screen bg-black">
      {/* Header with Navigation */}
      <PublicHeader />

      {/* Coming Soon Content */}
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          {/* Icon */}
          <div className="flex justify-center">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/20 to-teal-500/20 rounded-full blur-3xl animate-pulse" />
              <div className="relative w-32 h-32 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center border-4 border-white/20">
                <Users className="w-16 h-16 text-white" />
              </div>
            </div>
          </div>

          {/* Title */}
          <div className="space-y-4">
            <h1 className="text-4xl md:text-6xl font-bold bg-gradient-to-r from-emerald-400 via-teal-500 to-cyan-500 bg-clip-text text-transparent">
              Community Hub
            </h1>
            <p className="text-xl md:text-2xl text-gray-400">
              Videos, Blogs, News & Engagement
            </p>
          </div>

          {/* Coming Soon Badge */}
          <div className="inline-block">
            <div className="px-6 py-3 rounded-full bg-gradient-to-r from-emerald-500/20 to-teal-500/20 border border-emerald-500/30">
              <p className="text-emerald-400 font-semibold">Coming Soon</p>
            </div>
          </div>

          {/* Description */}
          <Card className="p-8 bg-gray-900/60 border-emerald-500/30">
            <div className="space-y-6 text-left">
              <p className="text-gray-300 text-lg">
                Connect with fellow LEGO® enthusiasts through our community content hub!
              </p>
              
              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <Video className="w-6 h-6 text-emerald-400 shrink-0 mt-1" />
                  <div>
                    <h3 className="font-bold text-white mb-1">Video Content</h3>
                    <p className="text-gray-400">Building tutorials, reviews, and E.L.F.I.E. mini-shows</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4">
                  <BookOpen className="w-6 h-6 text-teal-400 shrink-0 mt-1" />
                  <div>
                    <h3 className="font-bold text-white mb-1">Blogs & Articles</h3>
                    <p className="text-gray-400">Tips, news, and stories from the LEGO® community</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4">
                  <Users className="w-6 h-6 text-cyan-400 shrink-0 mt-1" />
                  <div>
                    <h3 className="font-bold text-white mb-1">Community Spotlights</h3>
                    <p className="text-gray-400">Featuring amazing builds and builder stories</p>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* CTA */}
          <div className="pt-8">
            <p className="text-gray-500 mb-4">Stay tuned for community content and engagement!</p>
            <Link href="/showroom">
              <Button size="lg" className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700" data-testid="button-visit-showroom">
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
