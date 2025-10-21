import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, ShoppingCart, ChevronRight, Sparkles } from "lucide-react";
import { Link } from "wouter";
import elfieRobot from "@assets/PlanetBrick_good_robot_1760672362080.png";

// Sample lots data - grouped by part number
const productLots = [
  { 
    id: 1, 
    part: "3001", 
    name: "2x4 Brick", 
    totalQty: 8547,
    lotCount: 5,
    category: "bricks",
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
    category: "plates",
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
    category: "bricks",
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
    category: "bricks",
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
    category: "tiles",
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
    category: "slopes",
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
    category: "minifigs",
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
    category: "bricks",
    variations: [
      { color: "Orange", colorHex: "#FE8A18", condition: "New", qty: 1234, price: "$0.28" },
      { color: "Bright Orange", colorHex: "#D67923", condition: "New", qty: 1765, price: "$0.18" },
      { color: "White", colorHex: "#F2F3F2", condition: "New", qty: 2341, price: "$0.16" },
      { color: "Blue", colorHex: "#0055BF", condition: "Used", qty: 1567, price: "$0.12" },
      { color: "Black", colorHex: "#05131D", condition: "New", qty: 983, price: "$0.17" },
    ]
  },
  { 
    id: 9, 
    part: "3024", 
    name: "1x1 Plate", 
    totalQty: 18234,
    lotCount: 8,
    category: "plates",
    variations: [
      { color: "Red", colorHex: "#D50000", condition: "New", qty: 4521, price: "$0.04" },
      { color: "Blue", colorHex: "#0055BF", condition: "New", qty: 3892, price: "$0.04" },
      { color: "Yellow", colorHex: "#F2CD37", condition: "New", qty: 2981, price: "$0.04" },
      { color: "Green", colorHex: "#00852B", condition: "New", qty: 2341, price: "$0.04" },
      { color: "White", colorHex: "#F2F3F2", condition: "New", qty: 1892, price: "$0.04" },
      { color: "Black", colorHex: "#05131D", condition: "New", qty: 1567, price: "$0.05" },
      { color: "Orange", colorHex: "#FE8A18", condition: "New", qty: 789, price: "$0.05" },
      { color: "Tan", colorHex: "#E4CD9E", condition: "Used", qty: 251, price: "$0.03" },
    ]
  },
  { 
    id: 10, 
    part: "6636", 
    name: "1x6 Tile", 
    totalQty: 1987,
    lotCount: 4,
    category: "tiles",
    variations: [
      { color: "White", colorHex: "#F2F3F2", condition: "New", qty: 892, price: "$0.25" },
      { color: "Black", colorHex: "#05131D", condition: "New", qty: 634, price: "$0.26" },
      { color: "Gray", colorHex: "#6C6E68", condition: "New", qty: 321, price: "$0.25" },
      { color: "Blue", colorHex: "#0055BF", condition: "Used", qty: 140, price: "$0.18" },
    ]
  },
  { 
    id: 11, 
    part: "3665", 
    name: "1x2x2 Slope", 
    totalQty: 4321,
    lotCount: 5,
    category: "slopes",
    variations: [
      { color: "Red", colorHex: "#D50000", condition: "New", qty: 1234, price: "$0.32" },
      { color: "Blue", colorHex: "#0055BF", condition: "New", qty: 1089, price: "$0.32" },
      { color: "Yellow", colorHex: "#F2CD37", condition: "New", qty: 892, price: "$0.31" },
      { color: "Green", colorHex: "#00852B", condition: "Used", qty: 678, price: "$0.22" },
      { color: "White", colorHex: "#F2F3F2", condition: "New", qty: 428, price: "$0.32" },
    ]
  },
  { 
    id: 12, 
    part: "3070b", 
    name: "1x1 Tile", 
    totalQty: 9876,
    lotCount: 6,
    category: "tiles",
    variations: [
      { color: "White", colorHex: "#F2F3F2", condition: "New", qty: 2987, price: "$0.06" },
      { color: "Black", colorHex: "#05131D", condition: "New", qty: 2456, price: "$0.07" },
      { color: "Red", colorHex: "#D50000", condition: "New", qty: 1678, price: "$0.06" },
      { color: "Blue", colorHex: "#0055BF", condition: "New", qty: 1234, price: "$0.06" },
      { color: "Yellow", colorHex: "#F2CD37", condition: "Used", qty: 987, price: "$0.04" },
      { color: "Green", colorHex: "#00852B", condition: "New", qty: 534, price: "$0.06" },
    ]
  },
  { 
    id: 13, 
    part: "3004", 
    name: "1x2 Brick", 
    totalQty: 11234,
    lotCount: 7,
    category: "bricks",
    variations: [
      { color: "Red", colorHex: "#D50000", condition: "New", qty: 2987, price: "$0.09" },
      { color: "Blue", colorHex: "#0055BF", condition: "New", qty: 2456, price: "$0.09" },
      { color: "Yellow", colorHex: "#F2CD37", condition: "New", qty: 1987, price: "$0.09" },
      { color: "Green", colorHex: "#00852B", condition: "New", qty: 1678, price: "$0.09" },
      { color: "White", colorHex: "#F2F3F2", condition: "New", qty: 1234, price: "$0.09" },
      { color: "Black", colorHex: "#05131D", condition: "New", qty: 678, price: "$0.10" },
      { color: "Gray", colorHex: "#6C6E68", condition: "Used", qty: 214, price: "$0.06" },
    ]
  },
  { 
    id: 14, 
    part: "3622", 
    name: "1x3 Brick", 
    totalQty: 5678,
    lotCount: 4,
    category: "bricks",
    variations: [
      { color: "Red", colorHex: "#D50000", condition: "New", qty: 1892, price: "$0.11" },
      { color: "Blue", colorHex: "#0055BF", condition: "New", qty: 1567, price: "$0.11" },
      { color: "Yellow", colorHex: "#F2CD37", condition: "New", qty: 1234, price: "$0.11" },
      { color: "White", colorHex: "#F2F3F2", condition: "Used", qty: 985, price: "$0.07" },
    ]
  },
  { 
    id: 15, 
    part: "3005", 
    name: "1x1 Brick", 
    totalQty: 23456,
    lotCount: 9,
    category: "bricks",
    variations: [
      { color: "Red", colorHex: "#D50000", condition: "New", qty: 4892, price: "$0.05" },
      { color: "Blue", colorHex: "#0055BF", condition: "New", qty: 4123, price: "$0.05" },
      { color: "Yellow", colorHex: "#F2CD37", condition: "New", qty: 3567, price: "$0.05" },
      { color: "Green", colorHex: "#00852B", condition: "New", qty: 2987, price: "$0.05" },
      { color: "White", colorHex: "#F2F3F2", condition: "New", qty: 2456, price: "$0.05" },
      { color: "Black", colorHex: "#05131D", condition: "New", qty: 2134, price: "$0.06" },
      { color: "Orange", colorHex: "#FE8A18", condition: "New", qty: 1678, price: "$0.06" },
      { color: "Trans-Clear", colorHex: "#FCFCFC", condition: "New", qty: 1234, price: "$0.07" },
      { color: "Gray", colorHex: "#6C6E68", condition: "Used", qty: 385, price: "$0.03" },
    ]
  },
  { 
    id: 16, 
    part: "3009", 
    name: "1x6 Brick", 
    totalQty: 3892,
    lotCount: 4,
    category: "bricks",
    variations: [
      { color: "Red", colorHex: "#D50000", condition: "New", qty: 1234, price: "$0.22" },
      { color: "Blue", colorHex: "#0055BF", condition: "New", qty: 1089, price: "$0.22" },
      { color: "Yellow", colorHex: "#F2CD37", condition: "New", qty: 892, price: "$0.22" },
      { color: "White", colorHex: "#F2F3F2", condition: "Used", qty: 677, price: "$0.15" },
    ]
  },
  { 
    id: 17, 
    part: "3008", 
    name: "1x8 Brick", 
    totalQty: 4521,
    lotCount: 5,
    category: "bricks",
    variations: [
      { color: "Red", colorHex: "#D50000", condition: "New", qty: 1234, price: "$0.35" },
      { color: "Blue", colorHex: "#0055BF", condition: "New", qty: 1089, price: "$0.35" },
      { color: "Yellow", colorHex: "#F2CD37", condition: "New", qty: 892, price: "$0.34" },
      { color: "White", colorHex: "#F2F3F2", condition: "New", qty: 789, price: "$0.35" },
      { color: "Black", colorHex: "#05131D", condition: "Used", qty: 517, price: "$0.25" },
    ]
  },
  { 
    id: 18, 
    part: "3007", 
    name: "2x8 Brick", 
    totalQty: 3214,
    lotCount: 4,
    category: "bricks",
    variations: [
      { color: "Red", colorHex: "#D50000", condition: "New", qty: 1092, price: "$0.45" },
      { color: "Blue", colorHex: "#0055BF", condition: "New", qty: 892, price: "$0.45" },
      { color: "Yellow", colorHex: "#F2CD37", condition: "New", qty: 734, price: "$0.44" },
      { color: "White", colorHex: "#F2F3F2", condition: "Used", qty: 496, price: "$0.32" },
    ]
  },
  { 
    id: 19, 
    part: "3006", 
    name: "2x10 Brick", 
    totalQty: 2156,
    lotCount: 3,
    category: "bricks",
    variations: [
      { color: "Red", colorHex: "#D50000", condition: "New", qty: 892, price: "$0.58" },
      { color: "Blue", colorHex: "#0055BF", condition: "New", qty: 734, price: "$0.58" },
      { color: "Yellow", colorHex: "#F2CD37", condition: "Used", qty: 530, price: "$0.42" },
    ]
  },
  { 
    id: 20, 
    part: "2456", 
    name: "2x6 Brick", 
    totalQty: 4892,
    lotCount: 5,
    category: "bricks",
    variations: [
      { color: "Red", colorHex: "#D50000", condition: "New", qty: 1432, price: "$0.32" },
      { color: "Blue", colorHex: "#0055BF", condition: "New", qty: 1234, price: "$0.32" },
      { color: "Yellow", colorHex: "#F2CD37", condition: "New", qty: 1089, price: "$0.31" },
      { color: "White", colorHex: "#F2F3F2", condition: "New", qty: 892, price: "$0.32" },
      { color: "Green", colorHex: "#00852B", condition: "Used", qty: 245, price: "$0.22" },
    ]
  },
  { 
    id: 21, 
    part: "3002", 
    name: "2x3 Brick", 
    totalQty: 5678,
    lotCount: 4,
    category: "bricks",
    variations: [
      { color: "Red", colorHex: "#D50000", condition: "New", qty: 1892, price: "$0.18" },
      { color: "Blue", colorHex: "#0055BF", condition: "New", qty: 1567, price: "$0.18" },
      { color: "Yellow", colorHex: "#F2CD37", condition: "New", qty: 1234, price: "$0.17" },
      { color: "White", colorHex: "#F2F3F2", condition: "Used", qty: 985, price: "$0.12" },
    ]
  },
];

// Group products by category
const featuredLots = productLots.slice(0, 5);
const brickLots = productLots.filter(lot => lot.category === "bricks");
const plateLots = productLots.filter(lot => lot.category === "plates");
const minifigLots = productLots.filter(lot => lot.category === "minifigs");
const tileLots = productLots.filter(lot => lot.category === "tiles");
const slopeLots = productLots.filter(lot => lot.category === "slopes");

interface LotCardProps {
  lot: typeof productLots[0];
  isSelected: boolean;
  onClick: () => void;
}

function LotCard({ lot, isSelected, onClick }: LotCardProps) {
  const primaryColor = lot.variations[0];

  return (
    <Card
      className={`shrink-0 w-28 md:w-56 bg-gray-900/60 border-purple-500/30 p-1.5 md:p-3 hover-elevate cursor-pointer transition-all ${
        isSelected ? 'ring-2 ring-cyan-400' : ''
      }`}
      onClick={onClick}
      data-testid={`card-lot-${lot.id}`}
    >
      {!isSelected ? (
        // Front: Lot Summary
        <div>
          <div
            className="w-full aspect-square rounded-md mb-1 md:mb-2 flex items-center justify-center border border-gray-700/50 relative overflow-hidden"
            style={{
              background: `linear-gradient(135deg, ${primaryColor.colorHex}60 0%, ${primaryColor.colorHex}30 100%)`,
              boxShadow: `0 4px 16px ${primaryColor.colorHex}40`
            }}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 via-transparent to-cyan-500/10" />
            <div className="absolute top-0 left-0 w-full h-full">
              {/* Floating sparkles */}
              <div className="absolute top-2 right-2 w-1 h-1 md:w-2 md:h-2 bg-white rounded-full animate-pulse" style={{ animationDelay: '0s' }} />
              <div className="absolute bottom-3 left-3 w-1 h-1 md:w-2 md:h-2 bg-cyan-400 rounded-full animate-pulse" style={{ animationDelay: '0.5s' }} />
              <div className="absolute top-1/2 left-1/4 w-0.5 h-0.5 md:w-1 md:h-1 bg-pink-400 rounded-full animate-pulse" style={{ animationDelay: '1s' }} />
            </div>
            <div className="text-sm md:text-2xl font-bold relative z-10" style={{
              color: primaryColor.colorHex === '#FCFCFC' || primaryColor.colorHex === '#F2F3F2' ? '#00000030' : '#FFFFFF50',
              textShadow: '0 2px 4px rgba(0,0,0,0.4)'
            }}>
              LEGO
            </div>
          </div>
          
          <div className="space-y-0.5 md:space-y-1">
            <h3 className="text-[9px] md:text-sm font-bold text-white leading-tight truncate">{lot.name}</h3>
            <p className="text-[8px] md:text-xs text-gray-400">#{lot.part}</p>
            
            <div className="flex items-center justify-between pt-0.5">
              <Badge variant="secondary" className="text-[7px] md:text-xs px-0.5 md:px-1.5 py-0 h-auto">
                {lot.lotCount} colors
              </Badge>
              <span className="text-[8px] md:text-xs font-bold text-cyan-400" data-testid={`text-qty-${lot.id}`}>
                {lot.totalQty.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      ) : (
        // Back: Color/Condition Variations
        <div className="space-y-0.5 md:space-y-1.5">
          <div className="flex items-center justify-between mb-0.5 md:mb-1">
            <h3 className="text-[8px] md:text-sm font-bold text-white">#{lot.part}</h3>
            <Badge className="text-[7px] md:text-xs px-0.5 md:px-1.5 py-0 h-auto bg-cyan-600/20 text-cyan-300 border-cyan-500/30">
              {lot.totalQty.toLocaleString()}
            </Badge>
          </div>
          
          <div className="space-y-0.5 max-h-24 md:max-h-48 overflow-y-auto">
            {lot.variations.map((variation, idx) => (
              <div
                key={idx}
                className="flex items-center gap-0.5 md:gap-1.5 p-0.5 md:p-1.5 rounded bg-gray-800/50 border border-gray-700/50"
                data-testid={`variation-${lot.id}-${idx}`}
              >
                <div
                  className="w-2 h-2 md:w-4 md:h-4 rounded-sm shrink-0 border border-gray-600/50"
                  style={{ backgroundColor: variation.colorHex }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-[7px] md:text-xs text-white truncate">{variation.color}</p>
                  <p className="text-[6px] md:text-[10px] text-gray-500">{variation.condition}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[7px] md:text-xs font-semibold text-cyan-400">{variation.price}</p>
                  <p className="text-[6px] md:text-[10px] text-gray-400">{variation.qty.toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

interface HorizontalRowProps {
  title: string;
  lots: typeof productLots;
  categoryId: string;
}

function HorizontalRow({ title, lots, categoryId }: HorizontalRowProps) {
  const [selectedLot, setSelectedLot] = useState<number | null>(null);

  return (
    <section className="py-2 md:py-4">
      <div className="px-2 md:px-4 mb-1.5 md:mb-3 flex items-center justify-between">
        <h2 className="text-xs md:text-xl font-bold text-white flex items-center gap-1 md:gap-2">
          <Sparkles className="w-3 h-3 md:w-5 md:h-5 text-pink-400" />
          {title}
        </h2>
        {lots.length > 12 && (
          <Link href={`/search?category=${categoryId}`}>
            <button className="text-[9px] md:text-sm text-cyan-400 hover:text-cyan-300 flex items-center gap-0.5 md:gap-1" data-testid={`button-more-${categoryId}`}>
              More
              <ChevronRight className="w-2.5 h-2.5 md:w-4 md:h-4" />
            </button>
          </Link>
        )}
      </div>
      
      <div className="overflow-x-auto scrollbar-hide">
        <div className="flex gap-1.5 md:gap-3 px-2 md:px-4">
          {lots.slice(0, 12).map((lot) => (
            <LotCard
              key={lot.id}
              lot={lot}
              isSelected={selectedLot === lot.id}
              onClick={() => setSelectedLot(selectedLot === lot.id ? null : lot.id)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Shop() {
  const totalLots = productLots.length;
  const totalParts = productLots.reduce((sum, lot) => sum + lot.totalQty, 0);

  return (
    <div className="min-h-screen bg-gray-950 relative overflow-hidden">
      {/* Enhanced Retro-futuristic Space background */}
      <div className="fixed inset-0 pointer-events-none">
        {/* Color orbs */}
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-purple-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-cyan-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/3 w-[400px] h-[400px] bg-pink-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />
        <div className="absolute bottom-1/3 right-1/3 w-[400px] h-[400px] bg-yellow-500/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1.5s' }} />
        <div className="absolute top-2/3 left-1/2 w-[300px] h-[300px] bg-red-500/8 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '0.8s' }} />
        <div className="absolute top-1/3 right-1/4 w-[350px] h-[350px] bg-green-500/8 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1.2s' }} />
        
        {/* Orbital rings */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] border border-purple-500/10 rounded-full animate-[spin_80s_linear_infinite]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] border border-cyan-500/10 rounded-full animate-[spin_60s_linear_infinite_reverse]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] border border-pink-500/10 rounded-full animate-[spin_40s_linear_infinite]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[200px] h-[200px] border border-yellow-500/10 rounded-full animate-[spin_30s_linear_infinite_reverse]" />
        
        {/* Stars/particles */}
        <div className="absolute top-1/4 left-1/5 w-1 h-1 bg-white rounded-full animate-pulse" />
        <div className="absolute top-2/3 left-2/5 w-0.5 h-0.5 bg-cyan-400 rounded-full animate-pulse" style={{ animationDelay: '0.5s' }} />
        <div className="absolute top-1/3 right-1/4 w-1 h-1 bg-pink-400 rounded-full animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute bottom-1/4 left-1/3 w-0.5 h-0.5 bg-purple-400 rounded-full animate-pulse" style={{ animationDelay: '1.5s' }} />
        <div className="absolute top-1/2 right-1/3 w-1 h-1 bg-yellow-400 rounded-full animate-pulse" style={{ animationDelay: '0.8s' }} />
      </div>

      <div className="relative z-10">
        {/* Admin-style Header */}
        <header className="sticky top-0 z-50 h-10 md:h-14 lg:h-16 border-b border-purple-500/30 flex items-center justify-between px-2 md:px-4 lg:px-6 bg-gradient-to-r from-purple-950/90 via-blue-950/80 to-purple-950/90 backdrop-blur-xl">
          {/* Elfie Icon - Left */}
          <button
            data-testid="button-elfie"
            className="relative group cursor-pointer flex items-center justify-center"
          >
            <div className="absolute inset-0 rounded-full bg-purple-500/30 blur-md animate-pulse group-hover:bg-purple-400/40 transition-all duration-300" />
            <div className="relative w-7 h-7 md:w-10 md:h-10 lg:w-12 lg:h-12 rounded-full bg-purple-500/20 border-2 border-purple-500/50 flex items-center justify-center group-hover:border-purple-400/70 group-hover:scale-110 transition-all duration-300">
              <img 
                src={elfieRobot} 
                alt="E.L.F.I.E." 
                className="w-5 h-5 md:w-8 md:h-8 lg:w-10 lg:h-10 object-contain"
              />
            </div>
            <div className="absolute inset-0 rounded-full border-2 border-purple-500/0 group-hover:border-purple-500/30 group-hover:scale-150 transition-all duration-500 opacity-0 group-hover:opacity-100" />
          </button>

          {/* PlanetBrick - Centered */}
          <h1 className="absolute left-1/2 transform -translate-x-1/2 text-sm md:text-xl lg:text-2xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">
            PlanetBrick
          </h1>

          {/* Cart & Login - Right */}
          <div className="flex items-center gap-1 md:gap-2">
            <Button size="icon" variant="ghost" className="text-cyan-300 h-7 w-7 md:h-10 md:w-10" data-testid="button-cart">
              <ShoppingCart className="w-3.5 h-3.5 md:w-5 md:h-5" />
            </Button>
            <Link href="/login">
              <Button variant="ghost" size="sm" className="text-cyan-300 text-[9px] md:text-sm h-6 md:h-9 px-1.5 md:px-3" data-testid="button-login-header">
                Login
              </Button>
            </Link>
          </div>
        </header>

        {/* Inventory Stats Banner - Admin Style */}
        <div className="sticky top-10 md:top-14 lg:top-16 z-40 px-2 md:px-4 lg:px-6 py-1.5 md:py-3 lg:py-4 bg-gradient-to-r from-pink-950/40 via-purple-950/30 to-cyan-950/40 border-b border-purple-500/30 backdrop-blur-xl">
          <div className="flex items-center justify-center gap-3 md:gap-6 text-[9px] md:text-sm lg:text-base">
            <div className="flex items-center gap-1 md:gap-2">
              <Sparkles className="w-2.5 h-2.5 md:w-4 md:h-4 lg:w-5 lg:w-5 text-pink-400" />
              <span className="font-bold text-white">{totalLots.toLocaleString()}</span>
              <span className="text-gray-400">Unique Lots</span>
            </div>
            <div className="w-px h-3 md:h-4 lg:h-5 bg-purple-500/30" />
            <div className="flex items-center gap-1 md:gap-2">
              <Sparkles className="w-2.5 h-2.5 md:w-4 md:h-4 lg:w-5 lg:w-5 text-cyan-400" />
              <span className="font-bold text-white">{totalParts.toLocaleString()}</span>
              <span className="text-gray-400">Total Parts</span>
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <div className="sticky top-16 md:top-[4.5rem] lg:top-[5.5rem] z-30 bg-gradient-to-b from-gray-900/95 to-gray-950/95 backdrop-blur-xl px-2 md:px-4 py-1.5 md:py-2 border-b border-purple-500/20">
          <div className="relative max-w-2xl mx-auto">
            <Search className="absolute left-2 md:left-3 top-1/2 -translate-y-1/2 w-3 h-3 md:w-4 md:h-4 text-gray-500" />
            <input
              type="text"
              placeholder="Search for LEGO parts..."
              className="w-full h-7 md:h-10 pl-7 md:pl-10 pr-3 md:pr-4 bg-gray-800/50 border border-purple-500/30 rounded-md text-[10px] md:text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
              data-testid="input-search"
            />
          </div>
        </div>

        {/* Netflix-style Horizontal Scrolling Rows */}
        <div className="pb-4 md:pb-8">
          <HorizontalRow title="Featured Profits" lots={featuredLots} categoryId="featured" />
          <HorizontalRow title="Bricks" lots={brickLots} categoryId="bricks" />
          <HorizontalRow title="Plates" lots={plateLots} categoryId="plates" />
          <HorizontalRow title="Tiles" lots={tileLots} categoryId="tiles" />
          <HorizontalRow title="Slopes" lots={slopeLots} categoryId="slopes" />
          <HorizontalRow title="Minifigs" lots={minifigLots} categoryId="minifigs" />
        </div>

        {/* Footer */}
        <footer className="border-t border-purple-500/30 py-3 md:py-4 px-2 md:px-4 mt-4 md:mt-6 bg-gradient-to-r from-purple-900/20 via-pink-900/10 to-cyan-900/20">
          <div className="text-center">
            <p className="text-gray-500 text-[9px] md:text-sm mb-1.5 md:mb-2">
              © 2025 PlanetBrick.com
            </p>
            <div className="flex justify-center gap-3 md:gap-4">
              <a href="#" className="text-gray-500 hover:text-cyan-400 text-[9px] md:text-sm transition-colors" data-testid="link-about">About</a>
              <a href="#" className="text-gray-500 hover:text-cyan-400 text-[9px] md:text-sm transition-colors" data-testid="link-shipping">Shipping</a>
              <a href="#" className="text-gray-500 hover:text-cyan-400 text-[9px] md:text-sm transition-colors" data-testid="link-contact">Contact</a>
            </div>
          </div>
        </footer>
      </div>

      <style>{`
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}
