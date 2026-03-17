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
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Package,
  Plus,
  MapPin,
  Layers,
  Archive,
  Settings2,
  Loader2,
  Zap,
  ChevronRight,
  Pencil,
  Trash2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface WarehouseManagementProps {
  onItemClick?: (type: 'inventory', id: number) => void;
}

type ViewType = null | 'lots' | 'bins' | 'shelves' | 'aisles';
type FilterType = 'all' | 'assigned' | 'unassigned';

const DEPTH_OPTIONS = [
  {
    value: 1,
    label: "Bins Only",
    description: "Simple — just label your bins",
    example: "Bin-01, Bin-02…",
  },
  {
    value: 2,
    label: "Shelves + Bins",
    description: "Group bins onto shelves",
    example: "Shelf A → Bin A-01…",
  },
  {
    value: 3,
    label: "Full Warehouse",
    description: "Aisles, shelves, and bins",
    example: "Aisle 1 → Shelf A → Bin A-01",
  },
];

export default function WarehouseManagement({ onItemClick }: WarehouseManagementProps) {
  const { toast } = useToast();
  const [activeView, setActiveView] = useState<ViewType>(null);
  const [filter, setFilter] = useState<FilterType>('all');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createType, setCreateType] = useState<'aisle' | 'shelf' | 'bin'>('bin');
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [editType, setEditType] = useState<'aisle' | 'shelf' | 'bin'>('bin');
  const [editAisleId, setEditAisleId] = useState<string>("");
  const [editShelfId, setEditShelfId] = useState<string>("");
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());
  const [bulkBinId, setBulkBinId] = useState<string>("");
  const [bulkShelfId, setBulkShelfId] = useState<string>("");
  const [bulkAisleId, setBulkAisleId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [showDepthSetup, setShowDepthSetup] = useState(false);

  // Bulk bin state
  const [bulkPrefix, setBulkPrefix] = useState("BIN-");
  const [bulkStart, setBulkStart] = useState("1");
  const [bulkEnd, setBulkEnd] = useState("20");
  const [bulkPad, setBulkPad] = useState("2");
  const [bulkShelfForBins, setBulkShelfForBins] = useState<string>("");

  const { data: warehouseSettings, isLoading: settingsLoading } = useQuery<{ depth: number }>({
    queryKey: ['/api/warehouse/settings'],
  });
  const depth = warehouseSettings?.depth ?? 3;

  const { data: aisles = [] } = useQuery<any[]>({ queryKey: ['/api/warehouse/aisles'] });
  const { data: shelves = [] } = useQuery<any[]>({ queryKey: ['/api/warehouse/shelves'] });
  const { data: bins = [] } = useQuery<any[]>({ queryKey: ['/api/warehouse/bins'] });
  const { data: unassignedInventory = [] } = useQuery<any[]>({ queryKey: ['/api/warehouse/unassigned/inventory'] });
  const { data: unassignedBins = [] } = useQuery<any[]>({ queryKey: ['/api/warehouse/unassigned/bins'] });
  const { data: unassignedShelves = [] } = useQuery<any[]>({ queryKey: ['/api/warehouse/unassigned/shelves'] });
  const { data: inventoryStats } = useQuery<any>({ queryKey: ['/api/inventory/stats'] });
  const { data: locations = [] } = useQuery<any[]>({ queryKey: ['/api/warehouse/locations'] });

  const assignedLots = locations.length;
  const totalLots = inventoryStats?.totalLots || 0;
  const unassignedLots = totalLots - assignedLots;
  const assignedBins = bins.length - unassignedBins.length;
  const assignedShelves = shelves.length - unassignedShelves.length;

  const invalidateWarehouse = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/warehouse/aisles'] });
    queryClient.invalidateQueries({ queryKey: ['/api/warehouse/shelves'] });
    queryClient.invalidateQueries({ queryKey: ['/api/warehouse/bins'] });
    queryClient.invalidateQueries({ queryKey: ['/api/warehouse/unassigned/bins'] });
    queryClient.invalidateQueries({ queryKey: ['/api/warehouse/unassigned/shelves'] });
    queryClient.invalidateQueries({ queryKey: ['/api/warehouse/locations'] });
    queryClient.invalidateQueries({ queryKey: ['/api/warehouse/unassigned/inventory'] });
    queryClient.invalidateQueries({ queryKey: ['/api/inventory/stats'] });
  };

  const updateDepthMutation = useMutation({
    mutationFn: (d: number) => apiRequest('PATCH', '/api/warehouse/settings', { depth: d }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/settings'] });
      setShowDepthSetup(false);
      toast({ title: "Warehouse depth updated" });
    },
  });

  const createAisleMutation = useMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      apiRequest('POST', '/api/warehouse/aisles', data),
    onSuccess: () => { invalidateWarehouse(); toast({ title: "Aisle created" }); setCreateDialogOpen(false); },
  });

  const createShelfMutation = useMutation({
    mutationFn: (data: { name: string; aisleId?: number; description?: string }) =>
      apiRequest('POST', '/api/warehouse/shelves', data),
    onSuccess: () => { invalidateWarehouse(); toast({ title: "Shelf created" }); setCreateDialogOpen(false); },
  });

  const createBinMutation = useMutation({
    mutationFn: (data: { name: string; shelfId?: number; description?: string }) =>
      apiRequest('POST', '/api/warehouse/bins', data),
    onSuccess: () => { invalidateWarehouse(); toast({ title: "Bin created" }); setCreateDialogOpen(false); },
  });

  const bulkCreateBinsMutation = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/warehouse/bins/bulk', data),
    onSuccess: (data: any) => {
      invalidateWarehouse();
      toast({ title: `${data.created} bins created` });
      setBulkDialogOpen(false);
    },
  });

  const assignInventoryMutation = useMutation({
    mutationFn: (data: { inventoryId: number; binId: number }) =>
      apiRequest('POST', '/api/warehouse/assign/inventory', data),
    onSuccess: () => { invalidateWarehouse(); },
  });

  const assignBinToShelfMutation = useMutation({
    mutationFn: ({ binId, shelfId }: { binId: number; shelfId: number }) =>
      apiRequest('PUT', `/api/warehouse/assign/bin/${binId}/shelf/${shelfId}`, {}),
    onSuccess: () => { invalidateWarehouse(); },
  });

  const assignShelfToAisleMutation = useMutation({
    mutationFn: ({ shelfId, aisleId }: { shelfId: number; aisleId: number }) =>
      apiRequest('PUT', `/api/warehouse/assign/shelf/${shelfId}/aisle/${aisleId}`, {}),
    onSuccess: () => { invalidateWarehouse(); },
  });

  const updateAisleMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiRequest('PUT', `/api/warehouse/aisles/${id}`, data),
    onSuccess: () => { invalidateWarehouse(); toast({ title: "Aisle updated" }); setEditDialogOpen(false); },
  });

  const updateShelfMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiRequest('PUT', `/api/warehouse/shelves/${id}`, data),
    onSuccess: () => { invalidateWarehouse(); toast({ title: "Shelf updated" }); setEditDialogOpen(false); },
  });

  const updateBinMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiRequest('PUT', `/api/warehouse/bins/${id}`, data),
    onSuccess: () => { invalidateWarehouse(); toast({ title: "Bin updated" }); setEditDialogOpen(false); },
  });

  const handleCreateSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = fd.get('name') as string;
    const description = fd.get('description') as string;
    if (createType === 'aisle') {
      createAisleMutation.mutate({ name, description });
    } else if (createType === 'shelf') {
      const aisleId = fd.get('aisleId') as string;
      createShelfMutation.mutate({ name, aisleId: aisleId ? parseInt(aisleId) : undefined, description });
    } else {
      const shelfId = fd.get('shelfId') as string;
      createBinMutation.mutate({ name, shelfId: shelfId ? parseInt(shelfId) : undefined, description });
    }
  };

  const handleEditSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editItem) return;
    const fd = new FormData(e.currentTarget);
    const name = fd.get('name') as string;
    const description = fd.get('description') as string;
    if (editType === 'aisle') {
      updateAisleMutation.mutate({ id: editItem.id, data: { name, description } });
    } else if (editType === 'shelf') {
      updateShelfMutation.mutate({ id: editItem.id, data: { name, aisleId: editAisleId ? parseInt(editAisleId) : undefined, description } });
    } else {
      updateBinMutation.mutate({ id: editItem.id, data: { name, shelfId: editShelfId ? parseInt(editShelfId) : undefined, description } });
    }
  };

  const handleEdit = (type: 'aisle' | 'shelf' | 'bin', item: any) => {
    setEditType(type);
    setEditItem(item);
    setEditAisleId(item.aisleId?.toString() || "");
    setEditShelfId(item.shelfId?.toString() || "");
    setEditDialogOpen(true);
  };

  const toggleItemSelection = (itemId: number) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  };

  const handleBulkAssign = async () => {
    if (selectedItems.size === 0) return;
    const count = selectedItems.size;
    if (activeView === 'lots' && bulkBinId) {
      const binId = parseInt(bulkBinId);
      await Promise.all(Array.from(selectedItems).map(inventoryId =>
        assignInventoryMutation.mutateAsync({ inventoryId, binId })
      ));
      toast({ title: `${count} lot${count !== 1 ? 's' : ''} assigned` });
      setSelectedItems(new Set()); setBulkBinId("");
    } else if (activeView === 'bins' && bulkShelfId) {
      const shelfId = parseInt(bulkShelfId);
      await Promise.all(Array.from(selectedItems).map(binId =>
        assignBinToShelfMutation.mutateAsync({ binId, shelfId })
      ));
      toast({ title: `${count} bin${count !== 1 ? 's' : ''} assigned` });
      setSelectedItems(new Set()); setBulkShelfId("");
    } else if (activeView === 'shelves' && bulkAisleId) {
      const aisleId = parseInt(bulkAisleId);
      await Promise.all(Array.from(selectedItems).map(shelfId =>
        assignShelfToAisleMutation.mutateAsync({ shelfId, aisleId })
      ));
      toast({ title: `${count} ${count !== 1 ? 'shelves' : 'shelf'} assigned` });
      setSelectedItems(new Set()); setBulkAisleId("");
    }
  };

  const alphaNumericSort = (a: any, b: any) =>
    (a.itemNo || a.name || '').localeCompare(b.itemNo || b.name || '', undefined, { numeric: true, sensitivity: 'base' });

  const getFilteredList = () => {
    if (!activeView) return [];
    if (activeView === 'lots') {
      const assignedMap = new Map();
      locations.forEach((loc: any) => {
        assignedMap.set(loc.inventoryId, { id: loc.inventoryId, itemNo: loc.itemNo, itemName: loc.itemName, colorName: loc.colorName, newOrUsed: loc.newOrUsed, quantity: loc.quantity, binName: loc.binName, assigned: true });
      });
      const assigned = Array.from(assignedMap.values());
      const unassigned = unassignedInventory.map((item: any) => ({ ...item, assigned: false }));
      let items = filter === 'assigned' ? assigned : filter === 'unassigned' ? unassigned : [...assigned, ...unassigned];
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        items = items.filter((i: any) => i.itemNo?.toLowerCase().includes(q) || i.itemName?.toLowerCase().includes(q));
      }
      return items.sort(alphaNumericSort);
    }
    if (activeView === 'bins') {
      const assigned = bins.filter((b: any) => b.shelfId).map((b: any) => ({ ...b, assigned: true }));
      const unassigned = unassignedBins.map((b: any) => ({ ...b, assigned: false }));
      if (filter === 'assigned') return assigned.sort(alphaNumericSort);
      if (filter === 'unassigned') return unassigned.sort(alphaNumericSort);
      return [...assigned, ...unassigned].sort(alphaNumericSort);
    }
    if (activeView === 'shelves') {
      const assigned = shelves.filter((s: any) => s.aisleId).map((s: any) => ({ ...s, assigned: true }));
      const unassigned = unassignedShelves.map((s: any) => ({ ...s, assigned: false }));
      if (filter === 'assigned') return assigned.sort(alphaNumericSort);
      if (filter === 'unassigned') return unassigned.sort(alphaNumericSort);
      return [...assigned, ...unassigned].sort(alphaNumericSort);
    }
    if (activeView === 'aisles') {
      return aisles.map((a: any) => ({ ...a, assigned: true })).sort(alphaNumericSort);
    }
    return [];
  };

  const filteredList = getFilteredList();

  // Bulk bin preview
  const bulkPreviewCount = (() => {
    const s = parseInt(bulkStart), e = parseInt(bulkEnd);
    if (isNaN(s) || isNaN(e) || s > e) return 0;
    return Math.min(e - s + 1, 500);
  })();
  const bulkPreviewNames = (() => {
    const s = parseInt(bulkStart), e = parseInt(bulkEnd), pad = parseInt(bulkPad) || 0;
    if (isNaN(s) || isNaN(e) || s > e) return [];
    const names = [];
    for (let i = s; i <= Math.min(e, s + 2); i++) {
      names.push(`${bulkPrefix}${pad > 0 ? String(i).padStart(pad, '0') : i}`);
    }
    if (e - s > 2) names.push(`…${bulkPrefix}${pad > 0 ? String(e).padStart(pad, '0') : e}`);
    return names;
  })();

  const depthOption = DEPTH_OPTIONS.find(d => d.value === depth) || DEPTH_OPTIONS[2];

  if (settingsLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-3 min-h-[60vh]">

      {/* Depth Selector */}
      {showDepthSetup ? (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Warehouse Setup Style</p>
              <p className="text-xs text-muted-foreground mt-0.5">Choose how deep your location hierarchy goes</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowDepthSetup(false)}>Cancel</Button>
          </div>
          <div className="grid gap-2">
            {DEPTH_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => updateDepthMutation.mutate(opt.value)}
                disabled={updateDepthMutation.isPending}
                className={`flex items-start gap-3 p-3 rounded-md border text-left transition-colors hover-elevate ${depth === opt.value ? 'border-yellow-500/60 bg-yellow-500/10' : 'border-border'}`}
                data-testid={`button-depth-${opt.value}`}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{opt.label}</span>
                    {depth === opt.value && <Badge className="text-[10px] px-1.5 py-0">Current</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
                  <p className="text-[10px] text-muted-foreground/70 mt-0.5 font-mono">{opt.example}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              </button>
            ))}
          </div>
        </Card>
      ) : (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Archive className="h-3.5 w-3.5" />
            <span className="font-medium">{depthOption.label}</span>
            <span className="text-muted-foreground/60">— {depthOption.description}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowDepthSetup(true)}
            className="text-xs h-7 px-2"
            data-testid="button-warehouse-setup"
          >
            <Settings2 className="h-3.5 w-3.5 mr-1" />
            Change
          </Button>
        </div>
      )}

      {/* Navigation Tabs — filtered by depth */}
      <div className="flex gap-2 overflow-x-auto">
        <button
          onClick={() => { setActiveView('lots'); setFilter('all'); setSelectedItems(new Set()); setSearchQuery(''); }}
          className={`flex-1 flex items-center justify-center gap-1.5 p-2.5 rounded-lg text-xs hover-elevate whitespace-nowrap ${activeView === 'lots' ? 'bg-blue-500/20 border-2 border-blue-500/40' : 'bg-muted/30 border-2 border-border'}`}
          data-testid="button-view-lots"
        >
          <Package className="w-4 h-4 text-blue-400" />
          <span className="font-semibold">Lots</span>
          {unassignedLots > 0 && (
            <Badge className="text-[9px] px-1 py-0 bg-blue-500/20 text-blue-300 no-default-active-elevate">{unassignedLots}</Badge>
          )}
        </button>

        <button
          onClick={() => { setActiveView('bins'); setFilter('all'); setSelectedItems(new Set()); setSearchQuery(''); }}
          className={`flex-1 flex items-center justify-center gap-1.5 p-2.5 rounded-lg text-xs hover-elevate whitespace-nowrap ${activeView === 'bins' ? 'bg-green-500/20 border-2 border-green-500/40' : 'bg-muted/30 border-2 border-border'}`}
          data-testid="button-view-bins"
        >
          <Archive className="w-4 h-4 text-green-400" />
          <span className="font-semibold">Bins</span>
          <span className="text-muted-foreground font-normal">{bins.length}</span>
        </button>

        {depth >= 2 && (
          <button
            onClick={() => { setActiveView('shelves'); setFilter('all'); setSelectedItems(new Set()); setSearchQuery(''); }}
            className={`flex-1 flex items-center justify-center gap-1.5 p-2.5 rounded-lg text-xs hover-elevate whitespace-nowrap ${activeView === 'shelves' ? 'bg-orange-500/20 border-2 border-orange-500/40' : 'bg-muted/30 border-2 border-border'}`}
            data-testid="button-view-shelves"
          >
            <Layers className="w-4 h-4 text-orange-400" />
            <span className="font-semibold">Shelves</span>
            <span className="text-muted-foreground font-normal">{shelves.length}</span>
          </button>
        )}

        {depth >= 3 && (
          <button
            onClick={() => { setActiveView('aisles'); setFilter('all'); setSelectedItems(new Set()); setSearchQuery(''); }}
            className={`flex-1 flex items-center justify-center gap-1.5 p-2.5 rounded-lg text-xs hover-elevate whitespace-nowrap ${activeView === 'aisles' ? 'bg-purple-500/20 border-2 border-purple-500/40' : 'bg-muted/30 border-2 border-border'}`}
            data-testid="button-view-aisles"
          >
            <MapPin className="w-4 h-4 text-purple-400" />
            <span className="font-semibold">Aisles</span>
            <span className="text-muted-foreground font-normal">{aisles.length}</span>
          </button>
        )}
      </div>

      {/* List View */}
      {activeView && (
        <Card className="p-3">
          {/* Stats row */}
          <div className="flex items-center gap-3 mb-3 text-xs flex-wrap">
            {activeView === 'lots' && (<>
              <span className="text-muted-foreground">Total: <span className="font-bold text-blue-400">{totalLots}</span></span>
              <span className="text-muted-foreground">Assigned: <span className="font-semibold">{assignedLots}</span></span>
              <span className="text-muted-foreground">Unassigned: <span className="font-semibold">{unassignedLots}</span></span>
            </>)}
            {activeView === 'bins' && (<>
              <span className="text-muted-foreground">Total: <span className="font-bold text-green-400">{bins.length}</span></span>
              {depth >= 2 && <span className="text-muted-foreground">On shelf: <span className="font-semibold">{assignedBins}</span></span>}
              {depth >= 2 && <span className="text-muted-foreground">Floating: <span className="font-semibold">{unassignedBins.length}</span></span>}
            </>)}
            {activeView === 'shelves' && (<>
              <span className="text-muted-foreground">Total: <span className="font-bold text-orange-400">{shelves.length}</span></span>
              {depth >= 3 && <span className="text-muted-foreground">In aisle: <span className="font-semibold">{assignedShelves}</span></span>}
              {depth >= 3 && <span className="text-muted-foreground">Floating: <span className="font-semibold">{unassignedShelves.length}</span></span>}
            </>)}
            {activeView === 'aisles' && (
              <span className="text-muted-foreground">Total: <span className="font-bold text-purple-400">{aisles.length}</span></span>
            )}
          </div>

          {/* Search (lots only) */}
          {activeView === 'lots' && (
            <Input
              placeholder="Search by part number or name…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="text-xs mb-3"
              data-testid="input-search-lots"
            />
          )}

          {/* Filters + Actions row */}
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <div className="flex gap-1">
              {(['all', 'assigned', ...(activeView === 'lots' ? ['unassigned'] : [])] as FilterType[]).map(f => (
                <Button key={f} size="sm" variant={filter === f ? 'default' : 'ghost'} onClick={() => setFilter(f)}
                  className="text-[10px] md:text-xs py-1 px-2 capitalize" data-testid={`filter-${f}`}>
                  {f}
                </Button>
              ))}
            </div>

            <div className="flex gap-1">
              {activeView === 'bins' && (
                <Button size="sm" variant="outline" onClick={() => setBulkDialogOpen(true)}
                  className="text-[10px] md:text-xs" data-testid="button-bulk-create-bins">
                  <Zap className="w-3 h-3 mr-1" />
                  Bulk Create
                </Button>
              )}
              {(activeView === 'aisles' || activeView === 'shelves' || activeView === 'bins') && (
                <Button size="sm" onClick={() => {
                  setCreateType(activeView === 'aisles' ? 'aisle' : activeView === 'shelves' ? 'shelf' : 'bin');
                  setCreateDialogOpen(true);
                }} data-testid="button-add-new" className="text-[10px] md:text-xs">
                  <Plus className="w-3 h-3 mr-1" />
                  Add One
                </Button>
              )}
            </div>
          </div>

          {/* Bulk assignment bar */}
          {selectedItems.size > 0 && (
            <div className="flex items-center gap-2 mb-3 p-2 bg-muted/30 rounded-md flex-wrap">
              <span className="text-xs font-medium">{selectedItems.size} selected</span>
              {activeView === 'lots' && (
                <Select value={bulkBinId} onValueChange={setBulkBinId}>
                  <SelectTrigger className="h-7 text-xs flex-1 min-w-[120px]">
                    <SelectValue placeholder="Assign to bin…" />
                  </SelectTrigger>
                  <SelectContent>
                    {bins.map((b: any) => (
                      <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {activeView === 'bins' && depth >= 2 && (
                <Select value={bulkShelfId} onValueChange={setBulkShelfId}>
                  <SelectTrigger className="h-7 text-xs flex-1 min-w-[120px]">
                    <SelectValue placeholder="Assign to shelf…" />
                  </SelectTrigger>
                  <SelectContent>
                    {shelves.map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {activeView === 'shelves' && depth >= 3 && (
                <Select value={bulkAisleId} onValueChange={setBulkAisleId}>
                  <SelectTrigger className="h-7 text-xs flex-1 min-w-[120px]">
                    <SelectValue placeholder="Assign to aisle…" />
                  </SelectTrigger>
                  <SelectContent>
                    {aisles.map((a: any) => (
                      <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button size="sm" onClick={handleBulkAssign} className="text-xs h-7">Assign</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedItems(new Set())} className="text-xs h-7">Clear</Button>
            </div>
          )}

          {/* Item list */}
          <div className="space-y-1 max-h-[55vh] overflow-y-auto">
            {filteredList.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground py-8">
                {activeView === 'lots' && filter === 'unassigned' ? "All lots are assigned — great job!" : "Nothing here yet."}
              </p>
            ) : filteredList.map((item: any) => (
              <div
                key={item.id}
                className="flex items-center gap-2 p-2 rounded-md hover-elevate cursor-pointer"
                onClick={() => {
                  if (activeView === 'lots' && item.assigned && onItemClick) {
                    onItemClick('inventory', item.id);
                  } else {
                    toggleItemSelection(item.id);
                  }
                }}
                data-testid={`item-${activeView}-${item.id}`}
              >
                <input
                  type="checkbox"
                  checked={selectedItems.has(item.id)}
                  onChange={() => toggleItemSelection(item.id)}
                  onClick={e => e.stopPropagation()}
                  className="rounded h-3.5 w-3.5 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-medium truncate">
                      {activeView === 'lots' ? (item.itemNo || item.name || '—') : item.name}
                    </span>
                    {activeView === 'lots' && item.colorName && (
                      <span className="text-[10px] text-muted-foreground">{item.colorName}</span>
                    )}
                    {activeView === 'lots' && item.newOrUsed && (
                      <Badge className={`text-[9px] px-1 py-0 no-default-active-elevate ${item.newOrUsed === 'N' ? 'bg-blue-500/20 text-blue-300' : 'bg-orange-500/20 text-orange-300'}`}>
                        {item.newOrUsed === 'N' ? 'New' : 'Used'}
                      </Badge>
                    )}
                    <Badge className={`text-[9px] px-1 py-0 no-default-active-elevate ${item.assigned ? 'bg-green-500/20 text-green-400' : 'bg-muted/40 text-muted-foreground'}`}>
                      {item.assigned ? 'Assigned' : 'Unassigned'}
                    </Badge>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {activeView === 'lots' && item.itemName && <span className="truncate block">{item.itemName}</span>}
                    {activeView === 'lots' && item.binName && <span>Bin: {item.binName}</span>}
                    {activeView === 'lots' && item.quantity != null && <span> · Qty: {item.quantity}</span>}
                    {activeView === 'bins' && item.shelfName && <span>Shelf: {item.shelfName}</span>}
                    {activeView === 'shelves' && item.aisleName && <span>Aisle: {item.aisleName}</span>}
                  </div>
                </div>
                {(activeView === 'bins' || activeView === 'shelves' || activeView === 'aisles') && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 shrink-0"
                    onClick={e => { e.stopPropagation(); handleEdit(activeView === 'aisles' ? 'aisle' : activeView === 'shelves' ? 'shelf' : 'bin', item); }}
                    data-testid={`button-edit-${activeView}-${item.id}`}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create {createType.charAt(0).toUpperCase() + createType.slice(1)}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateSubmit} className="space-y-4">
            <div>
              <Label>Name *</Label>
              <Input name="name" required data-testid="input-create-name" />
            </div>
            {createType === 'shelf' && depth >= 3 && (
              <div>
                <Label>Aisle <span className="text-muted-foreground">(optional)</span></Label>
                <Select name="aisleId">
                  <SelectTrigger data-testid="select-aisle">
                    <SelectValue placeholder="No aisle" />
                  </SelectTrigger>
                  <SelectContent>
                    {aisles.map((a: any) => (
                      <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {createType === 'bin' && depth >= 2 && (
              <div>
                <Label>Shelf <span className="text-muted-foreground">(optional)</span></Label>
                <Select name="shelfId">
                  <SelectTrigger data-testid="select-shelf">
                    <SelectValue placeholder="No shelf" />
                  </SelectTrigger>
                  <SelectContent>
                    {shelves.map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Description <span className="text-muted-foreground">(optional)</span></Label>
              <Input name="description" data-testid="input-create-description" />
            </div>
            <Button type="submit" className="w-full" disabled={createAisleMutation.isPending || createShelfMutation.isPending || createBinMutation.isPending}>
              {(createAisleMutation.isPending || createShelfMutation.isPending || createBinMutation.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Bulk Create Bins Dialog */}
      <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk Create Bins</DialogTitle>
            <DialogDescription>Generate a numbered series of bins at once.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Prefix</Label>
                <Input value={bulkPrefix} onChange={e => setBulkPrefix(e.target.value)} placeholder="BIN-" data-testid="input-bulk-prefix" />
              </div>
              <div>
                <Label>Number padding</Label>
                <Input type="number" min={0} max={6} value={bulkPad} onChange={e => setBulkPad(e.target.value)} placeholder="2 = 01, 02…" data-testid="input-bulk-pad" />
              </div>
              <div>
                <Label>From #</Label>
                <Input type="number" value={bulkStart} onChange={e => setBulkStart(e.target.value)} data-testid="input-bulk-start" />
              </div>
              <div>
                <Label>To #</Label>
                <Input type="number" value={bulkEnd} onChange={e => setBulkEnd(e.target.value)} data-testid="input-bulk-end" />
              </div>
            </div>
            {depth >= 2 && (
              <div>
                <Label>Assign to shelf <span className="text-muted-foreground">(optional)</span></Label>
                <Select value={bulkShelfForBins} onValueChange={setBulkShelfForBins}>
                  <SelectTrigger data-testid="select-bulk-shelf">
                    <SelectValue placeholder="No shelf" />
                  </SelectTrigger>
                  <SelectContent>
                    {shelves.map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {bulkPreviewCount > 0 && (
              <div className="bg-muted/30 rounded-md p-3 text-xs space-y-1">
                <p className="font-medium">Preview — {bulkPreviewCount} bins will be created</p>
                <p className="text-muted-foreground font-mono">{bulkPreviewNames.join(', ')}</p>
              </div>
            )}
            <Button
              className="w-full"
              disabled={bulkPreviewCount === 0 || bulkCreateBinsMutation.isPending}
              onClick={() => bulkCreateBinsMutation.mutate({
                prefix: bulkPrefix,
                start: parseInt(bulkStart),
                end: parseInt(bulkEnd),
                padLength: parseInt(bulkPad) || 0,
                shelfId: bulkShelfForBins || undefined,
              })}
              data-testid="button-bulk-create-confirm"
            >
              {bulkCreateBinsMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Zap className="h-4 w-4 mr-2" />}
              Create {bulkPreviewCount} Bins
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {editType.charAt(0).toUpperCase() + editType.slice(1)}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div>
              <Label>Name *</Label>
              <Input name="name" defaultValue={editItem?.name} required data-testid="input-edit-name" />
            </div>
            {editType === 'shelf' && depth >= 3 && (
              <div>
                <Label>Aisle <span className="text-muted-foreground">(optional)</span></Label>
                <Select value={editAisleId} onValueChange={setEditAisleId}>
                  <SelectTrigger><SelectValue placeholder="No aisle" /></SelectTrigger>
                  <SelectContent>
                    {aisles.map((a: any) => (
                      <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {editType === 'bin' && depth >= 2 && (
              <div>
                <Label>Shelf <span className="text-muted-foreground">(optional)</span></Label>
                <Select value={editShelfId} onValueChange={setEditShelfId}>
                  <SelectTrigger><SelectValue placeholder="No shelf" /></SelectTrigger>
                  <SelectContent>
                    {shelves.map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Description <span className="text-muted-foreground">(optional)</span></Label>
              <Input name="description" defaultValue={editItem?.description} data-testid="input-edit-description" />
            </div>
            <Button type="submit" className="w-full" disabled={updateAisleMutation.isPending || updateShelfMutation.isPending || updateBinMutation.isPending}>
              {(updateAisleMutation.isPending || updateShelfMutation.isPending || updateBinMutation.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
