import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Archive, MapPin, Package, Loader2, Boxes, Hash } from "lucide-react";
import PartImage from "@/components/PartImage";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
  lotQuantity: number;
  bagLabel: string | null;
  notes: string | null;
  binId: number;
}

export default function BinDetail({ data, onItemClick }: BinDetailProps) {
  const { binId } = data;
  const [lightbox, setLightbox] = useState<BinLocation | null>(null);

  const { data: items, isLoading } = useQuery<BinLocation[]>({
    queryKey: ['/api/warehouse/locations/bin', binId],
    enabled: !!binId,
  });

  const totalQty = items?.reduce((sum, l) => sum + (l.quantity || 0), 0) ?? 0;
  const lotCount = items?.length ?? 0;
  const locationParts = [data.aisleName, data.shelfName, data.name].filter(Boolean);

  return (
    <div className="flex flex-col h-full" data-testid="bin-detail">
      {/* Compact header card — matches InventoryDetail style */}
      <div className="flex-shrink-0 bg-gradient-to-r from-yellow-500/15 via-yellow-500/5 to-transparent border border-yellow-500/30 rounded-lg p-3 mb-3">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-16 h-16 bg-gray-900 rounded-lg border border-gray-700 flex items-center justify-center">
            <Archive className="w-8 h-8 text-yellow-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="text-sm font-black text-yellow-400 font-mono" data-testid="text-bin-name">
                {data.name ?? `BIN ${binId}`}
              </h3>
              <span className="text-[9px] font-bold font-mono px-1.5 py-0.5 rounded bg-gray-700/60 text-gray-400 uppercase">
                BIN
              </span>
            </div>
            {locationParts.length > 1 && (
              <div className="flex items-center gap-1 text-[10px] text-gray-400 mb-2">
                <MapPin className="h-2.5 w-2.5" />
                <span className="truncate">{locationParts.join(' › ')}</span>
              </div>
            )}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <Boxes className="h-3 w-3 text-gray-400" />
                <span className="text-[10px] text-gray-400">Lots:</span>
                <span className="text-xs font-black font-mono text-yellow-400" data-testid="text-bin-lot-count">{lotCount}</span>
              </div>
              <div className="flex items-center gap-1">
                <Hash className="h-3 w-3 text-gray-400" />
                <span className="text-[10px] text-gray-400">Qty:</span>
                <span className="text-xs font-black font-mono text-yellow-400" data-testid="text-bin-total-qty">{totalQty}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Items list */}
      <div className="flex-1 overflow-y-auto min-h-0 space-y-2">
        <div className="flex items-center justify-between mb-1 px-0.5">
          <p className="text-[10px] md:text-sm font-bold text-gray-400">ITEMS IN BIN</p>
          {!isLoading && items && (
            <span className="text-[10px] text-gray-500" data-testid="text-bin-items-count">
              {items.length} {items.length === 1 ? 'lot' : 'lots'}
            </span>
          )}
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-8 text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            <span className="text-xs">Loading items…</span>
          </div>
        )}

        {!isLoading && (!items || items.length === 0) && (
          <div className="app-card-muted p-4 flex flex-col items-center text-gray-500">
            <Package className="h-6 w-6 mb-1.5 opacity-50" />
            <p className="text-xs">This bin is empty</p>
            <p className="text-[10px] text-gray-600 mt-0.5">Scan a lot to file it in here</p>
          </div>
        )}

        {!isLoading && items && items.length > 0 && items.map((it) => (
          <div
            key={it.id}
            data-testid={`row-bin-item-${it.inventoryId}`}
            className="app-card-muted p-2 flex items-center gap-2"
          >
            {/* Image button — opens lightbox */}
            <button
              onClick={() => setLightbox(it)}
              data-testid={`button-bin-item-image-${it.inventoryId}`}
              title="Tap to enlarge"
              className="flex-shrink-0 w-12 h-12 bg-gray-900 rounded-md border border-gray-700 p-1 flex items-center justify-center cursor-zoom-in hover:border-gray-500 transition-colors"
            >
              <PartImage
                partNumber={it.itemNo}
                itemType={it.itemType}
                colorId={it.colorId}
                lotId={it.inventoryId}
                fallbackClassName="w-6 h-6 text-gray-600"
              />
            </button>

            {/* Tile body — opens inventory detail */}
            <button
              onClick={() => onItemClick?.('inventory', it.inventoryId)}
              disabled={!onItemClick}
              data-testid={`button-bin-item-${it.inventoryId}`}
              className="flex-1 min-w-0 text-left flex items-center gap-2 disabled:cursor-default"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-mono text-[11px] text-lego-blue font-black">{it.itemNo}</span>
                  <Badge
                    variant="outline"
                    className={`text-[9px] py-0 px-1.5 h-4 font-bold ${
                      it.newOrUsed === 'N'
                        ? 'border-lego-green/40 text-lego-green'
                        : 'border-lego-orange/40 text-lego-orange'
                    }`}
                  >
                    {it.newOrUsed === 'N' ? 'NEW' : 'USED'}
                  </Badge>
                  {it.colorName && (
                    <span className="text-[10px] text-gray-400 truncate">{it.colorName}</span>
                  )}
                </div>
                <p className="text-[11px] text-gray-300 truncate mt-0.5" title={it.itemName ?? ''}>
                  {it.itemName ?? it.itemNo}
                </p>
                {it.bagLabel && (
                  <p className="text-[10px] text-gray-500 truncate">Bag: {it.bagLabel}</p>
                )}
              </div>
              <div className="text-right shrink-0 pl-1">
                <p className="text-sm font-black font-mono text-lego-blue" data-testid={`text-bin-item-qty-${it.inventoryId}`}>
                  ×{it.quantity ?? 0}
                </p>
                <p className="text-[9px] text-gray-500 uppercase">in stock</p>
              </div>
            </button>
          </div>
        ))}
      </div>

      {/* Image lightbox */}
      <Dialog open={!!lightbox} onOpenChange={(o) => !o && setLightbox(null)}>
        <DialogContent className="max-w-sm p-4 flex flex-col items-center gap-3 bg-gray-950 border-gray-700">
          {lightbox && (
            <>
              <DialogHeader className="w-full">
                <DialogTitle className="text-sm font-mono text-lego-blue">{lightbox.itemNo}</DialogTitle>
              </DialogHeader>
              <div className="w-full aspect-square bg-gray-900 rounded-lg flex items-center justify-center p-4">
                <PartImage
                  partNumber={lightbox.itemNo}
                  itemType={lightbox.itemType}
                  colorId={lightbox.colorId}
                  lotId={lightbox.inventoryId}
                  className="w-full h-full object-contain"
                  fallbackClassName="w-24 h-24 text-gray-600"
                />
              </div>
              {lightbox.colorName && (
                <p className="text-xs text-gray-400">{lightbox.colorName}</p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
