import { useState, useEffect } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Package, Search, X, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type BrowseType = 'lots' | 'parts' | 'categories';

interface InventoryBrowsePanelProps {
  type: BrowseType;
  onItemClick?: (type: 'order' | 'inventory', id: number | string) => void;
}

export default function InventoryBrowsePanel({ type, onItemClick }: InventoryBrowsePanelProps) {
  const [page, setPage] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => { setPage(0); }, [search, type]);

  const { data, isLoading, isFetching } = useQuery<{ rows: any[]; total: number; page: number; limit: number }>({
    queryKey: ['/api/inventory/browse', type, page, search],
    queryFn: () => {
      const params = new URLSearchParams({ type, page: String(page), search });
      return fetch(`/api/inventory/browse?${params}`).then(r => r.json());
    },
    staleTime: 30000,
    placeholderData: keepPreviousData,
  });

  const title = type === 'lots' ? 'Inventory Lots' : type === 'parts' ? 'Parts by Quantity' : 'Categories';

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 px-4 pt-3 pb-2 border-b border-white/10 flex items-center gap-2">
        <Package className="w-4 h-4 text-blue-400 flex-shrink-0" />
        <span className="text-sm font-semibold text-gray-100 flex-1">{title}</span>
        {data && <span className="text-xs text-gray-500">{data.total.toLocaleString()} total</span>}
      </div>

      <div className="flex-shrink-0 px-4 pt-3 pb-2">
        <div className="relative">
          {isFetching
            ? <Loader2 className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 animate-spin pointer-events-none" />
            : <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
          }
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={type === 'categories' ? 'Search categories…' : 'Search by lot ID, part #, name, or color…'}
            className="pl-8 pr-8 text-xs h-9 bg-gray-900 border-gray-700"
            data-testid="input-browse-search"
          />
          {searchInput && (
            <button onClick={() => setSearchInput('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-2 min-h-0">
        {!data && isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          </div>
        ) : data && data.rows.length === 0 ? (
          <div className="py-12 text-center text-gray-500 text-sm">No results found</div>
        ) : type === 'categories' ? (
          <div className="divide-y divide-gray-800">
            {data?.rows.map((row: any, i: number) => (
              <div key={row.categoryId ?? i} className="flex items-center justify-between py-2.5" data-testid={`row-category-${row.categoryId}`}>
                <span className="text-xs text-gray-200">{row.categoryName ?? 'Uncategorized'}</span>
                <div className="flex items-center gap-3 text-right">
                  <span className="text-[10px] text-gray-500">{Number(row.lotCount).toLocaleString()} lots</span>
                  <span className="text-xs font-mono text-blue-300 min-w-[3rem] text-right">{Number(row.totalQty).toLocaleString()} pcs</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-gray-800">
            {data?.rows.map((row: any) => (
              <div
                key={row.id}
                className="flex items-center gap-3 py-2.5 cursor-pointer hover-elevate rounded-md"
                data-testid={`row-lot-${row.id}`}
                onClick={() => onItemClick?.('inventory', row.id)}
              >
                {row.colorRgb && (
                  <div className="w-3 h-3 rounded-full flex-shrink-0 ring-1 ring-gray-600" style={{ backgroundColor: `#${row.colorRgb}` }} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-mono text-gray-300">{row.itemNo}</span>
                    {row.newOrUsed === 'U' && <span className="text-[9px] px-1 py-0 rounded bg-yellow-900/40 text-yellow-400 border border-yellow-700/30">Used</span>}
                    {row.alternateOf && <span className="text-[9px] px-1 py-0 rounded bg-purple-900/40 text-purple-300 border border-purple-700/30" title={`Alternate of ${row.alternateOf}`}>Alt</span>}
                    <span className="text-[9px] font-mono text-gray-600">#{row.id}</span>
                  </div>
                  <div className="text-[10px] text-gray-500 truncate">{row.itemName ?? row.colorName ?? ''}{row.itemName && row.colorName ? ` · ${row.colorName}` : ''}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-xs font-mono text-blue-300">{Number(row.quantity).toLocaleString()}</div>
                  {row.unitPrice && <div className="text-[10px] text-gray-500">${Number(row.unitPrice).toFixed(3)}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {data && data.total > data.limit && (
        <div className="flex-shrink-0 border-t border-gray-800 px-4 py-3 flex items-center justify-between">
          <span className="text-xs text-gray-500">
            {(page * 100 + 1).toLocaleString()}–{Math.min((page + 1) * 100, data.total).toLocaleString()} of {data.total.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            <Button size="icon" variant="ghost" disabled={page === 0} onClick={() => setPage(p => p - 1)} data-testid="button-browse-prev">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button size="icon" variant="ghost" disabled={(page + 1) * 100 >= data.total} onClick={() => setPage(p => p + 1)} data-testid="button-browse-next">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
