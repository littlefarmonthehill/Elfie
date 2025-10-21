import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, ShoppingCart, ChevronRight, Sparkles, Plus, X, Minus } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import elfieRobot from "@assets/PlanetBrick_good_robot_1760672362080.png";
import planetBrickLogo from "@assets/PlanetBrick_with_planet_1761030158394.png";

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

interface ColorGroup {
  colorName: string;
  colorHex: string;
  variations: {
    color: string;
    colorHex: string;
    condition: string;
    qty: number;
    price: string;
  }[];
  totalQty: number;
}

interface ProductLot {
  id: number;
  part: string;
  name: string;
  totalQty: number;
  lotCount: number;
  uniqueColorCount: number;
  category: string;
  variations: {
    color: string;
    colorHex: string;
    condition: string;
    qty: number;
    price: string;
  }[];
  colorGroups: ColorGroup[];
}

// Mock data for development (will be replaced with API data)
const mockProductLots: Omit<ProductLot, 'uniqueColorCount' | 'colorGroups'>[] = [
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

interface LotCardProps {
  lot: ProductLot;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onAddToCart: (variation: any, quantity: number) => void;
}

function LotCard({ lot, isOpen, onOpenChange, onAddToCart }: LotCardProps) {
  const primaryColor = lot.variations[0];
  const [quantities, setQuantities] = useState<Record<number, number>>({});

  const updateQuantity = (idx: number, delta: number) => {
    setQuantities(prev => {
      const current = prev[idx] || 1;
      const newQty = Math.max(1, Math.min(lot.variations[idx].qty, current + delta));
      return { ...prev, [idx]: newQty };
    });
  };

  return (
    <>
      <Card
        className="shrink-0 w-36 md:w-64 p-2 md:p-4 bg-gray-900/60 border-purple-500/30 hover-elevate cursor-pointer transition-all"
        onClick={() => onOpenChange(true)}
        data-testid={`card-lot-${lot.id}`}
      >
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
                {lot.uniqueColorCount} {lot.uniqueColorCount === 1 ? 'color' : 'colors'}
              </Badge>
              <span className="text-[10px] md:text-sm font-bold text-cyan-400" data-testid={`text-qty-${lot.id}`}>
                {lot.totalQty.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </Card>

      <Dialog open={isOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[80vh] bg-black/98 border-white/20 overflow-hidden flex flex-col backdrop-blur-xl">
          <DialogHeader className="pb-3 border-b border-white/10">
            <DialogTitle className="text-lg md:text-xl font-bold text-white flex items-center gap-3">
              <Sparkles className="w-5 h-5 text-cyan-400" />
              {lot.name}
            </DialogTitle>
            <DialogDescription className="text-xs md:text-sm text-gray-400 flex items-center gap-2">
              <span className="text-cyan-400">#{lot.part}</span>
              <span className="text-gray-600">•</span>
              <span>{lot.uniqueColorCount} {lot.uniqueColorCount === 1 ? 'color' : 'colors'}</span>
              <span className="text-gray-600">•</span>
              <span>{lot.totalQty.toLocaleString()} pieces</span>
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto pr-2 mt-4">
            <div className="grid grid-cols-1 gap-3">
              {lot.colorGroups.map((colorGroup, groupIdx) => (
                <div key={groupIdx} className="space-y-2">
                  {/* Color Header */}
                  <div className="flex items-center gap-3 px-2">
                    <div
                      className="w-8 h-8 rounded-md shrink-0 border-2 border-white/30 shadow-md"
                      style={{ 
                        backgroundColor: colorGroup.colorHex,
                        boxShadow: `0 2px 8px ${colorGroup.colorHex}40`
                      }}
                    />
                    <div>
                      <h4 className="text-sm md:text-base font-bold text-white">{colorGroup.colorName}</h4>
                      <p className="text-xs text-gray-500">{colorGroup.totalQty.toLocaleString()} pieces total</p>
                    </div>
                  </div>
                  
                  {/* Condition Variations */}
                  <div className="space-y-1.5 pl-2">
                    {colorGroup.variations.map((variation, varIdx) => {
                      const idx = lot.variations.findIndex(v => v.color === variation.color && v.condition === variation.condition);
                      const quantity = quantities[idx] || 1;
                      return (
                        <div 
                          key={varIdx}
                          className="p-2.5 bg-gray-900/40 border border-white/5 rounded-lg hover-elevate transition-all duration-300 group"
                          data-testid={`variation-${lot.id}-${idx}`}
                        >
                          <div className="flex items-center gap-3">
                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="outline" className="text-[10px] md:text-xs text-gray-300 border-white/20">
                                  {variation.condition}
                                </Badge>
                                <span className="text-xs md:text-sm text-gray-500">{variation.qty.toLocaleString()} available</span>
                              </div>
                              <div className="text-base md:text-lg font-bold text-cyan-400 mt-1">{variation.price}</div>
                            </div>

                            {/* Quantity Controls */}
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1 bg-gray-800/80 rounded-md p-0.5 border border-white/10">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 text-white hover:bg-white/10"
                                  onClick={() => updateQuantity(idx, -1)}
                                  disabled={quantity <= 1}
                                >
                                  <Minus className="w-3 h-3" />
                                </Button>
                                <div className="w-10 text-center">
                                  <span className="text-sm font-bold text-white">{quantity}</span>
                                </div>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 text-white hover:bg-white/10"
                                  onClick={() => updateQuantity(idx, 1)}
                                  disabled={quantity >= variation.qty}
                                >
                                  <Plus className="w-3 h-3" />
                                </Button>
                              </div>
                              
                              <Button
                                size="sm"
                                className="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white px-3 text-xs shadow-lg transition-all duration-300 group-hover:shadow-cyan-500/50 h-6"
                                onClick={() => {
                                  onAddToCart({ ...variation, lotId: lot.id, partNumber: lot.part, partName: lot.name }, quantity);
                                  setQuantities(prev => ({ ...prev, [idx]: 1 }));
                                }}
                                data-testid={`button-add-${lot.id}-${idx}`}
                              >
                                <ShoppingCart className="w-3 h-3 mr-1" />
                                Add
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface HorizontalRowProps {
  title: string;
  lots: ProductLot[];
  categoryId: string;
  onAddToCart: (item: any, quantity: number) => void;
  bandColor: string;
}

function HorizontalRow({ title, lots, categoryId, onAddToCart, bandColor }: HorizontalRowProps) {
  const [openLotId, setOpenLotId] = useState<number | null>(null);

  return (
    <section className="py-6 md:py-8 relative">
      {/* Colorful Band Background */}
      <div className={`absolute inset-0 bg-gradient-to-r ${bandColor} opacity-10`} />
      
      <div className="relative z-10">
        <div className="px-3 md:px-6 mb-4 md:mb-6 flex items-center justify-between">
          <h2 className={`text-2xl md:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r ${bandColor} flex items-center gap-2 md:gap-4`}>
            <Sparkles className="w-6 h-6 md:w-8 md:h-8 text-white drop-shadow-lg" />
            {title}
          </h2>
          {lots.length > 12 && (
            <Link href={`/search?category=${categoryId}`}>
              <button className={`text-sm md:text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r ${bandColor} hover:opacity-80 flex items-center gap-1.5 md:gap-2 transition-opacity`} data-testid={`button-more-${categoryId}`}>
                More
                <ChevronRight className="w-5 h-5 md:w-6 md:h-6" />
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
                isOpen={openLotId === lot.id}
                onOpenChange={(open) => setOpenLotId(open ? lot.id : null)}
                onAddToCart={onAddToCart}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Shop() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const { toast } = useToast();

  // Fetch real inventory data
  const { data: inventoryData, isLoading: inventoryLoading } = useQuery<{ lots: ProductLot[] }>({
    queryKey: ['/api/shop/inventory'],
  });

  // Fetch real stats (using public shop endpoint)
  const { data: statsData, isLoading: statsLoading } = useQuery<{
    totalLots: number;
    totalParts: number;
  }>({
    queryKey: ['/api/shop/stats'],
  });

  // Process lots to group by color
  const processedLots = (inventoryData?.lots || mockProductLots).map(lot => {
    // Group variations by color
    const colorMap = new Map<string, ColorGroup>();
    
    lot.variations.forEach(variation => {
      if (!colorMap.has(variation.color)) {
        colorMap.set(variation.color, {
          colorName: variation.color,
          colorHex: variation.colorHex,
          variations: [],
          totalQty: 0
        });
      }
      const group = colorMap.get(variation.color)!;
      group.variations.push(variation);
      group.totalQty += variation.qty;
    });
    
    const colorGroups = Array.from(colorMap.values());
    
    return {
      ...lot,
      uniqueColorCount: colorGroups.length,
      colorGroups
    };
  });

  const productLots = processedLots;
  const totalLots = statsData?.totalLots || productLots.length;
  const totalParts = statsData?.totalParts || productLots.reduce((sum, lot) => sum + lot.totalQty, 0);
  
  // Group products by category
  const featuredLots = productLots.slice(0, 5);
  const brickLots = productLots.filter(lot => lot.category.includes('brick'));
  const plateLots = productLots.filter(lot => lot.category.includes('plate'));
  const minifigLots = productLots.filter(lot => lot.category.includes('minifig'));
  const tileLots = productLots.filter(lot => lot.category.includes('tile'));
  const slopeLots = productLots.filter(lot => lot.category.includes('slope'));

  const handleAddToCart = (item: any, quantity: number = 1) => {
    const cartItem: CartItem = {
      ...item,
      quantity, // Use provided quantity
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
        newCart[existingIndex].quantity += quantity;
        return newCart;
      } else {
        // Add new item
        return [...prevCart, cartItem];
      }
    });
    
    toast({
      title: "Added to cart",
      description: `${quantity}x ${item.partName} - ${item.color} (${item.condition})`,
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
    <div className="min-h-screen bg-black relative overflow-hidden">
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
        {/* Redesigned Header - Centered Logo, Comet Stats */}
        <header className="sticky top-0 z-50 bg-black/95 backdrop-blur-xl border-b border-white/10 relative pb-8 md:pb-12">
          <div className="px-4 md:px-8 py-2 md:py-3 flex items-start justify-between relative">
            {/* Cart & Login - Top Right */}
            <div className="flex items-center gap-1.5 md:gap-3 ml-auto">
              <Sheet open={isCartOpen} onOpenChange={setIsCartOpen}>
                <SheetTrigger asChild>
                  <Button size="icon" variant="ghost" className="text-cyan-300 h-8 w-8 md:h-10 md:w-10 relative hover-elevate" data-testid="button-cart">
                    <ShoppingCart className="w-4 h-4 md:w-5 md:h-5" />
                    {cartCount > 0 && (
                      <Badge className="absolute -top-1 -right-1 h-4 w-4 md:h-5 md:w-5 flex items-center justify-center p-0 text-[8px] md:text-[9px] bg-cyan-500 border-none font-bold">
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
              <Button variant="ghost" size="sm" className="text-cyan-300 text-[9px] md:text-sm h-8 md:h-10 px-2 md:px-3" data-testid="button-login-header">
                Login
              </Button>
            </Link>
            </div>
          </div>

          {/* Centered Logo - Half In/Half Out */}
          <div className="absolute left-1/2 -translate-x-1/2 top-1 md:top-2 z-[60]">
            <img 
              src={planetBrickLogo} 
              alt="PlanetBrick" 
              className="h-12 md:h-20 w-auto object-contain drop-shadow-2xl"
              data-testid="logo-planetbrick"
            />
          </div>

          {/* Stats Row - Below Logo */}
          <div className="absolute bottom-1.5 left-0 right-0 flex items-center justify-center gap-8 md:gap-16 z-[50]">
            {/* Lots - Left with Comet Trail */}
            <div className="flex items-center gap-2 relative group">
              {/* Comet trail effect */}
              <div className="absolute -left-8 top-1/2 -translate-y-1/2 w-32 h-px bg-gradient-to-r from-transparent via-cyan-400/40 to-cyan-500/60 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <div className="relative">
                <Sparkles className="w-4 h-4 md:w-5 md:h-5 text-cyan-400" />
              </div>
              <div className="text-left">
                <div className="text-sm md:text-lg font-bold text-white">{totalLots.toLocaleString()}</div>
                <div className="text-[8px] md:text-[10px] text-gray-400">Unique Lots</div>
              </div>
            </div>

            {/* Parts - Right with Comet Trail */}
            <div className="flex items-center gap-2 group">
              <div className="text-right">
                <div className="text-sm md:text-lg font-bold text-white">{totalParts.toLocaleString()}</div>
                <div className="text-[8px] md:text-[10px] text-gray-400">Total Parts</div>
              </div>
              <div className="relative">
                <Sparkles className="w-4 h-4 md:w-5 md:h-5 text-blue-400" />
              </div>
              {/* Comet trail effect */}
              <div className="absolute -right-8 top-1/2 -translate-y-1/2 w-32 h-px bg-gradient-to-l from-transparent via-blue-400/40 to-blue-500/60 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            </div>
          </div>
        </header>

        {/* Search Bar */}
        <div className="sticky top-[5rem] md:top-[6rem] z-30 bg-black/95 backdrop-blur-xl px-3 md:px-6 py-3 md:py-4 border-b border-white/10">
          <div className="relative max-w-3xl mx-auto">
            <Search className="absolute left-3 md:left-4 top-1/2 -translate-y-1/2 w-4 h-4 md:w-5 md:h-5 text-gray-500" />
            <input
              type="text"
              placeholder="Search for LEGO parts..."
              className="w-full h-9 md:h-12 pl-9 md:pl-12 pr-4 md:pr-5 bg-gray-900/80 border border-white/20 rounded-md text-xs md:text-base text-white placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
              data-testid="input-search"
            />
          </div>
        </div>

        {/* Colorful Category Bands */}
        <div className="pb-4 md:pb-8">
          <HorizontalRow title="Featured Products" lots={featuredLots} categoryId="featured" onAddToCart={handleAddToCart} bandColor="from-blue-500 via-cyan-400 to-white" />
          <HorizontalRow title="Bricks" lots={brickLots} categoryId="bricks" onAddToCart={handleAddToCart} bandColor="from-gray-400 via-blue-400 to-red-500" />
          <HorizontalRow title="Plates" lots={plateLots} categoryId="plates" onAddToCart={handleAddToCart} bandColor="from-blue-600 via-cyan-500 to-gray-300" />
          <HorizontalRow title="Tiles" lots={tileLots} categoryId="tiles" onAddToCart={handleAddToCart} bandColor="from-white via-blue-300 to-cyan-500" />
          <HorizontalRow title="Slopes" lots={slopeLots} categoryId="slopes" onAddToCart={handleAddToCart} bandColor="from-indigo-600 via-blue-400 to-white" />
          <HorizontalRow title="Minifigs" lots={minifigLots} categoryId="minifigs" onAddToCart={handleAddToCart} bandColor="from-gray-500 via-red-400 to-blue-500" />
        </div>

        {/* Footer */}
        <footer className="border-t border-white/10 py-3 md:py-4 px-2 md:px-4 mt-4 md:mt-6 bg-black/50">
          <div className="text-center">
            <p className="text-gray-500 text-[9px] md:text-sm mb-1.5 md:mb-2">
              © 2025 PlanetBrick.com
            </p>
            <div className="flex justify-center gap-3 md:gap-4">
              <a href="#" className="text-gray-400 hover:text-cyan-400 text-[9px] md:text-sm transition-colors" data-testid="link-about">About</a>
              <a href="#" className="text-gray-400 hover:text-cyan-400 text-[9px] md:text-sm transition-colors" data-testid="link-shipping">Shipping</a>
              <a href="#" className="text-gray-400 hover:text-cyan-400 text-[9px] md:text-sm transition-colors" data-testid="link-contact">Contact</a>
            </div>
          </div>
        </footer>
      </div>

      {/* Floating E.L.F.I.E. Chatbot Button - Bottom Right */}
      <button
        data-testid="button-elfie-chat"
        className="fixed bottom-6 right-6 z-[70] group cursor-pointer"
      >
        <div className="relative">
          {/* Pulsing glow effect */}
          <div className="absolute inset-0 rounded-full bg-gradient-to-r from-blue-500 via-cyan-400 to-white blur-xl animate-pulse group-hover:blur-2xl transition-all duration-300 opacity-60" />
          
          {/* Main button */}
          <div className="relative w-16 h-16 md:w-20 md:h-20 rounded-full bg-gradient-to-r from-blue-600 via-cyan-500 to-blue-400 border-4 border-white/20 flex items-center justify-center group-hover:scale-110 transition-all duration-300 shadow-2xl">
            <img 
              src={elfieRobot} 
              alt="E.L.F.I.E." 
              className="w-12 h-12 md:w-16 md:h-16 object-contain"
            />
          </div>

          {/* Label */}
          <div className="absolute -top-12 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
            <div className="bg-gray-900 text-white px-3 py-1.5 rounded-lg text-sm font-bold border border-purple-500/50">
              E.L.F.I.E.
              <div className="text-[10px] text-gray-400">Inventory & Set Info</div>
            </div>
          </div>

          {/* Orbital ring animation */}
          <div className="absolute inset-0 rounded-full border-2 border-blue-500/30 group-hover:border-cyan-500/50 group-hover:scale-150 transition-all duration-700 opacity-0 group-hover:opacity-100" />
        </div>
      </button>

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
