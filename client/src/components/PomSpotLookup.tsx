import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Package, RefreshCw, AlertCircle, X, TrendingUp, TrendingDown, CheckCircle } from "lucide-react";

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

interface SpotLookupResult {
  priceData: LotPriceEntry;
  lotPriceData: Record<string, LotPriceEntry>;
  thresholds: { tooHigh: number; tooLow: number };
  inventoryLots: Array<{
    id: number;
    colorId: number | null;
    colorName: string | null;
    colorRgb: string | null;
    quantity: number;
    unitPrice: string | null;
    newOrUsed: string;
  }>;
}

interface PomSpotLookupProps {
  formatCurrency: (v: string | number) => string;
}

export function PomSpotLookup({ formatCurrency }: PomSpotLookupProps) {
  const [partNo, setPartNo] = useState("");
  const [colorId, setColorId] = useState<string>("none");
  const [result, setResult] = useState<SpotLookupResult | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const { data: colors } = useQuery<Color[]>({
    queryKey: ["/api/colors"],
  });

  const invalidateDashboard = () => {
    queryClient.refetchQueries({ queryKey: ['/api/priceomatic/insights'] });
    queryClient.refetchQueries({ queryKey: ['/api/priceomatic/freshness'] });
  };

  const lookupMutation = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams({
        partNo: partNo.trim().toUpperCase(),
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
        if (data?.inventoryLots?.length > 0) {
          invalidateDashboard();
        }
      }
    },
    onError: (err: Error) => {
      setLookupError(err.message);
      setResult(null);
    },
  });

  const handleLookup = () => {
    if (!partNo.trim()) return;

    const searchPart = partNo.trim().toUpperCase();
    const searchColorId = colorId !== "none" ? parseInt(colorId) : null;

    // Check the already-loaded insights cache before hitting the API
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
        // Build lotPriceData from cached insights — one entry per (colorId, newOrUsed) combo
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

        // priceData for the header: prefer the selected color, else use first match
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

        // inventoryLots from matched insight items
        const inventoryLots = matches.map((m) => ({
          id: m.inventoryId,
          colorId: m.colorId,
          colorName: m.colorName,
          colorRgb: colors?.find((c: Color) => c.id === m.colorId)?.rgb ?? null,
          quantity: m.quantity,
          unitPrice: m.currentPrice,
          newOrUsed: m.newOrUsed,
        }));

        // Thresholds from settings cache
        const settingsCache = queryClient.getQueryData<any>(['/api/settings']);
        const thresholds = {
          tooHigh: settingsCache?.pomTooHighThreshold ?? 20,
          tooLow: settingsCache?.pomTooLowThreshold ?? 20,
        };

        setResult({ priceData, lotPriceData, inventoryLots, thresholds });
        setLookupError(null);
        return; // Skip the API call entirely
      }
    }

    // No cached insights found — fall back to the API
    lookupMutation.mutate();
  };

  const handleClose = () => {
    if (result?.inventoryLots?.length) {
      invalidateDashboard();
    }
    setResult(null);
    setLookupError(null);
  };

  const pd = result?.priceData;
  const lots = result?.inventoryLots ?? [];
  const lotPriceData = result?.lotPriceData ?? {};
  const thresholds = result?.thresholds ?? { tooHigh: 25, tooLow: 25 };

  const sellerCount = Number(pd?.stockTotalLots ?? 0);
  const scarcityLabel =
    sellerCount < 5 ? "Very Low" : sellerCount < 15 ? "Low" : sellerCount < 50 ? "Medium" : "Normal";
  const scarcityColor =
    sellerCount < 5 ? "text-orange-300" : sellerCount < 15 ? "text-yellow-300" : sellerCount < 50 ? "text-blue-300" : "text-gray-400";

  const getPricingStatus = (currentPrice: string | null, suggestedPrice: string) => {
    const current = currentPrice ? parseFloat(currentPrice) : 0;
    const suggested = parseFloat(suggestedPrice);
    if (!current || !suggested) return null;
    const variancePct = ((current - suggested) / suggested) * 100;
    if (variancePct > thresholds.tooHigh) return "too-high";
    if (variancePct < -thresholds.tooLow) return "too-low";
    return "good";
  };

  return (
    <div className="bg-gray-900/60 border border-purple-500/20 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2.5">
        <Search className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
        <h3 className="text-xs font-semibold text-purple-300 uppercase tracking-wide">
          Spot Price Lookup
        </h3>
        <span className="text-[10px] text-gray-500 hidden sm:inline">
          any part, in or out of inventory
        </span>
      </div>

      {/* Search controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Part # (e.g. 3001)"
          value={partNo}
          onChange={(e) => setPartNo(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleLookup()}
          className="text-[16px] w-36 font-mono"
          data-testid="input-spot-partno"
        />

        <Select value={colorId} onValueChange={setColorId}>
          <SelectTrigger className="w-36 text-sm" data-testid="select-spot-color">
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
          onClick={handleLookup}
          disabled={!partNo.trim() || lookupMutation.isPending}
          className="bg-purple-600 hover:bg-purple-500 text-white flex-shrink-0"
          data-testid="button-spot-lookup"
        >
          {lookupMutation.isPending ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Search className="w-3.5 h-3.5" />
          )}
          <span className="ml-1.5">Look Up</span>
        </Button>
      </div>

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

          {/* Inventory lots with per-color suggested prices */}
          <div className="max-h-[220px] overflow-y-auto pr-0.5 space-y-1">
            {lots.length > 0 ? (
              <>
                <div className="text-[10px] text-gray-500 font-medium uppercase tracking-wide mb-1.5">
                  Your inventory ({lots.length} lot{lots.length !== 1 ? "s" : ""})
                </div>
                {lots.map((lot) => {
                  const lotKey = `${lot.colorId ?? "null"}_${lot.newOrUsed}`;
                  const lotPd = lotPriceData[lotKey];
                  const suggestedPrice = lotPd?.suggestedPrice;
                  const status = suggestedPrice ? getPricingStatus(lot.unitPrice, suggestedPrice) : null;

                  return (
                    <div
                      key={lot.id}
                      className="flex items-center justify-between gap-2 px-2.5 py-2 rounded bg-gray-800/50 border border-gray-700/30"
                    >
                      {/* Color + condition */}
                      <div className="flex items-center gap-1.5 min-w-0">
                        {lot.colorRgb ? (
                          <span
                            className="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-gray-600"
                            style={{ backgroundColor: `#${lot.colorRgb}` }}
                          />
                        ) : (
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-gray-600" />
                        )}
                        <span className="text-xs text-gray-200 truncate">{lot.colorName || "N/A"}</span>
                        <span className="text-[10px] text-gray-500 flex-shrink-0">
                          {lot.quantity}×
                        </span>
                      </div>

                      {/* Prices + status */}
                      <div className="flex items-center gap-2 flex-shrink-0 text-xs font-mono">
                        <span className="text-gray-300">
                          {lot.unitPrice ? formatCurrency(lot.unitPrice) : "—"}
                        </span>
                        {suggestedPrice && (
                          <>
                            <span className="text-gray-600">→</span>
                            <span className="text-green-400 font-semibold">
                              {formatCurrency(suggestedPrice)}
                            </span>
                            {status === "too-high" && (
                              <TrendingDown className="w-3 h-3 text-red-400 flex-shrink-0" />
                            )}
                            {status === "too-low" && (
                              <TrendingUp className="w-3 h-3 text-yellow-400 flex-shrink-0" />
                            )}
                            {status === "good" && (
                              <CheckCircle className="w-3 h-3 text-green-500 flex-shrink-0" />
                            )}
                          </>
                        )}
                        {!suggestedPrice && lotPd === undefined && (
                          <RefreshCw className="w-3 h-3 text-gray-600 animate-spin flex-shrink-0" />
                        )}
                      </div>
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
