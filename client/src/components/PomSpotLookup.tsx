import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
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
import { Search, Package, RefreshCw, AlertCircle } from "lucide-react";

interface Color {
  id: number;
  name: string;
  rgb: string | null;
}

interface SpotLookupResult {
  priceData: {
    itemNo: string;
    itemName: string | null;
    thumbnailUrl: string | null;
    stockAvgPrice: string | null;
    soldAvgPrice: string | null;
    stockTotalLots: number | null;
    suggestedPrice: string;
    premiumPercentage: number;
  };
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
  const [newOrUsed, setNewOrUsed] = useState<"N" | "U">("N");
  const [result, setResult] = useState<SpotLookupResult | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const { data: colors } = useQuery<Color[]>({
    queryKey: ["/api/colors"],
  });

  const lookupMutation = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams({
        partNo: partNo.trim().toUpperCase(),
        itemType: "P",
        newOrUsed,
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
      }
    },
    onError: (err: Error) => {
      setLookupError(err.message);
      setResult(null);
    },
  });

  const handleLookup = () => {
    if (!partNo.trim()) return;
    lookupMutation.mutate();
  };

  const pd = result?.priceData;
  const lots = result?.inventoryLots ?? [];

  const sellerCount = Number(pd?.stockTotalLots ?? 0);
  const scarcityLabel =
    sellerCount < 5
      ? "Very Low"
      : sellerCount < 15
      ? "Low"
      : sellerCount < 50
      ? "Medium"
      : "Normal";
  const scarcityColor =
    sellerCount < 5
      ? "text-orange-300"
      : sellerCount < 15
      ? "text-yellow-300"
      : sellerCount < 50
      ? "text-blue-300"
      : "text-gray-400";

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
          className="text-sm w-36 font-mono"
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

        <div className="flex rounded-md overflow-hidden border border-gray-700 flex-shrink-0">
          <button
            onClick={() => setNewOrUsed("N")}
            className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
              newOrUsed === "N"
                ? "bg-purple-600 text-white"
                : "bg-gray-800 text-gray-400 hover:text-gray-200"
            }`}
            data-testid="toggle-spot-new"
          >
            New
          </button>
          <button
            onClick={() => setNewOrUsed("U")}
            className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
              newOrUsed === "U"
                ? "bg-purple-600 text-white"
                : "bg-gray-800 text-gray-400 hover:text-gray-200"
            }`}
            data-testid="toggle-spot-used"
          >
            Used
          </button>
        </div>

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
        <div className="mt-3 space-y-2 border-t border-gray-700/50 pt-3">
          {/* Part identity */}
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
                #{pd.itemNo} · {newOrUsed === "N" ? "New" : "Used"}
                {colorId && colorId !== "none" && colors
                  ? ` · ${colors.find((c) => c.id.toString() === colorId)?.name ?? ""}`
                  : " · All Colors"}
              </div>
            </div>
          </div>

          {/* Price data grid */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs bg-gray-800/40 rounded-md px-3 py-2.5">
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
              <span className="text-gray-400">Avg Sold</span>
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

          {/* Inventory lots */}
          {lots.length > 0 ? (
            <div className="text-xs">
              <div className="text-gray-500 mb-1.5 font-medium">
                In your inventory ({lots.length} lot{lots.length !== 1 ? "s" : ""}):
              </div>
              <div className="space-y-1">
                {lots.map((lot) => (
                  <div
                    key={lot.id}
                    className="flex items-center justify-between px-2 py-1.5 rounded bg-gray-800/40 border border-gray-700/30"
                  >
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {lot.colorRgb && (
                        <span
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: `#${lot.colorRgb}` }}
                        />
                      )}
                      <span className="text-gray-200">
                        {lot.colorName || "N/A"}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[9px] px-1 py-0 h-4 border-gray-600 text-gray-400"
                      >
                        {lot.newOrUsed === "N" ? "New" : "Used"}
                      </Badge>
                      <span className="text-gray-500">{lot.quantity} qty</span>
                    </div>
                    <span className="text-gray-200 font-mono font-medium">
                      {lot.unitPrice ? formatCurrency(lot.unitPrice) : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-gray-600 flex items-center gap-1.5">
              <Package className="w-3 h-3" />
              Not currently in your inventory
            </div>
          )}
        </div>
      )}
    </div>
  );
}
