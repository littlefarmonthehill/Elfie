import { useState, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Search, Package, RefreshCw, AlertCircle, X, Camera, DollarSign, ExternalLink } from "lucide-react";

interface Color {
  id: number;
  name: string;
  rgb: string | null;
}

interface LotPriceEntry {
  itemNo: string;
  itemName: string | null;
  thumbnailUrl: string | null;
  stockAvgPrice: string | null;
  soldAvgPrice: string | null;
  stockTotalLots: number | null;
  suggestedPrice: string;
  premiumPercentage: number;
}

interface InventoryLot {
  id: number;
  colorId: number | null;
  colorName: string | null;
  colorRgb: string | null;
  quantity: number;
  unitPrice: string | null;
  newOrUsed: string;
  suggestedPrice?: string | null;
  opportunityScore?: number | null;
  marketPeakSoldPrice?: string | null;
  floorApplied?: 'cost' | 'min' | 'none' | null;
}

interface SpotLookupResult {
  priceData: LotPriceEntry;
  lotPriceData: Record<string, LotPriceEntry>;
  thresholds: { tooHigh: number; tooLow: number };
  marketPeakSoldPrice?: number | null;
  inventoryLots: InventoryLot[];
}

interface PomSpotLookupProps {
  formatCurrency: (v: string | number) => string;
}

export function PomSpotLookup({ formatCurrency }: PomSpotLookupProps) {
  const [partNo, setPartNo] = useState("");
  const [colorId, setColorId] = useState<string>("none");
  const [result, setResult] = useState<SpotLookupResult | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<{ name: string; id: string; confidence: number } | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  // lotKey → suggestedPrice from on-demand pricing fetch
  const [pricingCache, setPricingCache] = useState<Map<string, { suggestedPrice?: string | null; soldMaxPrice?: string | null }>>(new Map());
  const [pricingLoading, setPricingLoading] = useState<Set<string>>(new Set());

  const fetchPricingMutation = useMutation({
    mutationFn: async (lots: Array<{ itemNo: string; itemType: string; colorId: number | null; newOrUsed: string; key: string }>) => {
      const results: Array<{ key: string; suggestedPrice: string | null; soldMaxPrice: string | null }> = [];
      await Promise.all(lots.map(async (lot) => {
        const data = await apiRequest("POST", "/api/priceomatic/fetch-pricing", {
          itemNo: lot.itemNo,
          itemType: lot.itemType,
          colorId: lot.colorId,
          newOrUsed: lot.newOrUsed,
        });
        results.push({ key: lot.key, suggestedPrice: data.suggestedPrice ?? null, soldMaxPrice: data.soldMaxPrice ?? null });
      }));
      return results;
    },
    onMutate: (lots) => {
      setPricingLoading(prev => new Set([...prev, ...lots.map(l => l.key)]));
    },
    onSettled: (_data, _err, lots) => {
      setPricingLoading(prev => {
        const next = new Set(prev);
        lots.forEach(l => next.delete(l.key));
        return next;
      });
    },
    onSuccess: (results) => {
      setPricingCache(prev => {
        const next = new Map(prev);
        results.forEach(r => {
          next.set(r.key, { suggestedPrice: r.suggestedPrice, soldMaxPrice: r.soldMaxPrice });
        });
        return next;
      });
    },
    onError: () => {
      toast({ title: "Pricing failed", description: "Could not fetch suggested price from BrickLink", variant: "destructive" });
    },
  });

  const { data: colors } = useQuery<Color[]>({
    queryKey: ["/api/colors"],
  });

  const invalidateDashboard = () => {
    queryClient.refetchQueries({ queryKey: ['/api/priceomatic/insights'] });
    queryClient.refetchQueries({ queryKey: ['/api/priceomatic/freshness'] });
  };

  const lookupMutation = useMutation({
    mutationFn: async (overridePartNo?: string) => {
      const searchPart = (overridePartNo ?? partNo).trim().toUpperCase();
      const params = new URLSearchParams({
        partNo: searchPart,
        itemType: "P",
        newOrUsed: "N",
      });
      if (colorId && colorId !== "none") params.set("colorId", colorId);
      return await apiRequest("GET", `/api/pom/spot-lookup?${params}`);
    },
    onSuccess: (data) => {
      if (data?.error) {
        setLookupError(data.message || data.error);
        setResult(null);
      } else {
        setResult(data);
        setLookupError(null);
        invalidateDashboard();
      }
    },
    onError: (err: Error) => {
      setLookupError(err.message);
      setResult(null);
    },
  });

  const handleLookup = (overridePartNo?: string) => {
    const searchStr = (overridePartNo ?? partNo).trim();
    if (!searchStr) return;

    const searchPart = searchStr.toUpperCase();
    const searchColorId = colorId !== "none" ? parseInt(colorId) : null;

    const insightsCache = queryClient.getQueryData<{ success: boolean; data: any }>(['/api/priceomatic/insights']);
    const allInsights = insightsCache?.data;

    if (allInsights) {
      const allItems: any[] = [
        ...(allInsights.tooHigh ?? []),
        ...(allInsights.tooLow ?? []),
        ...(allInsights.wellPriced ?? []),
      ];

      const matches = allItems.filter((item) => {
        const partMatch = item.itemNo.toUpperCase() === searchPart;
        const colorMatch = searchColorId === null || item.colorId === searchColorId;
        return partMatch && colorMatch;
      });

      if (matches.length > 0) {
        const lotPriceData: Record<string, LotPriceEntry> = {};
        for (const m of matches) {
          const key = `${m.colorId ?? "null"}_${m.newOrUsed}`;
          lotPriceData[key] = {
            itemNo: m.itemNo,
            itemName: m.itemName,
            thumbnailUrl: null,
            stockAvgPrice: m.stockAvgPrice ?? null,
            soldAvgPrice: m.soldAvgPrice ?? null,
            stockTotalLots: m.stockTotalLots ?? null,
            suggestedPrice: m.suggestedPrice,
            premiumPercentage: 0,
          };
        }

        const primaryMatch =
          searchColorId !== null
            ? (matches.find((m) => m.colorId === searchColorId) ?? matches[0])
            : matches[0];

        const priceData: LotPriceEntry = {
          itemNo: primaryMatch.itemNo,
          itemName: primaryMatch.itemName,
          thumbnailUrl: null,
          stockAvgPrice: primaryMatch.stockAvgPrice ?? null,
          soldAvgPrice: primaryMatch.soldAvgPrice ?? null,
          stockTotalLots: primaryMatch.stockTotalLots ?? null,
          suggestedPrice: primaryMatch.suggestedPrice,
          premiumPercentage: 0,
        };

        // Compute market peak from cached insights (max marketPeakSoldPrice across all matched lots)
        const peakValues = matches
          .map((m: any) => m.marketPeakSoldPrice != null ? parseFloat(String(m.marketPeakSoldPrice)) : 0)
          .filter((v: number) => v > 0);
        const marketPeakSoldPrice = peakValues.length > 0 ? Math.max(...peakValues) : null;

        const inventoryLots: InventoryLot[] = matches.map((m: any) => ({
          id: m.inventoryId,
          colorId: m.colorId,
          colorName: m.colorName,
          colorRgb: colors?.find((c: Color) => c.id === m.colorId)?.rgb ?? null,
          quantity: m.quantity,
          unitPrice: m.currentPrice,
          newOrUsed: m.newOrUsed,
          suggestedPrice: m.suggestedPrice ?? null,
          opportunityScore: m.opportunityScore ?? null,
          marketPeakSoldPrice: m.marketPeakSoldPrice ?? null,
          floorApplied: m.floorApplied ?? null,
        }));

        const settingsCache = queryClient.getQueryData<any>(['/api/settings']);
        const thresholds = {
          tooHigh: settingsCache?.pomTooHighThreshold ?? 20,
          tooLow: settingsCache?.pomTooLowThreshold ?? 20,
        };

        setResult({ priceData, lotPriceData, inventoryLots, thresholds, marketPeakSoldPrice });
        setLookupError(null);
        return;
      }
    }

    lookupMutation.mutate(overridePartNo);
  };

  const handleImageUpload = async (file: File) => {
    if (!file) return;
    setIsScanning(true);
    setScanResult(null);
    setLookupError(null);

    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('itemType', 'parts');

      const response = await fetch('/api/brickognize/identify', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Image recognition failed');

      const data = await response.json();

      if (data.items && data.items.length > 0) {
        const top = data.items[0];
        const confidence = Math.round(top.score * 100);
        setScanResult({ name: top.name, id: top.id, confidence });
        setPartNo(top.id);
        // Auto-trigger lookup with the identified part number
        handleLookup(top.id);
        toast({
          title: `Part identified (${confidence}% confidence)`,
          description: `${top.name} — Part ${top.id}`,
        });
      } else {
        setLookupError("Couldn't identify the part. Try a clearer photo.");
      }
    } catch {
      setLookupError("Image recognition failed. Try again.");
    } finally {
      setIsScanning(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleClose = () => {
    if (result?.inventoryLots?.length) {
      invalidateDashboard();
    }
    setResult(null);
    setLookupError(null);
    setScanResult(null);
  };

  const pd = result?.priceData;
  const lots = result?.inventoryLots ?? [];
  const lotPriceData = result?.lotPriceData ?? {};

  return (
    <div className="bg-gray-900/50 border border-purple-500/20 rounded-lg p-2.5">
      <div className="flex items-center gap-2">
        {/* Camera button — left of search bar */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="flex-shrink-0 text-purple-400"
              onClick={() => fileInputRef.current?.click()}
              disabled={isScanning}
              data-testid="button-pom-camera"
            >
              {isScanning ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Camera className="w-4 h-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {isScanning ? 'Identifying part...' : 'Photo ID — take or upload a photo to identify the part'}
          </TooltipContent>
        </Tooltip>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          data-testid="input-pom-image"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleImageUpload(file);
          }}
        />

        <Input
          placeholder="Part # (e.g. 3001)"
          value={partNo}
          onChange={(e) => setPartNo(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleLookup()}
          className="w-32 flex-shrink-0 text-[16px] font-mono touch-manipulation"
          data-testid="input-spot-partno"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
        <Select value={colorId} onValueChange={setColorId}>
          <SelectTrigger className="flex-1 min-w-0 text-[16px] touch-manipulation" data-testid="select-spot-color">
            <SelectValue placeholder="Any color" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Any color</SelectItem>
            {colors?.map((c) => (
              <SelectItem key={c.id} value={c.id.toString()}>
                <span className="flex items-center gap-1.5">
                  {c.rgb && (
                    <span
                      className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0"
                      style={{ backgroundColor: `#${c.rgb}` }}
                    />
                  )}
                  {c.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          onClick={() => handleLookup()}
          disabled={!partNo.trim() || lookupMutation.isPending}
          size="icon"
          variant="ghost"
          className="flex-shrink-0 text-purple-400"
          data-testid="button-spot-lookup"
        >
          {lookupMutation.isPending ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Search className="w-4 h-4" />
          )}
        </Button>
      </div>

      {/* Scan badge */}
      {scanResult && !result && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-purple-300">
          <Camera className="w-3 h-3 flex-shrink-0" />
          <span>Identified: <span className="font-mono text-white">{scanResult.id}</span> · {scanResult.name} · {scanResult.confidence}% confidence</span>
        </div>
      )}

      {/* Error */}
      {lookupError && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-red-400">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {lookupError}
        </div>
      )}

      {/* Results */}
      {pd && (
        <div className="mt-3 border-t border-gray-700/50 pt-3">
          {/* Results header with close button */}
          <div className="flex items-start justify-between gap-2 mb-2.5">
            <a
              href={`https://www.bricklink.com/v2/catalog/catalogitem.page?P=${pd.itemNo}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-2.5 group/bllink min-w-0 flex-1"
              onClick={(e) => e.stopPropagation()}
              data-testid="link-bricklink-catalog"
            >
              {pd.thumbnailUrl ? (
                <img
                  src={pd.thumbnailUrl}
                  alt={pd.itemName || pd.itemNo}
                  className="w-12 h-12 object-contain rounded bg-gray-800 flex-shrink-0 group-hover/bllink:ring-1 group-hover/bllink:ring-blue-500/40 transition-all"
                />
              ) : (
                <div className="w-12 h-12 rounded bg-gray-800 flex-shrink-0 flex items-center justify-center group-hover/bllink:ring-1 group-hover/bllink:ring-blue-500/40 transition-all">
                  <Package className="w-5 h-5 text-gray-600" />
                </div>
              )}
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white leading-tight flex items-center gap-1 group-hover/bllink:text-blue-300 transition-colors">
                  <span className="truncate">{pd.itemName || "—"}</span>
                  <ExternalLink className="w-3 h-3 text-gray-600 group-hover/bllink:text-blue-400 flex-shrink-0 transition-colors" />
                </div>
                <div className="text-[11px] text-gray-500 font-mono mt-0.5">
                  #{pd.itemNo}
                  {colorId && colorId !== "none" && colors
                    ? ` · ${colors.find((c) => c.id.toString() === colorId)?.name ?? ""}`
                    : " · All Colors"}
                </div>
                {scanResult && (
                  <div className="text-[10px] text-purple-400 mt-0.5 flex items-center gap-1">
                    <Camera className="w-2.5 h-2.5" />
                    Photo ID · {scanResult.confidence}% confidence
                  </div>
                )}
              </div>
            </a>
            <button
              onClick={handleClose}
              className="text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0 mt-0.5"
              data-testid="button-spot-close"
              aria-label="Close results"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Inventory lots — grouped by color, N/U side-by-side matching filter card style */}
          <div className="max-h-[280px] overflow-y-auto pr-0.5 space-y-1">
            {lots.length > 0 ? (() => {
              const scoreColor = (s: number | null) => {
                if (s === null) return 'text-gray-600';
                if (s >= 2.0) return 'text-emerald-400';
                if (s >= 1.5) return 'text-orange-400';
                if (s >= 1.0) return 'text-yellow-500';
                return 'text-gray-500';
              };

              const LotPriceCell = ({ lot }: { lot: InventoryLot | undefined }) => {
                if (!lot) return <span className="text-[10px] text-gray-700 w-14 text-right flex-shrink-0">—</span>;
                const lotKey = `${lot.colorId ?? "null"}_${lot.newOrUsed}`;
                const fetchedEntry = pricingCache.get(lotKey) ?? null;
                const fetchedSugg = fetchedEntry?.suggestedPrice ?? null;
                return (
                  <div className="flex flex-col items-end w-14 flex-shrink-0">
                    <span className="text-[10px] font-mono text-gray-300 leading-tight">
                      {lot.unitPrice ? formatCurrency(lot.unitPrice) : "—"}
                    </span>
                    {fetchedSugg ? (
                      <span className="text-[9px] font-mono text-purple-400 leading-tight">
                        {formatCurrency(fetchedSugg)}
                      </span>
                    ) : null}
                  </div>
                );
              };

              // Group by colorId
              const colorGroups = new Map<string, { newLot?: InventoryLot; usedLot?: InventoryLot }>();
              lots.forEach(lot => {
                const key = String(lot.colorId ?? 'null');
                if (!colorGroups.has(key)) colorGroups.set(key, {});
                const g = colorGroups.get(key)!;
                if (lot.newOrUsed === 'N') g.newLot = lot;
                else g.usedLot = lot;
              });

              return (
                <>
                  {/* Column header — matches filter results */}
                  <div className="flex items-center gap-1 px-2 pb-0.5">
                    <div className="flex-1 min-w-0" />
                    <span className="text-[9px] uppercase tracking-wider text-gray-400 w-14 text-right flex-shrink-0">N Cur</span>
                    <span className="text-[9px] uppercase tracking-wider text-gray-400 rounded px-1.5 py-0.5 whitespace-nowrap flex-shrink-0">N Score</span>
                    <span className="text-[9px] uppercase tracking-wider text-gray-400 w-14 text-right flex-shrink-0">U Cur</span>
                    <span className="text-[9px] uppercase tracking-wider text-gray-400 rounded px-1.5 py-0.5 whitespace-nowrap flex-shrink-0">U Score</span>
                    <span className="w-5 flex-shrink-0" />
                  </div>

                  {Array.from(colorGroups.entries()).map(([colorKey, { newLot, usedLot }]) => {
                    const anyLot = newLot ?? usedLot!;
                    const totalQty = (newLot?.quantity ?? 0) + (usedLot?.quantity ?? 0);
                    const cachedPeakN = pricingCache.get(`${anyLot.colorId ?? 'null'}_N`)?.soldMaxPrice;
                    const cachedPeakU = pricingCache.get(`${anyLot.colorId ?? 'null'}_U`)?.soldMaxPrice;
                    const freshPeakN = cachedPeakN ? parseFloat(cachedPeakN) : 0;
                    const freshPeakU = cachedPeakU ? parseFloat(cachedPeakU) : 0;
                    const freshPeak = (freshPeakN > 0 || freshPeakU > 0) ? Math.max(freshPeakN, freshPeakU) : null;
                    const stalePeakStr = newLot?.marketPeakSoldPrice ?? usedLot?.marketPeakSoldPrice ?? null;
                    const peakStr = freshPeak != null ? freshPeak.toFixed(4) : stalePeakStr;
                    const peakIsFresh = freshPeak != null;
                    const nPrice = newLot?.unitPrice ? parseFloat(newLot.unitPrice) : 0;
                    const uPrice = usedLot?.unitPrice ? parseFloat(usedLot.unitPrice) : 0;
                    const nScore = freshPeak != null && nPrice > 0
                      ? Number((freshPeak / nPrice).toFixed(2))
                      : newLot?.opportunityScore ?? null;
                    const uScore = freshPeak != null && uPrice > 0
                      ? Number((freshPeak / uPrice).toFixed(2))
                      : usedLot?.opportunityScore ?? null;

                    return (
                      <div
                        key={colorKey}
                        className="bg-gray-900/50 border border-gray-700 rounded-lg px-2 py-1.5"
                      >
                        {/* Single row: left=color+peak flex-col, right=N/U pricing — mirrors filter results */}
                        <div className="flex items-center gap-1 min-w-0">
                          <div className="flex flex-col flex-1 min-w-0">
                            <div className="flex items-center gap-1 min-w-0">
                              {/* In-stock indicator */}
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" title="In your inventory" />
                              <span className="text-[10px] font-mono text-gray-300 flex-shrink-0">×{totalQty}</span>
                              {anyLot.colorRgb ? (
                                <span className="w-2 h-2 rounded-full flex-shrink-0 border border-gray-600" style={{ backgroundColor: `#${anyLot.colorRgb}` }} />
                              ) : (
                                <span className="w-2 h-2 rounded-full flex-shrink-0 bg-gray-600" />
                              )}
                              <span className="text-[10px] text-gray-300 truncate">{anyLot.colorName || '—'}</span>
                            </div>
                            {peakStr && (
                              <span className={`text-[9px] pl-0.5 ${peakIsFresh ? 'text-purple-400' : 'text-gray-400'}`}>
                                peak {formatCurrency(peakStr)}
                              </span>
                            )}
                          </div>
                          <LotPriceCell lot={newLot} />
                          <span className={`text-[10px] font-mono font-bold text-right flex-shrink-0 w-[58px] ${scoreColor(nScore)}`}>
                            {nScore != null ? `${nScore}×` : '—'}
                          </span>
                          <LotPriceCell lot={usedLot} />
                          <span className={`text-[10px] font-mono font-bold text-right flex-shrink-0 w-[58px] ${scoreColor(uScore)}`}>
                            {uScore != null ? `${uScore}×` : '—'}
                          </span>
                          {/* Pricing button */}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => {
                                  const lotsToPrice = [
                                    newLot ? { itemNo: result.priceData.itemNo, itemType: 'P', colorId: newLot.colorId, newOrUsed: 'N', key: `${newLot.colorId ?? 'null'}_N` } : null,
                                    usedLot ? { itemNo: result.priceData.itemNo, itemType: 'P', colorId: usedLot.colorId, newOrUsed: 'U', key: `${usedLot.colorId ?? 'null'}_U` } : null,
                                  ].filter(Boolean) as any[];
                                  fetchPricingMutation.mutate(lotsToPrice);
                                }}
                                disabled={[newLot, usedLot].some(l => l && pricingLoading.has(`${l.colorId ?? 'null'}_${l.newOrUsed}`))}
                                className="text-gray-600 hover:text-purple-400 disabled:text-gray-700 transition-colors flex-shrink-0"
                              >
                                <DollarSign className={`w-3 h-3 ${[newLot, usedLot].some(l => l && pricingLoading.has(`${l.colorId ?? 'null'}_${l.newOrUsed}`)) ? 'animate-pulse text-purple-400' : ''}`} />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="text-xs">Get suggested price</TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    );
                  })}
                </>
              );
            })() : (
              /* Not in inventory — still show market pricing from priceData for new listings */
              pd && (
                <>
                  {/* Column header */}
                  <div className="flex items-center gap-1 px-2 pb-0.5">
                    <div className="flex-1 min-w-0" />
                    <span className="text-[9px] uppercase tracking-wider text-gray-400 w-14 text-right flex-shrink-0">N Cur</span>
                    <span className="text-[9px] uppercase tracking-wider text-gray-400 rounded px-1.5 py-0.5 whitespace-nowrap flex-shrink-0">N Score</span>
                    <span className="text-[9px] uppercase tracking-wider text-gray-400 w-14 text-right flex-shrink-0">U Cur</span>
                    <span className="text-[9px] uppercase tracking-wider text-gray-400 rounded px-1.5 py-0.5 whitespace-nowrap flex-shrink-0">U Score</span>
                    <span className="w-5 flex-shrink-0" />
                  </div>
                  <div className="bg-gray-900/50 border border-gray-700/50 border-dashed rounded-lg px-2 py-1.5">
                    <div className="flex items-center gap-1 min-w-0">
                      <div className="flex flex-col flex-1 min-w-0">
                        <div className="flex items-center gap-1 min-w-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-gray-600 flex-shrink-0" title="Not in your inventory" />
                          <span className="text-[10px] text-gray-500 truncate">Not in inventory</span>
                        </div>
                        <span className="text-[9px] text-gray-600 pl-0.5">Click $ to get suggested price</span>
                      </div>
                      {/* N Cur + optional suggested */}
                      <div className="flex flex-col items-end w-14 flex-shrink-0">
                        <span className="text-[10px] font-mono text-gray-600 leading-tight">—</span>
                        {pricingCache.get('newlisting_N')?.suggestedPrice && (
                          <span className="text-[9px] font-mono text-purple-400 leading-tight">{formatCurrency(pricingCache.get('newlisting_N')!.suggestedPrice!)}</span>
                        )}
                      </div>
                      <span className="text-[10px] font-mono text-gray-700 text-right flex-shrink-0 w-[58px]">—</span>
                      <div className="flex flex-col items-end w-14 flex-shrink-0">
                        <span className="text-[10px] font-mono text-gray-600 leading-tight">—</span>
                      </div>
                      <span className="text-[10px] font-mono text-gray-700 text-right flex-shrink-0 w-[58px]">—</span>
                      {/* Pricing button */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => {
                              fetchPricingMutation.mutate([{
                                itemNo: pd.itemNo,
                                itemType: 'P',
                                colorId: colorId !== 'none' ? parseInt(colorId) : null,
                                newOrUsed: 'N',
                                key: 'newlisting_N',
                              }]);
                            }}
                            disabled={pricingLoading.has('newlisting_N')}
                            className="text-gray-600 hover:text-purple-400 disabled:text-gray-700 transition-colors flex-shrink-0"
                          >
                            <DollarSign className={`w-3 h-3 ${pricingLoading.has('newlisting_N') ? 'animate-pulse text-purple-400' : ''}`} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="text-xs">Get suggested price</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
