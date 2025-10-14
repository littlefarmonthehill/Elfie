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
  bin: { id: number; name: string };
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/picklist'] });
      refetch();
    },
  });

  const reshelveMutation = useMutation({
    mutationFn: async ({ binId, reshelved }: { binId: number; reshelved: boolean }) => {
      return await apiRequest('PUT', `/api/picklist/bin/${binId}/reshelve`, { reshelved });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/picklist'] });
      refetch();
    },
  });

  // Group bins by aisle and shelf
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

      {/* Picklist Bins - Condensed */}
      <div className="space-y-1" data-testid="picklist-bins-container">
        {Object.keys(groupedBins).length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No bins in picklist</p>
            <p className="text-sm">Bins will appear here when orders are awaiting fulfillment</p>
          </div>
        ) : (
          Object.entries(groupedBins).map(([aisle, shelves]) => (
            <div key={aisle} className="space-y-1" data-testid={`aisle-group-${aisle}`}>
              {Object.entries(shelves).map(([shelf, bins]) => (
                <div key={shelf} className="space-y-1" data-testid={`shelf-group-${shelf}`}>
                  {bins.map((bin) => {
                    const binKey = bin.binId ?? 'none';
                    const binLocation = bin.warehouseLocation 
                      ? `${bin.warehouseLocation.aisle.name} › ${bin.warehouseLocation.shelf.name} › ${bin.warehouseLocation.bin.name}`
                      : 'Unassigned';
                    const binDescription = `${bin.itemCount} ${bin.itemCount === 1 ? 'item' : 'items'}`;
                    
                    return (
                      <div 
                        key={binKey} 
                        className="flex items-center gap-2 bg-gray-800/50 border border-gray-700 rounded px-2 py-1.5 hover-elevate"
                        data-testid={`bin-${binKey}`}
                      >
                        {/* Pulled Checkbox - Left */}
                        <Checkbox
                          data-testid={`checkbox-pull-bin-${binKey}`}
                          checked={bin.pulled}
                          onCheckedChange={(checked) => {
                            if (bin.binId) {
                              pullMutation.mutate({ binId: bin.binId, pulled: checked === true });
                            }
                          }}
                          disabled={!bin.binId || pullMutation.isPending}
                        />

                        {/* Bin Info - Center */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-white truncate">{binLocation}</span>
                            <span className="text-xs text-gray-400">• {binDescription}</span>
                          </div>
                        </div>

                        {/* Reshelved Checkbox - Right */}
                        <Checkbox
                          data-testid={`checkbox-reshelve-bin-${binKey}`}
                          checked={bin.reshelved}
                          onCheckedChange={(checked) => {
                            if (bin.binId) {
                              reshelveMutation.mutate({ binId: bin.binId, reshelved: checked === true });
                            }
                          }}
                          disabled={!bin.binId || !bin.pulled || reshelveMutation.isPending}
                        />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
