import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Package, Search, Sparkles, Building2, Users, CheckCircle2, ArrowRight, Database, Zap, Shield } from "lucide-react";
import logoUrl from "@assets/PlanetBrick_dotcom_with_planet_and_robot_400_1760672362080.png";

export default function Shop() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-purple-900">
      
      {/* Hero Section */}
      <section className="relative overflow-hidden border-b border-purple-500/20">
        {/* Animated Background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] border-2 border-purple-500/10 rounded-full animate-[spin_60s_linear_infinite]" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] border-2 border-cyan-500/10 rounded-full animate-[spin_40s_linear_infinite_reverse]" />
          
          {/* Gradient orbs */}
          <div className="absolute top-20 -left-40 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-20 -right-40 w-96 h-96 bg-cyan-500/20 rounded-full blur-3xl animate-pulse delay-1000" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-20 lg:py-24">
          <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
            
            {/* Left: Content */}
            <div className="space-y-6 md:space-y-8">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-purple-500/10 border border-purple-500/20">
                <Sparkles className="w-4 h-4 text-purple-400" />
                <span className="text-sm text-purple-300 font-medium">Rare & Discontinued LEGO Parts</span>
              </div>

              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight">
                <span className="bg-gradient-to-r from-purple-300 via-pink-300 to-cyan-300 bg-clip-text text-transparent">
                  The Galaxy's Deepest
                </span>
                <br />
                <span className="text-white">LEGO Inventory</span>
              </h1>

              <p className="text-lg md:text-xl text-gray-300 leading-relaxed max-w-xl">
                Access <span className="text-cyan-400 font-semibold">thousands of discontinued parts</span> from classic sets dating back decades. Whether you're restoring a vintage model or building custom creations at scale, we've got the breadth and depth you need.
              </p>

              <div className="flex flex-wrap gap-3">
                <Button 
                  size="lg"
                  className="bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 hover:from-purple-500 hover:via-pink-500 hover:to-cyan-500 text-white border-0 shadow-lg shadow-purple-500/50 h-12 px-8 text-base font-semibold"
                  data-testid="button-browse-inventory"
                >
                  <Search className="w-5 h-5 mr-2" />
                  Browse Inventory
                </Button>
                <Button 
                  size="lg"
                  variant="outline"
                  className="border-cyan-500/50 text-cyan-300 hover:bg-cyan-500/10 h-12 px-8 text-base backdrop-blur-sm bg-gray-900/40"
                  data-testid="button-bulk-inquiry"
                >
                  <Building2 className="w-5 h-5 mr-2" />
                  Bulk Inquiry
                </Button>
              </div>

              {/* Trust Indicators */}
              <div className="flex flex-wrap gap-6 pt-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-400" />
                  <span className="text-sm text-gray-400">BrickLink Verified</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-400" />
                  <span className="text-sm text-gray-400">BrickOwl Seller</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-400" />
                  <span className="text-sm text-gray-400">Fast Shipping</span>
                </div>
              </div>
            </div>

            {/* Right: Logo & Visual */}
            <div className="relative flex justify-center lg:justify-end">
              <div className="relative">
                <img 
                  src={logoUrl} 
                  alt="PlanetBrick.com" 
                  className="w-full max-w-md lg:max-w-lg drop-shadow-2xl"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 opacity-20 blur-3xl -z-10 scale-110" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="relative py-16 md:py-24 border-b border-purple-500/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12 md:mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              <span className="bg-gradient-to-r from-purple-300 via-pink-300 to-cyan-300 bg-clip-text text-transparent">
                Why Serious Builders Choose PlanetBrick
              </span>
            </h2>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">
              From solo collectors to commercial builders, we supply the parts that power ambitious projects
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
            
            {/* Feature 1: Deep Inventory */}
            <Card className="bg-gradient-to-br from-purple-950/50 to-gray-900/90 border-purple-500/20 p-6 md:p-8 hover-elevate">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500/20 to-purple-600/20 flex items-center justify-center mb-4 border border-purple-500/30">
                <Database className="w-6 h-6 text-purple-400" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Deep Catalog</h3>
              <p className="text-gray-400 leading-relaxed">
                Thousands of parts from sets spanning 1970s–2020s. If it's been discontinued, we probably have it in stock.
              </p>
            </Card>

            {/* Feature 2: Bulk Friendly */}
            <Card className="bg-gradient-to-br from-cyan-950/50 to-gray-900/90 border-cyan-500/20 p-6 md:p-8 hover-elevate">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-cyan-600/20 flex items-center justify-center mb-4 border border-cyan-500/30">
                <Building2 className="w-6 h-6 text-cyan-400" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Bulk Orders Welcome</h3>
              <p className="text-gray-400 leading-relaxed">
                Need 10,000 of a specific part? We handle commercial-scale orders with volume discounts.
              </p>
            </Card>

            {/* Feature 3: Fast Shipping */}
            <Card className="bg-gradient-to-br from-pink-950/50 to-gray-900/90 border-pink-500/20 p-6 md:p-8 hover-elevate">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-pink-500/20 to-pink-600/20 flex items-center justify-center mb-4 border border-pink-500/30">
                <Zap className="w-6 h-6 text-pink-400" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Lightning Fast</h3>
              <p className="text-gray-400 leading-relaxed">
                Same-day processing for orders placed before 2PM EST. Get your parts when you need them.
              </p>
            </Card>

            {/* Feature 4: Quality Guarantee */}
            <Card className="bg-gradient-to-br from-purple-950/50 to-gray-900/90 border-purple-500/20 p-6 md:p-8 hover-elevate">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500/20 to-purple-600/20 flex items-center justify-center mb-4 border border-purple-500/30">
                <Shield className="w-6 h-6 text-purple-400" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Quality Verified</h3>
              <p className="text-gray-400 leading-relaxed">
                Every part inspected and graded. New means new. Used means honest condition descriptions.
              </p>
            </Card>

            {/* Feature 5: Expert Search */}
            <Card className="bg-gradient-to-br from-cyan-950/50 to-gray-900/90 border-cyan-500/20 p-6 md:p-8 hover-elevate">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-cyan-600/20 flex items-center justify-center mb-4 border border-cyan-500/30">
                <Search className="w-6 h-6 text-cyan-400" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Smart Search</h3>
              <p className="text-gray-400 leading-relaxed">
                Find parts by set number, part ID, color, or even describe what you need. Our AI helps you find it.
              </p>
            </Card>

            {/* Feature 6: Collector Focus */}
            <Card className="bg-gradient-to-br from-pink-950/50 to-gray-900/90 border-pink-500/20 p-6 md:p-8 hover-elevate">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-pink-500/20 to-pink-600/20 flex items-center justify-center mb-4 border border-pink-500/30">
                <Users className="w-6 h-6 text-pink-400" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Built by Collectors</h3>
              <p className="text-gray-400 leading-relaxed">
                We're LEGO enthusiasts too. We know what you're looking for because we've been there.
              </p>
            </Card>
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section className="relative py-16 md:py-24 border-b border-purple-500/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4 text-white">
              Who We Serve
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {/* Adult Modelers */}
            <Card className="bg-gradient-to-br from-gray-900/90 to-purple-950/50 border-purple-500/20 p-8 text-center hover-elevate">
              <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-gradient-to-br from-purple-500/20 to-purple-600/20 flex items-center justify-center border-2 border-purple-500/30">
                <Package className="w-8 h-8 text-purple-400" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Adult Collectors</h3>
              <p className="text-gray-400 leading-relaxed">
                Restoring vintage sets, building MOCs (My Own Creations), or completing your childhood collection? We stock the rare parts you need.
              </p>
            </Card>

            {/* Commercial Builders */}
            <Card className="bg-gradient-to-br from-gray-900/90 to-cyan-950/50 border-cyan-500/20 p-8 text-center hover-elevate">
              <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-gradient-to-br from-cyan-500/20 to-cyan-600/20 flex items-center justify-center border-2 border-cyan-500/30">
                <Building2 className="w-8 h-8 text-cyan-400" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Commercial Projects</h3>
              <p className="text-gray-400 leading-relaxed">
                Museums, exhibitions, corporate builds—we supply commercial-grade quantities with consistent quality and fast turnaround.
              </p>
            </Card>

            {/* Professional Resellers */}
            <Card className="bg-gradient-to-br from-gray-900/90 to-pink-950/50 border-pink-500/20 p-8 text-center hover-elevate">
              <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-gradient-to-br from-pink-500/20 to-pink-600/20 flex items-center justify-center border-2 border-pink-500/30">
                <Users className="w-8 h-8 text-pink-400" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Fellow Resellers</h3>
              <p className="text-gray-400 leading-relaxed">
                Wholesale pricing available for verified resellers. Let's grow the LEGO community together.
              </p>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative py-16 md:py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="relative bg-gradient-to-br from-purple-600/10 via-pink-600/10 to-cyan-600/10 p-1 rounded-3xl backdrop-blur-xl">
            <div className="bg-gray-900/90 rounded-3xl p-8 md:p-12 border border-white/10">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">
                <span className="bg-gradient-to-r from-purple-300 via-pink-300 to-cyan-300 bg-clip-text text-transparent">
                  Ready to Find What You Need?
                </span>
              </h2>
              <p className="text-gray-300 text-lg mb-8 max-w-2xl mx-auto">
                Start browsing our inventory or reach out for bulk quotes. We're here to help you build something amazing.
              </p>
              <div className="flex flex-wrap gap-4 justify-center">
                <Button 
                  size="lg"
                  className="bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 hover:from-purple-500 hover:via-pink-500 hover:to-cyan-500 text-white border-0 shadow-lg shadow-purple-500/50 h-14 px-10 text-lg font-semibold"
                  data-testid="button-start-shopping"
                >
                  Start Shopping
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
                <Button 
                  size="lg"
                  variant="outline"
                  className="border-cyan-500/50 text-cyan-300 hover:bg-cyan-500/10 h-14 px-10 text-lg backdrop-blur-sm bg-gray-900/40"
                  data-testid="button-contact-us"
                >
                  Contact Us
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative border-t border-purple-500/20 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-gray-500 text-sm">
              © 2025 PlanetBrick.com. All rights reserved.
            </p>
            <div className="flex gap-6">
              <a href="#" className="text-gray-500 hover:text-cyan-400 text-sm transition-colors" data-testid="link-about">About</a>
              <a href="#" className="text-gray-500 hover:text-cyan-400 text-sm transition-colors" data-testid="link-shipping">Shipping</a>
              <a href="#" className="text-gray-500 hover:text-cyan-400 text-sm transition-colors" data-testid="link-returns">Returns</a>
              <a href="#" className="text-gray-500 hover:text-cyan-400 text-sm transition-colors" data-testid="link-contact">Contact</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
