import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, ShoppingCart, Star, Box, Grid3x3, Bot, Cog } from "lucide-react";
import { Link } from "wouter";
import logoUrl from "@assets/PlanetBrick_dotcom_with_planet_and_robot_400_1760672362080.png";

const featuredProducts = [
  { id: 1, name: "2x4 Brick", color: "Red", part: "3001", price: "$0.15", stock: 2847, rating: 4.9, colorHex: "#D50000" },
  { id: 2, name: "1x2 Plate", color: "Blue", part: "3023", price: "$0.08", stock: 5621, rating: 5.0, colorHex: "#0055BF" },
  { id: 3, name: "2x2 Brick", color: "Yellow", part: "3003", price: "$0.12", stock: 1893, rating: 4.8, colorHex: "#F2CD37" },
  { id: 4, name: "1x1 Round", color: "Trans-Clear", part: "3062b", price: "$0.05", stock: 8234, rating: 4.9, colorHex: "#FCFCFC" },
  { id: 5, name: "1x4 Tile", color: "Dark Gray", part: "2431", price: "$0.18", stock: 967, rating: 4.7, colorHex: "#6C6E68" },
  { id: 6, name: "2x2 Slope", color: "Green", part: "3039", price: "$0.22", stock: 3421, rating: 5.0, colorHex: "#00852B" },
  { id: 7, name: "1x2 Grill", color: "Black", part: "2877", price: "$0.14", stock: 2156, rating: 4.8, colorHex: "#05131D" },
  { id: 8, name: "Minifig Head", color: "Yellow", part: "3626", price: "$0.45", stock: 534, rating: 5.0, colorHex: "#F2CD37" },
  { id: 9, name: "1x1 Plate", color: "White", part: "3024", price: "$0.06", stock: 9821, rating: 4.9, colorHex: "#F2F3F2" },
  { id: 10, name: "1x6 Brick", color: "Orange", part: "3009", price: "$0.28", stock: 1234, rating: 4.6, colorHex: "#FE8A18" },
  { id: 11, name: "2x3 Plate", color: "Tan", part: "3021", price: "$0.16", stock: 2789, rating: 4.8, colorHex: "#E4CD9E" },
  { id: 12, name: "1x2x2 Window", color: "Trans-Blue", part: "60592", price: "$0.35", stock: 876, rating: 4.9, colorHex: "#0081F0" },
  { id: 13, name: "1x2 Brick", color: "Lime", part: "3004", price: "$0.12", stock: 1456, rating: 4.9, colorHex: "#BBE90B" },
  { id: 14, name: "2x2 Tile", color: "Pink", part: "3068", price: "$0.14", stock: 2341, rating: 4.7, colorHex: "#FC97AC" },
  { id: 15, name: "1x1 Cone", color: "Purple", part: "4589", price: "$0.09", stock: 3987, rating: 4.8, colorHex: "#81007B" },
  { id: 16, name: "1x4 Brick", color: "Bright Orange", part: "3010", price: "$0.18", stock: 1765, rating: 5.0, colorHex: "#D67923" },
];

export default function Shop() {
  return (
    <div className="min-h-screen bg-gray-950">
      
      {/* Compact Header */}
      <header className="sticky top-0 z-50 border-b border-purple-500/20 backdrop-blur-xl bg-gray-900/95">
        <div className="px-3 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <img src={logoUrl} alt="PlanetBrick" className="h-10" />
            </div>
            <div className="flex items-center gap-2">
              <Button 
                size="icon"
                variant="ghost" 
                className="text-cyan-300 h-9 w-9"
                data-testid="button-cart"
              >
                <ShoppingCart className="w-5 h-5" />
              </Button>
              <Link href="/login">
                <Button 
                  variant="ghost" 
                  size="sm"
                  className="text-cyan-300 text-xs h-9"
                  data-testid="button-login-header"
                >
                  Login
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Search Bar */}
      <div className="sticky top-14 z-40 bg-gradient-to-b from-gray-900 to-gray-950 px-3 py-3 border-b border-purple-500/10">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            placeholder="Search by part #, color, or name..."
            className="w-full h-10 pl-10 pr-4 bg-gray-800/50 border border-purple-500/20 rounded-lg text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
            data-testid="input-search"
          />
        </div>
      </div>
      
      {/* Featured Products Grid */}
      <section className="px-3 py-4">
        <h2 className="text-lg font-bold text-white mb-3">Featured Parts</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {featuredProducts.map((product) => (
            <Card 
              key={product.id}
              className="bg-gray-900/50 border-purple-500/20 p-3 hover-elevate cursor-pointer"
              data-testid={`card-product-${product.id}`}
            >
              <div 
                className="w-full aspect-square rounded-lg mb-2 flex items-center justify-center border border-gray-700/50 shadow-lg"
                style={{ 
                  backgroundColor: product.colorHex,
                  boxShadow: `0 4px 14px ${product.colorHex}40`
                }}
              >
                <div className="text-4xl font-bold" style={{
                  color: product.colorHex === '#FCFCFC' || product.colorHex === '#F2F3F2' || product.colorHex === '#F2CD37' ? '#00000030' : '#FFFFFF30',
                  textShadow: '0 2px 4px rgba(0,0,0,0.3)'
                }}>
                  LEGO
                </div>
              </div>
              
              <div className="space-y-1">
                <div className="flex items-start justify-between gap-1">
                  <h3 className="text-xs font-semibold text-white leading-tight">{product.name}</h3>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                    <span className="text-xs text-gray-400">{product.rating}</span>
                  </div>
                </div>
                
                <p className="text-xs text-gray-400">{product.color}</p>
                <p className="text-xs text-gray-500">#{product.part}</p>
                
                <div className="flex items-center justify-between pt-1">
                  <span className="text-sm font-bold text-cyan-400" data-testid={`text-price-${product.id}`}>{product.price}</span>
                  <Badge variant="secondary" className="text-xs px-1.5 py-0.5 h-auto" data-testid={`text-stock-${product.id}`}>
                    {product.stock.toLocaleString()} in stock
                  </Badge>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* Categories Quick Access */}
      <section className="px-3 py-6 border-t border-purple-500/10">
        <h2 className="text-lg font-bold text-white mb-3">Shop by Category</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="bg-gradient-to-br from-red-900/30 to-gray-900/50 border-red-500/20 p-4 text-center hover-elevate cursor-pointer" data-testid="category-bricks">
            <Box className="w-8 h-8 mx-auto mb-2 text-red-400" />
            <h3 className="text-sm font-semibold text-white">Bricks</h3>
            <p className="text-xs text-gray-400 mt-1">12,847 parts</p>
          </Card>
          
          <Card className="bg-gradient-to-br from-blue-900/30 to-gray-900/50 border-blue-500/20 p-4 text-center hover-elevate cursor-pointer" data-testid="category-plates">
            <Grid3x3 className="w-8 h-8 mx-auto mb-2 text-blue-400" />
            <h3 className="text-sm font-semibold text-white">Plates</h3>
            <p className="text-xs text-gray-400 mt-1">8,234 parts</p>
          </Card>
          
          <Card className="bg-gradient-to-br from-yellow-900/30 to-gray-900/50 border-yellow-500/20 p-4 text-center hover-elevate cursor-pointer" data-testid="category-minifigs">
            <Bot className="w-8 h-8 mx-auto mb-2 text-yellow-400" />
            <h3 className="text-sm font-semibold text-white">Minifigs</h3>
            <p className="text-xs text-gray-400 mt-1">3,456 parts</p>
          </Card>
          
          <Card className="bg-gradient-to-br from-purple-900/30 to-gray-900/50 border-purple-500/20 p-4 text-center hover-elevate cursor-pointer" data-testid="category-technic">
            <Cog className="w-8 h-8 mx-auto mb-2 text-purple-400" />
            <h3 className="text-sm font-semibold text-white">Technic</h3>
            <p className="text-xs text-gray-400 mt-1">5,678 parts</p>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-purple-500/20 py-6 px-3 mt-8">
        <div className="text-center">
          <p className="text-gray-500 text-xs mb-3">
            © 2025 PlanetBrick.com. All rights reserved.
          </p>
          <div className="flex justify-center gap-4">
            <a href="#" className="text-gray-500 hover:text-cyan-400 text-xs transition-colors" data-testid="link-about">About</a>
            <a href="#" className="text-gray-500 hover:text-cyan-400 text-xs transition-colors" data-testid="link-shipping">Shipping</a>
            <a href="#" className="text-gray-500 hover:text-cyan-400 text-xs transition-colors" data-testid="link-returns">Returns</a>
            <a href="#" className="text-gray-500 hover:text-cyan-400 text-xs transition-colors" data-testid="link-contact">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
