import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Package, PackageCheck, CheckCircle2, Circle, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

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
  const [expandedBins, setExpandedBins] = useState<Set<number>>(new Set());

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

  const toggleBinExpansion = (binId: number) => {
    setExpandedBins(prev => {
      const newSet = new Set(prev);
      if (newSet.has(binId)) {
        newSet.delete(binId);
      } else {
        newSet.add(binId);
      }
      return newSet;
    });
  };

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

  const totalBins = picklistData.length;
  const pulledBins = picklistData.filter(bin => bin.pulled && !bin.reshelved).length;
  const toPullBins = picklistData.filter(bin => !bin.pulled).length;

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
            {totalBins} bins
          </Badge>
          <Badge variant="outline" className="bg-orange-500/10 border-orange-500/30 text-orange-400">
            {toPullBins} to pull
          </Badge>
          <Badge variant="outline" className="bg-green-500/10 border-green-500/30 text-green-400">
            {pulledBins} pulled
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
          All Bins
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

      {/* Picklist Bins Grouped by Location */}
      <div className="space-y-6" data-testid="picklist-bins-container">
        {Object.keys(groupedBins).length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No bins in picklist</p>
            <p className="text-sm">Bins will appear here when orders are awaiting fulfillment</p>
          </div>
        ) : (
          Object.entries(groupedBins).map(([aisle, shelves]) => (
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
                  {bins.map((bin) => {
                    if (!bin.binId) return null;
                    const isExpanded = expandedBins.has(bin.binId);
                    
                    return (
                      <div key={bin.binId} className="ml-4" data-testid={`bin-${bin.binId}`}>
                        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 hover-elevate">
                          <div className="flex items-center gap-3">
                            {/* Pull Checkbox */}
                            <div className="flex items-center gap-2">
                              <Checkbox
                                data-testid={`checkbox-pull-bin-${bin.binId}`}
                                checked={bin.pulled}
                                onCheckedChange={(checked) => {
                                  pullMutation.mutate({ binId: bin.binId!, pulled: checked === true });
                                }}
                                disabled={pullMutation.isPending}
                              />
                              {bin.pulled ? (
                                <CheckCircle2 className="h-4 w-4 text-green-400" />
                              ) : (
                                <Circle className="h-4 w-4 text-gray-600" />
                              )}
                            </div>

                            {/* Bin Details */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-semibold text-white">
                                  Bin: {bin.warehouseLocation?.bin.name}
                                </p>
                                <Badge variant="outline" className="text-xs">
                                  {bin.itemCount} {bin.itemCount === 1 ? 'item' : 'items'}
                                </Badge>
                              </div>
                            </div>

                            {/* Reshelve Checkbox */}
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500">Reshelve</span>
                              <Checkbox
                                data-testid={`checkbox-reshelve-bin-${bin.binId}`}
                                checked={bin.reshelved}
                                onCheckedChange={(checked) => {
                                  reshelveMutation.mutate({ binId: bin.binId!, reshelved: checked === true });
                                }}
                                disabled={!bin.pulled || reshelveMutation.isPending}
                              />
                              {bin.reshelved ? (
                                <CheckCircle2 className="h-4 w-4 text-green-400" />
                              ) : (
                                <Circle className="h-4 w-4 text-gray-600" />
                              )}
                            </div>

                            {/* Expand/Collapse Button */}
                            <Button
                              data-testid={`button-expand-bin-${bin.binId}`}
                              size="icon"
                              variant="ghost"
                              onClick={() => toggleBinExpansion(bin.binId!)}
                              className="h-8 w-8"
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </Button>
                          </div>

                          {/* Expandable Item Details */}
                          {isExpanded && (
                            <div className="mt-3 pt-3 border-t border-gray-700 space-y-2">
                              {bin.items.map((item, idx) => (
                                <div
                                  key={item.picklistItemId}
                                  data-testid={`bin-item-${bin.binId}-${idx}`}
                                  className="text-xs text-gray-400 pl-8"
                                >
                                  <p className="text-white font-medium">{item.itemName}</p>
                                  <p className="text-gray-500">
                                    SKU: {item.sku} • Qty: {item.quantity} • Order: {item.orderNumber}
                                  </p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
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
