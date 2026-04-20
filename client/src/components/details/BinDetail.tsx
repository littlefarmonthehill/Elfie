import { useQuery } from "@tanstack/react-query";
import { Archive, MapPin, Package, Loader2, Boxes, Sparkles, Hash } from "lucide-react";
import PartImage from "@/components/PartImage";
import { Badge } from "@/components/ui/badge";

interface BinDetailProps {
  data: {
    binId: number;
    name?: string | null;
    shelfName?: string | null;
    aisleName?: string | null;
    itemCount?: number;
  };
  onItemClick?: (type: 'order' | 'inventory', id: number | string) => void;
}

interface BinLocation {
  id: number;
  inventoryId: number;
  itemNo: string;
  itemType: string;
  itemName: string | null;
  colorId: number | null;
  colorName: string | null;
  newOrUsed: 'N' | 'U';
  unitPrice: string | null;
  quantity: number;
  bagLabel: string | null;
  notes: string | null;
  binId: number;
}

export default function BinDetail({ data, onItemClick }: BinDetailProps) {
  const { binId } = data;

  const { data: items, isLoading } = useQuery<BinLocation[]>({
    queryKey: ['/api/warehouse/locations/bin', binId],
    enabled: !!binId,
  });

  const totalQty = items?.reduce((sum, l) => sum + (l.quantity || 0), 0) ?? 0;
  const lotCount = items?.length ?? 0;

  const locationParts = [data.aisleName, data.shelfName, data.name].filter(Boolean);

  return (
    <div className="space-y-4 pb-6" data-testid="bin-detail">
      {/* Hero header — fun, branded warehouse vibe */}
      <div className="relative overflow-hidden rounded-xl border border-yellow-500/30 bg-gradient-to-br from-yellow-500/15 via-amber-500/5 to-orange-500/10 p-4">
        <div className="absolute -right-6 -top-6 opacity-10">
          <Archive className="h-32 w-32 text-yellow-400" />
        </div>
        <div className="relative flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-yellow-500/20 border border-yellow-500/40">
            <Archive className="h-6 w-6 text-yellow-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-yellow-400/80 font-semibold">
              <Sparkles className="h-3 w-3" />
              Bin
            </div>
            <h2 className="text-xl font-bold text-gray-100 mt-0.5 truncate" data-testid="text-bin-name">
              {data.name ?? `Bin ${binId}`}
            </h2>
            {locationParts.length > 1 && (
              <div className="flex items-center gap-1.5 text-xs text-gray-400 mt-1">
                <MapPin className="h-3 w-3" />
                <span className="truncate">{locationParts.join(' › ')}</span>
              </div>
            )}
          </div>
        </div>

        {/* Stat pills */}
        <div className="relative mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-md bg-gray-950/50 border border-gray-800/80 px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
              <Boxes className="h-3 w-3" /> Lots
            </div>
            <div className="text-lg font-bold text-gray-100 mt-0.5" data-testid="text-bin-lot-count">{lotCount}</div>
          </div>
          <div className="rounded-md bg-gray-950/50 border border-gray-800/80 px-3 py-2">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
              <Hash className="h-3 w-3" /> Total Qty
            </div>
            <div className="text-lg font-bold text-gray-100 mt-0.5" data-testid="text-bin-total-qty">{totalQty}</div>
          </div>
        </div>
      </div>

      {/* Items section */}
      <div>
        <div className="flex items-center justify-between mb-2 px-1">
          <h3 className="text-xs uppercase tracking-wider font-semibold text-gray-400">
            Items in this bin
          </h3>
          {!isLoading && items && (
            <span className="text-[11px] text-gray-500" data-testid="text-bin-items-count">
              {items.length} {items.length === 1 ? 'lot' : 'lots'}
            </span>
          )}
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-12 text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            <span className="text-sm">Loading items…</span>
          </div>
        )}

        {!isLoading && (!items || items.length === 0) && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500 border border-dashed border-gray-800 rounded-lg">
            <Package className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-sm">This bin is empty</p>
            <p className="text-[11px] text-gray-600 mt-1">Scan a lot to file it in here</p>
          </div>
        )}

        {!isLoading && items && items.length > 0 && (
          <div className="space-y-2">
            {items.map((it) => (
              <button
                key={it.id}
                onClick={() => onItemClick?.('inventory', it.inventoryId)}
                disabled={!onItemClick}
                data-testid={`row-bin-item-${it.inventoryId}`}
                className="w-full text-left rounded-lg border border-gray-800 bg-gray-900/40 p-3 flex items-center gap-3 hover-elevate active-elevate-2 disabled:cursor-default"
              >
                <div className="h-12 w-12 shrink-0 rounded-md overflow-hidden bg-gray-950 border border-gray-800 flex items-center justify-center">
                  <PartImage
                    partNumber={it.itemNo}
                    itemType={it.itemType}
                    colorId={it.colorId}
                    lotId={it.inventoryId}
                    className="h-full w-full object-contain"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-yellow-400/90 font-semibold">{it.itemNo}</span>
                    <Badge
                      variant="outline"
                      className={`text-[9px] py-0 px-1.5 h-4 ${
                        it.newOrUsed === 'N'
                          ? 'border-green-500/40 text-green-400'
                          : 'border-blue-500/40 text-blue-400'
                      }`}
                    >
                      {it.newOrUsed === 'N' ? 'New' : 'Used'}
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-200 truncate mt-0.5">
                    {it.itemName ?? it.itemNo}
                  </p>
                  <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-0.5">
                    {it.colorName && <span className="truncate">{it.colorName}</span>}
                    {it.bagLabel && (
                      <>
                        <span className="text-gray-700">•</span>
                        <span className="truncate">Bag: {it.bagLabel}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-base font-bold text-gray-100">×{it.quantity}</div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-500">in stock</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
