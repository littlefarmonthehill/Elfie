import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, Plus, X, Minus, ArrowLeft } from "lucide-react";
import { Link, useLocation, useSearch } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

interface ProductVariation {
  color: string;
  colorHex: string;
  condition: string;
  qty: number;
  price: number;
}

interface ColorGroup {
  colorName: string;
  colorHex: string;
  variations: ProductVariation[];
  totalQty: number;
}

interface ProductLot {
  id: number;
  part: string;
  partName: string;
  category: string;
  totalQty: number;
  imageUrl: string;
  variations: ProductVariation[];
  uniqueColorCount?: number;
  colorGroups?: ColorGroup[];
}

interface CartItem {
  lotId: number;
  partNumber: string;
  partName: string;
  color: string;
  colorHex: string;
  condition: string;
  price: string;
  quantity: number;
  imageUrl: string;
}

export default function Search() {
  const searchParams = useSearch();
  const category = new URLSearchParams(searchParams).get('category') || '';
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [selectedLot, setSelectedLot] = useState<ProductLot | null>(null);
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

  // Check authentication status
  const { data: user } = useQuery<any>({
    queryKey: ['/api/auth/user'],
    retry: false,
  });

  // Fetch real inventory data
  const { data: inventoryData, isLoading: inventoryLoading } = useQuery<{ lots: ProductLot[] }>({
    queryKey: ['/api/shop/inventory'],
  });

  // Fetch real stats
  const { data: statsData } = useQuery<{
    totalLots: number;
    totalParts: number;
  }>({
    queryKey: ['/api/shop/stats'],
  });

  // Process lots to group by color
  const processedLots = (inventoryData?.lots || []).map(lot => {
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

  // Filter products by category
  const filteredLots = useMemo(() => {
    if (!category) return processedLots;
    return processedLots.filter(lot => 
      lot.category.toLowerCase().includes(category.toLowerCase())
    );
  }, [processedLots, category]);

  const totalLots = statsData?.totalLots || 0;
  const totalParts = statsData?.totalParts || 0;

  // Category display mapping
  const categoryDisplay: Record<string, { name: string; color: string }> = {
    'brick': { name: 'Bricks', color: 'from-red-500 via-orange-500 to-yellow-500' },
    'plate': { name: 'Plates', color: 'from-blue-500 via-cyan-500 to-teal-500' },
    'minifig': { name: 'Minifigures', color: 'from-yellow-400 via-orange-400 to-red-400' },
    'tile': { name: 'Tiles', color: 'from-purple-500 via-pink-500 to-rose-500' },
    'slope': { name: 'Slopes', color: 'from-green-500 via-emerald-500 to-teal-500' },
  };

  const currentCategory = categoryDisplay[category] || { name: category, color: 'from-cyan-500 to-blue-500' };

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
        const newCart = [...prevCart];
        newCart[existingIndex].quantity += quantity;
        return newCart;
      } else {
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
      {/* Background effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-purple-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-cyan-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      <div className="relative z-10">
        {/* Header */}
        <header className="sticky top-0 z-50 bg-black/95 backdrop-blur-xl border-b border-white/10 relative pb-6 md:pb-8">
          <div className="px-4 md:px-8 py-2 flex items-start justify-between relative">
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
                              <div className="flex items-center gap-2 mt-2">
                                <span className="text-sm font-bold text-cyan-400">{item.price}</span>
                                <span className="text-xs text-gray-500">× {item.quantity}</span>
                              </div>
                            </div>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-500/10"
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
                    <div className="mt-6 pt-6 border-t border-gray-700">
                      <div className="flex justify-between items-center mb-4">
                        <span className="text-lg font-bold text-white">Total:</span>
                        <span className="text-2xl font-bold text-cyan-400">
                          ${cartTotal.toFixed(2)}
                        </span>
                      </div>
                      <Button className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-bold" data-testid="button-checkout">
                        Proceed to Checkout
                      </Button>
                    </div>
                  )}
                </SheetContent>
              </Sheet>
              {user ? (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="text-cyan-300 text-[9px] md:text-sm h-8 md:h-10 px-2 md:px-3" 
                  onClick={() => logoutMutation.mutate()}
                  disabled={logoutMutation.isPending}
                  data-testid="button-logout-header"
                >
                  <LogOut className="w-3 h-3 md:w-4 md:w-4 mr-1" />
                  Logout
                </Button>
              ) : (
                <Link href="/login">
                  <Button variant="ghost" size="sm" className="text-cyan-300 text-[9px] md:text-sm h-8 md:h-10 px-2 md:px-3" data-testid="button-login-header">
                    Login
                  </Button>
                </Link>
              )}
            </div>
          </div>

          {/* Centered Logo */}
          <div className="absolute left-1/2 -translate-x-1/2 top-2 md:top-3">
            <Link href="/shop">
              <h1 className="text-3xl md:text-5xl lg:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-500 cursor-pointer hover:scale-105 transition-transform" data-testid="link-logo">
                PlanetBrick
              </h1>
            </Link>
          </div>

          {/* Stats Band - Below Logo */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-r from-gray-900/80 via-gray-800/80 to-gray-900/80 backdrop-blur-sm border-t border-white/5 px-12 md:px-20 lg:px-32">
            <div className="flex items-center justify-between py-2 md:py-3">
              <div className="group relative">
                <div className="absolute -inset-2 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 rounded-lg blur opacity-0 group-hover:opacity-100 transition-all duration-300" />
                <div className="relative text-left">
                  <div className="text-[10px] md:text-sm text-gray-400 uppercase tracking-wider">Unique Lots</div>
                  <div className="text-base md:text-2xl lg:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400">
                    {totalLots.toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="group relative">
                <div className="absolute -inset-2 bg-gradient-to-r from-purple-500/20 to-pink-500/20 rounded-lg blur opacity-0 group-hover:opacity-100 transition-all duration-300" />
                <div className="relative text-right">
                  <div className="text-[10px] md:text-sm text-gray-400 uppercase tracking-wider">Total Parts</div>
                  <div className="text-base md:text-2xl lg:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
                    {totalParts.toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <div className="container mx-auto px-4 py-8 max-w-7xl">
          {/* Back Button & Category Title */}
          <div className="flex items-center gap-4 mb-8">
            <Link href="/shop">
              <Button variant="ghost" className="text-white hover-elevate" data-testid="button-back">
                <ArrowLeft className="w-5 h-5 mr-2" />
                Back to Shop
              </Button>
            </Link>
            <h1 className={`text-3xl md:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r ${currentCategory.color}`}>
              {currentCategory.name}
            </h1>
          </div>

          {/* Product Grid */}
          {inventoryLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 md:gap-4">
              {Array.from({ length: 12 }).map((_, i) => (
                <Card key={i} className="animate-pulse bg-gray-800/50 border-gray-700 h-64" />
              ))}
            </div>
          ) : filteredLots.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-xl text-gray-400">No products found in this category</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 md:gap-4">
              {filteredLots.map((lot) => (
                <Card
                  key={lot.id}
                  className="group relative overflow-hidden bg-gradient-to-br from-gray-900/90 to-gray-800/90 border-gray-700/50 hover:border-cyan-500/50 transition-all duration-300 cursor-pointer hover-elevate"
                  onClick={() => setSelectedLot(lot)}
                  data-testid={`card-product-${lot.id}`}
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <div className="relative p-2 md:p-3">
                    {/* Image */}
                    <div className="aspect-square mb-2 md:mb-3 rounded-md overflow-hidden bg-white/5 flex items-center justify-center">
                      {lot.imageUrl ? (
                        <img 
                          src={lot.imageUrl} 
                          alt={lot.partName} 
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <div className="w-full h-full bg-gray-700/50 flex items-center justify-center">
                          <span className="text-xs text-gray-500">No image</span>
                        </div>
                      )}
                    </div>

                    {/* Part Info */}
                    <h3 className="text-[10px] md:text-xs font-bold text-white mb-0.5 md:mb-1 line-clamp-2 min-h-[28px] md:min-h-[32px]">
                      {lot.partName}
                    </h3>
                    <p className="text-[8px] md:text-[10px] text-gray-400 mb-2">#{lot.part}</p>

                    {/* Stats */}
                    <div className="flex items-center justify-between gap-1 mb-2">
                      <Badge variant="secondary" className="text-[8px] md:text-[9px] px-1 md:px-1.5 h-4 md:h-5 no-default-hover-elevate">
                        {lot.uniqueColorCount} {lot.uniqueColorCount === 1 ? 'color' : 'colors'}
                      </Badge>
                      <span className="text-[9px] md:text-[10px] text-cyan-400 font-bold">
                        {lot.totalQty} pcs
                      </span>
                    </div>

                    {/* Color dots */}
                    <div className="flex gap-0.5 md:gap-1 flex-wrap">
                      {lot.colorGroups?.slice(0, 8).map((color, idx) => (
                        <div
                          key={idx}
                          className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full border border-white/20"
                          style={{ backgroundColor: color.colorHex }}
                          title={color.colorName}
                        />
                      ))}
                      {(lot.uniqueColorCount || 0) > 8 && (
                        <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full bg-gray-700 border border-white/20 flex items-center justify-center">
                          <span className="text-[6px] md:text-[7px] text-white">+{(lot.uniqueColorCount || 0) - 8}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Product Detail Modal */}
      <Dialog open={!!selectedLot} onOpenChange={() => setSelectedLot(null)}>
        <DialogContent className="max-w-xl bg-gradient-to-br from-gray-900 to-gray-800 border-cyan-500/30 text-white max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl md:text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400">
              {selectedLot?.partName}
            </DialogTitle>
            <DialogDescription className="text-gray-400 text-sm">
              Part #{selectedLot?.part} • {selectedLot?.category}
            </DialogDescription>
          </DialogHeader>

          {selectedLot && (
            <div className="space-y-4">
              {/* Product Image */}
              <div className="aspect-square w-full max-w-xs mx-auto rounded-lg overflow-hidden bg-white/5 flex items-center justify-center">
                {selectedLot.imageUrl ? (
                  <img 
                    src={selectedLot.imageUrl} 
                    alt={selectedLot.partName} 
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="text-gray-500">No image available</div>
                )}
              </div>

              {/* Color Variations */}
              <div className="space-y-3">
                {selectedLot.colorGroups?.map((colorGroup, idx) => (
                  <div key={idx} className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
                    <div className="flex items-start gap-3">
                      {/* Color swatch and name */}
                      <div className="flex-shrink-0">
                        <div
                          className="w-10 h-10 rounded border-2 border-white/20"
                          style={{ backgroundColor: colorGroup.colorHex }}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-sm text-white mb-2">{colorGroup.colorName}</h4>
                        
                        {/* Variations - horizontal layout */}
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          {colorGroup.variations.map((variation, vIdx) => (
                            <Card key={vIdx} className="flex-shrink-0 bg-gray-900/50 border-gray-600 p-2 min-w-[140px]">
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <Badge 
                                    variant={variation.condition === 'New' ? 'default' : 'secondary'}
                                    className="text-[9px] px-1.5 h-4 no-default-hover-elevate"
                                  >
                                    {variation.condition}
                                  </Badge>
                                  <span className="text-[10px] text-gray-400">{variation.qty} available</span>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-sm font-bold text-cyan-400">${variation.price.toFixed(2)}</span>
                                  <Button
                                    size="icon"
                                    className="h-6 w-6 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleAddToCart({
                                        lotId: selectedLot.id,
                                        partNumber: selectedLot.part,
                                        partName: selectedLot.partName,
                                        color: colorGroup.colorName,
                                        colorHex: colorGroup.colorHex,
                                        condition: variation.condition,
                                        price: `$${variation.price.toFixed(2)}`,
                                        imageUrl: selectedLot.imageUrl,
                                      }, 1);
                                    }}
                                    data-testid={`button-add-${idx}-${vIdx}`}
                                  >
                                    <ShoppingCart className="w-3 h-3" />
                                  </Button>
                                </div>
                              </div>
                            </Card>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
