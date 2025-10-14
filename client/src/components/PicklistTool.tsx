import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Package, PackageCheck, CheckCircle2, Circle, Loader2 } from "lucide-react";

type WarehouseLocation = {
  aisle: { id: number; name: string };
  shelf: { id: number; name: string };
  bin: { id: number; name: string };
};

type PicklistItem = {
  id: string;
  orderDetailId: string;
  orderId: string;
  pulled: boolean;
  reshelved: boolean;
  orderDetail: {
    id: string;
    name: string;
    sku: string;
    quantity: number;
  };
  order: {
    id: string;
    orderNumber: string;
    orderStatus: string;
  };
  warehouseLocation: WarehouseLocation | null;
};

type GroupedPicklistItem = PicklistItem & {
  aisleGroup: string;
  shelfGroup: string;
  binGroup: string;
};

export default function PicklistTool() {
  const [filter, setFilter] = useState<'all' | 'to_pull' | 'to_reshelve'>('all');

  const { data: picklistData = [], isLoading, refetch } = useQuery<PicklistItem[]>({
    queryKey: ['/api/picklist', filter],
    queryFn: async () => {
      const params = filter !== 'all' ? `?filter=${filter}` : '';
      const response = await fetch(`/api/picklist${params}`);
      if (!response.ok) throw new Error('Failed to fetch picklist');
      return response.json();
    },
  });

  const pullMutation = useMutation({
    mutationFn: async ({ id, pulled }: { id: string; pulled: boolean }) => {
      console.log('[Pull Mutation] Starting:', { id, pulled });
      const result = await apiRequest('PUT', `/api/picklist/${id}/pull`, { pulled });
      console.log('[Pull Mutation] Success:', result);
      return result;
    },
    onSuccess: (data) => {
      console.log('[Pull Mutation] onSuccess:', data);
      // Invalidate all picklist queries regardless of filter
      queryClient.invalidateQueries({ queryKey: ['/api/picklist'] });
      // Also refetch current query
      refetch();
    },
    onError: (error) => {
      console.error('[Pull Mutation] Error:', error);
    },
  });

  const reshelveMutation = useMutation({
    mutationFn: async ({ id, reshelved }: { id: string; reshelved: boolean }) => {
      console.log('[Reshelve Mutation] Starting:', { id, reshelved });
      const result = await apiRequest('PUT', `/api/picklist/${id}/reshelve`, { reshelved });
      console.log('[Reshelve Mutation] Success:', result);
      return result;
    },
    onSuccess: (data) => {
      console.log('[Reshelve Mutation] onSuccess:', data);
      // Invalidate all picklist queries regardless of filter
      queryClient.invalidateQueries({ queryKey: ['/api/picklist'] });
      // Also refetch current query
      refetch();
    },
    onError: (error) => {
      console.error('[Reshelve Mutation] Error:', error);
    },
  });

  // Group items by aisle, then shelf, then bin
  const groupedItems = picklistData.reduce((acc, item) => {
    const aisleKey = item.warehouseLocation?.aisle.name || 'No Location';
    const shelfKey = item.warehouseLocation?.shelf.name || 'No Shelf';
    const binKey = item.warehouseLocation?.bin.name || 'No Bin';

    if (!acc[aisleKey]) {
      acc[aisleKey] = {};
    }
    if (!acc[aisleKey][shelfKey]) {
      acc[aisleKey][shelfKey] = {};
    }
    if (!acc[aisleKey][shelfKey][binKey]) {
      acc[aisleKey][shelfKey][binKey] = [];
    }

    acc[aisleKey][shelfKey][binKey].push({
      ...item,
      aisleGroup: aisleKey,
      shelfGroup: shelfKey,
      binGroup: binKey,
    });

    return acc;
  }, {} as Record<string, Record<string, Record<string, GroupedPicklistItem[]>>>);

  const totalItems = picklistData.length;
  const pulledItems = picklistData.filter(item => item.pulled && !item.reshelved).length;
  const toPullItems = picklistData.filter(item => !item.pulled).length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with Stats */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Picklist</h2>
          <p className="text-sm text-gray-400">Active orders awaiting fulfillment</p>
        </div>
        <div className="flex gap-2">
          <Badge variant="outline" className="bg-blue-500/10 border-blue-500/30 text-blue-400">
            {totalItems} items
          </Badge>
          <Badge variant="outline" className="bg-orange-500/10 border-orange-500/30 text-orange-400">
            {toPullItems} to pull
          </Badge>
          <Badge variant="outline" className="bg-green-500/10 border-green-500/30 text-green-400">
            {pulledItems} pulled
          </Badge>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <Button
          data-testid="button-filter-all"
          size="sm"
          variant={filter === 'all' ? 'default' : 'outline'}
          onClick={() => setFilter('all')}
        >
          All Items
        </Button>
        <Button
          data-testid="button-filter-to-pull"
          size="sm"
          variant={filter === 'to_pull' ? 'default' : 'outline'}
          onClick={() => setFilter('to_pull')}
        >
          <Package className="h-4 w-4 mr-1" />
          To Pull
        </Button>
        <Button
          data-testid="button-filter-to-reshelve"
          size="sm"
          variant={filter === 'to_reshelve' ? 'default' : 'outline'}
          onClick={() => setFilter('to_reshelve')}
        >
          <PackageCheck className="h-4 w-4 mr-1" />
          To Reshelve
        </Button>
      </div>

      {/* Picklist Items Grouped by Location */}
      <div className="space-y-6" data-testid="picklist-items-container">
        {Object.keys(groupedItems).length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No items in picklist</p>
            <p className="text-sm">Items will appear here when orders are awaiting fulfillment</p>
          </div>
        ) : (
          Object.entries(groupedItems).map(([aisle, shelves]) => (
            <div key={aisle} className="space-y-3" data-testid={`aisle-group-${aisle}`}>
              {/* Aisle Header */}
              <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-2">
                <h3 className="text-sm font-bold text-purple-400">Aisle: {aisle}</h3>
              </div>

              {/* Shelves within Aisle */}
              {Object.entries(shelves).map(([shelf, bins]) => (
                <div key={shelf} className="ml-4 space-y-2" data-testid={`shelf-group-${shelf}`}>
                  <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-2">
                    <h4 className="text-xs font-bold text-blue-400">Shelf: {shelf}</h4>
                  </div>

                  {/* Bins within Shelf */}
                  {Object.entries(bins).map(([bin, items]) => (
                    <div key={bin} className="ml-4 space-y-2" data-testid={`bin-group-${bin}`}>
                      <div className="bg-gray-700/50 rounded-lg p-2">
                        <h5 className="text-xs font-semibold text-gray-300 mb-2">Bin: {bin}</h5>
                        
                        {/* Items in Bin */}
                        <div className="space-y-1">
                          {items.map((item) => (
                            <div
                              key={item.id}
                              data-testid={`picklist-item-${item.id}`}
                              className="flex items-center gap-3 bg-gray-800/50 border border-gray-700 rounded p-2 hover-elevate"
                            >
                              {/* Pull Checkbox */}
                              <div className="flex items-center gap-2">
                                <Checkbox
                                  data-testid={`checkbox-pull-${item.id}`}
                                  checked={item.pulled}
                                  onCheckedChange={(checked) => {
                                    console.log('Pull checkbox changed:', item.id, 'checked:', checked);
                                    pullMutation.mutate({ id: item.id, pulled: checked === true });
                                  }}
                                  disabled={pullMutation.isPending}
                                />
                                {item.pulled ? (
                                  <CheckCircle2 className="h-4 w-4 text-green-400" />
                                ) : (
                                  <Circle className="h-4 w-4 text-gray-600" />
                                )}
                              </div>

                              {/* Item Details */}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-white truncate">
                                  {item.orderDetail.name}
                                </p>
                                <p className="text-xs text-gray-400">
                                  SKU: {item.orderDetail.sku} • Qty: {item.orderDetail.quantity} • Order: {item.order.orderNumber}
                                </p>
                              </div>

                              {/* Reshelve Checkbox */}
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-500">Reshelve</span>
                                <Checkbox
                                  data-testid={`checkbox-reshelve-${item.id}`}
                                  checked={item.reshelved}
                                  onCheckedChange={(checked) => {
                                    console.log('Reshelve checkbox changed:', item.id, 'checked:', checked);
                                    reshelveMutation.mutate({ id: item.id, reshelved: checked === true });
                                  }}
                                  disabled={!item.pulled || reshelveMutation.isPending}
                                />
                                {item.reshelved ? (
                                  <CheckCircle2 className="h-4 w-4 text-green-400" />
                                ) : (
                                  <Circle className="h-4 w-4 text-gray-600" />
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
