import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, ShoppingCart, ChevronDown, ChevronUp, Sparkles, Plus, X, Minus, Check, LogOut } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
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
import planetBrickLogo from "@assets/PlanetBrick_with_planet_1761030158394.png";
import noImagePlaceholder from "@assets/generated_images/LEGO_image_unavailable_placeholder_957f3211.png";

interface CartItem {
  lotId: number;
  partNumber: string;
  partName: string;
  color: string;
  colorHex: string;
  condition: string;
  qty: number;
  price: string;
  quantity: number;
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

interface Category {
  id: number;
  name: string;
  lotCount: number;
  partCount: number;
}

function getProxyImageUrl(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;
  return `/api/images/proxy?url=${encodeURIComponent(imageUrl)}`;
}

interface LotCardProps {
  lot: ProductLot;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onAddToCart: (variation: any, quantity: number) => void;
}

function LotCard({ lot, isOpen, onOpenChange, onAddToCart }: LotCardProps) {
  const primaryColor = lot.variations[0];
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  
  const imageUrl = getProxyImageUrl(lot.imageUrl);
  
  const newQty = lot.variations
    .filter(v => v.condition === 'New')
    .reduce((sum, v) => sum + v.qty, 0);
  
  const usedQty = lot.variations
    .filter(v => v.condition === 'Used')
    .reduce((sum, v) => sum + v.qty, 0);

  const handleQuantityChange = (variationIndex: number, delta: number) => {
    setQuantities(prev => {
      const current = prev[variationIndex] || 0;
      const newQty = Math.max(0, current + delta);
      return { ...prev, [variationIndex]: newQty };
    });
  };

  const handleAddToCart = (variation: any, index: number) => {
    const qty = quantities[index] || 1;
    onAddToCart({
      lotId: lot.id,
      partNumber: lot.part,
      partName: lot.name,
      color: variation.color,
      colorHex: variation.colorHex,
      condition: variation.condition,
      qty: variation.qty,
      price: variation.price,
    }, qty);
    setQuantities(prev => ({ ...prev, [index]: 0 }));
  };

  return (
    <>
      <Card
        className="shrink-0 w-48 md:w-72 p-2 md:p-4 bg-gray-900/60 border-purple-500/30 hover-elevate cursor-pointer transition-all"
        onClick={() => onOpenChange(true)}
        data-testid={`card-lot-${lot.id}`}
      >
        <div className="aspect-square bg-black/40 rounded-md mb-2 md:mb-3 overflow-hidden border border-purple-500/20 flex items-center justify-center">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={lot.name}
              className="w-full h-full object-contain"
              onError={(e) => {
                e.currentTarget.src = noImagePlaceholder;
              }}
            />
          ) : (
            <img
              src={noImagePlaceholder}
              alt="No image available"
              className="w-full h-full object-contain opacity-50"
            />
          )}
        </div>
        
        <div className="space-y-1 md:space-y-2">
          <div className="font-black text-white text-sm md:text-base line-clamp-2 leading-tight">
            {lot.name}
          </div>
          <div className="text-xs text-gray-400 font-mono">
            #{lot.part}
          </div>
          
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge 
              variant="secondary" 
              className="bg-purple-500/20 text-purple-300 border-purple-500/40 text-xs shrink-0"
              data-testid={`badge-colors-${lot.id}`}
            >
              {lot.uniqueColorCount} {lot.uniqueColorCount === 1 ? 'Color' : 'Colors'}
            </Badge>
            {newQty > 0 && (
              <Badge 
                variant="secondary"
                className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-xs shrink-0"
                data-testid={`badge-new-${lot.id}`}
              >
                New: {newQty.toLocaleString()}
              </Badge>
            )}
            {usedQty > 0 && (
              <Badge 
                variant="secondary"
                className="bg-amber-500/20 text-amber-300 border-amber-500/40 text-xs shrink-0"
                data-testid={`badge-used-${lot.id}`}
              >
                Used: {usedQty.toLocaleString()}
              </Badge>
            )}
          </div>
        </div>
      </Card>

      <Dialog open={isOpen} onOpenChange={onOpenChange}>
        <DialogContent 
          className="max-w-2xl max-h-[90vh] overflow-y-auto bg-gradient-to-br from-gray-950 via-gray-900 to-black border-2 border-purple-500/30"
          data-testid={`modal-lot-${lot.id}`}
        >
          <DialogHeader>
            <DialogTitle className="text-base md:text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400">
              {lot.name}
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-300 font-mono">
              Part #{lot.part}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 md:space-y-4">
            {imageUrl && (
              <div className="aspect-square bg-black/40 rounded-lg overflow-hidden border-2 border-purple-500/20 flex items-center justify-center">
                <img
                  src={imageUrl}
                  alt={lot.name}
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    e.currentTarget.src = noImagePlaceholder;
                  }}
                />
              </div>
            )}

            <div className="space-y-2 md:space-y-3">
              <h3 className="text-sm md:text-base font-bold text-cyan-300">
                Available Colors & Conditions
              </h3>
              
              {lot.colorGroups.map((colorGroup, groupIdx) => (
                <div 
                  key={groupIdx}
                  className="border-2 border-purple-500/30 rounded-lg p-2 md:p-3 bg-gray-900/40 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-4 h-4 md:w-5 md:h-5 rounded-md border-2 border-white/30 shrink-0"
                      style={{ backgroundColor: colorGroup.colorHex }}
                    />
                    <div className="font-bold text-sm md:text-base text-white">
                      {colorGroup.colorName}
                    </div>
                    <div className="text-xs text-gray-400 ml-auto">
                      Total: {colorGroup.totalQty.toLocaleString()}
                    </div>
                  </div>

                  {colorGroup.variations.map((variation, varIdx) => {
                    const variationIndex = lot.variations.findIndex(
                      v => v.color === variation.color && v.condition === variation.condition
                    );
                    const currentQty = quantities[variationIndex] || 0;

                    return (
                      <div 
                        key={varIdx}
                        className="flex items-center justify-between gap-2 bg-black/20 rounded-md p-2"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-xs md:text-sm text-white">
                            {variation.condition}
                          </div>
                          <div className="text-xs text-gray-400">
                            {variation.qty.toLocaleString()} available
                          </div>
                        </div>
                        
                        <div className="text-sm md:text-base font-bold text-cyan-300 shrink-0">
                          {variation.price}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-7 w-7 bg-gray-800 border-purple-500/40"
                            onClick={() => handleQuantityChange(variationIndex, -1)}
                            data-testid={`button-decrease-${lot.id}-${variationIndex}`}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          
                          <Input
                            type="number"
                            min="0"
                            value={currentQty}
                            onChange={(e) => {
                              const val = parseInt(e.target.value) || 0;
                              setQuantities(prev => ({ ...prev, [variationIndex]: Math.max(0, val) }));
                            }}
                            className="w-12 h-7 text-center bg-gray-800 border-purple-500/40 text-white text-xs"
                            data-testid={`input-quantity-${lot.id}-${variationIndex}`}
                          />
                          
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-7 w-7 bg-gray-800 border-purple-500/40"
                            onClick={() => handleQuantityChange(variationIndex, 1)}
                            data-testid={`button-increase-${lot.id}-${variationIndex}`}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                          
                          <Button
                            size="sm"
                            className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-bold h-7 px-2"
                            onClick={() => handleAddToCart(variation, variationIndex)}
                            disabled={currentQty === 0}
                            data-testid={`button-add-${lot.id}-${variationIndex}`}
                          >
                            Add
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface CollapsibleSectionProps {
  title: string;
  lots: ProductLot[];
  lotCount?: number;
  partCount?: number;
  bandColor: string;
  onAddToCart: (variation: any, quantity: number) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  sectionId: string;
}

function CollapsibleSection({ 
  title, 
  lots, 
  lotCount, 
  partCount, 
  bandColor, 
  onAddToCart, 
  isCollapsed, 
  onToggleCollapse,
  sectionId 
}: CollapsibleSectionProps) {
  const [openLotId, setOpenLotId] = useState<number | null>(null);

  return (
    <section className="py-4 md:py-6 relative" data-testid={`section-${sectionId}`}>
      <div className={`absolute inset-0 bg-gradient-to-r ${bandColor} opacity-10`} />
      
      <div className="relative z-10">
        <div className="px-3 md:px-6 mb-3 md:mb-4">
          <div 
            className="flex items-center justify-between cursor-pointer"
            onClick={onToggleCollapse}
            data-testid={`button-toggle-${sectionId}`}
          >
            <div className="flex-1">
              <h2 className={`text-lg md:text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r ${bandColor} flex items-center gap-2 mb-1`}>
                <Sparkles className="w-5 h-5 md:w-6 md:h-6 text-white drop-shadow-lg" />
                {title}
                {isCollapsed ? <ChevronDown className="w-5 h-5 md:w-6 md:h-6 text-white" /> : <ChevronUp className="w-5 h-5 md:w-6 md:h-6 text-white" />}
              </h2>
              {lotCount !== undefined && partCount !== undefined && (
                <div className="text-xs text-gray-400 pl-7 md:pl-8">
                  {lotCount.toLocaleString()} lots · {partCount.toLocaleString()} parts
                </div>
              )}
            </div>
          </div>
        </div>

        {!isCollapsed && lots.length > 0 && (
          <div className="overflow-x-auto scrollbar-hide smooth-scroll">
            <div className="flex gap-2 md:gap-4 px-3 md:px-6 will-change-scroll">
              {lots.map((lot) => (
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
        )}

        {!isCollapsed && lots.length === 0 && (
          <div className="text-center text-gray-400 py-6">
            No items in this group
          </div>
        )}
      </div>
    </section>
  );
}

export default function Shop() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [selectedItemType, setSelectedItemType] = useState<string | null>('PART');
  const [selectedCategories, setSelectedCategories] = useState<number[]>([]);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const toggleSection = (sectionId: string) => {
    setCollapsedSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(sectionId)) {
        newSet.delete(sectionId);
      } else {
        newSet.add(sectionId);
      }
      return newSet;
    });
  };

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

  const { data: categoriesData } = useQuery<{
    categories: Category[];
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

  const { data: specialGroupsData, isLoading: specialGroupsLoading } = useQuery<{
    newItems: ProductLot[];
    hotItems: ProductLot[];
    discountedItems: ProductLot[];
  }>({
    queryKey: ['/api/shop/special-groups', { itemType: selectedItemType }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedItemType) {
        params.append('itemType', selectedItemType);
      }
      const response = await fetch(`/api/shop/special-groups?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch special groups');
      return response.json();
    },
  });

  const { data: categoryInventoryData, isLoading: categoryInventoryLoading } = useQuery<{ lots: ProductLot[] }>({
    queryKey: ['/api/shop/inventory', { itemType: selectedItemType, categoryIds: selectedCategories }],
    enabled: selectedCategories.length > 0,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedItemType) {
        params.append('itemType', selectedItemType);
      }
      if (selectedCategories.length > 0) {
        params.append('categoryIds', selectedCategories.join(','));
      }
      const response = await fetch(`/api/shop/inventory?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch inventory');
      return response.json();
    },
  });

  const { data: statsData } = useQuery<{
    totalLots: number;
    totalParts: number;
  }>({
    queryKey: ['/api/shop/stats'],
  });

  const { data: user } = useQuery<any>({
    queryKey: ['/api/auth/user'],
    retry: false,
  });

  const processLots = (lots: ProductLot[]) => {
    return lots.map(lot => {
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
      
      return {
        ...lot,
        uniqueColorCount: colorMap.size,
        colorGroups: Array.from(colorMap.values())
      };
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

  const sortedCategories = [...(categoriesData?.categories || [])].sort((a, b) => {
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

  const handleAddToCart = (item: any, quantity: number = 1) => {
    const cartItem: CartItem = {
      ...item,
      quantity,
    };
    
    setCart(prevCart => {
      const existingIndex = prevCart.findIndex(
        i => i.lotId === item.lotId && 
        i.color === item.color && 
        i.condition === item.condition
      );

      if (existingIndex >= 0) {
        const updated = [...prevCart];
        updated[existingIndex] = {
          ...updated[existingIndex],
          quantity: updated[existingIndex].quantity + quantity
        };
        return updated;
      }

      return [...prevCart, cartItem];
    });
    
    toast({
      title: "Added to cart",
      description: `${quantity}x ${item.partName} (${item.color}, ${item.condition})`,
    });
  };

  const totalLots = statsData?.totalLots || 0;
  const totalParts = statsData?.totalParts || 0;

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

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="bg-black border-b-2 border-purple-500/30 sticky top-0 z-50">
        <div className="relative px-3 md:px-6 py-2 md:py-3">
          <div className="flex items-center justify-between mb-2">
            <div className="w-24 md:w-32" />
            
            <Link href="/shop">
              <div className="flex items-center justify-center">
                <img 
                  src={planetBrickLogo} 
                  alt="PlanetBrick" 
                  className="h-24 md:h-32 lg:h-40 w-auto cursor-pointer hover:scale-105 transition-transform"
                  data-testid="logo-planetbrick"
                />
              </div>
            </Link>

            <div className="flex items-center gap-2 w-24 md:w-32 justify-end">
              <Sheet open={isCartOpen} onOpenChange={setIsCartOpen}>
                <SheetTrigger asChild>
                  <Button 
                    size="icon"
                    variant="outline"
                    className="relative bg-gray-900 border-purple-500/40 hover:bg-gray-800"
                    data-testid="button-cart"
                  >
                    <ShoppingCart className="h-4 w-4" />
                    {cart.length > 0 && (
                      <Badge 
                        className="absolute -top-2 -right-2 bg-cyan-500 text-black font-bold text-xs"
                        data-testid="badge-cart-count"
                      >
                        {cart.length}
                      </Badge>
                    )}
                  </Button>
                </SheetTrigger>
                <SheetContent className="w-full sm:max-w-lg bg-gradient-to-br from-gray-950 via-gray-900 to-black border-l-2 border-purple-500/30">
                  <SheetHeader>
                    <SheetTitle className="text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400">
                      Shopping Cart
                    </SheetTitle>
                    <SheetDescription className="text-gray-300 text-sm">
                      {cart.length} {cart.length === 1 ? 'item' : 'items'}
                    </SheetDescription>
                  </SheetHeader>
                  
                  <div className="mt-4 space-y-3 max-h-[70vh] overflow-y-auto">
                    {cart.length === 0 ? (
                      <div className="text-center text-gray-400 py-12 text-sm">
                        Your cart is empty
                      </div>
                    ) : (
                      cart.map((item, index) => (
                        <div 
                          key={index}
                          className="flex items-center gap-2 bg-gray-900/60 rounded-lg p-2 border border-purple-500/30"
                          data-testid={`cart-item-${index}`}
                        >
                          <div 
                            className="w-10 h-10 rounded-md shrink-0 border-2 border-white/20"
                            style={{ backgroundColor: item.colorHex }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="font-bold text-white text-sm truncate">{item.partName}</div>
                            <div className="text-xs text-gray-400">
                              {item.color} • {item.condition}
                            </div>
                            <div className="text-xs text-cyan-300 font-bold">
                              {item.price} × {item.quantity}
                            </div>
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setCart(cart.filter((_, i) => i !== index))}
                            className="shrink-0 h-8 w-8"
                            data-testid={`button-remove-${index}`}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </SheetContent>
              </Sheet>

              {user ? (
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => logoutMutation.mutate()}
                  className="bg-gray-900 border-purple-500/40 hover:bg-gray-800"
                  data-testid="button-logout"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              ) : (
                <Link href="/auth/login">
                  <Button 
                    size="sm"
                    variant="outline"
                    className="bg-gray-900 border-purple-500/40 hover:bg-gray-800 text-xs"
                    data-testid="button-login"
                  >
                    Login
                  </Button>
                </Link>
              )}
            </div>
          </div>

          <div className="flex items-center justify-center gap-3 md:gap-6 text-xs text-gray-400">
            <div className="flex items-center gap-1 group cursor-default">
              <span className="font-bold text-cyan-400" data-testid="text-total-lots">
                {totalLots.toLocaleString()}
              </span>
              <span>Unique Lots</span>
              <div className="w-1 h-1 rounded-full bg-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div className="w-px h-3 bg-purple-500/30" />
            <div className="flex items-center gap-1 group cursor-default">
              <span className="font-bold text-purple-400" data-testid="text-total-parts">
                {totalParts.toLocaleString()}
              </span>
              <span>Total Parts</span>
              <div className="w-1 h-1 rounded-full bg-purple-400 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>
        </div>
      </header>

      <div className="sticky top-[88px] md:top-[100px] z-40 bg-black/95 backdrop-blur-sm border-b border-purple-500/20 px-3 md:px-6 py-2">
        <div className="relative max-w-2xl mx-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search for LEGO parts..."
            className="pl-9 text-sm bg-gray-900/60 border-purple-500/30 text-white placeholder:text-gray-500"
            data-testid="input-search"
          />
        </div>
      </div>

      <div className="sticky top-[132px] md:top-[148px] z-30 bg-gradient-to-b from-black via-black/95 to-transparent border-b border-purple-500/20 px-3 md:px-6 py-2">
        <div className="overflow-x-auto scrollbar-hide">
          <div className="flex gap-2 min-w-min">
            {sortedCategories.map((category) => {
              const isSelected = selectedCategories.includes(category.id);
              return (
                <Button
                  key={category.id}
                  variant={isSelected ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleCategoryToggle(category.id)}
                  className={`shrink-0 text-xs ${
                    isSelected 
                      ? "bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-bold border-none"
                      : "bg-gray-900/40 border-purple-500/30 text-gray-300 hover:bg-gray-800"
                  }`}
                  data-testid={`button-category-${category.id}`}
                >
                  {isSelected && <Check className="w-3 h-3 mr-1" />}
                  {category.name}
                  <Badge 
                    variant="secondary"
                    className={`ml-1.5 text-xs ${
                      isSelected
                        ? "bg-white/20 text-white"
                        : "bg-purple-500/20 text-purple-300"
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

      <main className="pb-8">
        <CollapsibleSection
          title="🆕 New Items"
          lots={specialGroups.newItems}
          bandColor="from-emerald-500 via-teal-500 to-cyan-500"
          onAddToCart={handleAddToCart}
          isCollapsed={collapsedSections.has('new-items')}
          onToggleCollapse={() => toggleSection('new-items')}
          sectionId="new-items"
        />

        <CollapsibleSection
          title="🔥 Hot Items"
          lots={specialGroups.hotItems}
          bandColor="from-red-500 via-orange-500 to-yellow-500"
          onAddToCart={handleAddToCart}
          isCollapsed={collapsedSections.has('hot-items')}
          onToggleCollapse={() => toggleSection('hot-items')}
          sectionId="hot-items"
        />

        <CollapsibleSection
          title="💰 Discounted Items"
          lots={specialGroups.discountedItems}
          bandColor="from-violet-500 via-fuchsia-500 to-pink-500"
          onAddToCart={handleAddToCart}
          isCollapsed={collapsedSections.has('discounted-items')}
          onToggleCollapse={() => toggleSection('discounted-items')}
          sectionId="discounted-items"
        />

        {selectedCategories.length > 0 && (
          <div className="mt-4">
            {selectedCategories.map((categoryId, index) => {
              const category = categoriesData?.categories.find(c => c.id === categoryId);
              if (!category) return null;

              const categoryLots = categoryProductMap.get(categoryId) || [];
              const gradient = colorGradients[index % colorGradients.length];

              return (
                <CollapsibleSection
                  key={categoryId}
                  title={category.name}
                  lots={categoryLots}
                  lotCount={category.lotCount}
                  partCount={category.partCount}
                  bandColor={gradient}
                  onAddToCart={handleAddToCart}
                  isCollapsed={collapsedSections.has(`category-${categoryId}`)}
                  onToggleCollapse={() => toggleSection(`category-${categoryId}`)}
                  sectionId={`category-${categoryId}`}
                />
              );
            })}
          </div>
        )}

        {(categoryInventoryLoading || specialGroupsLoading) && (
          <div className="flex items-center justify-center py-12">
            <div className="text-cyan-400">Loading...</div>
          </div>
        )}
      </main>
    </div>
  );
}
