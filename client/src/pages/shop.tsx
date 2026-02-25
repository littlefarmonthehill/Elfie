import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, ShoppingCart, ChevronRight, Sparkles, Plus, X, Minus, Check, ChevronDown, ChevronUp, ExternalLink, LayoutGrid, List } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";
import { formatProductDisplayName, formatColorDisplayName } from "@/lib/lego-branding";
import { PublicHeader } from "@/components/PublicHeader";
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
import noImagePlaceholder from "@assets/generated_images/LEGO_image_unavailable_placeholder_957f3211.png";

// Store URLs for showroom links (placeholders - update with actual store URLs)
const BRICKLINK_STORE_URL = "#bricklink-store";
const BRICKOWL_STORE_URL = "#brickowl-store";

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
  itemType?: string;
  totalQty: number;
  lotCount: number;
  uniqueColorCount: number;
  category: string;
  categoryId?: number | null;
  categoryName?: string | null;
  imageUrl?: string | null;
  thumbnailUrl?: string | null;
  firstColorId?: number | null;
  variations: {
    color: string;
    colorId: number | null;
    colorHex: string;
    condition: string;
    qty: number;
    price: string;
    imageUrl?: string | null;
    thumbnailUrl?: string | null;
  }[];
  colorGroups: ColorGroup[];
}

function getProxyImageUrl(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;
  // BrickLink CDN images load directly — no proxy needed
  if (imageUrl.includes('img.bricklink.com')) return imageUrl;
  // Rebrickable and others go through our proxy
  return `/api/images/proxy?url=${encodeURIComponent(imageUrl)}`;
}

// Mock data for development (will be replaced with API data)
const mockProductLots: Array<Omit<ProductLot, 'uniqueColorCount' | 'colorGroups'>> = [
  { 
    id: 1, 
    part: "3001", 
    name: "2x4 Brick", 
    totalQty: 8547,
    lotCount: 5,
    category: "bricks",
    variations: [
      { color: "Red", colorId: null, colorHex: "#D50000", condition: "New", qty: 2847, price: "$0.15" },
      { color: "Blue", colorId: null, colorHex: "#0055BF", condition: "New", qty: 1823, price: "$0.15" },
      { color: "Yellow", colorId: null, colorHex: "#F2CD37", condition: "New", qty: 1456, price: "$0.14" },
      { color: "Green", colorId: null, colorHex: "#00852B", condition: "Used", qty: 1789, price: "$0.10" },
      { color: "Black", colorId: null, colorHex: "#05131D", condition: "New", qty: 632, price: "$0.16" },
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
      { color: "Blue", colorId: null, colorHex: "#0055BF", condition: "New", qty: 5621, price: "$0.08" },
      { color: "White", colorId: null, colorHex: "#F2F3F2", condition: "New", qty: 2987, price: "$0.07" },
      { color: "Black", colorId: null, colorHex: "#05131D", condition: "New", qty: 1834, price: "$0.08" },
      { color: "Red", colorId: null, colorHex: "#D50000", condition: "Used", qty: 1234, price: "$0.05" },
      { color: "Gray", colorId: null, colorHex: "#6C6E68", condition: "New", qty: 567, price: "$0.08" },
      { color: "Tan", colorId: null, colorHex: "#E4CD9E", condition: "Used", qty: 213, price: "$0.05" },
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
      { color: "Yellow", colorId: null, colorHex: "#F2CD37", condition: "New", qty: 1893, price: "$0.12" },
      { color: "Red", colorId: null, colorHex: "#D50000", condition: "New", qty: 2341, price: "$0.12" },
      { color: "White", colorId: null, colorHex: "#F2F3F2", condition: "Used", qty: 1456, price: "$0.08" },
      { color: "Orange", colorId: null, colorHex: "#FE8A18", condition: "New", qty: 544, price: "$0.13" },
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
      { color: "Trans-Clear", colorId: null, colorHex: "#FCFCFC", condition: "New", qty: 8234, price: "$0.05" },
      { color: "Trans-Blue", colorId: null, colorHex: "#0081F0", condition: "New", qty: 2987, price: "$0.06" },
      { color: "Black", colorId: null, colorHex: "#05131D", condition: "New", qty: 1834, price: "$0.05" },
      { color: "Red", colorId: null, colorHex: "#D50000", condition: "New", qty: 1234, price: "$0.05" },
      { color: "Yellow", colorId: null, colorHex: "#F2CD37", condition: "New", qty: 789, price: "$0.05" },
      { color: "Green", colorId: null, colorHex: "#00852B", condition: "Used", qty: 456, price: "$0.03" },
      { color: "White", colorId: null, colorHex: "#F2F3F2", condition: "New", qty: 144, price: "$0.05" },
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
      { color: "Dark Gray", colorId: null, colorHex: "#6C6E68", condition: "New", qty: 967, price: "$0.18" },
      { color: "White", colorId: null, colorHex: "#F2F3F2", condition: "New", qty: 1456, price: "$0.17" },
      { color: "Black", colorId: null, colorHex: "#05131D", condition: "Used", qty: 1033, price: "$0.12" },
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
      { color: "Green", colorId: null, colorHex: "#00852B", condition: "New", qty: 3421, price: "$0.22" },
      { color: "Tan", colorId: null, colorHex: "#E4CD9E", condition: "New", qty: 1234, price: "$0.20" },
      { color: "Blue", colorId: null, colorHex: "#0055BF", condition: "Used", qty: 789, price: "$0.15" },
      { color: "Red", colorId: null, colorHex: "#D50000", condition: "New", qty: 234, price: "$0.22" },
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
      { color: "Yellow", colorId: null, colorHex: "#F2CD37", condition: "New", qty: 534, price: "$0.45" },
      { color: "Yellow", colorId: null, colorHex: "#F2CD37", condition: "Used", qty: 987, price: "$0.30" },
      { color: "Light Flesh", colorId: null, colorHex: "#F6D7B3", condition: "New", qty: 613, price: "$0.48" },
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
      { color: "Orange", colorId: null, colorHex: "#FE8A18", condition: "New", qty: 1234, price: "$0.28" },
      { color: "Bright Orange", colorId: null, colorHex: "#D67923", condition: "New", qty: 1765, price: "$0.18" },
      { color: "White", colorId: null, colorHex: "#F2F3F2", condition: "New", qty: 2341, price: "$0.16" },
      { color: "Blue", colorId: null, colorHex: "#0055BF", condition: "Used", qty: 1567, price: "$0.12" },
      { color: "Black", colorId: null, colorHex: "#05131D", condition: "New", qty: 983, price: "$0.17" },
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
      { color: "Red", colorId: null, colorHex: "#D50000", condition: "New", qty: 4521, price: "$0.04" },
      { color: "Blue", colorId: null, colorHex: "#0055BF", condition: "New", qty: 3892, price: "$0.04" },
      { color: "Yellow", colorId: null, colorHex: "#F2CD37", condition: "New", qty: 2981, price: "$0.04" },
      { color: "Green", colorId: null, colorHex: "#00852B", condition: "New", qty: 2341, price: "$0.04" },
      { color: "White", colorId: null, colorHex: "#F2F3F2", condition: "New", qty: 1892, price: "$0.04" },
      { color: "Black", colorId: null, colorHex: "#05131D", condition: "New", qty: 1567, price: "$0.05" },
      { color: "Orange", colorId: null, colorHex: "#FE8A18", condition: "New", qty: 789, price: "$0.05" },
      { color: "Tan", colorId: null, colorHex: "#E4CD9E", condition: "Used", qty: 251, price: "$0.03" },
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
      { color: "White", colorId: null, colorHex: "#F2F3F2", condition: "New", qty: 892, price: "$0.25" },
      { color: "Black", colorId: null, colorHex: "#05131D", condition: "New", qty: 634, price: "$0.26" },
      { color: "Gray", colorId: null, colorHex: "#6C6E68", condition: "New", qty: 321, price: "$0.25" },
      { color: "Blue", colorId: null, colorHex: "#0055BF", condition: "Used", qty: 140, price: "$0.18" },
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
      { color: "Red", colorId: null, colorHex: "#D50000", condition: "New", qty: 1234, price: "$0.32" },
      { color: "Blue", colorId: null, colorHex: "#0055BF", condition: "New", qty: 1089, price: "$0.32" },
      { color: "Yellow", colorId: null, colorHex: "#F2CD37", condition: "New", qty: 892, price: "$0.31" },
      { color: "Green", colorId: null, colorHex: "#00852B", condition: "Used", qty: 678, price: "$0.22" },
      { color: "White", colorId: null, colorHex: "#F2F3F2", condition: "New", qty: 428, price: "$0.32" },
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
      { color: "White", colorId: null, colorHex: "#F2F3F2", condition: "New", qty: 2987, price: "$0.06" },
      { color: "Black", colorId: null, colorHex: "#05131D", condition: "New", qty: 2456, price: "$0.07" },
      { color: "Red", colorId: null, colorHex: "#D50000", condition: "New", qty: 1678, price: "$0.06" },
      { color: "Blue", colorId: null, colorHex: "#0055BF", condition: "New", qty: 1234, price: "$0.06" },
      { color: "Yellow", colorId: null, colorHex: "#F2CD37", condition: "Used", qty: 987, price: "$0.04" },
      { color: "Green", colorId: null, colorHex: "#00852B", condition: "New", qty: 534, price: "$0.06" },
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
      { color: "Red", colorId: null, colorHex: "#D50000", condition: "New", qty: 2987, price: "$0.09" },
      { color: "Blue", colorId: null, colorHex: "#0055BF", condition: "New", qty: 2456, price: "$0.09" },
      { color: "Yellow", colorId: null, colorHex: "#F2CD37", condition: "New", qty: 1987, price: "$0.09" },
      { color: "Green", colorId: null, colorHex: "#00852B", condition: "New", qty: 1678, price: "$0.09" },
      { color: "White", colorId: null, colorHex: "#F2F3F2", condition: "New", qty: 1234, price: "$0.09" },
      { color: "Black", colorId: null, colorHex: "#05131D", condition: "New", qty: 678, price: "$0.10" },
      { color: "Gray", colorId: null, colorHex: "#6C6E68", condition: "Used", qty: 214, price: "$0.06" },
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
      { color: "Red", colorId: null, colorHex: "#D50000", condition: "New", qty: 1892, price: "$0.11" },
      { color: "Blue", colorId: null, colorHex: "#0055BF", condition: "New", qty: 1567, price: "$0.11" },
      { color: "Yellow", colorId: null, colorHex: "#F2CD37", condition: "New", qty: 1234, price: "$0.11" },
      { color: "White", colorId: null, colorHex: "#F2F3F2", condition: "Used", qty: 985, price: "$0.07" },
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
      { color: "Red", colorId: null, colorHex: "#D50000", condition: "New", qty: 4892, price: "$0.05" },
      { color: "Blue", colorId: null, colorHex: "#0055BF", condition: "New", qty: 4123, price: "$0.05" },
      { color: "Yellow", colorId: null, colorHex: "#F2CD37", condition: "New", qty: 3567, price: "$0.05" },
      { color: "Green", colorId: null, colorHex: "#00852B", condition: "New", qty: 2987, price: "$0.05" },
      { color: "White", colorId: null, colorHex: "#F2F3F2", condition: "New", qty: 2456, price: "$0.05" },
      { color: "Black", colorId: null, colorHex: "#05131D", condition: "New", qty: 2134, price: "$0.06" },
      { color: "Orange", colorId: null, colorHex: "#FE8A18", condition: "New", qty: 1678, price: "$0.06" },
      { color: "Trans-Clear", colorId: null, colorHex: "#FCFCFC", condition: "New", qty: 1234, price: "$0.07" },
      { color: "Gray", colorId: null, colorHex: "#6C6E68", condition: "Used", qty: 385, price: "$0.03" },
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
      { color: "Red", colorId: null, colorHex: "#D50000", condition: "New", qty: 1234, price: "$0.22" },
      { color: "Blue", colorId: null, colorHex: "#0055BF", condition: "New", qty: 1089, price: "$0.22" },
      { color: "Yellow", colorId: null, colorHex: "#F2CD37", condition: "New", qty: 892, price: "$0.22" },
      { color: "White", colorId: null, colorHex: "#F2F3F2", condition: "Used", qty: 677, price: "$0.15" },
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
      { color: "Red", colorId: null, colorHex: "#D50000", condition: "New", qty: 1234, price: "$0.35" },
      { color: "Blue", colorId: null, colorHex: "#0055BF", condition: "New", qty: 1089, price: "$0.35" },
      { color: "Yellow", colorId: null, colorHex: "#F2CD37", condition: "New", qty: 892, price: "$0.34" },
      { color: "White", colorId: null, colorHex: "#F2F3F2", condition: "New", qty: 789, price: "$0.35" },
      { color: "Black", colorId: null, colorHex: "#05131D", condition: "Used", qty: 517, price: "$0.25" },
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
      { color: "Red", colorId: null, colorHex: "#D50000", condition: "New", qty: 1092, price: "$0.45" },
      { color: "Blue", colorId: null, colorHex: "#0055BF", condition: "New", qty: 892, price: "$0.45" },
      { color: "Yellow", colorId: null, colorHex: "#F2CD37", condition: "New", qty: 734, price: "$0.44" },
      { color: "White", colorId: null, colorHex: "#F2F3F2", condition: "Used", qty: 496, price: "$0.32" },
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
      { color: "Red", colorId: null, colorHex: "#D50000", condition: "New", qty: 892, price: "$0.58" },
      { color: "Blue", colorId: null, colorHex: "#0055BF", condition: "New", qty: 734, price: "$0.58" },
      { color: "Yellow", colorId: null, colorHex: "#F2CD37", condition: "Used", qty: 530, price: "$0.42" },
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
      { color: "Red", colorId: null, colorHex: "#D50000", condition: "New", qty: 1432, price: "$0.32" },
      { color: "Blue", colorId: null, colorHex: "#0055BF", condition: "New", qty: 1234, price: "$0.32" },
      { color: "Yellow", colorId: null, colorHex: "#F2CD37", condition: "New", qty: 1089, price: "$0.31" },
      { color: "White", colorId: null, colorHex: "#F2F3F2", condition: "New", qty: 892, price: "$0.32" },
      { color: "Green", colorId: null, colorHex: "#00852B", condition: "Used", qty: 245, price: "$0.22" },
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
      { color: "Red", colorId: null, colorHex: "#D50000", condition: "New", qty: 1892, price: "$0.18" },
      { color: "Blue", colorId: null, colorHex: "#0055BF", condition: "New", qty: 1567, price: "$0.18" },
      { color: "Yellow", colorId: null, colorHex: "#F2CD37", condition: "New", qty: 1234, price: "$0.17" },
      { color: "White", colorId: null, colorHex: "#F2F3F2", condition: "Used", qty: 985, price: "$0.12" },
    ]
  },
];

interface LotCardProps {
  lot: ProductLot;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onAddToCart: (variation: any, quantity: number) => void;
  viewMode?: 'gallery' | 'list';
}

function LotCard({ lot, isOpen, onOpenChange, onAddToCart, viewMode = 'gallery' }: LotCardProps) {
  const primaryColor = lot.variations[0];
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  
  // Calculate total quantities for New and Used
  const totalNewQty = lot.variations
    .filter(v => v.condition === 'New')
    .reduce((sum, v) => sum + v.qty, 0);
  const totalUsedQty = lot.variations
    .filter(v => v.condition === 'Used')
    .reduce((sum, v) => sum + v.qty, 0);
  
  // Get unique colors sorted alphabetically
  const uniqueColors = Array.from(new Set(lot.colorGroups.map(g => g.colorName))).sort();
  
  // Sort color groups alphabetically
  const sortedColorGroups = [...lot.colorGroups].sort((a, b) => a.colorName.localeCompare(b.colorName));
  
  // Filter variations by selected color
  const displayedColorGroups = selectedColor 
    ? sortedColorGroups.filter(g => g.colorName === selectedColor)
    : sortedColorGroups;
  
  // Use first variation's image (first color we have) for the card
  const getInitialImageUrl = () => {
    // First try the lot-level image
    if (lot.imageUrl) return lot.imageUrl;
    // Then try the first variation (first color)
    if (lot.variations.length > 0 && lot.variations[0].imageUrl) {
      return lot.variations[0].imageUrl;
    }
    // Fallback to any variation with an image
    const variationWithImage = lot.variations.find(v => v.imageUrl);
    return variationWithImage?.imageUrl || null;
  };
  
  const [imageSrc, setImageSrc] = useState<string | null>(
    getProxyImageUrl(getInitialImageUrl())
  );

  const updateQuantity = (idx: number, delta: number) => {
    setQuantities(prev => {
      const current = prev[idx] || 1;
      const newQty = Math.max(1, Math.min(lot.variations[idx].qty, current + delta));
      return { ...prev, [idx]: newQty };
    });
  };
  
  const handleImageError = () => {
    const originalUrl = getInitialImageUrl();
    if (originalUrl && imageSrc !== originalUrl) {
      console.warn(`[Shop] Proxy image failed for ${lot.part}, falling back to original URL`);
      setImageSrc(originalUrl);
    } else {
      console.warn(`[Shop] No image available for ${lot.part}`);
      setImageSrc(null);
    }
  };

  return (
    <>
      <Card
        className={`${viewMode === 'list' ? 'w-full' : 'w-full'} p-1 md:p-2 bg-gray-900/60 border-purple-500/30 hover-elevate cursor-pointer transition-all`}
        onClick={() => onOpenChange(true)}
        data-testid={`card-lot-${lot.id}`}
      >
        <div className={viewMode === 'list' ? 'flex gap-1.5 items-center' : ''}>
          {/* Compact Image - Spotify-style */}
          <div
            className={`${viewMode === 'list' ? 'w-10 h-10 md:w-12 md:h-12 shrink-0' : 'w-full aspect-square'} rounded ${viewMode === 'gallery' ? 'mb-1' : ''} flex items-center justify-center border border-gray-700/50 relative overflow-hidden`}
            style={{
              background: imageSrc
                ? 'radial-gradient(ellipse at 30% 30%, #1e3a8a 0%, #0f172a 50%, #000000 100%)'
                : `linear-gradient(135deg, ${primaryColor.colorHex}60 0%, ${primaryColor.colorHex}30 100%)`,
            }}
          >
            {imageSrc ? (
              <div className="relative z-10 w-full h-full p-0.5 flex items-center justify-center">
                <img 
                  src={imageSrc} 
                  alt={lot.name}
                  className="max-w-full max-h-full object-contain"
                  onError={handleImageError}
                  data-testid={`img-part-${lot.id}`}
                />
              </div>
            ) : (
              <div className="relative z-10 w-full h-full p-1 flex items-center justify-center">
                <img 
                  src={noImagePlaceholder} 
                  alt="Image not available"
                  className="max-w-full max-h-full object-contain opacity-60"
                  data-testid={`img-placeholder-${lot.id}`}
                />
              </div>
            )}
          </div>
          
          <div className={`${viewMode === 'list' ? 'flex-1 min-w-0' : ''}`}>
            {/* Compact name - single line in list view */}
            <h3 className={`text-[10px] md:text-xs font-semibold text-white leading-tight mb-1 ${viewMode === 'list' ? 'line-clamp-1' : 'line-clamp-2'}`}>
              {formatProductDisplayName(lot.name)}
            </h3>
            
            {/* Smaller badges with labels */}
            <div className="flex items-center gap-1 flex-wrap">
              <Badge variant="secondary" className="px-1 py-0 h-3.5 text-[8px] md:text-[9px] bg-cyan-500/20 text-cyan-300 border-cyan-500/30">
                {lot.uniqueColorCount} {lot.uniqueColorCount === 1 ? 'color' : 'colors'}
              </Badge>
              <Badge variant="secondary" className="px-1 py-0 h-3.5 text-[8px] md:text-[9px] bg-purple-500/20 text-purple-300 border-purple-500/30">
                {lot.totalQty.toLocaleString()} qty
              </Badge>
            </div>
          </div>
        </div>
      </Card>

      <Dialog open={isOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col p-0 pt-10" style={{
          background: 'linear-gradient(135deg, #1a1a2e 0%, #1e2640 50%, #1f3a5f 100%)',
          border: '3px solid',
          borderImage: 'linear-gradient(135deg, #4a9fb8, #5a7eb8, #7a6ba8) 1',
          boxShadow: '0 0 20px rgba(74, 159, 184, 0.2), inset 0 0 15px rgba(90, 126, 184, 0.08)'
        }}>
          <DialogHeader className="sr-only">
            <DialogTitle>{formatProductDisplayName(lot.name)}</DialogTitle>
            <DialogDescription>Part #{lot.part} - {lot.uniqueColorCount} colors available</DialogDescription>
          </DialogHeader>
          {/* Sticker-style header */}
          <div className="relative p-3 md:p-4" style={{
            background: 'linear-gradient(90deg, #4a9fb8 0%, #5a7eb8 50%, #7a6ba8 100%)',
            boxShadow: '0 3px 8px rgba(0, 0, 0, 0.25)'
          }}>
            <div className="text-center">
              <div className="text-base md:text-lg font-bold text-white drop-shadow-md uppercase tracking-wide">
                {formatProductDisplayName(lot.name)}
              </div>
            </div>
          </div>
          
          {/* Mobile-first content layout */}
          <div className="flex-1 overflow-y-auto p-3 md:p-4">
            {/* Stats at top - side by side */}
            <div className="grid grid-cols-2 gap-2 md:gap-3 mb-4">
              {/* Total Parts */}
              <div className="bg-gradient-to-br from-teal-600/25 to-cyan-700/25 rounded border-2 border-teal-500/40 p-2 md:p-3">
                <div className="text-[10px] md:text-xs text-teal-300 font-bold uppercase tracking-wide mb-1">Total Parts</div>
                <div className="text-lg md:text-2xl font-black text-white">{lot.totalQty.toLocaleString()}</div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {totalNewQty > 0 && (
                    <span className="text-[9px] md:text-xs text-teal-200">
                      <span className="font-bold">{totalNewQty.toLocaleString()}</span> New
                    </span>
                  )}
                  {totalUsedQty > 0 && (
                    <span className="text-[9px] md:text-xs text-amber-200">
                      <span className="font-bold">{totalUsedQty.toLocaleString()}</span> Used
                    </span>
                  )}
                </div>
              </div>

              {/* Price Range */}
              <div className="bg-gradient-to-br from-purple-600/25 to-indigo-700/25 rounded border-2 border-purple-500/40 p-2 md:p-3">
                <div className="text-[10px] md:text-xs text-purple-300 font-bold uppercase tracking-wide mb-1">Price Range</div>
                <div className="text-lg md:text-2xl font-black text-white">
                  {(() => {
                    const prices = lot.variations.map(v => parseFloat(v.price.replace('$', '')));
                    const minPrice = Math.min(...prices);
                    const maxPrice = Math.max(...prices);
                    if (minPrice === maxPrice) {
                      return `$${minPrice.toFixed(2)}`;
                    }
                    return `$${minPrice.toFixed(2)} - $${maxPrice.toFixed(2)}`;
                  })()}
                </div>
                <div className="text-[9px] md:text-xs text-purple-200 mt-0.5">per piece</div>
              </div>
            </div>

            {/* Colors - simple text list with color dots */}
            <div className="bg-white/5 rounded border border-cyan-400/30 p-2 md:p-3">
              <h3 className="text-xs md:text-sm font-bold text-cyan-300 mb-2 uppercase tracking-wide">Available Colors</h3>
              <p className="text-[10px] md:text-xs text-white leading-relaxed flex flex-wrap gap-x-2 gap-y-1">
                {sortedColorGroups.map((colorGroup, idx) => (
                  <span key={idx} className="inline-flex items-center gap-1" data-testid={`color-text-${idx}`}>
                    <span 
                      className="w-2 h-2 rounded-full border border-white/50 shrink-0 inline-block" 
                      style={{ 
                        backgroundColor: colorGroup.colorHex 
                          ? (colorGroup.colorHex.startsWith('#') ? colorGroup.colorHex : `#${colorGroup.colorHex}`)
                          : '#CCCCCC'
                      }}
                    />
                    <span>{formatColorDisplayName(colorGroup.colorName)}{idx < sortedColorGroups.length - 1 ? ',' : ''}</span>
                  </span>
                ))}
              </p>
            </div>
          </div>

          {/* Prominent Store Buttons at Bottom - Smaller, more compact */}
          <div className="p-3 md:p-4 bg-gradient-to-r from-gray-900 to-black border-t-4 border-cyan-400/50">
            <div className="text-center mb-2">
              <p className="text-xs text-white font-semibold">Purchase from our official stores:</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                className="bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 text-white font-semibold text-xs shadow-lg"
                onClick={() => window.open(BRICKLINK_STORE_URL, '_blank')}
                data-testid="button-bricklink-main"
              >
                <ExternalLink className="w-3 h-3 mr-1.5" />
                Shop on BrickLink
              </Button>
              <Button
                size="sm"
                className="bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white font-semibold text-xs shadow-lg"
                onClick={() => window.open(BRICKOWL_STORE_URL, '_blank')}
                data-testid="button-brickowl-main"
              >
                <ExternalLink className="w-3 h-3 mr-1.5" />
                Shop on BrickOwl
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Image Lightbox */}
      <Dialog open={!!lightboxImage} onOpenChange={(open) => !open && setLightboxImage(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] bg-black/95 border-white/20 p-2 md:p-4">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-cyan-400" />
              {formatProductDisplayName(lot.name)}
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center p-4">
            <div 
              className="w-full max-w-3xl aspect-square rounded-lg flex items-center justify-center relative overflow-hidden"
              style={{
                background: 'radial-gradient(ellipse at center, #1e3a8a 0%, #0f172a 50%, #000000 100%)'
              }}
            >
              <div className="absolute inset-0 opacity-60">
                <div className="absolute top-[15%] left-[10%] w-24 md:w-32 h-24 md:h-32 bg-cyan-500/40 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '0s', animationDuration: '3s' }} />
                <div className="absolute bottom-[15%] right-[15%] w-20 md:w-28 h-20 md:h-28 bg-blue-400/40 rounded-full blur-2xl animate-pulse" style={{ animationDelay: '1.5s', animationDuration: '4s' }} />
                <div className="absolute top-[50%] right-[60%] w-16 md:w-20 h-16 md:h-20 bg-purple-400/30 rounded-full blur-xl animate-pulse" style={{ animationDelay: '3s', animationDuration: '5s' }} />
              </div>
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-transparent to-cyan-500/10" />
              {lightboxImage && (
                <div className="relative z-10 w-full h-full p-4 md:p-8 flex items-center justify-center">
                  <img 
                    src={lightboxImage} 
                    alt={lot.name}
                    className="max-w-full max-h-full object-contain"
                    data-testid={`img-lightbox-${lot.id}`}
                  />
                </div>
              )}
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
  lotCount: number;
  partCount: number;
  categoryId: string;
  onAddToCart: (item: any, quantity: number) => void;
  bandColor: string;
  viewMode?: 'gallery' | 'list';
}

function CategorySkeleton({ bandColor }: { bandColor: string }) {
  return (
    <section className="py-6 md:py-8 relative">
      {/* Colorful Band Background */}
      <div className={`absolute inset-0 bg-gradient-to-r ${bandColor} opacity-10`} />
      
      <div className="relative z-10">
        <div className="px-3 md:px-6 mb-4 md:mb-6">
          {/* Title skeleton */}
          <div className="flex items-center gap-2 md:gap-4 mb-2">
            <Skeleton className="w-6 h-6 md:w-8 md:h-8 rounded-full" />
            <Skeleton className="h-8 md:h-10 w-48 md:w-64" />
          </div>
          {/* Stats skeleton */}
          <div className="pl-8 md:pl-12">
            <Skeleton className="h-4 w-32 md:w-40" />
          </div>
        </div>
        
        {/* Product cards skeleton - Grid layout */}
        <div className="px-3 md:px-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <Card key={i} className="bg-gray-900/50 border-gray-800 p-2 md:p-3">
                <Skeleton className="w-full aspect-square mb-2 md:mb-3 rounded" />
                <Skeleton className="h-3 md:h-4 w-full mb-1.5 md:mb-2" />
                <Skeleton className="h-3 md:h-4 w-3/4 mb-2 md:mb-3" />
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 md:h-5 w-12 md:w-16" />
                  <Skeleton className="h-6 md:h-8 w-6 md:w-8 rounded-full" />
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function HorizontalRow({ title, lots, lotCount, partCount, categoryId, onAddToCart, bandColor, viewMode = 'gallery' }: HorizontalRowProps) {
  const [openLotId, setOpenLotId] = useState<number | null>(null);
  const [displayCount, setDisplayCount] = useState(40);
  const ITEMS_PER_PAGE = 40;

  const handleLoadMore = () => {
    setDisplayCount(prev => prev + ITEMS_PER_PAGE);
  };

  const displayedLots = lots.slice(0, displayCount);
  const hasMore = displayCount < lots.length;

  return (
    <section className="py-6 md:py-8 relative" data-testid={`category-section-${categoryId}`}>
      {/* Colorful Band Background */}
      <div className={`absolute inset-0 bg-gradient-to-r ${bandColor} opacity-10`} />
      
      <div className="relative z-10">
        <div className="px-3 md:px-6 mb-4 md:mb-6">
          <h2 className={`text-2xl md:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r ${bandColor} flex items-center gap-2 md:gap-4 mb-2`}>
            <Sparkles className="w-6 h-6 md:w-8 md:h-8 text-white drop-shadow-lg" />
            {title}
          </h2>
          <div className="pl-8 md:pl-12">
            <div className="text-xs md:text-sm text-gray-400">
              {lotCount.toLocaleString()} lots · {partCount.toLocaleString()} parts
            </div>
          </div>
        </div>
      
        {viewMode === 'gallery' ? (
          /* Gallery View - Dense Grid (Spotify-style) */
          <div className="px-3 md:px-6">
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2 md:gap-3">
              {displayedLots.map((lot) => (
                <LotCard
                  key={lot.id}
                  lot={lot}
                  isOpen={openLotId === lot.id}
                  onOpenChange={(open) => setOpenLotId(open ? lot.id : null)}
                  onAddToCart={onAddToCart}
                  viewMode="gallery"
                />
              ))}
            </div>
            
            {/* Load More Button */}
            {hasMore && (
              <div className="mt-6 text-center">
                <Button
                  onClick={handleLoadMore}
                  className={`bg-gradient-to-r ${bandColor} text-white font-semibold px-6 py-2 h-10`}
                  data-testid={`button-load-more-${categoryId}`}
                >
                  Show next {Math.min(ITEMS_PER_PAGE, lots.length - displayCount)}
                </Button>
              </div>
            )}
          </div>
        ) : (
          /* List View - Compact Rows */
          <div className="px-3 md:px-6">
            <div className="space-y-1">
              {displayedLots.map((lot) => (
                <LotCard
                  key={lot.id}
                  lot={lot}
                  isOpen={openLotId === lot.id}
                  onOpenChange={(open) => setOpenLotId(open ? lot.id : null)}
                  onAddToCart={onAddToCart}
                  viewMode="list"
                />
              ))}
            </div>
            
            {/* Load More Button */}
            {hasMore && (
              <div className="mt-6 text-center">
                <Button
                  onClick={handleLoadMore}
                  className={`bg-gradient-to-r ${bandColor} text-white font-semibold px-6 py-2 h-10`}
                  data-testid={`button-load-more-${categoryId}`}
                >
                  Show next {Math.min(ITEMS_PER_PAGE, lots.length - displayCount)}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export default function Shop() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'gallery' | 'list'>('gallery');
  const [selectedItemType, setSelectedItemType] = useState<string | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<number[]>([]);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [showDiscounts, setShowDiscounts] = useState(true);
  const [showNewItems, setShowNewItems] = useState(true);
  const { toast } = useToast();

  // Logout mutation
  const logoutMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/logout'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      toast({
        title: "Logged out",
        description: "You have been logged out successfully",
      });
    },
  });

  // Fetch real inventory data with itemType filter
  const { data: inventoryData, isLoading: inventoryLoading } = useQuery<{ lots: ProductLot[] }>({
    queryKey: ['/api/shop/inventory', { itemType: selectedItemType }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedItemType) {
        params.append('itemType', selectedItemType);
      }
      const response = await fetch(`/api/shop/inventory?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch inventory');
      return response.json();
    },
  });

  // Fetch categories and item types
  const { data: categoriesData } = useQuery<{
    categories: Array<{ id: number; name: string; lotCount: number; partCount: number }>;
    itemTypes: Array<{ type: string; count: number }>;
  }>({
    queryKey: ['/api/shop/categories', { itemType: selectedItemType }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedItemType) {
        params.append('itemType', selectedItemType);
      }
      const response = await fetch(`/api/shop/categories?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch categories');
      return response.json();
    },
  });

  // Fetch real stats (using public shop endpoint)
  const { data: statsData, isLoading: statsLoading } = useQuery<{
    totalLots: number;
    totalParts: number;
  }>({
    queryKey: ['/api/shop/stats'],
  });

  // Check authentication status
  const { data: user } = useQuery<any>({
    queryKey: ['/api/auth/user'],
    retry: false,
  });

  // Fetch special groups (New, Hot, Discounted)
  const { data: specialGroupsData, isLoading: specialGroupsLoading } = useQuery<{
    newItems: ProductLot[];
    hotItems: ProductLot[];
    discountedItems: ProductLot[];
  }>({
    queryKey: ['/api/shop/special-groups', { itemType: selectedItemType }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedItemType) params.append('itemType', selectedItemType);
      const response = await fetch(`/api/shop/special-groups?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch special groups');
      return response.json();
    },
  });

  // Fetch inventory for selected categories
  const { data: categoryInventoryData, isLoading: categoryInventoryLoading } = useQuery<{ lots: ProductLot[] }>({
    queryKey: ['/api/shop/inventory', { itemType: selectedItemType, categoryIds: selectedCategories }],
    queryFn: async () => {
      if (selectedCategories.length === 0) return { lots: [] };
      const params = new URLSearchParams();
      if (selectedItemType) params.append('itemType', selectedItemType);
      params.append('categoryIds', selectedCategories.join(','));
      const response = await fetch(`/api/shop/inventory?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch category inventory');
      return response.json();
    },
    enabled: selectedCategories.length > 0,
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

  const processLots = (lots: any[]) => {
    return lots.map(lot => {
      const colorMap = new Map<string, ColorGroup>();
      lot.variations.forEach((variation: any) => {
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
      
      // Sort variations within each color group: New items first, then Used
      const sortedColorGroups = Array.from(colorMap.values()).map(group => ({
        ...group,
        variations: [...group.variations].sort((a, b) => {
          // New items first
          if (a.condition !== b.condition) {
            return a.condition === 'New' ? -1 : 1;
          }
          // Then by quantity descending
          return b.qty - a.qty;
        })
      }));
      
      return {
        ...lot,
        uniqueColorCount: colorMap.size,
        colorGroups: sortedColorGroups
      };
    });
  };

  const toggleSection = (sectionId: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  const specialGroups = {
    newItems: processLots(specialGroupsData?.newItems || []),
    hotItems: processLots(specialGroupsData?.hotItems || []),
    discountedItems: processLots(specialGroupsData?.discountedItems || []),
  };

  const categoryProductMap = new Map<number, ProductLot[]>();
  if (categoryInventoryData?.lots) {
    const processedLots = processLots(categoryInventoryData.lots);
    processedLots.forEach(lot => {
      const catId = lot.categoryId;
      if (catId) {
        if (!categoryProductMap.has(catId)) {
          categoryProductMap.set(catId, []);
        }
        categoryProductMap.get(catId)!.push(lot);
      }
    });
  }
  
  // Build selectedCategoryData from categoryProductMap
  const selectedCategoryData = selectedCategories.map((catId: number) => {
    const category = categoriesData?.categories.find((c: any) => c.id === catId);
    if (!category) return null;
    
    const categoryLots = categoryProductMap.get(catId) || [];
    
    return {
      id: catId,
      name: category.name,
      lots: categoryLots,
      lotCount: categoryLots.length,
      partCount: categoryLots.reduce((sum, lot) => sum + lot.totalQty, 0),
    };
  }).filter(Boolean);

  const sortedCategoryList = [...(categoriesData?.categories || [])].sort((a, b) => {
    const aSelected = selectedCategories.includes(a.id);
    const bSelected = selectedCategories.includes(b.id);
    if (aSelected && !bSelected) return -1;
    if (!aSelected && bSelected) return 1;
    return a.name.localeCompare(b.name);
  });

  const handleCategoryToggle = (categoryId: number) => {
    setSelectedCategories(prev => {
      if (prev.includes(categoryId)) {
        return prev.filter(id => id !== categoryId);
      } else {
        return [...prev, categoryId];
      }
    });
  };
  
  // Format item type labels to be plural and readable
  const formatItemType = (type: string): string => {
    const typeMap: Record<string, string> = {
      'PART': 'Parts',
      'MINIFIG': 'Minifigs',
      'SET': 'Sets',
      'BOOK': 'Books',
      'GEAR': 'Gear',
      'CATALOG': 'Catalogs',
      'INSTRUCTION': 'Instructions',
      'ORIGINAL_BOX': 'Original Boxes',
      'UNSORTED_LOT': 'Unsorted Lots',
    };
    return typeMap[type] || type;
  };

  const productLots = processedLots;
  const totalLots = statsData?.totalLots || productLots.length;
  const totalParts = statsData?.totalParts || productLots.reduce((sum, lot) => sum + lot.totalQty, 0);
  
  // Helper function to calculate item score for sorting
  const calculateItemScore = (lot: ProductLot) => {
    // Calculate total value (price * quantity)
    const totalValue = lot.variations.reduce((sum, v) => {
      const price = parseFloat(v.price.replace('$', '') || '0');
      return sum + (price * v.qty);
    }, 0);
    
    // Higher value items get higher scores
    const valueScore = totalValue;
    
    // More colors/variations = more appealing = higher score
    const varietyScore = lot.uniqueColorCount * 10;
    
    // More total quantity = better availability = higher score
    const quantityScore = Math.log(lot.totalQty + 1) * 5;
    
    // Combine scores (weighted)
    return (valueScore * 0.6) + (varietyScore * 0.3) + (quantityScore * 0.1);
  };

  // Create a lookup map for category counts from API
  const categoryCounts = new Map<string, { lotCount: number; partCount: number }>();
  categoriesData?.categories.forEach(cat => {
    categoryCounts.set(cat.name, {
      lotCount: cat.lotCount,
      partCount: cat.partCount
    });
  });

  // Group products by category from API data
  const categoryGroups = new Map<string, ProductLot[]>();
  
  productLots.forEach(lot => {
    const categoryKey = lot.categoryName || 'Other';
    if (!categoryGroups.has(categoryKey)) {
      categoryGroups.set(categoryKey, []);
    }
    categoryGroups.get(categoryKey)!.push(lot);
  });

  // Sort items within each category by score, then convert to array and sort categories alphabetically
  const sortedCategories = Array.from(categoryGroups.entries())
    .map(([name, lots]) => {
      const counts = categoryCounts.get(name) || { lotCount: 0, partCount: 0 };
      return {
        name,
        lots: lots.sort((a, b) => calculateItemScore(b) - calculateItemScore(a)),
        lotCount: counts.lotCount, // Use API-provided lot count (inventory rows)
        partCount: counts.partCount // Use API-provided part count (total quantity)
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // Assign color gradients to categories
  const colorGradients = [
    "from-cyan-500 via-blue-500 to-purple-600",
    "from-red-500 via-orange-500 to-yellow-500",
    "from-emerald-500 via-teal-500 to-cyan-500",
    "from-violet-500 via-fuchsia-500 to-pink-500",
    "from-blue-600 via-indigo-600 to-purple-600",
    "from-amber-500 via-rose-500 to-red-600",
    "from-lime-500 via-green-500 to-emerald-500",
    "from-sky-500 via-blue-500 to-indigo-500",
    "from-pink-500 via-rose-500 to-red-500",
    "from-purple-500 via-violet-500 to-indigo-500",
  ];

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
    <div className="min-h-screen bg-black relative">
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
        {/* Public Header with Cart Sheet */}
        <PublicHeader 
          cartCount={cartCount} 
          onCartClick={() => setIsCartOpen(true)} 
        />

        {/* Shopping Cart Sheet */}
        <Sheet open={isCartOpen} onOpenChange={setIsCartOpen}>
          <SheetTrigger asChild>
            <button className="hidden" data-testid="hidden-cart-trigger" />
          </SheetTrigger>
                <SheetContent className="w-full sm:max-w-lg bg-gray-900 border-purple-500/30">
                  <SheetHeader>
                    <SheetTitle className="text-white">Shopping Cart</SheetTitle>
                    <SheetDescription className="text-gray-400">
                      {cartCount} {cartCount === 1 ? 'item' : 'items'} • For bundles & special items
                    </SheetDescription>
                  </SheetHeader>
                  <div className="mt-6 space-y-3 max-h-[60vh] overflow-y-auto">
                    {cart.length === 0 ? (
                      <div className="text-center py-8 space-y-2">
                        <p className="text-gray-500">Your cart is empty</p>
                        <p className="text-xs text-gray-600">Individual parts available on BrickLink & BrickOwl</p>
                      </div>
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
                                {formatProductDisplayName(item.partName)}
                              </h4>
                              <p className="text-xs text-gray-400">#{item.partNumber}</p>
                              <p className="text-xs text-gray-500">
                                {formatColorDisplayName(item.color)} • {item.condition}
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

        {/* Search Bar and Filters */}
        <div className="relative bg-black/95 backdrop-blur-xl px-3 md:px-6 py-2 border-b border-white/10">
          <div className="max-w-4xl mx-auto space-y-2">
            {/* Search Bar + View Toggle */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  placeholder="Search for LEGO parts..."
                  className="w-full h-9 pl-9 pr-4 bg-gray-900/80 border border-white/20 rounded-md text-xs text-white placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                  data-testid="input-search"
                />
              </div>
              {/* View Toggle */}
              <div className="flex gap-0.5 bg-gray-900/80 border border-white/20 rounded-md p-0.5">
                <Button
                  size="icon"
                  variant="ghost"
                  className={`h-8 w-8 ${viewMode === 'gallery' ? 'bg-cyan-600 hover:bg-cyan-500 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                  onClick={() => setViewMode('gallery')}
                  data-testid="button-view-gallery"
                >
                  <LayoutGrid className="w-4 h-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className={`h-8 w-8 ${viewMode === 'list' ? 'bg-cyan-600 hover:bg-cyan-500 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                  onClick={() => setViewMode('list')}
                  data-testid="button-view-list"
                >
                  <List className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Item Type Filter - Compact with counts */}
            <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
              {categoriesData?.itemTypes.map((itemType) => (
                <Button
                  key={itemType.type}
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.preventDefault();
                    setSelectedItemType(itemType.type);
                  }}
                  className={`whitespace-nowrap text-[10px] h-7 px-2.5 ${
                    selectedItemType === itemType.type
                      ? "bg-orange-600/60 hover:bg-orange-600/70 text-white font-semibold"
                      : "bg-gray-900/60 text-gray-400 hover:text-gray-300 hover:bg-gray-800/80"
                  }`}
                  data-testid={`filter-${itemType.type?.toLowerCase()}`}
                >
                  {formatItemType(itemType.type)}
                  <Badge className="ml-1.5 h-4 px-1 text-[9px] bg-white/20 border-none">{itemType.count}</Badge>
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* Category Pills Selector with Discounts/New Items - Compact and subtle */}
        <div className="relative bg-gray-800/40 backdrop-blur-sm border-y border-white/10 px-3 md:px-6 py-2">
          <div className="flex gap-1.5">
            {/* Special Filters - Fixed/Frozen */}
            <div className="flex gap-1.5 shrink-0">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowDiscounts(!showDiscounts)}
                className={`whitespace-nowrap text-[10px] h-7 px-2.5 ${
                  showDiscounts
                    ? "bg-purple-600/60 text-white font-semibold border border-purple-400"
                    : "bg-purple-600/20 text-purple-300 hover:bg-purple-600/40 hover:text-purple-200 border border-purple-500/30"
                }`}
                data-testid="filter-discounts"
              >
                Discounts
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowNewItems(!showNewItems)}
                className={`whitespace-nowrap text-[10px] h-7 px-2.5 ${
                  showNewItems
                    ? "bg-emerald-600/60 text-white font-semibold border border-emerald-400"
                    : "bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/40 hover:text-emerald-200 border border-emerald-500/30"
                }`}
                data-testid="filter-new-items"
              >
                New Items
              </Button>
            </div>
            
            {/* Category Filters - Scrollable */}
            <div className="overflow-x-auto overflow-y-hidden scrollbar-hide flex-1" style={{ touchAction: 'pan-x' }}>
              <div className="flex gap-1.5 min-w-min">
                {sortedCategoryList.map((category) => {
                  const isSelected = selectedCategories.includes(category.id);
                  return (
                    <Button
                      key={category.id}
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCategoryToggle(category.id)}
                      className={`shrink-0 text-[10px] h-7 px-2.5 ${
                        isSelected 
                          ? "bg-gray-800/80 text-white font-semibold border border-white/30"
                          : "bg-gray-900/30 border border-white/10 text-gray-400 hover:bg-gray-800/60 hover:text-gray-300"
                      }`}
                      data-testid={`button-category-${category.id}`}
                    >
                      {category.name}
                      <Badge 
                        variant="secondary"
                        className={`ml-1 text-[9px] h-3.5 px-1 ${
                          isSelected
                            ? "bg-white/30 text-white"
                            : "bg-gray-700/50 text-gray-400"
                        }`}
                      >
                        {category.lotCount}
                      </Badge>
                    </Button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Selected Categories Display */}
        {selectedCategories.length > 0 && (
          <div className="px-3 md:px-6 py-2 bg-gray-900/40 border-y border-white/10">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-gray-400 mr-1">Filtering:</span>
              {selectedCategories.map(catId => {
                const category = categoriesData?.categories.find(c => c.id === catId);
                if (!category) return null;
                return (
                  <button
                    key={catId}
                    onClick={() => handleCategoryToggle(catId)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] bg-gray-800/80 text-white rounded border border-white/20 hover:bg-gray-700 transition-colors"
                    data-testid={`remove-category-${catId}`}
                  >
                    {category.name}
                    <X className="w-3 h-3" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Product Groups - Special Groups + Selected Categories */}
        <div className="pb-4 md:pb-8">
          {inventoryLoading ? (
            <div className="space-y-0">
              <div className="text-center py-6 md:py-8">
                <p className="text-cyan-400 text-sm md:text-base font-semibold animate-pulse">
                  Loading products...
                </p>
              </div>
              {Array.from({ length: 3 }).map((_, i) => (
                <CategorySkeleton 
                  key={i} 
                  bandColor={colorGradients[i % colorGradients.length]}
                />
              ))}
            </div>
          ) : (
            <>
              {/* Special Groups - New Items First, Then Discounts */}
              {showNewItems && specialGroups.newItems && specialGroups.newItems.length > 0 && (
                <HorizontalRow
                  title="New Items"
                  lots={specialGroups.newItems}
                  lotCount={specialGroups.newItems.length}
                  partCount={specialGroups.newItems.reduce((sum, lot) => sum + lot.totalQty, 0)}
                  categoryId="new-items"
                  onAddToCart={handleAddToCart}
                  bandColor="from-emerald-500 via-teal-500 to-cyan-500"
                  viewMode={viewMode}
                />
              )}
              
              {showDiscounts && specialGroups.discountedItems && specialGroups.discountedItems.length > 0 && (
                <HorizontalRow
                  title="Discounted Items"
                  lots={specialGroups.discountedItems}
                  lotCount={specialGroups.discountedItems.length}
                  partCount={specialGroups.discountedItems.reduce((sum, lot) => sum + lot.totalQty, 0)}
                  categoryId="discounted-items"
                  onAddToCart={handleAddToCart}
                  bandColor="from-violet-500 via-fuchsia-500 to-pink-500"
                  viewMode={viewMode}
                />
              )}
              
              {/* Category Sections - Show selected OR all if none selected */}
              {selectedCategories.length > 0 ? (
                // Show only selected categories
                selectedCategoryData.map((category, index) => category && (
                  <HorizontalRow
                    key={category.id}
                    title={category.name}
                    lots={category.lots}
                    lotCount={category.lotCount}
                    partCount={category.partCount}
                    categoryId={category.id.toString()}
                    onAddToCart={handleAddToCart}
                    bandColor={colorGradients[index % colorGradients.length]}
                    viewMode={viewMode}
                  />
                ))
              ) : (
                // Show all categories when none selected
                sortedCategories.map((category, index) => (
                  <HorizontalRow
                    key={category.name}
                    title={category.name}
                    lots={category.lots}
                    lotCount={category.lotCount}
                    partCount={category.partCount}
                    categoryId={category.name.toLowerCase().replace(/\s+/g, '-')}
                    onAddToCart={handleAddToCart}
                    bandColor={colorGradients[index % colorGradients.length]}
                    viewMode={viewMode}
                  />
                ))
              )}
            </>
          )}
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
        .smooth-scroll {
          scroll-behavior: smooth;
          -webkit-overflow-scrolling: touch;
          transform: translateZ(0);
          backface-visibility: hidden;
          perspective: 1000px;
        }
        .will-change-scroll {
          will-change: transform;
        }
      `}</style>
    </div>
  );
}
