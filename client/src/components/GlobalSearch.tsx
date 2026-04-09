import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Package, ShoppingCart, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface InventoryResult {
  id: number;
  itemNo: string;
  description: string | null;
  remarks: string | null;
  colorName: string | null;
  newOrUsed: string;
  quantity: number;
  unitPrice: string | null;
}

interface OrderResult {
  id: string;
  orderNumber: string;
  customerUsername: string | null;
  customerEmail: string | null;
  shipTo: string;
  orderTotal: string;
  orderStatus: string;
  marketplace: string | null;
  orderDate: string;
}

interface SearchResults {
  inventory: InventoryResult[];
  orders: OrderResult[];
}

interface GlobalSearchProps {
  open: boolean;
  onClose: () => void;
  onSelect: (type: 'inventory' | 'order', id: number | string) => void;
}

function shipToName(shipTo: string): string {
  try {
    const parsed = JSON.parse(shipTo);
    const parts = [parsed.name, parsed.company].filter(Boolean);
    return parts[0] || shipTo;
  } catch {
    return shipTo;
  }
}

export default function GlobalSearch({ open, onClose, onSelect }: GlobalSearchProps) {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setDebouncedQ('');
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 200);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isFetching } = useQuery<SearchResults>({
    queryKey: ['/api/search', debouncedQ],
    queryFn: async () => {
      if (debouncedQ.length < 2) return { inventory: [], orders: [] };
      const res = await fetch(`/api/search?q=${encodeURIComponent(debouncedQ)}`);
      return res.json();
    },
    enabled: debouncedQ.length >= 2,
    staleTime: 0,
  });

  const hasResults = (data?.inventory?.length ?? 0) + (data?.orders?.length ?? 0) > 0;
  const showEmpty = debouncedQ.length >= 2 && !isFetching && !hasResults;

  const handleSelect = (type: 'inventory' | 'order', id: number | string) => {
    onClose();
    onSelect(type, id);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Panel — slides down from top */}
      <div className="relative z-10 w-full max-w-lg mx-auto mt-[env(safe-area-inset-top,0px)]">
        <div className="m-3 rounded-xl bg-gray-900 border border-white/10 shadow-2xl overflow-hidden">

          {/* Search input row */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/8">
            <Search className="h-4 w-4 text-gray-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search lots, part #, color, order #, customer…"
              className="flex-1 bg-transparent text-sm text-gray-100 placeholder:text-gray-500 outline-none"
              data-testid="input-global-search"
              onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
            />
            {q && (
              <button onClick={() => setQ('')} className="text-gray-500 hover:text-gray-300">
                <X className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-300 text-xs border border-white/10 rounded px-1.5 py-0.5"
            >
              Esc
            </button>
          </div>

          {/* Results */}
          <div className="max-h-[60vh] overflow-y-auto">

            {/* Inventory results */}
            {(data?.inventory?.length ?? 0) > 0 && (
              <div>
                <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-500 flex items-center gap-1.5">
                  <Package className="h-3 w-3" /> Inventory
                </p>
                {data!.inventory.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleSelect('inventory', item.id)}
                    className="w-full flex items-start gap-3 px-3 py-2 hover:bg-white/5 transition-colors text-left"
                    data-testid={`search-result-inventory-${item.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono font-semibold text-lego-yellow">#{item.id}</span>
                        <span className="text-xs font-medium text-gray-200">{item.itemNo}</span>
                        {item.colorName && (
                          <span className="text-xs text-gray-400">{item.colorName}</span>
                        )}
                        <span className={cn(
                          "text-[10px] font-semibold px-1 rounded",
                          item.newOrUsed === 'N' ? "bg-blue-500/20 text-blue-300" : "bg-amber-500/20 text-amber-300"
                        )}>
                          {item.newOrUsed === 'N' ? 'New' : 'Used'}
                        </span>
                      </div>
                      {(item.description || item.remarks) && (
                        <p className="text-xs text-gray-500 truncate mt-0.5">
                          {item.description || item.remarks}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-gray-300">Qty {item.quantity}</p>
                      {item.unitPrice && (
                        <p className="text-xs text-gray-500">${parseFloat(item.unitPrice).toFixed(2)}</p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Orders results */}
            {(data?.orders?.length ?? 0) > 0 && (
              <div className={cn((data?.inventory?.length ?? 0) > 0 && "border-t border-white/6")}>
                <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-500 flex items-center gap-1.5">
                  <ShoppingCart className="h-3 w-3" /> Orders
                </p>
                {data!.orders.map((order) => (
                  <button
                    key={order.id}
                    onClick={() => handleSelect('order', order.id)}
                    className="w-full flex items-start gap-3 px-3 py-2 hover:bg-white/5 transition-colors text-left"
                    data-testid={`search-result-order-${order.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono font-semibold text-lego-blue">#{order.orderNumber}</span>
                        <span className="text-xs text-gray-300">{order.customerUsername || shipToName(order.shipTo)}</span>
                        {order.marketplace && (
                          <span className="text-[10px] text-gray-500">{order.marketplace}</span>
                        )}
                      </div>
                      {order.customerEmail && (
                        <p className="text-xs text-gray-500 truncate mt-0.5">{order.customerEmail}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-gray-300">${parseFloat(order.orderTotal).toFixed(2)}</p>
                      <p className="text-[10px] text-gray-500 capitalize">{order.orderStatus.toLowerCase().replace(/_/g, ' ')}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Loading */}
            {isFetching && debouncedQ.length >= 2 && (
              <div className="px-3 py-4 text-xs text-gray-500 text-center">Searching…</div>
            )}

            {/* Empty */}
            {showEmpty && (
              <div className="px-3 py-6 text-center">
                <p className="text-sm text-gray-500">No results for <span className="text-gray-300">"{debouncedQ}"</span></p>
                <p className="text-xs text-gray-600 mt-1">Try a part number, lot ID, color, order number, or customer name</p>
              </div>
            )}

            {/* Prompt */}
            {debouncedQ.length < 2 && q.length === 0 && (
              <div className="px-3 py-5 text-center">
                <p className="text-xs text-gray-600">Type at least 2 characters to search</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
