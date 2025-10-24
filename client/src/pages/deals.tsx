import { Link } from "wouter";
import { ArrowLeft, Gift, Package, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function Deals() {
  return (
    <div className="min-h-screen bg-black">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-black/80 backdrop-blur-xl">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/">
              <Button variant="ghost" size="sm" data-testid="button-back-home">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Home
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Coming Soon Content */}
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          {/* Icon */}
          <div className="flex justify-center">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 to-pink-500/20 rounded-full blur-3xl animate-pulse" />
              <div className="relative w-32 h-32 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center border-4 border-white/20">
                <Gift className="w-16 h-16 text-white" />
              </div>
            </div>
          </div>

          {/* Title */}
          <div className="space-y-4">
            <h1 className="text-4xl md:text-6xl font-bold bg-gradient-to-r from-purple-400 via-pink-500 to-rose-500 bg-clip-text text-transparent">
              Special Deals
            </h1>
            <p className="text-xl md:text-2xl text-gray-400">
              Exclusive Bundles & Limited Offers
            </p>
          </div>

          {/* Coming Soon Badge */}
          <div className="inline-block">
            <div className="px-6 py-3 rounded-full bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-500/30">
              <p className="text-purple-400 font-semibold">Coming Soon</p>
            </div>
          </div>

          {/* Description */}
          <Card className="p-8 bg-gray-900/60 border-purple-500/30">
            <div className="space-y-6 text-left">
              <p className="text-gray-300 text-lg">
                Get ready for exclusive LEGO® bundles and special offers you won't find anywhere else!
              </p>
              
              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <Package className="w-6 h-6 text-purple-400 shrink-0 mt-1" />
                  <div>
                    <h3 className="font-bold text-white mb-1">Curated Bundles</h3>
                    <p className="text-gray-400">Specially designed sets and themed collections</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4">
                  <Sparkles className="w-6 h-6 text-pink-400 shrink-0 mt-1" />
                  <div>
                    <h3 className="font-bold text-white mb-1">Exclusive Offers</h3>
                    <p className="text-gray-400">Limited-time deals available only on PlanetBrick</p>
                  </div>
                </div>
                
                <div className="flex items-start gap-4">
                  <Gift className="w-6 h-6 text-rose-400 shrink-0 mt-1" />
                  <div>
                    <h3 className="font-bold text-white mb-1">Special Promotions</h3>
                    <p className="text-gray-400">Seasonal sales and member-exclusive discounts</p>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* CTA */}
          <div className="pt-8">
            <p className="text-gray-500 mb-4">Be the first to know when deals launch!</p>
            <Link href="/showroom">
              <Button size="lg" className="bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700" data-testid="button-visit-showroom">
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
