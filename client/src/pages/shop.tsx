import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, ShoppingCart, Box, Grid3x3, Bot, Cog, Sparkles } from "lucide-react";
import { Link } from "wouter";
import logoUrl from "@assets/PlanetBrick_dotcom_with_planet_and_robot_400_1760672362080.png";

// Sample lots data - grouped by part number
const productLots = [
  { 
    id: 1, 
    part: "3001", 
    name: "2x4 Brick", 
    totalQty: 8547,
    lotCount: 5,
    variations: [
      { color: "Red", colorHex: "#D50000", condition: "New", qty: 2847, price: "$0.15" },
      { color: "Blue", colorHex: "#0055BF", condition: "New", qty: 1823, price: "$0.15" },
      { color: "Yellow", colorHex: "#F2CD37", condition: "New", qty: 1456, price: "$0.14" },
      { color: "Green", colorHex: "#00852B", condition: "Used", qty: 1789, price: "$0.10" },
      { color: "Black", colorHex: "#05131D", condition: "New", qty: 632, price: "$0.16" },
    ]
  },
  { 
    id: 2, 
    part: "3023", 
    name: "1x2 Plate", 
    totalQty: 12456,
    lotCount: 6,
    variations: [
      { color: "Blue", colorHex: "#0055BF", condition: "New", qty: 5621, price: "$0.08" },
      { color: "White", colorHex: "#F2F3F2", condition: "New", qty: 2987, price: "$0.07" },
      { color: "Black", colorHex: "#05131D", condition: "New", qty: 1834, price: "$0.08" },
      { color: "Red", colorHex: "#D50000", condition: "Used", qty: 1234, price: "$0.05" },
      { color: "Gray", colorHex: "#6C6E68", condition: "New", qty: 567, price: "$0.08" },
      { color: "Tan", colorHex: "#E4CD9E", condition: "Used", qty: 213, price: "$0.05" },
    ]
  },
  { 
    id: 3, 
    part: "3003", 
    name: "2x2 Brick", 
    totalQty: 6234,
    lotCount: 4,
    variations: [
      { color: "Yellow", colorHex: "#F2CD37", condition: "New", qty: 1893, price: "$0.12" },
      { color: "Red", colorHex: "#D50000", condition: "New", qty: 2341, price: "$0.12" },
      { color: "White", colorHex: "#F2F3F2", condition: "Used", qty: 1456, price: "$0.08" },
      { color: "Orange", colorHex: "#FE8A18", condition: "New", qty: 544, price: "$0.13" },
    ]
  },
  { 
    id: 4, 
    part: "3062b", 
    name: "1x1 Round Brick", 
    totalQty: 15678,
    lotCount: 7,
    variations: [
      { color: "Trans-Clear", colorHex: "#FCFCFC", condition: "New", qty: 8234, price: "$0.05" },
      { color: "Trans-Blue", colorHex: "#0081F0", condition: "New", qty: 2987, price: "$0.06" },
      { color: "Black", colorHex: "#05131D", condition: "New", qty: 1834, price: "$0.05" },
      { color: "Red", colorHex: "#D50000", condition: "New", qty: 1234, price: "$0.05" },
      { color: "Yellow", colorHex: "#F2CD37", condition: "New", qty: 789, price: "$0.05" },
      { color: "Green", colorHex: "#00852B", condition: "Used", qty: 456, price: "$0.03" },
      { color: "White", colorHex: "#F2F3F2", condition: "New", qty: 144, price: "$0.05" },
    ]
  },
  { 
    id: 5, 
    part: "2431", 
    name: "1x4 Tile", 
    totalQty: 3456,
    lotCount: 3,
    variations: [
      { color: "Dark Gray", colorHex: "#6C6E68", condition: "New", qty: 967, price: "$0.18" },
      { color: "White", colorHex: "#F2F3F2", condition: "New", qty: 1456, price: "$0.17" },
      { color: "Black", colorHex: "#05131D", condition: "Used", qty: 1033, price: "$0.12" },
    ]
  },
  { 
    id: 6, 
    part: "3039", 
    name: "2x2 Slope", 
    totalQty: 5678,
    lotCount: 4,
    variations: [
      { color: "Green", colorHex: "#00852B", condition: "New", qty: 3421, price: "$0.22" },
      { color: "Tan", colorHex: "#E4CD9E", condition: "New", qty: 1234, price: "$0.20" },
      { color: "Blue", colorHex: "#0055BF", condition: "Used", qty: 789, price: "$0.15" },
      { color: "Red", colorHex: "#D50000", condition: "New", qty: 234, price: "$0.22" },
    ]
  },
  { 
    id: 7, 
    part: "3626", 
    name: "Minifig Head", 
    totalQty: 2134,
    lotCount: 3,
    variations: [
      { color: "Yellow", colorHex: "#F2CD37", condition: "New", qty: 534, price: "$0.45" },
      { color: "Yellow", colorHex: "#F2CD37", condition: "Used", qty: 987, price: "$0.30" },
      { color: "Light Flesh", colorHex: "#F6D7B3", condition: "New", qty: 613, price: "$0.48" },
    ]
  },
  { 
    id: 8, 
    part: "3010", 
    name: "1x4 Brick", 
    totalQty: 7890,
    lotCount: 5,
    variations: [
      { color: "Orange", colorHex: "#FE8A18", condition: "New", qty: 1234, price: "$0.28" },
      { color: "Bright Orange", colorHex: "#D67923", condition: "New", qty: 1765, price: "$0.18" },
      { color: "White", colorHex: "#F2F3F2", condition: "New", qty: 2341, price: "$0.16" },
      { color: "Blue", colorHex: "#0055BF", condition: "Used", qty: 1567, price: "$0.12" },
      { color: "Black", colorHex: "#05131D", condition: "New", qty: 983, price: "$0.17" },
    ]
  },
];

export default function Shop() {
  const [selectedLot, setSelectedLot] = useState<number | null>(null);
  
  const totalLots = productLots.length;
  const totalParts = productLots.reduce((sum, lot) => sum + lot.totalQty, 0);

  return (
    <div className="min-h-screen bg-gray-950 relative overflow-hidden">
      {/* Retro-futuristic background effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] border border-purple-500/10 rounded-full animate-[spin_60s_linear_infinite]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] border border-cyan-500/10 rounded-full animate-[spin_40s_linear_infinite_reverse]" />
      </div>

      <div className="relative z-10">
        {/* Compact Header */}
        <header className="sticky top-0 z-50 border-b border-purple-500/30 backdrop-blur-xl bg-gradient-to-r from-purple-900/40 via-pink-900/30 to-cyan-900/40">
          <div className="px-2 py-1.5">
            <div className="flex items-center justify-between">
              <img src={logoUrl} alt="PlanetBrick" className="h-8" />
              <div className="flex items-center gap-1.5">
                <Button size="icon" variant="ghost" className="text-cyan-300 h-7 w-7" data-testid="button-cart">
                  <ShoppingCart className="w-4 h-4" />
                </Button>
                <Link href="/login">
                  <Button variant="ghost" size="sm" className="text-cyan-300 text-xs h-7 px-2" data-testid="button-login-header">
                    Login
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </header>

        {/* Inventory Stats Banner */}
        <div className="sticky top-9 z-40 bg-gradient-to-r from-pink-600/20 via-purple-600/20 to-cyan-600/20 backdrop-blur-xl border-b border-purple-500/30 px-2 py-2">
          <div className="flex items-center justify-center gap-4 text-xs">
            <div className="flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-pink-400" />
              <span className="text-gray-300">{totalLots.toLocaleString()}</span>
              <span className="text-gray-500">Unique Lots</span>
            </div>
            <div className="w-px h-3 bg-purple-500/30" />
            <div className="flex items-center gap-1">
              <Box className="w-3 h-3 text-cyan-400" />
              <span className="text-gray-300">{totalParts.toLocaleString()}</span>
              <span className="text-gray-500">Total Parts</span>
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <div className="sticky top-16 z-30 bg-gradient-to-b from-gray-900/95 to-gray-950/95 backdrop-blur-xl px-2 py-1.5 border-b border-purple-500/20">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500" />
            <input
              type="text"
              placeholder="Search parts..."
              className="w-full h-7 pl-8 pr-3 bg-gray-800/50 border border-purple-500/30 rounded-md text-xs text-white placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
              data-testid="input-search"
            />
          </div>
        </div>

        {/* Categories - At Top */}
        <section className="px-2 py-2 border-b border-purple-500/20">
          <h2 className="text-xs font-bold text-white mb-1.5 flex items-center gap-1">
            <Grid3x3 className="w-3 h-3 text-purple-400" />
            Shop by Category
          </h2>
          <div className="grid grid-cols-4 gap-1.5">
            <Card className="bg-gradient-to-br from-red-900/20 to-gray-900/40 border-red-500/30 p-2 text-center hover-elevate cursor-pointer" data-testid="category-bricks">
              <Box className="w-5 h-5 mx-auto mb-0.5 text-red-400" />
              <h3 className="text-xs font-semibold text-white">Bricks</h3>
              <p className="text-[10px] text-gray-400">12.8K</p>
            </Card>
            
            <Card className="bg-gradient-to-br from-blue-900/20 to-gray-900/40 border-blue-500/30 p-2 text-center hover-elevate cursor-pointer" data-testid="category-plates">
              <Grid3x3 className="w-5 h-5 mx-auto mb-0.5 text-blue-400" />
              <h3 className="text-xs font-semibold text-white">Plates</h3>
              <p className="text-[10px] text-gray-400">8.2K</p>
            </Card>
            
            <Card className="bg-gradient-to-br from-yellow-900/20 to-gray-900/40 border-yellow-500/30 p-2 text-center hover-elevate cursor-pointer" data-testid="category-minifigs">
              <Bot className="w-5 h-5 mx-auto mb-0.5 text-yellow-400" />
              <h3 className="text-xs font-semibold text-white">Minifigs</h3>
              <p className="text-[10px] text-gray-400">3.5K</p>
            </Card>
            
            <Card className="bg-gradient-to-br from-purple-900/20 to-gray-900/40 border-purple-500/30 p-2 text-center hover-elevate cursor-pointer" data-testid="category-technic">
              <Cog className="w-5 h-5 mx-auto mb-0.5 text-purple-400" />
              <h3 className="text-xs font-semibold text-white">Technic</h3>
              <p className="text-[10px] text-gray-400">5.7K</p>
            </Card>
          </div>
        </section>

        {/* Product Lots Grid */}
        <section className="px-2 py-2">
          <h2 className="text-xs font-bold text-white mb-1.5 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-pink-400" />
            Featured Lots
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {productLots.map((lot) => {
              const isSelected = selectedLot === lot.id;
              const primaryColor = lot.variations[0];

              return (
                <Card
                  key={lot.id}
                  className={`bg-gray-900/60 border-purple-500/30 p-2 hover-elevate cursor-pointer transition-all ${
                    isSelected ? 'ring-2 ring-cyan-400' : ''
                  }`}
                  onClick={() => setSelectedLot(isSelected ? null : lot.id)}
                  data-testid={`card-lot-${lot.id}`}
                >
                  {!isSelected ? (
                    // Front: Lot Summary
                    <div>
                      <div
                        className="w-full aspect-square rounded-md mb-1 flex items-center justify-center border border-gray-700/50 relative overflow-hidden"
                        style={{
                          background: `linear-gradient(135deg, ${primaryColor.colorHex}40 0%, ${primaryColor.colorHex}20 100%)`,
                          boxShadow: `0 2px 8px ${primaryColor.colorHex}30`
                        }}
                      >
                        <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 via-transparent to-cyan-500/5" />
                        <div className="text-lg font-bold relative z-10" style={{
                          color: primaryColor.colorHex === '#FCFCFC' || primaryColor.colorHex === '#F2F3F2' ? '#00000030' : '#FFFFFF40',
                          textShadow: '0 1px 2px rgba(0,0,0,0.3)'
                        }}>
                          LEGO
                        </div>
                      </div>
                      
                      <div className="space-y-0.5">
                        <h3 className="text-[11px] font-bold text-white leading-tight">{lot.name}</h3>
                        <p className="text-[10px] text-gray-400">#{lot.part}</p>
                        
                        <div className="flex items-center justify-between pt-0.5">
                          <Badge variant="secondary" className="text-[9px] px-1 py-0 h-auto">
                            {lot.lotCount} colors
                          </Badge>
                          <span className="text-[10px] font-bold text-cyan-400" data-testid={`text-qty-${lot.id}`}>
                            {lot.totalQty.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    // Back: Color/Condition Variations
                    <div className="space-y-1">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="text-[10px] font-bold text-white">#{lot.part}</h3>
                        <Badge className="text-[8px] px-1 py-0 h-auto bg-cyan-600/20 text-cyan-300 border-cyan-500/30">
                          {lot.totalQty.toLocaleString()} total
                        </Badge>
                      </div>
                      
                      <div className="space-y-0.5 max-h-32 overflow-y-auto">
                        {lot.variations.map((variation, idx) => (
                          <div
                            key={idx}
                            className="flex items-center gap-1 p-1 rounded bg-gray-800/50 border border-gray-700/50"
                            data-testid={`variation-${lot.id}-${idx}`}
                          >
                            <div
                              className="w-3 h-3 rounded-sm shrink-0 border border-gray-600/50"
                              style={{ backgroundColor: variation.colorHex }}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-[9px] text-white truncate">{variation.color}</p>
                              <p className="text-[8px] text-gray-500">{variation.condition}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-[9px] font-semibold text-cyan-400">{variation.price}</p>
                              <p className="text-[8px] text-gray-400">{variation.qty.toLocaleString()}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-purple-500/30 py-3 px-2 mt-4 bg-gradient-to-r from-purple-900/20 via-pink-900/10 to-cyan-900/20">
          <div className="text-center">
            <p className="text-gray-500 text-[10px] mb-1.5">
              © 2025 PlanetBrick.com
            </p>
            <div className="flex justify-center gap-3">
              <a href="#" className="text-gray-500 hover:text-cyan-400 text-[10px] transition-colors" data-testid="link-about">About</a>
              <a href="#" className="text-gray-500 hover:text-cyan-400 text-[10px] transition-colors" data-testid="link-shipping">Shipping</a>
              <a href="#" className="text-gray-500 hover:text-cyan-400 text-[10px] transition-colors" data-testid="link-contact">Contact</a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
