import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Package, PackageCheck, Loader2 } from "lucide-react";

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
  pulled: boolean;
  reshelved: boolean;
};

type BinPicklist = {
  binId: number | null;
  warehouseLocation: WarehouseLocation | null;
  itemCount: number;
  items: BinPicklistItem[];
  pulled: boolean;
  reshelved: boolean;
};

export default function PicklistTool() {
  const [filter, setFilter] = useState<'all' | 'to_pull' | 'to_reshelve'>('all');

  const { data: picklistData = [], isLoading, refetch } = useQuery<BinPicklist[]>({
    queryKey: ['/api/picklist', filter],
    queryFn: async () => {
      const params = filter !== 'all' ? `?filter=${filter}` : '';
      const response = await fetch(`/api/picklist${params}`);
      if (!response.ok) throw new Error('Failed to fetch picklist');
      return response.json();
    },
  });

  const pullMutation = useMutation({
    mutationFn: async ({ binId, pulled }: { binId: number; pulled: boolean }) => {
      return await apiRequest('PUT', `/api/picklist/bin/${binId}/pull`, { pulled });
    },
    onMutate: async ({ binId, pulled }) => {
      await queryClient.cancelQueries({ queryKey: ['/api/picklist'] });
      const previousData = queryClient.getQueryData(['/api/picklist', filter]);
      queryClient.setQueryData(['/api/picklist', filter], (old: any) => {
        if (!old) return old;
        return old.map((item: any) => 
          item.binId === binId ? { ...item, pulled } : item
        );
      });
      return { previousData };
    },
    onError: (err, variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(['/api/picklist', filter], context.previousData);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/picklist'] });
      queryClient.invalidateQueries({ queryKey: ['/api/picklist/stats'] });
    },
  });

  const reshelveMutation = useMutation({
    mutationFn: async ({ binId, reshelved }: { binId: number; reshelved: boolean }) => {
      return await apiRequest('PUT', `/api/picklist/bin/${binId}/reshelve`, { reshelved });
    },
    onMutate: async ({ binId, reshelved }) => {
      await queryClient.cancelQueries({ queryKey: ['/api/picklist'] });
      const previousData = queryClient.getQueryData(['/api/picklist', filter]);
      queryClient.setQueryData(['/api/picklist', filter], (old: any) => {
        if (!old) return old;
        return old.map((item: any) => 
          item.binId === binId ? { ...item, reshelved } : item
        );
      });
      return { previousData };
    },
    onError: (err, variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(['/api/picklist', filter], context.previousData);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/picklist'] });
      queryClient.invalidateQueries({ queryKey: ['/api/picklist/stats'] });
    },
  });

  // Group bins by aisle and shelf, sort descending by aisle
  const groupedBins = picklistData.reduce((acc, bin) => {
    const aisleKey = bin.warehouseLocation?.aisle.name || 'No Location';
    const shelfKey = bin.warehouseLocation?.shelf.name || 'No Shelf';

    if (!acc[aisleKey]) {
      acc[aisleKey] = {};
    }
    if (!acc[aisleKey][shelfKey]) {
      acc[aisleKey][shelfKey] = [];
    }

    acc[aisleKey][shelfKey].push(bin);

    return acc;
  }, {} as Record<string, Record<string, BinPicklist[]>>);

  // Sort aisles descending
  const sortedAisles = Object.keys(groupedBins).sort((a, b) => b.localeCompare(a));

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter Buttons */}
      <div className="flex gap-2">
        <Button
          variant={filter === 'all' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('all')}
          data-testid="button-filter-all"
        >
          All Bins
        </Button>
        <Button
          variant={filter === 'to_pull' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('to_pull')}
          data-testid="button-filter-to-pull"
        >
          <Package className="h-4 w-4 mr-1" />
          To Pull
        </Button>
        <Button
          variant={filter === 'to_reshelve' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('to_reshelve')}
          data-testid="button-filter-to-reshelve"
        >
          <PackageCheck className="h-4 w-4 mr-1" />
          To Reshelve
        </Button>
      </div>

      {/* Picklist Bins - Grouped by Aisle */}
      <div className="space-y-3" data-testid="picklist-bins-container">
        {sortedAisles.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No bins in picklist</p>
            <p className="text-sm">Bins will appear here when orders are awaiting fulfillment</p>
          </div>
        ) : (
          sortedAisles.map((aisle) => {
            const shelves = groupedBins[aisle];
            return (
              <div key={aisle} className="space-y-2" data-testid={`aisle-group-${aisle}`}>
                {/* Aisle Header */}
                <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg px-3 py-1.5">
                  <h3 className="text-sm font-bold text-purple-400">{aisle}</h3>
                </div>

                {/* Shelves within Aisle */}
                <div className="space-y-2">
                  {Object.entries(shelves).map(([shelf, bins]) => (
                    <div key={shelf} className="space-y-1" data-testid={`shelf-group-${shelf}`}>
                      {/* Shelf Header */}
                      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-1">
                        <h4 className="text-xs font-bold text-blue-400">{shelf}</h4>
                      </div>

                      {/* Bins within Shelf */}
                      <div className="space-y-2">
                        {bins.map((bin) => {
                          const binKey = bin.binId ?? 'none';
                          const binName = bin.warehouseLocation?.bin.name || 'Unassigned';
                          const binDescription = bin.warehouseLocation?.bin.description;
                          
                          return (
                            <div key={binKey} className="space-y-1" data-testid={`bin-${binKey}`}>
                              {/* Bin row: pull checkbox + name + reshelve checkbox */}
                              <div className="flex items-center gap-3 bg-gray-800/50 border border-gray-700 rounded px-3 py-2">
                                {/* Pulled Checkbox - Left */}
                                <div className="shrink-0">
                                  <Checkbox
                                    data-testid={`checkbox-pull-bin-${binKey}`}
                                    checked={bin.pulled}
                                    onCheckedChange={(checked) => {
                                      if (bin.binId) {
                                        pullMutation.mutate({ binId: bin.binId, pulled: checked === true });
                                      }
                                    }}
                                    disabled={!bin.binId || pullMutation.isPending}
                                    className="touch-auto"
                                  />
                                </div>

                                {/* Bin Info - Center */}
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-white truncate">{binName}</div>
                                  {binDescription && (
                                    <div className="text-xs text-gray-400 mt-0.5">{binDescription}</div>
                                  )}
                                </div>

                                {/* Item count badge */}
                                {bin.items.length > 0 && (
                                  <span className="shrink-0 text-[10px] font-bold text-blue-300 bg-blue-900/40 border border-blue-700/40 rounded-full px-1.5 py-0.5 tabular-nums">
                                    {bin.items.length} {bin.items.length === 1 ? 'lot' : 'lots'}
                                  </span>
                                )}

                                {/* Reshelved Checkbox - Right */}
                                <div className="shrink-0">
                                  <Checkbox
                                    data-testid={`checkbox-reshelve-bin-${binKey}`}
                                    checked={bin.reshelved}
                                    onCheckedChange={(checked) => {
                                      if (bin.binId) {
                                        reshelveMutation.mutate({ binId: bin.binId, reshelved: checked === true });
                                      }
                                    }}
                                    disabled={!bin.binId || !bin.pulled || reshelveMutation.isPending}
                                    className="touch-auto"
                                  />
                                </div>
                              </div>

                              {/* Items within this bin */}
                              {bin.items.length > 0 && (
                                <div className="ml-4 space-y-1">
                                  {bin.items.map((item) => (
                                    <div
                                      key={item.picklistItemId}
                                      className="flex items-baseline gap-2 bg-gray-900/60 border border-gray-700/50 rounded px-2.5 py-1.5"
                                      data-testid={`picklist-item-${item.picklistItemId}`}
                                    >
                                      <span className="font-mono text-[10px] text-gray-500 shrink-0">{item.sku}</span>
                                      <span className="text-xs text-white flex-1 min-w-0 truncate">{item.itemName}</span>
                                      <span className="text-[10px] text-gray-400 shrink-0 tabular-nums">
                                        Qty {item.quantity} · {item.orderNumber}
                                      </span>
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
          })
        )}
      </div>
    </div>
  );
}
