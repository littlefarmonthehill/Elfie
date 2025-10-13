import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Package,
  Plus,
  MapPin,
  Layers,
  Archive,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface WarehouseManagementProps {
  onItemClick?: (type: 'inventory', id: number) => void;
}

type ViewType = null | 'lots' | 'bins' | 'shelves' | 'aisles';
type FilterType = 'all' | 'assigned' | 'unassigned';

export default function WarehouseManagement({ onItemClick }: WarehouseManagementProps) {
  const { toast } = useToast();
  const [activeView, setActiveView] = useState<ViewType>(null);
  const [filter, setFilter] = useState<FilterType>('all');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createType, setCreateType] = useState<'aisle' | 'shelf' | 'bin'>('aisle');
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [editType, setEditType] = useState<'aisle' | 'shelf' | 'bin'>('aisle');
  const [editAisleId, setEditAisleId] = useState<string>("");
  const [editShelfId, setEditShelfId] = useState<string>("");
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());
  const [bulkBinId, setBulkBinId] = useState<string>("");
  const [bulkShelfId, setBulkShelfId] = useState<string>("");
  const [bulkAisleId, setBulkAisleId] = useState<string>("");

  // Fetch warehouse data
  const { data: aisles = [] } = useQuery<any[]>({
    queryKey: ['/api/warehouse/aisles'],
  });

  const { data: shelves = [] } = useQuery<any[]>({
    queryKey: ['/api/warehouse/shelves'],
  });

  const { data: bins = [] } = useQuery<any[]>({
    queryKey: ['/api/warehouse/bins'],
  });

  const { data: unassignedInventory = [] } = useQuery<any[]>({
    queryKey: ['/api/warehouse/unassigned/inventory'],
  });

  const { data: unassignedBins = [] } = useQuery<any[]>({
    queryKey: ['/api/warehouse/unassigned/bins'],
  });

  const { data: unassignedShelves = [] } = useQuery<any[]>({
    queryKey: ['/api/warehouse/unassigned/shelves'],
  });

  const { data: inventoryStats } = useQuery<any>({
    queryKey: ['/api/inventory/stats'],
  });

  const { data: locations = [] } = useQuery<any[]>({
    queryKey: ['/api/warehouse/locations'],
  });

  // Calculate counts
  const assignedLots = locations.length;
  const totalLots = inventoryStats?.totalLots || 0;
  const unassignedLots = totalLots - assignedLots;
  const assignedBins = bins.length - unassignedBins.length;
  const assignedShelves = shelves.length - unassignedShelves.length;
  const assignedAisles = aisles.length;

  // Create mutations
  const createAisleMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string }) => {
      const response = await apiRequest('POST', '/api/warehouse/aisles', data);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/aisles'] });
      toast({ title: "Aisle created successfully" });
      setCreateDialogOpen(false);
    },
  });

  const createShelfMutation = useMutation({
    mutationFn: async (data: { name: string; aisleId?: number; description?: string }) => {
      const response = await apiRequest('POST', '/api/warehouse/shelves', data);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/shelves'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/aisles'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/unassigned/shelves'] });
      toast({ title: "Shelf created successfully" });
      setCreateDialogOpen(false);
    },
  });

  const createBinMutation = useMutation({
    mutationFn: async (data: { name: string; shelfId?: number; description?: string }) => {
      const response = await apiRequest('POST', '/api/warehouse/bins', data);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/bins'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/shelves'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/aisles'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/unassigned/bins'] });
      toast({ title: "Bin created successfully" });
      setCreateDialogOpen(false);
    },
  });

  const assignInventoryMutation = useMutation({
    mutationFn: async (data: { inventoryId: number; binId: number; bagLabel?: string }) => {
      const response = await apiRequest('POST', '/api/warehouse/assign/inventory', data);
      return await response.json();
    },
    onSuccess: () => {
      // Only invalidate queries, don't clear state here (bulk handler will do that)
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/unassigned/inventory'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/bins'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/shelves'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/aisles'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/locations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/inventory/stats'] });
    },
  });

  const assignBinToShelfMutation = useMutation({
    mutationFn: async ({ binId, shelfId }: { binId: number; shelfId: number }) => {
      const response = await apiRequest('PUT', `/api/warehouse/assign/bin/${binId}/shelf/${shelfId}`, {});
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/bins'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/unassigned/bins'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/shelves'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/aisles'] });
    },
  });

  const assignShelfToAisleMutation = useMutation({
    mutationFn: async ({ shelfId, aisleId }: { shelfId: number; aisleId: number }) => {
      const response = await apiRequest('PUT', `/api/warehouse/assign/shelf/${shelfId}/aisle/${aisleId}`, {});
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/shelves'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/unassigned/shelves'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/aisles'] });
    },
  });

  // Edit mutations
  const updateAisleMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { name: string; description?: string } }) => {
      const response = await apiRequest('PUT', `/api/warehouse/aisles/${id}`, data);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/aisles'] });
      toast({ title: "Aisle updated successfully" });
      setEditDialogOpen(false);
    },
  });

  const updateShelfMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { name: string; aisleId?: number; description?: string } }) => {
      const response = await apiRequest('PUT', `/api/warehouse/shelves/${id}`, data);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/shelves'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/aisles'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/unassigned/shelves'] });
      toast({ title: "Shelf updated successfully" });
      setEditDialogOpen(false);
    },
  });

  const updateBinMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { name: string; shelfId?: number; description?: string } }) => {
      const response = await apiRequest('PUT', `/api/warehouse/bins/${id}`, data);
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/bins'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/shelves'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/aisles'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/unassigned/bins'] });
      toast({ title: "Bin updated successfully" });
      setEditDialogOpen(false);
    },
  });

  const handleCreateSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const description = formData.get('description') as string;

    if (createType === 'aisle') {
      createAisleMutation.mutate({ name, description });
    } else if (createType === 'shelf') {
      const aisleId = formData.get('aisleId') as string;
      createShelfMutation.mutate({ 
        name, 
        aisleId: (aisleId && aisleId !== '0') ? parseInt(aisleId) : undefined,
        description 
      });
    } else if (createType === 'bin') {
      const shelfId = formData.get('shelfId') as string;
      createBinMutation.mutate({ 
        name, 
        shelfId: (shelfId && shelfId !== '0') ? parseInt(shelfId) : undefined,
        description 
      });
    }
  };

  const handleEditSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editItem) return;
    
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const description = formData.get('description') as string;

    if (editType === 'aisle') {
      updateAisleMutation.mutate({ id: editItem.id, data: { name, description } });
    } else if (editType === 'shelf') {
      updateShelfMutation.mutate({ 
        id: editItem.id,
        data: { 
          name, 
          aisleId: (editAisleId && editAisleId !== '0') ? parseInt(editAisleId) : undefined,
          description 
        }
      });
    } else if (editType === 'bin') {
      updateBinMutation.mutate({ 
        id: editItem.id,
        data: { 
          name, 
          shelfId: (editShelfId && editShelfId !== '0') ? parseInt(editShelfId) : undefined,
          description 
        }
      });
    }
  };

  const handleEdit = (type: 'aisle' | 'shelf' | 'bin', item: any) => {
    setEditType(type);
    setEditItem(item);
    setEditAisleId(item.aisleId?.toString() || "0");
    setEditShelfId(item.shelfId?.toString() || "0");
    setEditDialogOpen(true);
  };

  const toggleItemSelection = (itemId: number) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(itemId)) {
      newSelected.delete(itemId);
    } else {
      newSelected.add(itemId);
    }
    setSelectedItems(newSelected);
  };

  const handleBulkAssign = async () => {
    if (selectedItems.size === 0) return;

    const count = selectedItems.size;

    if (activeView === 'lots' && bulkBinId) {
      const binId = parseInt(bulkBinId);
      const promises = Array.from(selectedItems).map(inventoryId => 
        assignInventoryMutation.mutateAsync({ inventoryId, binId })
      );
      
      await Promise.all(promises);
      toast({ title: `${count} lot${count > 1 ? 's' : ''} assigned successfully` });
      setSelectedItems(new Set());
      setBulkBinId("");
    } else if (activeView === 'bins' && bulkShelfId) {
      const shelfId = parseInt(bulkShelfId);
      const promises = Array.from(selectedItems).map(binId => 
        assignBinToShelfMutation.mutateAsync({ binId, shelfId })
      );
      
      await Promise.all(promises);
      toast({ title: `${count} bin${count > 1 ? 's' : ''} assigned successfully` });
      setSelectedItems(new Set());
      setBulkShelfId("");
    } else if (activeView === 'shelves' && bulkAisleId) {
      const aisleId = parseInt(bulkAisleId);
      const promises = Array.from(selectedItems).map(shelfId => 
        assignShelfToAisleMutation.mutateAsync({ shelfId, aisleId })
      );
      
      await Promise.all(promises);
      toast({ title: `${count} ${count > 1 ? 'shelves' : 'shelf'} assigned successfully` });
      setSelectedItems(new Set());
      setBulkAisleId("");
    }
  };

  // Get filtered list based on active view and filter
  const getFilteredList = () => {
    if (!activeView) return [];

    if (activeView === 'lots') {
      const assigned = locations.map(loc => ({
        id: loc.inventoryId,
        itemNo: loc.itemNo,
        colorName: loc.colorName,
        newOrUsed: loc.newOrUsed,
        quantity: loc.quantity,
        binName: loc.binName,
        assigned: true,
      }));
      const unassigned = unassignedInventory.map(item => ({ ...item, assigned: false }));
      
      if (filter === 'assigned') return assigned;
      if (filter === 'unassigned') return unassigned;
      return [...assigned, ...unassigned];
    }

    if (activeView === 'bins') {
      const assigned = bins.filter(bin => bin.shelfId).map(bin => ({ ...bin, assigned: true }));
      const unassigned = unassignedBins.map(bin => ({ ...bin, assigned: false }));
      
      if (filter === 'assigned') return assigned;
      if (filter === 'unassigned') return unassigned;
      return [...assigned, ...unassigned];
    }

    if (activeView === 'shelves') {
      const assigned = shelves.filter(shelf => shelf.aisleId).map(shelf => ({ ...shelf, assigned: true }));
      const unassigned = unassignedShelves.map(shelf => ({ ...shelf, assigned: false }));
      
      if (filter === 'assigned') return assigned;
      if (filter === 'unassigned') return unassigned;
      return [...assigned, ...unassigned];
    }

    if (activeView === 'aisles') {
      return aisles.map(aisle => ({ ...aisle, assigned: true }));
    }

    return [];
  };

  const filteredList = getFilteredList();

  return (
    <div className="space-y-3 min-h-[60vh]">
      {/* Overview Stats */}
      <Card className="p-3">
        <div className="flex items-center gap-2 mb-3">
          <MapPin className="w-4 h-4 text-yellow-400" />
          <h3 className="text-sm font-semibold">Warehouse Overview</h3>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <div>
            <div className="text-[9px] text-gray-500 uppercase font-bold mb-1">Lots</div>
            <div className="text-lg font-bold text-blue-400">{totalLots}</div>
          </div>
          <div>
            <div className="text-[9px] text-gray-500 uppercase font-bold mb-1">Bins</div>
            <div className="text-lg font-bold text-green-400">{bins.length}</div>
          </div>
          <div>
            <div className="text-[9px] text-gray-500 uppercase font-bold mb-1">Shelves</div>
            <div className="text-lg font-bold text-orange-400">{shelves.length}</div>
          </div>
          <div>
            <div className="text-[9px] text-gray-500 uppercase font-bold mb-1">Aisles</div>
            <div className="text-lg font-bold text-purple-400">{aisles.length}</div>
          </div>
        </div>
      </Card>

      {/* Navigation Links */}
      <Card className="p-3">
        <div className="space-y-2">
          <button
            onClick={() => { setActiveView('lots'); setFilter('all'); setSelectedItems(new Set()); }}
            className={`w-full flex items-center justify-between p-2 rounded text-xs hover-elevate ${
              activeView === 'lots' ? 'bg-blue-500/20' : ''
            }`}
            data-testid="button-view-lots"
          >
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-blue-400" />
              <span className="font-medium">Lots</span>
            </div>
            <div className="flex gap-2">
              <Badge variant="secondary" className="text-[9px]">
                Assigned: {assignedLots}
              </Badge>
              <Badge variant="secondary" className="text-[9px]">
                Unassigned: {unassignedLots}
              </Badge>
            </div>
          </button>

          <button
            onClick={() => { setActiveView('bins'); setFilter('all'); setSelectedItems(new Set()); }}
            className={`w-full flex items-center justify-between p-2 rounded text-xs hover-elevate ${
              activeView === 'bins' ? 'bg-green-500/20' : ''
            }`}
            data-testid="button-view-bins"
          >
            <div className="flex items-center gap-2">
              <Archive className="w-4 h-4 text-green-400" />
              <span className="font-medium">Bins</span>
            </div>
            <div className="flex gap-2">
              <Badge variant="secondary" className="text-[9px]">
                Assigned: {assignedBins}
              </Badge>
              <Badge variant="secondary" className="text-[9px]">
                Unassigned: {unassignedBins.length}
              </Badge>
            </div>
          </button>

          <button
            onClick={() => { setActiveView('shelves'); setFilter('all'); setSelectedItems(new Set()); }}
            className={`w-full flex items-center justify-between p-2 rounded text-xs hover-elevate ${
              activeView === 'shelves' ? 'bg-orange-500/20' : ''
            }`}
            data-testid="button-view-shelves"
          >
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-orange-400" />
              <span className="font-medium">Shelves</span>
            </div>
            <div className="flex gap-2">
              <Badge variant="secondary" className="text-[9px]">
                Assigned: {assignedShelves}
              </Badge>
              <Badge variant="secondary" className="text-[9px]">
                Unassigned: {unassignedShelves.length}
              </Badge>
            </div>
          </button>

          <button
            onClick={() => { setActiveView('aisles'); setFilter('all'); setSelectedItems(new Set()); }}
            className={`w-full flex items-center justify-between p-2 rounded text-xs hover-elevate ${
              activeView === 'aisles' ? 'bg-purple-500/20' : ''
            }`}
            data-testid="button-view-aisles"
          >
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-purple-400" />
              <span className="font-medium">Aisles</span>
            </div>
            <div className="flex gap-2">
              <Badge variant="secondary" className="text-[9px]">
                Total: {aisles.length}
              </Badge>
            </div>
          </button>
        </div>
      </Card>

      {/* List View */}
      {activeView && (
        <Card className="p-3">
          {/* Filter and Actions */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={filter === 'all' ? 'default' : 'ghost'}
                onClick={() => setFilter('all')}
                data-testid="filter-all"
                className="text-[10px] py-1 px-2"
              >
                All
              </Button>
              <Button
                size="sm"
                variant={filter === 'assigned' ? 'default' : 'ghost'}
                onClick={() => setFilter('assigned')}
                data-testid="filter-assigned"
                className="text-[10px] py-1 px-2"
              >
                Assigned
              </Button>
              {(activeView === 'lots' || activeView === 'bins') && (
                <Button
                  size="sm"
                  variant={filter === 'unassigned' ? 'default' : 'ghost'}
                  onClick={() => setFilter('unassigned')}
                  data-testid="filter-unassigned"
                  className="text-[10px] py-1 px-2"
                >
                  Unassigned
                </Button>
              )}
            </div>
            {(activeView === 'aisles' || activeView === 'shelves' || activeView === 'bins') && (
              <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                <Button 
                  size="sm" 
                  onClick={() => {
                    if (activeView === 'aisles') setCreateType('aisle');
                    if (activeView === 'shelves') setCreateType('shelf');
                    if (activeView === 'bins') setCreateType('bin');
                    setCreateDialogOpen(true);
                  }}
                  data-testid="button-add-new"
                  className="text-[10px] py-1 px-2"
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Add New
                </Button>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create {createType.charAt(0).toUpperCase() + createType.slice(1)}</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleCreateSubmit} className="space-y-4">
                    <div>
                      <Label>Name *</Label>
                      <Input name="name" required data-testid="input-create-name" />
                    </div>
                    {createType === 'shelf' && (
                      <div>
                        <Label>Aisle (Optional)</Label>
                        <Select name="aisleId">
                          <SelectTrigger data-testid="select-create-aisle">
                            <SelectValue placeholder="Select aisle" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="0">None</SelectItem>
                            {aisles.map((aisle) => (
                              <SelectItem key={aisle.id} value={String(aisle.id)}>
                                {aisle.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {createType === 'bin' && (
                      <div>
                        <Label>Shelf (Optional)</Label>
                        <Select name="shelfId">
                          <SelectTrigger data-testid="select-create-shelf">
                            <SelectValue placeholder="Select shelf" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="0">None</SelectItem>
                            {shelves.map((shelf) => (
                              <SelectItem key={shelf.id} value={String(shelf.id)}>
                                {shelf.aisleName ? `${shelf.aisleName} - ` : ''}{shelf.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div>
                      <Label>Description (Optional)</Label>
                      <Input name="description" data-testid="input-create-description" />
                    </div>
                    <Button type="submit" className="w-full" data-testid="button-submit-create">
                      Create
                    </Button>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>

          {/* Bulk Assignment Controls */}
          {selectedItems.size > 0 && (activeView === 'lots' || (activeView === 'bins' && filter === 'unassigned')) && (
            <div className="flex items-center gap-2 mb-3 p-2 bg-blue-500/10 rounded">
              <span className="text-xs text-gray-400">{selectedItems.size} selected</span>
              {activeView === 'lots' && (
                <>
                  <Select value={bulkBinId} onValueChange={setBulkBinId}>
                    <SelectTrigger className="w-32 h-7 text-[10px]" data-testid="select-bulk-bin">
                      <SelectValue placeholder="Select bin" />
                    </SelectTrigger>
                    <SelectContent>
                      {bins.map((bin: any) => (
                        <SelectItem key={bin.id} value={String(bin.id)}>
                          {bin.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button 
                    size="sm" 
                    onClick={handleBulkAssign} 
                    disabled={!bulkBinId}
                    data-testid="button-bulk-assign"
                    className="text-[10px]"
                  >
                    {filter === 'assigned' ? 'Move to Bin' : 'Assign to Bin'}
                  </Button>
                </>
              )}
              {activeView === 'bins' && filter === 'unassigned' && (
                <>
                  <Select value={bulkShelfId} onValueChange={setBulkShelfId}>
                    <SelectTrigger className="w-32 h-7 text-[10px]" data-testid="select-bulk-shelf">
                      <SelectValue placeholder="Select shelf" />
                    </SelectTrigger>
                    <SelectContent>
                      {shelves.map((shelf: any) => (
                        <SelectItem key={shelf.id} value={String(shelf.id)}>
                          {shelf.aisleName ? `${shelf.aisleName} - ` : ''}{shelf.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button 
                    size="sm" 
                    onClick={handleBulkAssign} 
                    disabled={!bulkShelfId}
                    data-testid="button-bulk-assign"
                    className="text-[10px]"
                  >
                    Assign to Shelf
                  </Button>
                </>
              )}
            </div>
          )}

          {/* List Items */}
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {filteredList.length === 0 ? (
              <div className="text-center text-xs text-gray-500 py-4">
                No {filter === 'all' ? '' : filter} {activeView} found
              </div>
            ) : (
              filteredList.map((item: any) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 p-2 rounded hover-elevate text-xs"
                  data-testid={`list-item-${item.id}`}
                >
                  {activeView === 'lots' && (
                    <input
                      type="checkbox"
                      checked={selectedItems.has(item.id)}
                      onChange={() => toggleItemSelection(item.id)}
                      className="w-4 h-4 rounded"
                      data-testid={`checkbox-item-${item.id}`}
                    />
                  )}
                  {activeView === 'bins' && !item.assigned && (
                    <input
                      type="checkbox"
                      checked={selectedItems.has(item.id)}
                      onChange={() => toggleItemSelection(item.id)}
                      className="w-4 h-4 rounded"
                      data-testid={`checkbox-item-${item.id}`}
                    />
                  )}
                  <div
                    className="flex-1 cursor-pointer"
                    onClick={() => {
                      if (activeView === 'lots') {
                        onItemClick?.('inventory', item.id);
                      } else {
                        handleEdit(
                          activeView === 'aisles' ? 'aisle' : activeView === 'shelves' ? 'shelf' : 'bin',
                          item
                        );
                      }
                    }}
                  >
                    {activeView === 'lots' && (
                      <>
                        <div className="font-medium text-gray-300">{item.itemNo}</div>
                        <div className="text-[10px] text-gray-500">
                          {item.colorName} • {item.newOrUsed === 'N' ? 'New' : 'Used'} • Qty: {item.quantity}
                          {item.binName && ` • Bin: ${item.binName}`}
                        </div>
                      </>
                    )}
                    {activeView === 'bins' && (
                      <>
                        <div className="font-medium text-gray-300">{item.name}</div>
                        <div className="text-[10px] text-gray-500">
                          {item.shelfName ? `Shelf: ${item.aisleName ? `${item.aisleName} - ` : ''}${item.shelfName}` : 'Unassigned'}
                        </div>
                      </>
                    )}
                    {activeView === 'shelves' && (
                      <>
                        <div className="font-medium text-gray-300">{item.name}</div>
                        <div className="text-[10px] text-gray-500">
                          {item.aisleName ? `Aisle: ${item.aisleName}` : 'Unassigned'}
                        </div>
                      </>
                    )}
                    {activeView === 'aisles' && (
                      <>
                        <div className="font-medium text-gray-300">{item.name}</div>
                        {item.description && (
                          <div className="text-[10px] text-gray-500">{item.description}</div>
                        )}
                      </>
                    )}
                  </div>
                  {item.assigned && (
                    <Badge variant="secondary" className="text-[9px]">
                      Assigned
                    </Badge>
                  )}
                </div>
              ))
            )}
          </div>
        </Card>
      )}

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {editType.charAt(0).toUpperCase() + editType.slice(1)}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div>
              <Label>Name *</Label>
              <Input 
                name="name" 
                required 
                defaultValue={editItem?.name || ''}
                data-testid="input-edit-name" 
              />
            </div>
            {editType === 'shelf' && (
              <div>
                <Label>Aisle (Optional)</Label>
                <Select value={editAisleId} onValueChange={setEditAisleId}>
                  <SelectTrigger data-testid="select-edit-aisle">
                    <SelectValue placeholder="Select aisle" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">None</SelectItem>
                    {aisles.map((aisle) => (
                      <SelectItem key={aisle.id} value={String(aisle.id)}>
                        {aisle.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {editType === 'bin' && (
              <div>
                <Label>Shelf (Optional)</Label>
                <Select value={editShelfId} onValueChange={setEditShelfId}>
                  <SelectTrigger data-testid="select-edit-shelf">
                    <SelectValue placeholder="Select shelf" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">None</SelectItem>
                    {shelves.map((shelf) => (
                      <SelectItem key={shelf.id} value={String(shelf.id)}>
                        {shelf.aisleName ? `${shelf.aisleName} - ` : ''}{shelf.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Description (Optional)</Label>
              <Input 
                name="description" 
                defaultValue={editItem?.description || ''}
                data-testid="input-edit-description" 
              />
            </div>
            <Button type="submit" className="w-full" data-testid="button-submit-edit">
              Update
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
