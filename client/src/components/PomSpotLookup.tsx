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
import { Search, Package, RefreshCw, AlertCircle, X, Camera } from "lucide-react";

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
        const partMatch = item.itemNo === searchPart;
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

  const sellerCount = Number(pd?.stockTotalLots ?? 0);
  const scarcityLabel =
    sellerCount < 5 ? "Very Low" : sellerCount < 15 ? "Low" : sellerCount < 50 ? "Medium" : "Normal";
  const scarcityColor =
    sellerCount < 5 ? "text-orange-300" : sellerCount < 15 ? "text-yellow-300" : sellerCount < 50 ? "text-blue-300" : "text-gray-400";

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
            <div className="flex items-start gap-2.5">
              {pd.thumbnailUrl ? (
                <img
                  src={pd.thumbnailUrl}
                  alt={pd.itemName || pd.itemNo}
                  className="w-12 h-12 object-contain rounded bg-gray-800 flex-shrink-0"
                />
              ) : (
                <div className="w-12 h-12 rounded bg-gray-800 flex-shrink-0 flex items-center justify-center">
                  <Package className="w-5 h-5 text-gray-600" />
                </div>
              )}
              <div>
                <div className="text-sm font-semibold text-white leading-tight">
                  {pd.itemName || "—"}
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
            </div>
            <button
              onClick={handleClose}
              className="text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0 mt-0.5"
              data-testid="button-spot-close"
              aria-label="Close results"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Price data grid for queried combo */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs bg-gray-800/40 rounded-md px-3 py-2.5 mb-3">
            <div className="flex justify-between gap-2">
              <span className="text-gray-400">Avg Listed</span>
              <span className="text-gray-200 font-mono">
                {pd.stockAvgPrice ? formatCurrency(pd.stockAvgPrice) : "—"}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-gray-400">Sellers</span>
              <span className={`font-mono ${scarcityColor}`}>
                {sellerCount > 0 ? `${sellerCount} · ${scarcityLabel}` : "—"}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-gray-400">Sold P85</span>
              <span className="text-gray-200 font-mono">
                {pd.soldAvgPrice ? formatCurrency(pd.soldAvgPrice) : "—"}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-gray-400">Suggested</span>
              <span className="text-green-400 font-mono font-semibold">
                {formatCurrency(pd.suggestedPrice)}
              </span>
            </div>
          </div>

          {/* Inventory lots — stacked price + score, matching filter results style */}
          <div className="max-h-[280px] overflow-y-auto pr-0.5 space-y-1">
            {lots.length > 0 ? (
              <>
                {/* Column header */}
                <div className="flex items-center gap-1 px-1 pb-0.5">
                  <span className="text-[9px] uppercase tracking-wider text-gray-600 flex-1 min-w-0">Qty · Color · Peak sold</span>
                  <span className="text-[9px] uppercase tracking-wider text-gray-700 w-14 text-right flex-shrink-0">Cur / Sugg</span>
                  <span className="text-[9px] uppercase tracking-wider text-gray-700 w-12 text-right flex-shrink-0">Score</span>
                </div>

                {lots.map((lot) => {
                  const lotKey = `${lot.colorId ?? "null"}_${lot.newOrUsed}`;
                  const lotPd = lotPriceData[lotKey];
                  const suggestedPrice = lot.suggestedPrice ?? lotPd?.suggestedPrice ?? null;
                  const score = lot.opportunityScore ?? null;
                  const peakStr = lot.marketPeakSoldPrice;

                  const scoreColor = (s: number | null) => {
                    if (s === null) return 'text-gray-600';
                    if (s >= 2.0) return 'text-emerald-400';
                    if (s >= 1.5) return 'text-orange-400';
                    if (s >= 1.0) return 'text-yellow-500';
                    return 'text-gray-500';
                  };

                  return (
                    <div
                      key={lot.id}
                      className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-gray-800/50 border border-gray-700/30"
                    >
                      {/* Left: qty · color swatch + name · condition · peak */}
                      <div className="flex items-center gap-1 flex-1 min-w-0">
                        <span className="text-[10px] font-mono text-gray-500 flex-shrink-0">×{lot.quantity}</span>
                        {lot.colorRgb ? (
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0 border border-gray-600"
                            style={{ backgroundColor: `#${lot.colorRgb}` }}
                          />
                        ) : (
                          <span className="w-2 h-2 rounded-full flex-shrink-0 bg-gray-600" />
                        )}
                        <span className="text-[10px] text-gray-300 truncate">{lot.colorName || "N/A"}</span>
                        <span className={`text-[9px] font-mono flex-shrink-0 px-1 rounded ${lot.newOrUsed === 'N' ? 'text-blue-400 bg-blue-500/10' : 'text-amber-400 bg-amber-500/10'}`}>
                          {lot.newOrUsed === 'N' ? 'N' : 'U'}
                        </span>
                        {peakStr && (
                          <span className="text-[9px] text-gray-600 flex-shrink-0 truncate">
                            · peak {formatCurrency(peakStr)}
                          </span>
                        )}
                      </div>

                      {/* Stacked: current / suggested */}
                      <div className="flex flex-col items-end w-14 flex-shrink-0">
                        <span className="text-[10px] font-mono text-gray-300 leading-tight">
                          {lot.unitPrice ? formatCurrency(lot.unitPrice) : "—"}
                        </span>
                        {suggestedPrice ? (
                          <span className="text-[9px] font-mono text-purple-400 leading-tight">
                            {formatCurrency(suggestedPrice)}
                            {lot.floorApplied === 'cost' && <span className="text-emerald-500 ml-0.5">↑</span>}
                            {lot.floorApplied === 'min' && <span className="text-blue-400 ml-0.5">↑</span>}
                          </span>
                        ) : lotPd === undefined ? (
                          <RefreshCw className="w-2.5 h-2.5 text-gray-600 animate-spin mt-0.5" />
                        ) : (
                          <span className="text-[9px] text-gray-700">—</span>
                        )}
                      </div>

                      {/* Score */}
                      <span className={`text-[10px] font-mono font-bold w-12 text-right flex-shrink-0 ${scoreColor(score)}`}>
                        {score != null ? `${score}×` : '—'}
                      </span>
                    </div>
                  );
                })}
              </>
            ) : (
              <div className="text-[11px] text-gray-600 flex items-center gap-1.5">
                <Package className="w-3 h-3" />
                Not currently in your inventory
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
