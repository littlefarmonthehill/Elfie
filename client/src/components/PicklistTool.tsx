import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Package, Loader2, List, Layers, Printer, Trash2 } from "lucide-react";

type WarehouseLocation = {
  aisle: { id: number; name: string };
  shelf: { id: number; name: string };
  bin: { id: number; name: string; description: string | null };
};

type BinPicklistItem = {
  picklistItemId: string;
  orderDetailId: string;
  orderId: string;
  orderNumber: string;
  itemName: string;
  quantity: number;
  sku: string;
  partNumber: string | null;
  colorName: string | null;
  condition: string | null;
  pulled: boolean;
};

type BinPicklist = {
  binId: number | null;
  warehouseLocation: WarehouseLocation | null;
  itemCount: number;
  items: BinPicklistItem[];
  pulled: boolean;
};

type ViewMode = 'by_part' | 'by_bin';
type Filter = 'all' | 'to_pull';

interface PicklistToolProps {
  filterOrderIds?: Set<string>;
}

// ── Shared mutation options factory for picklist optimistic updates ──────────
// Each mutation only differs in its endpoint and cache updater;
// onMutate / onError / onSettled are identical across all four.
function picklistMutationOptions<TVariables>(
  mutationFn: (vars: TVariables) => Promise<any>,
  optimisticUpdate: (cache: any[], vars: TVariables) => any[],
  getFilter: () => Filter,
) {
  return {
    mutationFn,
    onMutate: async (vars: TVariables) => {
      await queryClient.cancelQueries({ queryKey: ['/api/picklist'] });
      const f = getFilter();
      const prev = queryClient.getQueryData(['/api/picklist', f]);
      queryClient.setQueryData(['/api/picklist', f], (old: any) =>
        optimisticUpdate(old ?? [], vars)
      );
      return { prev, f };
    },
    onError: (_e: any, _v: any, ctx: any) => {
      if (ctx?.prev) queryClient.setQueryData(['/api/picklist', ctx.f], ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/picklist'] });
      queryClient.invalidateQueries({ queryKey: ['/api/picklist/stats'] });
    },
  };
}

export default function PicklistTool({ filterOrderIds }: PicklistToolProps = {}) {
  const [viewMode, setViewMode] = useState<ViewMode>('by_part');
  const [filter, setFilter] = useState<Filter>('all');

  const { data: picklistData = [], isLoading } = useQuery<BinPicklist[]>({
    queryKey: ['/api/picklist', filter],
    queryFn: async () => {
      const params = filter !== 'all' ? `?filter=${filter}` : '';
      const response = await fetch(`/api/picklist${params}`);
      if (!response.ok) throw new Error('Failed to fetch picklist');
      return response.json();
    },
  });

  // Options factory closes over current `filter` on each render (TanStack Query v5 observes options)
  const getFilter = () => filter;

  // ── Bin-level pull mutation ──
  const pullBinMutation = useMutation(picklistMutationOptions(
    ({ binId, pulled }: { binId: number; pulled: boolean }) =>
      apiRequest('PUT', `/api/picklist/bin/${binId}/pull`, { pulled }),
    (old, { binId, pulled }) => old.map((b: any) => b.binId === binId ? { ...b, pulled } : b),
    getFilter,
  ));

  // ── Item-level pull mutation ──
  const pullItemMutation = useMutation(picklistMutationOptions(
    ({ itemId, pulled }: { itemId: string; pulled: boolean }) =>
      apiRequest('PUT', `/api/picklist/item/${itemId}/pull`, { pulled }),
    (old, { itemId, pulled }) =>
      old.map((bin: any) => ({
        ...bin,
        items: bin.items.map((it: any) =>
          it.picklistItemId === itemId ? { ...it, pulled } : it
        ),
      })),
    getFilter,
  ));

  // ── Clear shipped orders from picklist ──
  const clearMutation = useMutation({
    mutationFn: () => apiRequest('DELETE', '/api/picklist/shipped'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/picklist'] });
      queryClient.invalidateQueries({ queryKey: ['/api/picklist/stats'] });
    },
  });

  const partKey = (item: BinPicklistItem) => item.partNumber || item.sku || '';

  const handlePrint = () => {
    const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const filterLabel = filter === 'to_pull' ? 'To Pull' : 'All Items';

    let body = '';

    if (viewMode === 'by_part') {
      // Group by part number
      const partGroups: Map<string, BinPicklistItem[]> = new Map();
      for (const item of flatItems) {
        const key = partKey(item);
        if (!partGroups.has(key)) partGroups.set(key, []);
        partGroups.get(key)!.push(item);
      }
      body = Array.from(partGroups.entries()).map(([, variants]) => {
        const rep = variants[0];
        const variantRows = variants.map(v => {
          const meta = [
            `Qty ${v.quantity}`,
            v.orderNumber,
            v.colorName,
            v.condition === 'N' ? 'New' : v.condition === 'U' ? 'Used' : v.condition,
          ].filter(Boolean).join(' · ');
          return `<tr><td class="spacer"></td><td class="meta" colspan="2">${meta}</td><td class="cb"></td></tr>`;
        }).join('');
        return `
          <tr class="part-header">
            <td class="cb">☐</td>
            <td class="part-no">${rep.partNumber || rep.sku}</td>
            <td class="part-name">${rep.itemName || ''}</td>
            <td class="cb">☐</td>
          </tr>
          ${variantRows}`;
      }).join('');
    } else {
      // By shelf/bin
      for (const [aisle, shelves] of Object.entries(groupedBins).sort(([a], [b]) => b.localeCompare(a))) {
        body += `<tr class="aisle-header"><td colspan="3">${aisle}</td></tr>`;
        for (const [shelf, bins] of Object.entries(shelves)) {
          body += `<tr class="shelf-header"><td colspan="3">${shelf}</td></tr>`;
          for (const bin of bins) {
            const binName = bin.warehouseLocation?.bin.name || 'Unassigned';
            const sortedItems = [...bin.items].sort((a, b) => partKey(a).localeCompare(partKey(b), undefined, { numeric: true }));
            const itemRows = sortedItems.map(item => {
              const meta = [
                `Qty ${item.quantity}`,
                item.orderNumber,
                item.colorName,
                item.condition === 'N' ? 'New' : item.condition === 'U' ? 'Used' : item.condition,
              ].filter(Boolean).join(' · ');
              return `<tr><td class="cb">☐</td><td class="part-no">${item.partNumber || item.sku}</td><td class="part-name">${item.itemName || ''}<span class="meta"> — ${meta}</span></td><td class="cb"></td></tr>`;
            }).join('');
            body += `<tr class="bin-header"><td class="cb">☐</td><td colspan="2">${binName}</td></tr>${itemRows}`;
          }
        }
      }
    }

    const html = `<!DOCTYPE html><html><head><title>Picklist — ${date}</title>
<style>
  body { font-family: monospace; font-size: 11px; margin: 16px; color: #000; }
  h2 { font-size: 14px; margin: 0 0 4px; }
  .sub { font-size: 10px; color: #555; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 2px 4px; vertical-align: top; }
  .cb { width: 18px; text-align: center; font-size: 13px; }
  .spacer { width: 22px; }
  .part-no { width: 70px; font-weight: bold; white-space: nowrap; }
  .part-name { }
  .meta { color: #555; font-size: 10px; }
  .part-header td { padding-top: 6px; border-top: 1px solid #ddd; }
  .aisle-header td { background: #333; color: #fff; font-weight: bold; padding: 3px 6px; font-size: 12px; }
  .shelf-header td { background: #ccc; font-weight: bold; padding: 2px 6px; }
  .bin-header td { background: #eee; font-weight: bold; padding: 2px 6px; border-top: 1px solid #bbb; }
  @media print { @page { margin: 0.5in; } }
</style></head><body>
<h2>PlanetBrick Picklist</h2>
<div class="sub">${date} &nbsp;·&nbsp; ${filterLabel} &nbsp;·&nbsp; ${viewMode === 'by_part' ? 'By Part Number' : 'By Shelf / Bin'}</div>
<table>
  <thead><tr>
    <th class="cb" style="text-align:left">Pull</th>
    <th style="text-align:left">Part</th>
    <th style="text-align:left">Item</th>
  </tr></thead>
  <tbody>${body}</tbody>
</table>
</body></html>`;

    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
      w.addEventListener('afterprint', () => w.close());
      w.print();
    }
  };

  // ── Derived data ──
  // Apply order filter when orders are selected in the tiles
  const filteredPicklistData: BinPicklist[] =
    filterOrderIds && filterOrderIds.size > 0
      ? picklistData
          .map(bin => ({ ...bin, items: bin.items.filter(item => filterOrderIds.has(item.orderId)) }))
          .filter(bin => bin.items.length > 0)
      : picklistData;

  const flatItems: BinPicklistItem[] = filteredPicklistData
    .flatMap(bin => bin.items)
    .sort((a, b) => partKey(a).localeCompare(partKey(b), undefined, { numeric: true }));

  const groupedBins = filteredPicklistData.reduce((acc, bin) => {
    const aisleKey = bin.warehouseLocation?.aisle.name || 'No Location';
    const shelfKey = bin.warehouseLocation?.shelf.name || 'No Shelf';
    if (!acc[aisleKey]) acc[aisleKey] = {};
    if (!acc[aisleKey][shelfKey]) acc[aisleKey][shelfKey] = [];
    acc[aisleKey][shelfKey].push(bin);
    return acc;
  }, {} as Record<string, Record<string, BinPicklist[]>>);

  const sortedAisles = Object.keys(groupedBins).sort((a, b) => b.localeCompare(a));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
      </div>
    );
  }

  const isEmpty = viewMode === 'by_part' ? flatItems.length === 0 : sortedAisles.length === 0;

  return (
    <div className="space-y-4">

      {/* ── Controls row: view toggle + filter ── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* View toggle */}
        <div className="flex rounded-md overflow-hidden border border-gray-700">
          <button
            onClick={() => setViewMode('by_bin')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
              viewMode === 'by_bin'
                ? 'bg-purple-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
            data-testid="button-view-by-bin"
          >
            <Layers className="w-3.5 h-3.5" />
            By Shelf / Bin
          </button>
          <button
            onClick={() => setViewMode('by_part')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors border-l border-gray-700 ${
              viewMode === 'by_part'
                ? 'bg-purple-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
            data-testid="button-view-by-part"
          >
            <List className="w-3.5 h-3.5" />
            By Part Number
          </button>
        </div>

        {/* Order filter indicator */}
        {filterOrderIds && filterOrderIds.size > 0 && (
          <span className="text-xs font-medium px-2 py-1 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
            {filterOrderIds.size} order{filterOrderIds.size !== 1 ? 's' : ''} selected
          </span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Print */}
        <Button
          variant="outline"
          size="sm"
          onClick={handlePrint}
          data-testid="button-print-picklist"
        >
          <Printer className="h-3.5 w-3.5 mr-1" />
          Print
        </Button>

        {/* Status filters */}
        <Button
          variant={filter === 'all' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('all')}
          data-testid="button-filter-all"
        >
          All
        </Button>
        <Button
          variant={filter === 'to_pull' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('to_pull')}
          data-testid="button-filter-to-pull"
        >
          <Package className="h-3.5 w-3.5 mr-1" />
          To Pull
        </Button>

        {/* Clear shipped orders */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => clearMutation.mutate()}
          disabled={clearMutation.isPending}
          data-testid="button-clear-picklist"
          className="text-red-400 border-red-800/50 hover:text-red-300"
        >
          {clearMutation.isPending
            ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            : <Trash2 className="h-3.5 w-3.5 mr-1" />}
          Clear Shipped
        </Button>
      </div>

      {/* Column label */}
      <div className="flex items-center gap-3 px-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        <span className="w-4 text-center shrink-0">Pull</span>
        <span className="flex-1">
          {viewMode === 'by_part' ? 'Part / Item' : 'Bin'}
        </span>
      </div>

      {/* ── Empty state ── */}
      {isEmpty && (
        <div className="text-center py-12 text-gray-500">
          <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>Nothing in picklist</p>
          <p className="text-sm mt-1">Items appear here when orders are awaiting fulfillment</p>
        </div>
      )}

      {/* ══════════════════════════════════════════
          VIEW: BY PART NUMBER — grouped by part, variants below
          ══════════════════════════════════════════ */}
      {viewMode === 'by_part' && !isEmpty && (() => {
        // Group flatItems by partNumber (or sku fallback)
        const partGroups: Map<string, BinPicklistItem[]> = new Map();
        for (const item of flatItems) {
          const key = partKey(item);
          if (!partGroups.has(key)) partGroups.set(key, []);
          partGroups.get(key)!.push(item);
        }

        return (
          <div className="space-y-2" data-testid="picklist-by-part">
            {Array.from(partGroups.entries()).map(([key, variants]) => {
              const allPulled = variants.every(v => v.pulled);
              const somePulled = variants.some(v => v.pulled);
              const rep = variants[0];

              const handleGroupPull = () => {
                const target = !allPulled;
                variants.forEach(v =>
                  pullItemMutation.mutate({ itemId: v.picklistItemId, pulled: target })
                );
              };

              return (
                <div
                  key={key}
                  className={`rounded-lg border overflow-hidden transition-colors ${
                    allPulled
                      ? 'border-blue-800/30'
                      : somePulled
                      ? 'border-yellow-700/40'
                      : 'border-gray-700'
                  }`}
                  data-testid={`part-group-${key}`}
                >
                  {/* Part group header */}
                  <div
                    className={`flex items-center gap-3 px-3 py-2 ${
                      allPulled
                        ? 'bg-blue-950/30'
                        : somePulled
                        ? 'bg-yellow-950/20'
                        : 'bg-gray-800/70'
                    }`}
                  >
                    {/* Group-level pull checkbox */}
                    <Checkbox
                      data-testid={`checkbox-pull-group-${key}`}
                      checked={allPulled ? true : somePulled ? 'indeterminate' : false}
                      onCheckedChange={handleGroupPull}
                      disabled={pullItemMutation.isPending}
                      className="shrink-0 touch-auto"
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-mono text-xs text-purple-300 shrink-0">{rep.partNumber || rep.sku}</span>
                        <span className={`text-xs flex-1 min-w-0 truncate font-medium ${allPulled ? 'text-gray-400 line-through' : 'text-white'}`}>
                          {rep.itemName}
                        </span>
                      </div>
                    </div>

                    {variants.length > 1 && (
                      <span className="shrink-0 text-[10px] font-bold text-gray-400 tabular-nums">
                        {variants.length} lots
                      </span>
                    )}
                  </div>

                  {/* Variant rows */}
                  <div className="divide-y divide-gray-700/50">
                    {variants.map((item) => (
                      <div
                        key={item.picklistItemId}
                        className={`flex items-center gap-3 px-3 py-1.5 ${
                          item.pulled ? 'bg-blue-950/20' : 'bg-gray-900/60'
                        }`}
                        data-testid={`part-item-${item.picklistItemId}`}
                      >
                        {/* Indent spacer aligning with group checkbox */}
                        <div className="w-4 shrink-0" />

                        {/* Variant details */}
                        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap text-[10px]">
                          <span className="text-gray-300 tabular-nums">Qty {item.quantity}</span>
                          <span className="text-gray-500">·</span>
                          <span className="text-gray-400 font-mono">{item.orderNumber}</span>
                          {item.colorName && (
                            <span className="text-yellow-400">{item.colorName}</span>
                          )}
                          {item.condition && (
                            <span className={item.condition === 'N' ? 'text-green-400' : 'text-orange-400'}>
                              {item.condition === 'N' ? 'New' : item.condition === 'U' ? 'Used' : item.condition}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* ══════════════════════════════════════════
          VIEW: BY SHELF / BIN — aisle › shelf › bin grouping
          ══════════════════════════════════════════ */}
      {viewMode === 'by_bin' && !isEmpty && (
        <div className="space-y-3" data-testid="picklist-by-bin">
          {sortedAisles.map((aisle) => {
            const shelves = groupedBins[aisle];
            return (
              <div key={aisle} className="space-y-2" data-testid={`aisle-group-${aisle}`}>
                {/* Aisle header */}
                <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg px-3 py-1.5">
                  <h3 className="text-sm font-bold text-purple-400">{aisle}</h3>
                </div>

                <div className="space-y-2">
                  {Object.entries(shelves).map(([shelf, bins]) => (
                    <div key={shelf} className="space-y-1" data-testid={`shelf-group-${shelf}`}>
                      {/* Shelf header */}
                      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-1">
                        <h4 className="text-xs font-bold text-blue-400">{shelf}</h4>
                      </div>

                      <div className="space-y-2">
                        {bins.map((bin) => {
                          const binKey = bin.binId ?? 'none';
                          const binName = bin.warehouseLocation?.bin.name || 'Unassigned';
                          const binDescription = bin.warehouseLocation?.bin.description;

                          return (
                            <div key={binKey} className="space-y-1" data-testid={`bin-${binKey}`}>
                              {/* Bin row */}
                              <div className="flex items-center gap-3 bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2">
                                <Checkbox
                                  data-testid={`checkbox-pull-bin-${binKey}`}
                                  checked={bin.pulled}
                                  onCheckedChange={(checked) => {
                                    if (bin.binId) pullBinMutation.mutate({ binId: bin.binId, pulled: checked === true });
                                  }}
                                  disabled={!bin.binId || pullBinMutation.isPending}
                                  className="shrink-0 touch-auto"
                                />

                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-white truncate">{binName}</div>
                                  {binDescription && (
                                    <div className="text-xs text-gray-400 mt-0.5">{binDescription}</div>
                                  )}
                                </div>

                                {bin.items.length > 0 && (
                                  <span className="shrink-0 text-[10px] font-bold text-blue-300 bg-blue-900/40 border border-blue-700/40 rounded-full px-1.5 py-0.5 tabular-nums">
                                    {bin.items.length} {bin.items.length === 1 ? 'lot' : 'lots'}
                                  </span>
                                )}
                              </div>

                              {/* Items within this bin */}
                              {bin.items.length > 0 && (
                                <div className="ml-4 space-y-1">
                                  {[...bin.items].sort((a, b) => partKey(a).localeCompare(partKey(b), undefined, { numeric: true })).map((item) => (
                                    <div
                                      key={item.picklistItemId}
                                      className="flex items-start gap-2 bg-gray-900/60 border border-gray-700/50 rounded px-2.5 py-1.5"
                                      data-testid={`picklist-item-${item.picklistItemId}`}
                                    >
                                      <span className="font-mono text-[10px] text-purple-400 shrink-0 pt-0.5">{item.partNumber || item.sku}</span>
                                      <div className="flex-1 min-w-0">
                                        <div className="text-xs text-white truncate">{item.itemName}</div>
                                        <div className="flex items-center gap-2 text-[10px] text-gray-500 mt-0.5 flex-wrap">
                                          <span className="tabular-nums">Qty {item.quantity} · {item.orderNumber}</span>
                                          {item.colorName && <span className="text-yellow-500">{item.colorName}</span>}
                                          {item.condition && (
                                            <span className={item.condition === 'N' ? 'text-green-500' : 'text-orange-400'}>
                                              {item.condition === 'N' ? 'New' : item.condition === 'U' ? 'Used' : item.condition}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}
