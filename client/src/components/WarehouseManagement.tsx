import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Warehouse,
  Package,
  Plus,
  Edit,
  Trash2,
  ChevronRight,
  MapPin,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface WarehouseManagementProps {
  onItemClick?: (type: 'inventory', id: number) => void;
}

export default function WarehouseManagement({ onItemClick }: WarehouseManagementProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('overview');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createType, setCreateType] = useState<'aisle' | 'shelf' | 'bin'>('aisle');
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [editType, setEditType] = useState<'aisle' | 'shelf' | 'bin'>('aisle');
  const [editAisleId, setEditAisleId] = useState<string>("");
  const [editShelfId, setEditShelfId] = useState<string>("");

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
      // Invalidate shelves, aisles (aisle shelf counts affected), and unassigned shelves (new shelves may be unassigned)
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
      // Invalidate bins, shelves (bin counts), aisles, and unassigned bins (new bins may be unassigned)
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
      // Invalidate all affected queries: unassigned lots, bins (lot counts), shelves, aisles, locations
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/unassigned/inventory'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/bins'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/shelves'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/aisles'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/locations'] });
      toast({ title: "Lot assigned successfully" });
    },
  });

  const assignBinToShelfMutation = useMutation({
    mutationFn: async ({ binId, shelfId }: { binId: number; shelfId: number }) => {
      const response = await apiRequest('PUT', `/api/warehouse/assign/bin/${binId}/shelf/${shelfId}`, {});
      return await response.json();
    },
    onSuccess: () => {
      // Invalidate bins, unassigned bins, shelves (bin counts), and aisles
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/bins'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/unassigned/bins'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/shelves'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/aisles'] });
      toast({ title: "Bin assigned to shelf" });
    },
  });

  const assignShelfToAisleMutation = useMutation({
    mutationFn: async ({ shelfId, aisleId }: { shelfId: number; aisleId: number }) => {
      const response = await apiRequest('PUT', `/api/warehouse/assign/shelf/${shelfId}/aisle/${aisleId}`, {});
      return await response.json();
    },
    onSuccess: () => {
      // Invalidate shelves, unassigned shelves, and aisles (shelf counts)
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/shelves'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/unassigned/shelves'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/aisles'] });
      toast({ title: "Shelf assigned to aisle" });
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
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/shelves'] });
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
      toast({ title: "Bin updated successfully" });
      setEditDialogOpen(false);
    },
  });

  // Delete mutations
  const deleteAisleMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest('DELETE', `/api/warehouse/aisles/${id}`, {});
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/aisles'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/shelves'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/bins'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/unassigned/shelves'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/unassigned/bins'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/locations'] });
      toast({ title: "Aisle deleted successfully" });
    },
  });

  const deleteShelfMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest('DELETE', `/api/warehouse/shelves/${id}`, {});
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/shelves'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/aisles'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/bins'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/unassigned/shelves'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/unassigned/bins'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/locations'] });
      toast({ title: "Shelf deleted successfully" });
    },
  });

  const deleteBinMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest('DELETE', `/api/warehouse/bins/${id}`, {});
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/bins'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/shelves'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/aisles'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/unassigned/bins'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/unassigned/shelves'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/locations'] });
      toast({ title: "Bin deleted successfully" });
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
        aisleId: aisleId ? parseInt(aisleId) : undefined,
        description 
      });
    } else if (createType === 'bin') {
      const shelfId = formData.get('shelfId') as string;
      createBinMutation.mutate({ 
        name, 
        shelfId: shelfId ? parseInt(shelfId) : undefined,
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
          aisleId: editAisleId ? parseInt(editAisleId) : undefined,
          description 
        }
      });
    } else if (editType === 'bin') {
      updateBinMutation.mutate({ 
        id: editItem.id,
        data: { 
          name, 
          shelfId: editShelfId ? parseInt(editShelfId) : undefined,
          description 
        }
      });
    }
  };

  const handleEdit = (type: 'aisle' | 'shelf' | 'bin', item: any) => {
    setEditType(type);
    setEditItem(item);
    setEditAisleId(item.aisleId?.toString() || "");
    setEditShelfId(item.shelfId?.toString() || "");
    setEditDialogOpen(true);
  };

  const handleDelete = (type: 'aisle' | 'shelf' | 'bin', id: number) => {
    if (!confirm(`Are you sure you want to delete this ${type}?`)) return;
    
    if (type === 'aisle') {
      deleteAisleMutation.mutate(id);
    } else if (type === 'shelf') {
      deleteShelfMutation.mutate(id);
    } else if (type === 'bin') {
      deleteBinMutation.mutate(id);
    }
  };

  return (
    <div className="space-y-3">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full grid grid-cols-3">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="unassigned" data-testid="tab-unassigned">Unassigned</TabsTrigger>
          <TabsTrigger value="structure" data-testid="tab-structure">Structure</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-3 min-h-[60vh]">
          <div className="grid grid-cols-3 gap-2">
            <Card className="p-3">
              <div className="text-[9px] text-gray-500 uppercase font-bold mb-1">Aisles</div>
              <div className="text-xl font-bold text-blue-400">{aisles.length}</div>
            </Card>
            <Card className="p-3">
              <div className="text-[9px] text-gray-500 uppercase font-bold mb-1">Shelves</div>
              <div className="text-xl font-bold text-green-400">{shelves.length}</div>
            </Card>
            <Card className="p-3">
              <div className="text-[9px] text-gray-500 uppercase font-bold mb-1">Bins</div>
              <div className="text-xl font-bold text-orange-400">{bins.length}</div>
            </Card>
          </div>

          <Card className="p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-yellow-400" />
                <h3 className="text-sm font-semibold">Quick Stats</h3>
              </div>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-400">Unassigned Lots</span>
                <Badge variant={unassignedInventory.length > 0 ? "destructive" : "secondary"}>
                  {unassignedInventory.length}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Unassigned Bins</span>
                <Badge variant={unassignedBins.length > 0 ? "destructive" : "secondary"}>
                  {unassignedBins.length}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Unassigned Shelves</span>
                <Badge variant={unassignedShelves.length > 0 ? "destructive" : "secondary"}>
                  {unassignedShelves.length}
                </Badge>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* Unassigned Lots Tab */}
        <TabsContent value="unassigned" className="space-y-3 min-h-[60vh]">
          <UnassignedInventorySection 
            items={unassignedInventory} 
            bins={bins}
            onAssign={assignInventoryMutation.mutate}
            onItemClick={onItemClick}
          />
          <UnassignedBinsSection 
            bins={unassignedBins}
            shelves={shelves}
            onAssign={assignBinToShelfMutation.mutate}
          />
          <UnassignedShelvesSection 
            shelves={unassignedShelves}
            aisles={aisles}
            onAssign={assignShelfToAisleMutation.mutate}
          />
        </TabsContent>

        {/* Structure Management Tab */}
        <TabsContent value="structure" className="space-y-3 min-h-[60vh]">
          <div className="flex justify-end">
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-create-new">
                  <Plus className="w-4 h-4 mr-1" />
                  Create New
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New Item</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleCreateSubmit} className="space-y-4">
                  <div>
                    <Label>Type</Label>
                    <Select value={createType} onValueChange={(v) => setCreateType(v as any)}>
                      <SelectTrigger data-testid="select-create-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="aisle">Aisle</SelectItem>
                        <SelectItem value="shelf">Shelf</SelectItem>
                        <SelectItem value="bin">Bin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Name *</Label>
                    <Input name="name" required data-testid="input-name" />
                  </div>
                  {createType === 'shelf' && (
                    <div>
                      <Label>Aisle (Optional)</Label>
                      <Select name="aisleId">
                        <SelectTrigger data-testid="select-aisle">
                          <SelectValue placeholder="Select aisle" />
                        </SelectTrigger>
                        <SelectContent>
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
                        <SelectTrigger data-testid="select-shelf">
                          <SelectValue placeholder="Select shelf" />
                        </SelectTrigger>
                        <SelectContent>
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
                    <Input name="description" data-testid="input-description" />
                  </div>
                  <Button type="submit" className="w-full" data-testid="button-submit-create">
                    Create {createType.charAt(0).toUpperCase() + createType.slice(1)}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>

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
                        <SelectItem value="">None</SelectItem>
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
                        <SelectItem value="">None</SelectItem>
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
                  Update {editType.charAt(0).toUpperCase() + editType.slice(1)}
                </Button>
              </form>
            </DialogContent>
          </Dialog>

          <StructureView 
            aisles={aisles}
            shelves={shelves}
            bins={bins}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function UnassignedInventorySection({ items, bins, onAssign, onItemClick }: any) {
  const [selectedItems, setSelectedItems] = useState<Record<number, number>>({});
  const [selectedLots, setSelectedLots] = useState<Set<number>>(new Set());
  const [bulkBinId, setBulkBinId] = useState<string>("");

  const toggleLotSelection = (itemId: number) => {
    const newSelected = new Set(selectedLots);
    if (newSelected.has(itemId)) {
      newSelected.delete(itemId);
    } else {
      newSelected.add(itemId);
    }
    setSelectedLots(newSelected);
  };

  const handleBulkAssign = () => {
    if (!bulkBinId || selectedLots.size === 0) return;
    
    const binId = parseInt(bulkBinId);
    
    // Call mutation for each selected lot
    Array.from(selectedLots).forEach(inventoryId => {
      onAssign({ inventoryId, binId });
    });
    
    // Clear selections
    setSelectedLots(new Set());
    setBulkBinId("");
  };

  if (items.length === 0) {
    return (
      <Card className="p-4">
        <div className="text-center text-sm text-gray-400">
          All lots are assigned to bins
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-orange-400" />
          <h3 className="text-sm font-semibold">Unassigned Lots ({items.length})</h3>
        </div>
        {selectedLots.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">{selectedLots.size} selected</span>
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
            <Button size="sm" onClick={handleBulkAssign} disabled={!bulkBinId} data-testid="button-bulk-assign">
              Assign All
            </Button>
          </div>
        )}
      </div>
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {items.slice(0, 50).map((item: any) => (
          <div key={item.id} className="flex items-center gap-2 text-xs hover-elevate rounded p-2">
            <input
              type="checkbox"
              checked={selectedLots.has(item.id)}
              onChange={() => toggleLotSelection(item.id)}
              className="w-4 h-4 rounded"
              data-testid={`checkbox-lot-${item.id}`}
            />
            <div 
              className="flex-1 cursor-pointer"
              onClick={() => onItemClick?.('inventory', item.id)}
            >
              <div className="font-medium text-gray-300">{item.itemNo}</div>
              <div className="text-[10px] text-gray-500">
                {item.colorName} • {item.newOrUsed === 'N' ? 'New' : 'Used'} • Qty: {item.quantity}
              </div>
            </div>
            <Select
              value={selectedItems[item.id] ? String(selectedItems[item.id]) : ""}
              onValueChange={(binId) => setSelectedItems({ ...selectedItems, [item.id]: parseInt(binId) })}
            >
              <SelectTrigger className="w-32 h-7 text-[10px]" data-testid={`select-bin-${item.id}`}>
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
              disabled={!selectedItems[item.id]}
              onClick={() => {
                if (selectedItems[item.id]) {
                  onAssign({ inventoryId: item.id, binId: selectedItems[item.id] });
                }
              }}
              data-testid={`button-assign-${item.id}`}
            >
              Assign
            </Button>
          </div>
        ))}
        {items.length > 50 && (
          <div className="text-center text-[10px] text-gray-500 pt-2">
            Showing first 50 of {items.length} lots
          </div>
        )}
      </div>
    </Card>
  );
}

function UnassignedBinsSection({ bins, shelves, onAssign }: any) {
  const [selectedBins, setSelectedBins] = useState<Record<number, number>>({});

  if (bins.length === 0) {
    return (
      <Card className="p-4">
        <div className="text-center text-sm text-gray-400">
          All bins are assigned to shelves
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 mb-3">
        <Package className="w-4 h-4 text-blue-400" />
        <h3 className="text-sm font-semibold">Unassigned Bins ({bins.length})</h3>
      </div>
      <div className="space-y-2">
        {bins.map((bin: any) => (
          <div key={bin.id} className="flex items-center gap-2 text-xs hover-elevate rounded p-2">
            <div className="flex-1">
              <div className="font-medium text-gray-300">{bin.name}</div>
            </div>
            <Select
              value={selectedBins[bin.id] ? String(selectedBins[bin.id]) : ""}
              onValueChange={(shelfId) => setSelectedBins({ ...selectedBins, [bin.id]: parseInt(shelfId) })}
            >
              <SelectTrigger className="w-40 h-7 text-[10px]" data-testid={`select-shelf-${bin.id}`}>
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
              disabled={!selectedBins[bin.id]}
              onClick={() => {
                if (selectedBins[bin.id]) {
                  onAssign({ binId: bin.id, shelfId: selectedBins[bin.id] });
                }
              }}
              data-testid={`button-assign-bin-${bin.id}`}
            >
              Assign
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function UnassignedShelvesSection({ shelves, aisles, onAssign }: any) {
  const [selectedShelves, setSelectedShelves] = useState<Record<number, number>>({});

  if (shelves.length === 0) {
    return (
      <Card className="p-4">
        <div className="text-center text-sm text-gray-400">
          All shelves are assigned to aisles
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-3">
      <div className="flex items-center gap-2 mb-3">
        <Warehouse className="w-4 h-4 text-green-400" />
        <h3 className="text-sm font-semibold">Unassigned Shelves ({shelves.length})</h3>
      </div>
      <div className="space-y-2">
        {shelves.map((shelf: any) => (
          <div key={shelf.id} className="flex items-center gap-2 text-xs hover-elevate rounded p-2">
            <div className="flex-1">
              <div className="font-medium text-gray-300">{shelf.name}</div>
            </div>
            <Select
              value={selectedShelves[shelf.id] ? String(selectedShelves[shelf.id]) : ""}
              onValueChange={(aisleId) => setSelectedShelves({ ...selectedShelves, [shelf.id]: parseInt(aisleId) })}
            >
              <SelectTrigger className="w-32 h-7 text-[10px]" data-testid={`select-aisle-${shelf.id}`}>
                <SelectValue placeholder="Select aisle" />
              </SelectTrigger>
              <SelectContent>
                {aisles.map((aisle: any) => (
                  <SelectItem key={aisle.id} value={String(aisle.id)}>
                    {aisle.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={!selectedShelves[shelf.id]}
              onClick={() => {
                if (selectedShelves[shelf.id]) {
                  onAssign({ shelfId: shelf.id, aisleId: selectedShelves[shelf.id] });
                }
              }}
              data-testid={`button-assign-shelf-${shelf.id}`}
            >
              Assign
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function StructureView({ aisles, shelves, bins, onEdit, onDelete }: any) {
  const [expandedAisles, setExpandedAisles] = useState<Set<number>>(new Set());
  const [expandedShelves, setExpandedShelves] = useState<Set<number>>(new Set());

  const toggleAisle = (aisleId: number) => {
    const newExpanded = new Set(expandedAisles);
    if (newExpanded.has(aisleId)) {
      newExpanded.delete(aisleId);
    } else {
      newExpanded.add(aisleId);
    }
    setExpandedAisles(newExpanded);
  };

  const toggleShelf = (shelfId: number) => {
    const newExpanded = new Set(expandedShelves);
    if (newExpanded.has(shelfId)) {
      newExpanded.delete(shelfId);
    } else {
      newExpanded.add(shelfId);
    }
    setExpandedShelves(newExpanded);
  };

  return (
    <div className="space-y-2">
      {aisles.map((aisle: any) => {
        const aisleShelves = shelves.filter((s: any) => s.aisleId === aisle.id);
        const isExpanded = expandedAisles.has(aisle.id);

        return (
          <Card key={aisle.id} className="p-2">
            <div
              className="flex items-center justify-between hover-elevate rounded p-2"
              data-testid={`aisle-${aisle.id}`}
            >
              <div className="flex items-center gap-2 flex-1 cursor-pointer" onClick={() => toggleAisle(aisle.id)}>
                <ChevronRight className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                <Warehouse className="w-4 h-4 text-blue-400" />
                <span className="font-semibold text-sm">{aisle.name}</span>
                <Badge variant="secondary" className="text-[9px]">{aisleShelves.length} shelves</Badge>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => { e.stopPropagation(); onEdit('aisle', aisle); }}
                  data-testid={`button-edit-aisle-${aisle.id}`}
                >
                  <Edit className="w-3 h-3" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => { e.stopPropagation(); onDelete('aisle', aisle.id); }}
                  data-testid={`button-delete-aisle-${aisle.id}`}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>

            {isExpanded && (
              <div className="ml-6 mt-2 space-y-1">
                {aisleShelves.map((shelf: any) => {
                  const shelfBins = bins.filter((b: any) => b.shelfId === shelf.id);
                  const isShelfExpanded = expandedShelves.has(shelf.id);

                  return (
                    <div key={shelf.id}>
                      <div
                        className="flex items-center justify-between hover-elevate rounded p-2"
                        data-testid={`shelf-${shelf.id}`}
                      >
                        <div className="flex items-center gap-2 flex-1 cursor-pointer" onClick={() => toggleShelf(shelf.id)}>
                          <ChevronRight className={`w-3 h-3 transition-transform ${isShelfExpanded ? 'rotate-90' : ''}`} />
                          <span className="text-xs text-gray-300">{shelf.name}</span>
                          <Badge variant="secondary" className="text-[9px]">{shelfBins.length} bins</Badge>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => { e.stopPropagation(); onEdit('shelf', shelf); }}
                            data-testid={`button-edit-shelf-${shelf.id}`}
                          >
                            <Edit className="w-3 h-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => { e.stopPropagation(); onDelete('shelf', shelf.id); }}
                            data-testid={`button-delete-shelf-${shelf.id}`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>

                      {isShelfExpanded && (
                        <div className="ml-5 mt-1 space-y-1">
                          {shelfBins.map((bin: any) => (
                            <div key={bin.id} className="flex items-center justify-between hover-elevate rounded p-1.5 text-xs" data-testid={`bin-${bin.id}`}>
                              <div className="flex items-center gap-2">
                                <Package className="w-3 h-3 text-orange-400" />
                                <span className="text-gray-400">{bin.name}</span>
                                <Badge variant="outline" className="text-[9px]">{bin.itemCount} lots</Badge>
                              </div>
                              <div className="flex items-center gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={(e) => { e.stopPropagation(); onEdit('bin', bin); }}
                                  data-testid={`button-edit-bin-${bin.id}`}
                                >
                                  <Edit className="w-3 h-3" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={(e) => { e.stopPropagation(); onDelete('bin', bin.id); }}
                                  data-testid={`button-delete-bin-${bin.id}`}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
