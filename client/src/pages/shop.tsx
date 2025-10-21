import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, ShoppingCart, ChevronRight, Sparkles, Plus, X } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import elfieRobot from "@assets/PlanetBrick_good_robot_1760672362080.png";
import planetBrickLogo from "@assets/PlanetBrick_dotcom_with_planet_and_robot_400_1760672362080.png";

interface CartItem {
  lotId: number;
  partNumber: string;
  partName: string;
  color: string;
  colorHex: string;
  condition: string;
  qty: number;
  price: string;
  quantity: number; // quantity being purchased
}

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
  onAddToCart: (variation: any) => void;
}

function LotCard({ lot, isSelected, onClick, onAddToCart }: LotCardProps) {
  const primaryColor = lot.variations[0];

  return (
    <Card
      className={`shrink-0 bg-gray-900/60 border-purple-500/30 hover-elevate cursor-pointer transition-all duration-300 ${
        isSelected 
          ? 'ring-2 ring-cyan-400 scale-110 md:scale-125 z-20 w-40 md:w-80' 
          : 'w-36 md:w-64 p-2 md:p-4'
      } ${isSelected ? 'p-2 md:p-4' : ''}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button[data-add-to-cart]')) {
          return;
        }
        onClick();
      }}
      data-testid={`card-lot-${lot.id}`}
    >
      {!isSelected ? (
        // Front: Lot Summary
        <div>
          <div
            className="w-full aspect-square rounded-md mb-2 md:mb-3 flex items-center justify-center border border-gray-700/50 relative overflow-hidden"
            style={{
              background: `linear-gradient(135deg, ${primaryColor.colorHex}60 0%, ${primaryColor.colorHex}30 100%)`,
              boxShadow: `0 4px 16px ${primaryColor.colorHex}40`
            }}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 via-transparent to-cyan-500/10" />
            <div className="absolute top-0 left-0 w-full h-full">
              {/* Floating sparkles */}
              <div className="absolute top-2 right-2 w-1.5 h-1.5 md:w-3 md:h-3 bg-white rounded-full animate-pulse" style={{ animationDelay: '0s' }} />
              <div className="absolute bottom-3 left-3 w-1.5 h-1.5 md:w-3 md:h-3 bg-cyan-400 rounded-full animate-pulse" style={{ animationDelay: '0.5s' }} />
              <div className="absolute top-1/2 left-1/4 w-1 h-1 md:w-2 md:h-2 bg-pink-400 rounded-full animate-pulse" style={{ animationDelay: '1s' }} />
            </div>
            <div className="text-base md:text-3xl font-bold relative z-10" style={{
              color: primaryColor.colorHex === '#FCFCFC' || primaryColor.colorHex === '#F2F3F2' ? '#00000030' : '#FFFFFF50',
              textShadow: '0 2px 4px rgba(0,0,0,0.4)'
            }}>
              LEGO
            </div>
          </div>
          
          <div className="space-y-1 md:space-y-2">
            <h3 className="text-xs md:text-base font-bold text-white leading-tight truncate">{lot.name}</h3>
            <p className="text-[10px] md:text-sm text-gray-400">#{lot.part}</p>
            
            <div className="flex items-center justify-between pt-1">
              <Badge variant="secondary" className="text-[9px] md:text-sm px-1 md:px-2 py-0.5 h-auto">
                {lot.lotCount} colors
              </Badge>
              <span className="text-[10px] md:text-sm font-bold text-cyan-400" data-testid={`text-qty-${lot.id}`}>
                {lot.totalQty.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      ) : (
        // Back: Color/Condition Variations with Add to Cart
        <div className="space-y-1 md:space-y-2">
          <div className="flex items-center justify-between mb-1 md:mb-2">
            <h3 className="text-[10px] md:text-base font-bold text-white">#{lot.part} - {lot.name}</h3>
            <Badge className="text-[9px] md:text-sm px-1 md:px-2 py-0.5 h-auto bg-cyan-600/20 text-cyan-300 border-cyan-500/30">
              {lot.totalQty.toLocaleString()}
            </Badge>
          </div>
          
          <div className="space-y-1 md:space-y-1.5 max-h-32 md:max-h-64 overflow-y-auto">
            {lot.variations.map((variation, idx) => (
              <div
                key={idx}
                className="flex items-center gap-1 md:gap-2 p-1 md:p-2 rounded bg-gray-800/50 border border-gray-700/50 hover-elevate"
                data-testid={`variation-${lot.id}-${idx}`}
              >
                <div
                  className="w-3 h-3 md:w-6 md:h-6 rounded-sm shrink-0 border border-gray-600/50"
                  style={{ backgroundColor: variation.colorHex }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] md:text-sm text-white truncate font-medium">{variation.color}</p>
                  <p className="text-[8px] md:text-xs text-gray-500">{variation.condition}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[9px] md:text-sm font-semibold text-cyan-400">{variation.price}</p>
                  <p className="text-[8px] md:text-xs text-gray-400">{variation.qty.toLocaleString()} avail</p>
                </div>
                <Button
                  size="sm"
                  variant="default"
                  className="shrink-0 h-6 md:h-8 px-2 md:px-3 text-[8px] md:text-xs bg-cyan-600 hover:bg-cyan-500"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddToCart({ ...variation, lotId: lot.id, partNumber: lot.part, partName: lot.name });
                  }}
                  data-add-to-cart
                  data-testid={`button-add-${lot.id}-${idx}`}
                >
                  <Plus className="w-3 h-3 md:w-4 md:h-4" />
                </Button>
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
  onAddToCart: (item: any) => void;
}

function HorizontalRow({ title, lots, categoryId, onAddToCart }: HorizontalRowProps) {
  const [selectedLot, setSelectedLot] = useState<number | null>(null);

  return (
    <section className="py-3 md:py-6">
      <div className="px-3 md:px-6 mb-2 md:mb-4 flex items-center justify-between">
        <h2 className="text-sm md:text-2xl font-bold text-white flex items-center gap-1.5 md:gap-3">
          <Sparkles className="w-4 h-4 md:w-6 md:h-6 text-pink-400" />
          {title}
        </h2>
        {lots.length > 12 && (
          <Link href={`/search?category=${categoryId}`}>
            <button className="text-[10px] md:text-base text-cyan-400 hover:text-cyan-300 flex items-center gap-1 md:gap-1.5" data-testid={`button-more-${categoryId}`}>
              More
              <ChevronRight className="w-3 h-3 md:w-5 md:h-5" />
            </button>
          </Link>
        )}
      </div>
      
      <div className="overflow-x-auto scrollbar-hide">
        <div className="flex gap-2 md:gap-4 px-3 md:px-6">
          {lots.slice(0, 12).map((lot) => (
            <LotCard
              key={lot.id}
              lot={lot}
              isSelected={selectedLot === lot.id}
              onClick={() => setSelectedLot(selectedLot === lot.id ? null : lot.id)}
              onAddToCart={onAddToCart}
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
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const { toast } = useToast();

  const handleAddToCart = (item: any) => {
    const cartItem: CartItem = {
      ...item,
      quantity: 1, // default quantity
    };
    
    setCart(prevCart => {
      // Check if item already in cart
      const existingIndex = prevCart.findIndex(
        i => i.lotId === item.lotId && 
        i.color === item.color && 
        i.condition === item.condition
      );
      
      if (existingIndex >= 0) {
        // Update quantity
        const newCart = [...prevCart];
        newCart[existingIndex].quantity += 1;
        return newCart;
      } else {
        // Add new item
        return [...prevCart, cartItem];
      }
    });
    
    toast({
      title: "Added to cart",
      description: `${item.partName} - ${item.color} (${item.condition})`,
    });
  };

  const handleRemoveFromCart = (index: number) => {
    setCart(prevCart => prevCart.filter((_, i) => i !== index));
  };

  const cartTotal = cart.reduce((sum, item) => {
    const price = parseFloat(item.price.replace('$', ''));
    return sum + (price * item.quantity);
  }, 0);

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

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
        {/* Admin-style Header - Bigger */}
        <header className="sticky top-0 z-50 h-14 md:h-20 lg:h-24 border-b border-purple-500/30 flex items-center justify-between px-3 md:px-6 lg:px-8 bg-gradient-to-r from-purple-950/90 via-blue-950/80 to-purple-950/90 backdrop-blur-xl">
          {/* Elfie Icon - Left */}
          <button
            data-testid="button-elfie"
            className="relative group cursor-pointer flex items-center justify-center"
          >
            <div className="absolute inset-0 rounded-full bg-purple-500/30 blur-md animate-pulse group-hover:bg-purple-400/40 transition-all duration-300" />
            <div className="relative w-9 h-9 md:w-14 md:h-14 lg:w-16 lg:h-16 rounded-full bg-purple-500/20 border-2 border-purple-500/50 flex items-center justify-center group-hover:border-purple-400/70 group-hover:scale-110 transition-all duration-300">
              <img 
                src={elfieRobot} 
                alt="E.L.F.I.E." 
                className="w-7 h-7 md:w-12 md:h-12 lg:w-14 lg:h-14 object-contain"
              />
            </div>
            <div className="absolute inset-0 rounded-full border-2 border-purple-500/0 group-hover:border-purple-500/30 group-hover:scale-150 transition-all duration-500 opacity-0 group-hover:opacity-100" />
          </button>

          {/* PlanetBrick Logo - Centered */}
          <div className="absolute left-1/2 transform -translate-x-1/2 flex items-center justify-center">
            <img 
              src={planetBrickLogo} 
              alt="PlanetBrick.com" 
              className="h-10 md:h-16 lg:h-20 w-auto object-contain"
              data-testid="logo-planetbrick"
            />
          </div>

          {/* Cart & Login - Right */}
          <div className="flex items-center gap-1.5 md:gap-3">
            <Sheet open={isCartOpen} onOpenChange={setIsCartOpen}>
              <SheetTrigger asChild>
                <Button size="icon" variant="ghost" className="text-cyan-300 h-9 w-9 md:h-12 md:w-12 relative" data-testid="button-cart">
                  <ShoppingCart className="w-5 h-5 md:w-7 md:h-7" />
                  {cartCount > 0 && (
                    <Badge className="absolute -top-1 -right-1 h-5 w-5 md:h-6 md:w-6 flex items-center justify-center p-0 text-[8px] md:text-[10px] bg-cyan-500 border-none">
                      {cartCount}
                    </Badge>
                  )}
                </Button>
              </SheetTrigger>
              <SheetContent className="w-full sm:max-w-lg bg-gray-900 border-purple-500/30">
                <SheetHeader>
                  <SheetTitle className="text-white">Shopping Cart</SheetTitle>
                  <SheetDescription className="text-gray-400">
                    {cartCount} {cartCount === 1 ? 'item' : 'items'} in cart
                  </SheetDescription>
                </SheetHeader>
                <div className="mt-6 space-y-3 max-h-[60vh] overflow-y-auto">
                  {cart.length === 0 ? (
                    <p className="text-gray-500 text-center py-8">Your cart is empty</p>
                  ) : (
                    cart.map((item, index) => (
                      <Card key={index} className="p-3 bg-gray-800/50 border-gray-700">
                        <div className="flex items-start gap-3">
                          <div
                            className="w-8 h-8 rounded shrink-0 border border-gray-600"
                            style={{ backgroundColor: item.colorHex }}
                          />
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-semibold text-white truncate">
                              {item.partName}
                            </h4>
                            <p className="text-xs text-gray-400">#{item.partNumber}</p>
                            <p className="text-xs text-gray-500">
                              {item.color} • {item.condition}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-sm font-bold text-cyan-400">{item.price}</span>
                              <span className="text-xs text-gray-500">× {item.quantity}</span>
                            </div>
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-red-400 hover:text-red-300 shrink-0"
                            onClick={() => handleRemoveFromCart(index)}
                            data-testid={`button-remove-${index}`}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      </Card>
                    ))
                  )}
                </div>
                {cart.length > 0 && (
                  <div className="mt-6 pt-4 border-t border-gray-700">
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-lg font-bold text-white">Total:</span>
                      <span className="text-xl font-bold text-cyan-400">
                        ${cartTotal.toFixed(2)}
                      </span>
                    </div>
                    <Button className="w-full bg-cyan-600 hover:bg-cyan-500 text-white" data-testid="button-checkout">
                      Proceed to Checkout
                    </Button>
                  </div>
                )}
              </SheetContent>
            </Sheet>
            <Link href="/login">
              <Button variant="ghost" size="default" className="text-cyan-300 text-[10px] md:text-base h-9 md:h-12 px-2 md:px-4" data-testid="button-login-header">
                Login
              </Button>
            </Link>
          </div>
        </header>

        {/* Inventory Stats Banner - Admin Style - Bigger */}
        <div className="sticky top-14 md:top-20 lg:top-24 z-40 px-3 md:px-6 lg:px-8 py-2 md:py-4 lg:py-5 bg-gradient-to-r from-pink-950/40 via-purple-950/30 to-cyan-950/40 border-b border-purple-500/30 backdrop-blur-xl">
          <div className="flex items-center justify-center gap-4 md:gap-8 text-xs md:text-base lg:text-lg">
            <div className="flex items-center gap-1.5 md:gap-2.5">
              <Sparkles className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-pink-400" />
              <span className="font-bold text-white">{totalLots.toLocaleString()}</span>
              <span className="text-gray-400">Unique Lots</span>
            </div>
            <div className="w-px h-4 md:h-5 lg:h-6 bg-purple-500/30" />
            <div className="flex items-center gap-1.5 md:gap-2.5">
              <Sparkles className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-cyan-400" />
              <span className="font-bold text-white">{totalParts.toLocaleString()}</span>
              <span className="text-gray-400">Total Parts</span>
            </div>
          </div>
        </div>

        {/* Search Bar - Bigger */}
        <div className="sticky top-[6.5rem] md:top-[8.5rem] lg:top-[10.25rem] z-30 bg-gradient-to-b from-gray-900/95 to-gray-950/95 backdrop-blur-xl px-3 md:px-6 py-2 md:py-3 border-b border-purple-500/20">
          <div className="relative max-w-3xl mx-auto">
            <Search className="absolute left-3 md:left-4 top-1/2 -translate-y-1/2 w-4 h-4 md:w-5 md:h-5 text-gray-500" />
            <input
              type="text"
              placeholder="Search for LEGO parts..."
              className="w-full h-9 md:h-12 pl-9 md:pl-12 pr-4 md:pr-5 bg-gray-800/50 border border-purple-500/30 rounded-md text-xs md:text-base text-white placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
              data-testid="input-search"
            />
          </div>
        </div>

        {/* Netflix-style Horizontal Scrolling Rows */}
        <div className="pb-4 md:pb-8">
          <HorizontalRow title="Featured Profits" lots={featuredLots} categoryId="featured" onAddToCart={handleAddToCart} />
          <HorizontalRow title="Bricks" lots={brickLots} categoryId="bricks" onAddToCart={handleAddToCart} />
          <HorizontalRow title="Plates" lots={plateLots} categoryId="plates" onAddToCart={handleAddToCart} />
          <HorizontalRow title="Tiles" lots={tileLots} categoryId="tiles" onAddToCart={handleAddToCart} />
          <HorizontalRow title="Slopes" lots={slopeLots} categoryId="slopes" onAddToCart={handleAddToCart} />
          <HorizontalRow title="Minifigs" lots={minifigLots} categoryId="minifigs" onAddToCart={handleAddToCart} />
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
