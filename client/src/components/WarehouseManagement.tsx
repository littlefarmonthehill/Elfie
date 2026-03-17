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
  X,
  ExternalLink,
  SplitSquareHorizontal,
  Printer,
  Upload,
  CheckSquare,
  Square,
  FileText,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { QRCodeSVG } from "qrcode.react";

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

  // Lot locations dialog state
  const [lotDialogOpen, setLotDialogOpen] = useState(false);
  const [selectedLot, setSelectedLot] = useState<any>(null);
  const [addLocBinId, setAddLocBinId] = useState<string>("");
  const [addLocQty, setAddLocQty] = useState<string>("");
  const [addLocBagLabel, setAddLocBagLabel] = useState<string>("");
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [editingLocationId, setEditingLocationId] = useState<number | null>(null);
  const [editLocQty, setEditLocQty] = useState<string>("");

  // Print labels state
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [printLabelSize, setPrintLabelSize] = useState<'avery5160' | 'avery5163' | 'avery5164'>('avery5163');

  // Bulk bin state
  const [bulkPrefix, setBulkPrefix] = useState("BIN-");
  const [bulkStart, setBulkStart] = useState("1");
  const [bulkEnd, setBulkEnd] = useState("20");
  const [bulkPad, setBulkPad] = useState("2");
  const [bulkShelfForBins, setBulkShelfForBins] = useState<string>("");

  // Fill Bin dialog state
  const [fillBinDialogOpen, setFillBinDialogOpen] = useState(false);
  const [fillBinTargetId, setFillBinTargetId] = useState<string>("");
  const [fillBinCount, setFillBinCount] = useState("20");
  const [fillBinPending, setFillBinPending] = useState(false);
  const [fillBinDeselected, setFillBinDeselected] = useState<Set<number>>(new Set());
  const [fillBinManualAdds, setFillBinManualAdds] = useState<Map<number, any>>(new Map());
  const [fillBinSearch, setFillBinSearch] = useState("");

  // CSV Import state
  const [importCsvOpen, setImportCsvOpen] = useState(false);
  const [importMode, setImportMode] = useState<'structure' | 'assignments'>('structure');
  const [importCsvText, setImportCsvText] = useState("");
  const [importResult, setImportResult] = useState<{ created?: { aisles: number; shelves: number; bins: number; skipped: number }; stats?: { assigned: number; skipped: number; notFound: number }; errors: string[] } | null>(null);

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

  // Fetch all locations for the selected lot
  const { data: lotLocations = [], isLoading: lotLocationsLoading } = useQuery<any[]>({
    queryKey: ['/api/warehouse/locations/inventory', selectedLot?.id],
    queryFn: async () => {
      const res = await fetch(`/api/warehouse/locations/inventory/${selectedLot.id}`);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    enabled: !!selectedLot?.id && lotDialogOpen,
  });

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

  const invalidateLotLocations = (inventoryId: number) => {
    queryClient.invalidateQueries({ queryKey: ['/api/warehouse/locations/inventory', inventoryId] });
    queryClient.invalidateQueries({ queryKey: ['/api/warehouse/locations'] });
    queryClient.invalidateQueries({ queryKey: ['/api/warehouse/unassigned/inventory'] });
    queryClient.invalidateQueries({ queryKey: ['/api/inventory/stats'] });
  };

  const addLocationMutation = useMutation({
    mutationFn: (data: { inventoryId: number; binId: number; quantity?: number; bagLabel?: string }) =>
      apiRequest('POST', '/api/warehouse/assign/inventory', data),
    onSuccess: (_, vars) => {
      invalidateLotLocations(vars.inventoryId);
      invalidateWarehouse();
      setShowAddLocation(false);
      setAddLocBinId(""); setAddLocQty(""); setAddLocBagLabel("");
      toast({ title: "Location added" });
    },
    onError: () => toast({ title: "Failed to add location", variant: "destructive" }),
  });

  const updateLocationMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiRequest('PUT', `/api/warehouse/locations/${id}`, data),
    onSuccess: () => {
      if (selectedLot) invalidateLotLocations(selectedLot.id);
      invalidateWarehouse();
      setEditingLocationId(null);
      toast({ title: "Location updated" });
    },
    onError: () => toast({ title: "Failed to update location", variant: "destructive" }),
  });

  const deleteLocationMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/warehouse/locations/${id}`),
    onSuccess: () => {
      if (selectedLot) invalidateLotLocations(selectedLot.id);
      invalidateWarehouse();
      toast({ title: "Location removed" });
    },
    onError: () => toast({ title: "Failed to remove location", variant: "destructive" }),
  });

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
      const skipped = data.skipped ?? 0;
      if (data.created === 0) {
        toast({ title: `All ${skipped} bins already exist`, description: "Nothing was created — those bin names are already in use on this shelf." });
      } else if (skipped > 0) {
        toast({ title: `${data.created} bins created`, description: `${skipped} bin${skipped === 1 ? '' : 's'} skipped — already existed.` });
      } else {
        toast({ title: `${data.created} bins created` });
      }
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

  const deleteAisleMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/warehouse/aisles/${id}`),
    onSuccess: () => { invalidateWarehouse(); },
  });

  const deleteShelfMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/warehouse/shelves/${id}`),
    onSuccess: () => { invalidateWarehouse(); },
  });

  const deleteBinMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/warehouse/bins/${id}`),
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

  const importCsvMutation = useMutation({
    mutationFn: (csvText: string) => apiRequest('POST', '/api/warehouse/import/csv', { csvText }),
    onSuccess: async (res: any) => {
      const data = await res.json();
      setImportResult(data);
      invalidateWarehouse();
    },
    onError: () => toast({ title: "Import failed", variant: "destructive" }),
  });

  const importLotAssignmentsMutation = useMutation({
    mutationFn: (csvText: string) => apiRequest('POST', '/api/warehouse/import/lot-assignments', { csvText }),
    onSuccess: async (res: any) => {
      const data = await res.json();
      setImportResult(data);
      invalidateWarehouse();
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/locations'] });
    },
    onError: () => toast({ title: "Import failed", variant: "destructive" }),
  });

  const resetImportDialog = () => { setImportResult(null); setImportCsvText(""); };

  const handleSelectAll = () => {
    const allIds = new Set(filteredList.map((item: any) => item.id));
    setSelectedItems(allIds);
  };

  const handlePrintAll = () => {
    const allIds = new Set(filteredList.map((item: any) => item.id));
    setSelectedItems(allIds);
    setPrintDialogOpen(true);
  };

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

  const handleBulkDelete = async () => {
    if (selectedItems.size === 0) return;
    const count = selectedItems.size;
    const label = activeView === 'bins' ? 'bin' : activeView === 'shelves' ? 'shelf' : 'aisle';
    await Promise.all(Array.from(selectedItems).map(id => {
      if (activeView === 'bins') return deleteBinMutation.mutateAsync(id);
      if (activeView === 'shelves') return deleteShelfMutation.mutateAsync(id);
      if (activeView === 'aisles') return deleteAisleMutation.mutateAsync(id);
    }));
    toast({ title: `${count} ${label}${count !== 1 ? (label === 'shelf' ? 'ves' : 's') : ''} deleted` });
    setSelectedItems(new Set());
  };

  const alphaNumericSort = (a: any, b: any) =>
    (a.itemNo || a.name || '').localeCompare(b.itemNo || b.name || '', undefined, { numeric: true, sensitivity: 'base' });

  // Fill Bin: preview the next N unassigned lots sorted by part number
  const fillBinSorted = [...unassignedInventory].sort((a, b) =>
    (a.itemNo || '').localeCompare(b.itemNo || '', undefined, { numeric: true, sensitivity: 'base' })
  );
  const fillBinPreview = (() => {
    const count = Math.min(Math.max(parseInt(fillBinCount) || 20, 1), fillBinSorted.length);
    return fillBinSorted.slice(0, count);
  })();
  const fillBinHasMore = fillBinPreview.length < fillBinSorted.length;

  // Which preview items are actually checked (all minus explicitly deselected)
  const fillBinSelectedItems = fillBinPreview.filter(item => !fillBinDeselected.has(item.id));

  // All items that will be assigned: checked preview + manually added
  const fillBinToAssign = [
    ...fillBinSelectedItems,
    ...Array.from(fillBinManualAdds.values()),
  ];

  // Search results: unassigned lots matching query, not already in preview or manual adds
  const fillBinSearchResults = fillBinSearch.trim().length >= 1
    ? unassignedInventory
        .filter(item =>
          !fillBinPreview.some((p: any) => p.id === item.id) &&
          !fillBinManualAdds.has(item.id) &&
          (item.itemNo?.toLowerCase().includes(fillBinSearch.toLowerCase()) ||
           item.itemName?.toLowerCase().includes(fillBinSearch.toLowerCase()))
        )
        .slice(0, 12)
    : [];

  const toggleFillBinItem = (id: number) => {
    setFillBinDeselected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const addFillBinManual = (item: any) => {
    setFillBinManualAdds(prev => new Map(prev).set(item.id, item));
    setFillBinSearch("");
  };

  const removeFillBinManual = (id: number) => {
    setFillBinManualAdds(prev => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  const resetFillBinDialog = () => {
    setFillBinTargetId("");
    setFillBinDeselected(new Set());
    setFillBinManualAdds(new Map());
    setFillBinSearch("");
  };

  const handleFillBin = async () => {
    if (!fillBinTargetId || fillBinToAssign.length === 0) return;
    const binId = parseInt(fillBinTargetId);
    setFillBinPending(true);
    try {
      await Promise.all(fillBinToAssign.map(item =>
        assignInventoryMutation.mutateAsync({ inventoryId: item.id, binId })
      ));
      invalidateWarehouse();
      const binName = bins.find((b: any) => b.id === binId)?.name ?? 'bin';
      toast({ title: `${fillBinToAssign.length} lots assigned to ${binName}`, description: `${unassignedInventory.length - fillBinToAssign.length} unassigned lots remaining.` });
      setFillBinDialogOpen(false);
      resetFillBinDialog();
    } finally {
      setFillBinPending(false);
    }
  };

  const getFilteredList = () => {
    if (!activeView) return [];
    if (activeView === 'lots') {
      // Group all locations per inventory item (multi-location aware)
      const assignedMap = new Map<number, any>();
      locations.forEach((loc: any) => {
        if (!assignedMap.has(loc.inventoryId)) {
          assignedMap.set(loc.inventoryId, {
            id: loc.inventoryId, itemNo: loc.itemNo, itemName: loc.itemName,
            colorName: loc.colorName, newOrUsed: loc.newOrUsed,
            binNames: [], locationCount: 0, assigned: true,
          });
        }
        const entry = assignedMap.get(loc.inventoryId)!;
        entry.locationCount += 1;
        if (loc.binName) entry.binNames.push(loc.binName);
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

  // Build selected items data for print dialog
  const printItems = (() => {
    if (!activeView || selectedItems.size === 0) return [];
    const ids = Array.from(selectedItems);
    if (activeView === 'bins') return bins.filter((b: any) => ids.includes(b.id));
    if (activeView === 'shelves') return shelves.filter((s: any) => ids.includes(s.id));
    if (activeView === 'aisles') return aisles.filter((a: any) => ids.includes(a.id));
    return [];
  })();

  const getLabelQrData = (item: any) => {
    if (activeView === 'bins') return `BIN:${item.name}`;
    if (activeView === 'shelves') return `SHELF:${item.name}`;
    if (activeView === 'aisles') return `AISLE:${item.name}`;
    return item.name || String(item.id);
  };

  const getLabelSubtext = (item: any) => {
    if (activeView === 'bins') return [item.shelfName && `Shelf: ${item.shelfName}`, item.aisleName && `Aisle: ${item.aisleName}`].filter(Boolean).join('  ·  ');
    if (activeView === 'shelves') return item.aisleName ? `Aisle: ${item.aisleName}` : '';
    return '';
  };

  const LABEL_TEMPLATES: Record<string, {
    name: string; desc: string; perSheet: number;
    w: string; h: string; cols: number;
    pageMarginV: string; pageMarginH: string;
    colGap: string; rowGap: string;
    qr: number; font: string; sub: string;
    previewH: string; previewQr: number;
  }> = {
    avery5160: {
      name: 'Avery 5160 / 8160', desc: '1" × 2⅝"', perSheet: 30,
      w: '2.625in', h: '1in', cols: 3,
      pageMarginV: '0.5in', pageMarginH: '0.1875in',
      colGap: '0.125in', rowGap: '0in',
      qr: 48, font: '9px', sub: '7px',
      previewH: 'h-10', previewQr: 32,
    },
    avery5163: {
      name: 'Avery 5163 / 8163', desc: '2" × 4"', perSheet: 10,
      w: '4in', h: '2in', cols: 2,
      pageMarginV: '0.5in', pageMarginH: '0.15625in',
      colGap: '0.1875in', rowGap: '0in',
      qr: 88, font: '14px', sub: '10px',
      previewH: 'h-16', previewQr: 52,
    },
    avery5164: {
      name: 'Avery 5164 / 8164', desc: '3⅓" × 4"', perSheet: 6,
      w: '4in', h: '3.333in', cols: 2,
      pageMarginV: '0.5in', pageMarginH: '0.15625in',
      colGap: '0.1875in', rowGap: '0in',
      qr: 140, font: '18px', sub: '13px',
      previewH: 'h-24', previewQr: 72,
    },
  };

  const handlePrint = () => {
    if (printItems.length === 0) return;
    const origin = window.location.origin;
    const tmpl = LABEL_TEMPLATES[printLabelSize];
    const labelHtml = printItems.map((item: any) => {
      const qrData = getLabelQrData(item);
      const sub = getLabelSubtext(item);
      const qrUrl = `${origin}/api/warehouse/labels/qr?data=${encodeURIComponent(qrData)}&size=${tmpl.qr * 2}`;
      return `
        <div class="label">
          <img class="qr" src="${qrUrl}" width="${tmpl.qr}" height="${tmpl.qr}" />
          <div class="info">
            <div class="main">${item.name}</div>
            ${sub ? `<div class="sub">${sub}</div>` : ''}
          </div>
        </div>`;
    }).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Helvetica Neue', Arial, sans-serif; background: white; }
      @page {
        size: letter;
        margin: ${tmpl.pageMarginV} ${tmpl.pageMarginH};
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(${tmpl.cols}, ${tmpl.w});
        column-gap: ${tmpl.colGap};
        row-gap: ${tmpl.rowGap};
      }
      .label {
        width: ${tmpl.w}; height: ${tmpl.h};
        border: 1px solid #ccc;
        border-radius: 3px;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px;
        page-break-inside: avoid;
        background: white;
        overflow: hidden;
      }
      .qr { display: block; flex-shrink: 0; }
      .info { flex: 1; min-width: 0; overflow: hidden; }
      .main { font-size: ${tmpl.font}; font-weight: 700; color: #111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .sub { font-size: ${tmpl.sub}; color: #555; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
    </style>
    <script>
      window.addEventListener('load', function() {
        var images = Array.from(document.images);
        Promise.all(
          images.map(function(img) {
            return img.complete ? Promise.resolve() : new Promise(function(resolve) {
              img.onload = resolve;
              img.onerror = resolve;
            });
          })
        ).then(function() { window.print(); });
      });
    <\/script>
    </head><body>
    <div class="grid">${labelHtml}</div>
    </body></html>`;

    const win = window.open('', '_blank', 'width=800,height=600');
    if (win) {
      win.document.write(html);
      win.document.close();
    }
    setPrintDialogOpen(false);
  };

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
          <p className="text-[10px] text-muted-foreground/60 pt-1 border-t border-border">
            Upgrading to a deeper level is safe — your existing bins and all lot assignments are preserved. You simply gain the ability to organise bins onto shelves or aisles.
          </p>
        </Card>
      ) : (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Archive className="h-3.5 w-3.5" />
            <span className="font-medium">{depthOption.label}</span>
            <span className="text-muted-foreground/60 hidden sm:inline">— {depthOption.description}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7 px-2 gap-1"
              onClick={() => { setImportCsvOpen(true); setImportResult(null); setImportCsvText(""); }}
              data-testid="button-import-csv-top"
            >
              <Upload className="h-3 w-3" />
              Import CSV
            </Button>
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

            <div className="flex gap-1 flex-wrap">
              {/* Select All / Deselect All */}
              {(activeView === 'bins' || activeView === 'shelves' || activeView === 'aisles') && filteredList.length > 0 && (
                <>
                  {selectedItems.size === filteredList.length ? (
                    <Button size="sm" variant="ghost" onClick={() => setSelectedItems(new Set())}
                      className="text-[10px] md:text-xs" data-testid="button-deselect-all">
                      <CheckSquare className="w-3 h-3 mr-1 text-purple-400" />
                      Deselect All
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={handleSelectAll}
                      className="text-[10px] md:text-xs" data-testid="button-select-all">
                      <Square className="w-3 h-3 mr-1" />
                      Select All
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={handlePrintAll}
                    className="text-[10px] md:text-xs gap-1" data-testid="button-print-all-labels">
                    <Printer className="w-3 h-3" />
                    Print All
                  </Button>
                </>
              )}
              {activeView === 'lots' && unassignedInventory.length > 0 && (
                <Button size="sm" variant="outline" onClick={() => setFillBinDialogOpen(true)}
                  className="text-[10px] md:text-xs" data-testid="button-fill-bin">
                  <Zap className="w-3 h-3 mr-1" />
                  Fill a Bin
                </Button>
              )}
              {activeView === 'bins' && (
                <Button size="sm" variant="outline" onClick={() => setBulkDialogOpen(true)}
                  className="text-[10px] md:text-xs" data-testid="button-bulk-create-bins">
                  <Zap className="w-3 h-3 mr-1" />
                  Bulk Create
                </Button>
              )}
              {(activeView === 'aisles' || activeView === 'shelves' || activeView === 'bins') && (
                <>
                  <Button size="sm" variant="outline" onClick={() => { setImportCsvOpen(true); setImportResult(null); setImportCsvText(""); }}
                    className="text-[10px] md:text-xs" data-testid="button-import-csv">
                    <Upload className="w-3 h-3 mr-1" />
                    Import CSV
                  </Button>
                  <Button size="sm" onClick={() => {
                    setCreateType(activeView === 'aisles' ? 'aisle' : activeView === 'shelves' ? 'shelf' : 'bin');
                    setCreateDialogOpen(true);
                  }} data-testid="button-add-new" className="text-[10px] md:text-xs">
                    <Plus className="w-3 h-3 mr-1" />
                    Add One
                  </Button>
                </>
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
              {activeView === 'lots' && <Button size="sm" onClick={handleBulkAssign} className="text-xs h-7">Assign</Button>}
              {(activeView === 'bins' || activeView === 'shelves' || activeView === 'aisles') && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs h-7 gap-1"
                    onClick={() => setPrintDialogOpen(true)}
                    data-testid="button-print-labels"
                  >
                    <Printer className="h-3 w-3" />
                    Print Labels
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="text-xs h-7 gap-1"
                    onClick={handleBulkDelete}
                    data-testid="button-bulk-delete"
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete {selectedItems.size}
                  </Button>
                </>
              )}
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
                  if (activeView === 'lots' && item.assigned) {
                    setSelectedLot(item);
                    setLotDialogOpen(true);
                    setShowAddLocation(false);
                    setAddLocBinId(""); setAddLocQty(""); setAddLocBagLabel("");
                    setEditingLocationId(null);
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
                    {activeView === 'lots' && item.locationCount > 1 && (
                      <Badge className="text-[9px] px-1 py-0 bg-purple-500/20 text-purple-300 no-default-active-elevate">
                        <SplitSquareHorizontal className="h-2.5 w-2.5 mr-0.5" />{item.locationCount} bins
                      </Badge>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {activeView === 'lots' && item.itemName && <span className="truncate block">{item.itemName}</span>}
                    {activeView === 'lots' && item.assigned && item.binNames?.length > 0 && (
                      <span>
                        {item.binNames.slice(0, 2).join(', ')}
                        {item.binNames.length > 2 ? ` +${item.binNames.length - 2} more` : ''}
                      </span>
                    )}
                    {activeView === 'bins' && item.shelfName && <span>Shelf: {item.shelfName}</span>}
                    {activeView === 'shelves' && item.aisleName && <span>Aisle: {item.aisleName}</span>}
                  </div>
                </div>
                {(activeView === 'bins' || activeView === 'shelves' || activeView === 'aisles') && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={e => { e.stopPropagation(); handleEdit(activeView === 'aisles' ? 'aisle' : activeView === 'shelves' ? 'shelf' : 'bin', item); }}
                      data-testid={`button-edit-${activeView}-${item.id}`}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-destructive hover:text-destructive"
                      onClick={e => {
                        e.stopPropagation();
                        if (activeView === 'bins') deleteBinMutation.mutate(item.id);
                        else if (activeView === 'shelves') deleteShelfMutation.mutate(item.id);
                        else if (activeView === 'aisles') deleteAisleMutation.mutate(item.id);
                      }}
                      data-testid={`button-delete-${activeView}-${item.id}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Print Labels Dialog */}
      <Dialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="h-4 w-4 text-muted-foreground" />
              Print Labels
            </DialogTitle>
            <DialogDescription>
              {printItems.length} {activeView} label{printItems.length !== 1 ? 's' : ''} selected. Each label includes a QR code for scan-to-pick.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Template selector */}
            <div>
              <Label className="text-xs mb-2 block">Label template</Label>
              <div className="flex flex-col gap-1.5">
                {(['avery5160', 'avery5163', 'avery5164'] as const).map(key => {
                  const t = LABEL_TEMPLATES[key];
                  return (
                    <button
                      key={key}
                      onClick={() => setPrintLabelSize(key)}
                      className={`rounded-md border py-2 px-3 text-xs text-left transition-colors flex items-center justify-between gap-3 ${printLabelSize === key ? 'border-primary bg-primary/10 text-primary' : 'border-border hover-elevate'}`}
                      data-testid={`button-label-size-${key}`}
                    >
                      <div>
                        <div className="font-semibold">{t.name}</div>
                        <div className={`mt-0.5 ${printLabelSize === key ? 'text-primary/70' : 'text-muted-foreground'}`}>{t.desc} — {t.cols} across, {t.perSheet} per sheet</div>
                      </div>
                      <div className={`text-[10px] font-mono shrink-0 ${printLabelSize === key ? 'text-primary/60' : 'text-muted-foreground'}`}>{t.w} × {t.h}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Preview */}
            <div>
              <Label className="text-xs mb-2 block text-muted-foreground">Preview (first {Math.min(4, printItems.length)})</Label>
              <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                {printItems.slice(0, 4).map((item: any) => {
                  const qrData = getLabelQrData(item);
                  const sub = getLabelSubtext(item);
                  const tmpl = LABEL_TEMPLATES[printLabelSize];
                  return (
                    <div
                      key={item.id}
                      className={`flex items-center gap-2 border border-border rounded-md bg-white dark:bg-zinc-900 p-2 ${tmpl.previewH}`}
                    >
                      <QRCodeSVG
                        value={qrData}
                        size={tmpl.previewQr}
                        bgColor="transparent"
                        fgColor="currentColor"
                        className="shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-foreground truncate text-xs">
                          {item.name}
                        </p>
                        {sub && (
                          <p className="text-[9px] text-muted-foreground truncate mt-0.5">{sub}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
                {printItems.length > 4 && (
                  <div className="col-span-2 text-center text-xs text-muted-foreground py-2">
                    +{printItems.length - 4} more labels will be printed
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                className="flex-1 gap-2"
                onClick={handlePrint}
                disabled={printItems.length === 0}
                data-testid="button-print-confirm"
              >
                <Printer className="h-4 w-4" />
                Print {printItems.length} Label{printItems.length !== 1 ? 's' : ''}
              </Button>
              <Button variant="ghost" onClick={() => setPrintDialogOpen(false)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Lot Locations Dialog */}
      <Dialog open={lotDialogOpen} onOpenChange={open => { setLotDialogOpen(open); if (!open) setSelectedLot(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              Bin Locations
            </DialogTitle>
            {selectedLot && (
              <DialogDescription className="text-left">
                <span className="font-mono text-xs">{selectedLot.itemNo}</span>
                {selectedLot.colorName && <span className="text-xs"> · {selectedLot.colorName}</span>}
                {selectedLot.itemName && <span className="text-xs text-muted-foreground block truncate">{selectedLot.itemName}</span>}
              </DialogDescription>
            )}
          </DialogHeader>

          <div className="space-y-3">
            {/* Current locations */}
            {lotLocationsLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : lotLocations.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No bin assignments yet.</p>
            ) : (
              <div className="space-y-1.5">
                {lotLocations.map((loc: any) => {
                  const address = [loc.aisleName, loc.shelfName, loc.binName].filter(Boolean).join(' → ');
                  const isEditing = editingLocationId === loc.id;
                  return (
                    <div key={loc.id} className="flex items-center gap-2 p-2 rounded-md border border-border bg-muted/20">
                      <Archive className="h-3.5 w-3.5 text-green-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium">{address || loc.binName || '—'}</p>
                        {loc.bagLabel && <p className="text-[10px] text-muted-foreground">Label: {loc.bagLabel}</p>}
                        {isEditing ? (
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <Input
                              type="number"
                              placeholder="Qty"
                              value={editLocQty}
                              onChange={e => setEditLocQty(e.target.value)}
                              className="h-6 text-xs w-20"
                            />
                            <Button
                              size="sm"
                              className="h-6 text-[10px] px-2"
                              disabled={updateLocationMutation.isPending}
                              onClick={() => updateLocationMutation.mutate({
                                id: loc.id,
                                data: { inventoryId: loc.inventoryId, binId: loc.binId, quantity: editLocQty ? parseInt(editLocQty) : null },
                              })}
                            >
                              Save
                            </Button>
                            <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => setEditingLocationId(null)}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          loc.quantity != null && <p className="text-[10px] text-muted-foreground">Qty: {loc.quantity}</p>
                        )}
                      </div>
                      {!isEditing && (
                        <div className="flex gap-1 shrink-0">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={() => { setEditingLocationId(loc.id); setEditLocQty(loc.quantity != null ? String(loc.quantity) : ''); }}
                            data-testid={`button-edit-location-${loc.id}`}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-red-400"
                            disabled={deleteLocationMutation.isPending}
                            onClick={() => deleteLocationMutation.mutate(loc.id)}
                            data-testid={`button-delete-location-${loc.id}`}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add another location */}
            {showAddLocation ? (
              <div className="border border-dashed border-border rounded-md p-3 space-y-2.5">
                <p className="text-xs font-medium">Add Another Bin</p>
                <Select value={addLocBinId} onValueChange={setAddLocBinId}>
                  <SelectTrigger className="h-8 text-xs" data-testid="select-add-loc-bin">
                    <SelectValue placeholder="Select bin…" />
                  </SelectTrigger>
                  <SelectContent>
                    {bins.map((b: any) => (
                      <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[10px]">Qty in this bin <span className="text-muted-foreground">(optional)</span></Label>
                    <Input
                      type="number"
                      placeholder="e.g. 150"
                      value={addLocQty}
                      onChange={e => setAddLocQty(e.target.value)}
                      className="h-8 text-xs"
                      data-testid="input-add-loc-qty"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px]">Bag label <span className="text-muted-foreground">(optional)</span></Label>
                    <Input
                      placeholder="e.g. Bag-3"
                      value={addLocBagLabel}
                      onChange={e => setAddLocBagLabel(e.target.value)}
                      className="h-8 text-xs"
                      data-testid="input-add-loc-label"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={!addLocBinId || addLocationMutation.isPending}
                    onClick={() => addLocationMutation.mutate({
                      inventoryId: selectedLot!.id,
                      binId: parseInt(addLocBinId),
                      quantity: addLocQty ? parseInt(addLocQty) : undefined,
                      bagLabel: addLocBagLabel || undefined,
                    })}
                    data-testid="button-add-location-confirm"
                  >
                    {addLocationMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                    Add
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowAddLocation(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setShowAddLocation(true)}
                data-testid="button-add-location"
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Add Another Bin
              </Button>
            )}

            {/* Link to full inventory detail */}
            {onItemClick && selectedLot && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs text-muted-foreground"
                onClick={() => { setLotDialogOpen(false); onItemClick('inventory', selectedLot.id); }}
                data-testid="button-open-inventory-detail"
              >
                <ExternalLink className="h-3 w-3 mr-1.5" />
                Open part detail
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

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
                <p className="font-medium">Preview — up to {bulkPreviewCount} bins (existing names on this shelf are skipped)</p>
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

      {/* Fill Bin Dialog */}
      <Dialog open={fillBinDialogOpen} onOpenChange={open => { setFillBinDialogOpen(open); if (!open) resetFillBinDialog(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-400" />
              Fill a Bin
            </DialogTitle>
            <DialogDescription>
              Start with the next N parts from the queue, then uncheck any that don't belong and search to add non-sequential ones.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 pt-1">
            {/* Bin selector + count in one row */}
            <div className="flex gap-2 items-end">
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs">Bin</Label>
                <Select value={fillBinTargetId} onValueChange={setFillBinTargetId}>
                  <SelectTrigger data-testid="select-fill-bin-target">
                    <SelectValue placeholder="Select a bin…" />
                  </SelectTrigger>
                  <SelectContent>
                    {[...bins].sort(alphaNumericSort).map((b: any) => (
                      <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-28 space-y-1.5">
                <Label className="text-xs">Queue size</Label>
                <Input
                  type="number"
                  min={1}
                  value={fillBinCount}
                  onChange={e => setFillBinCount(e.target.value)}
                  data-testid="input-fill-bin-count"
                />
              </div>
            </div>

            {/* Checklist — queue items */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">
                  {fillBinPreview.length > 0
                    ? `Next ${fillBinPreview.length} from queue — uncheck anything that doesn't belong`
                    : 'No unassigned lots in queue'}
                </p>
                {fillBinPreview.length > 0 && (
                  <div className="flex gap-2 text-[10px] text-muted-foreground">
                    <button className="hover:text-foreground underline underline-offset-2" onClick={() => setFillBinDeselected(new Set())}>all</button>
                    <button className="hover:text-foreground underline underline-offset-2" onClick={() => setFillBinDeselected(new Set(fillBinPreview.map((i: any) => i.id)))}>none</button>
                  </div>
                )}
              </div>

              {fillBinPreview.length > 0 && (
                <div className="bg-muted/30 rounded-md p-2 max-h-52 overflow-y-auto space-y-0.5" data-testid="fill-bin-preview">
                  {fillBinPreview.map((item: any) => {
                    const checked = !fillBinDeselected.has(item.id);
                    return (
                      <label
                        key={item.id}
                        className={`flex items-center gap-2 px-1.5 py-1 rounded cursor-pointer select-none hover-elevate ${checked ? '' : 'opacity-40'}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleFillBinItem(item.id)}
                          className="h-3.5 w-3.5 rounded shrink-0"
                        />
                        <span className="font-mono text-xs font-medium shrink-0 w-20 truncate">{item.itemNo}</span>
                        <span className="text-[11px] text-muted-foreground truncate flex-1">{item.itemName || '—'}</span>
                        {item.colorName && <span className="text-[10px] text-muted-foreground shrink-0">{item.colorName}</span>}
                      </label>
                    );
                  })}
                </div>
              )}
              {fillBinHasMore && (
                <button
                  onClick={() => setFillBinCount(String(parseInt(fillBinCount) + 20))}
                  className="w-full text-[11px] text-muted-foreground hover:text-foreground py-1 flex items-center justify-center gap-1.5 border border-dashed border-border rounded-md"
                  data-testid="button-fill-bin-load-more"
                >
                  <Plus className="h-3 w-3" />
                  Load 20 more ({fillBinSorted.length - fillBinPreview.length} remaining)
                </button>
              )}
            </div>

            {/* Manually added items */}
            {fillBinManualAdds.size > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Added manually</p>
                <div className="bg-blue-500/5 border border-blue-500/20 rounded-md p-2 space-y-0.5">
                  {Array.from(fillBinManualAdds.values()).map((item: any) => (
                    <div key={item.id} className="flex items-center gap-2 px-1.5 py-1">
                      <span className="font-mono text-xs font-medium shrink-0 w-20 truncate">{item.itemNo}</span>
                      <span className="text-[11px] text-muted-foreground truncate flex-1">{item.itemName || '—'}</span>
                      {item.colorName && <span className="text-[10px] text-muted-foreground shrink-0">{item.colorName}</span>}
                      <button
                        onClick={() => removeFillBinManual(item.id)}
                        className="h-4 w-4 shrink-0 text-muted-foreground hover:text-destructive"
                        data-testid={`button-remove-manual-${item.id}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Search to add non-sequential parts */}
            <div className="space-y-1.5">
              <Label className="text-xs">Find a part to add</Label>
              <Input
                placeholder="Search by part number or name (e.g. x102, pb7730)"
                value={fillBinSearch}
                onChange={e => setFillBinSearch(e.target.value)}
                className="text-xs"
                data-testid="input-fill-bin-search"
              />
              {fillBinSearchResults.length > 0 && (
                <div className="bg-muted/30 rounded-md p-1.5 space-y-0.5 max-h-32 overflow-y-auto">
                  {fillBinSearchResults.map((item: any) => (
                    <button
                      key={item.id}
                      onClick={() => addFillBinManual(item)}
                      className="w-full flex items-center gap-2 px-2 py-1 rounded text-left hover-elevate"
                      data-testid={`button-add-search-${item.id}`}
                    >
                      <Plus className="h-3 w-3 text-blue-400 shrink-0" />
                      <span className="font-mono text-xs font-medium shrink-0 w-20 truncate">{item.itemNo}</span>
                      <span className="text-[11px] text-muted-foreground truncate flex-1">{item.itemName || '—'}</span>
                      {item.colorName && <span className="text-[10px] text-muted-foreground shrink-0">{item.colorName}</span>}
                    </button>
                  ))}
                </div>
              )}
              {fillBinSearch.trim().length >= 1 && fillBinSearchResults.length === 0 && (
                <p className="text-[10px] text-muted-foreground px-1">No unassigned lots match — part may already be in the list above or already assigned.</p>
              )}
            </div>

            {/* Footer summary + confirm */}
            <div className="flex items-center justify-between gap-3 pt-1 flex-wrap">
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{fillBinToAssign.length}</span> lots will be assigned
                {fillBinManualAdds.size > 0 && <span className="text-blue-400"> (+{fillBinManualAdds.size} added manually)</span>}
              </p>
              <Button
                disabled={!fillBinTargetId || fillBinToAssign.length === 0 || fillBinPending}
                onClick={handleFillBin}
                data-testid="button-fill-bin-confirm"
              >
                {fillBinPending
                  ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Assigning…</>
                  : <><Zap className="h-4 w-4 mr-1.5" />Assign {fillBinToAssign.length} to {bins.find((b: any) => b.id === parseInt(fillBinTargetId))?.name ?? 'Bin'}</>
                }
              </Button>
            </div>
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

      {/* ── Import CSV Dialog ── */}
      <Dialog open={importCsvOpen} onOpenChange={o => { setImportCsvOpen(o); if (!o) resetImportDialog(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Import from CSV
            </DialogTitle>
            <DialogDescription>
              Import your warehouse layout or assign your inventory lots to bins.
            </DialogDescription>
          </DialogHeader>

          {/* Mode toggle */}
          {!importResult && (
            <div className="flex rounded-md overflow-hidden border border-border">
              <button
                onClick={() => { setImportMode('structure'); resetImportDialog(); }}
                className={`flex-1 py-2 text-xs font-medium transition-colors ${importMode === 'structure' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50'}`}
                data-testid="button-import-mode-structure"
              >
                Warehouse Structure
              </button>
              <button
                onClick={() => { setImportMode('assignments'); resetImportDialog(); }}
                className={`flex-1 py-2 text-xs font-medium transition-colors border-l border-border ${importMode === 'assignments' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50'}`}
                data-testid="button-import-mode-assignments"
              >
                Lot Assignments
              </button>
            </div>
          )}

          {!importResult ? (
            <div className="space-y-4">

              {/* ── Structure mode ── */}
              {importMode === 'structure' && (
                <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" />Format — creates bins, shelves, aisles</p>
                  <div className="space-y-1">
                    {depth === 1 && <pre className="text-[10px] font-mono text-green-400 bg-black/30 p-2 rounded">{`bin\nBIN-01\nBIN-02\nBIN-03`}</pre>}
                    {depth === 2 && <pre className="text-[10px] font-mono text-green-400 bg-black/30 p-2 rounded">{`shelf,bin\nShelf-A,BIN-A1\nShelf-A,BIN-A2\nShelf-B,BIN-B1`}</pre>}
                    {depth === 3 && <pre className="text-[10px] font-mono text-green-400 bg-black/30 p-2 rounded">{`aisle,shelf,bin\nA,Shelf-A1,BIN-A1-01\nA,Shelf-A1,BIN-A1-02\nB,Shelf-B1,BIN-B1-01`}</pre>}
                    <p className="text-[10px] text-muted-foreground pt-1">Column order doesn't matter. Existing names are skipped.</p>
                  </div>
                </div>
              )}

              {/* ── Lot assignments mode ── */}
              {importMode === 'assignments' && (
                <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" />Format — assigns inventory lots to bins</p>
                  <div className="space-y-2">
                    <div>
                      <p className="text-[10px] text-muted-foreground mb-1">Required columns: <code className="bg-muted px-1 rounded">part_number</code> and <code className="bg-muted px-1 rounded">bin</code></p>
                      <p className="text-[10px] text-muted-foreground mb-1.5">Optional: <code className="bg-muted px-1 rounded">color_id</code> <code className="bg-muted px-1 rounded">condition</code> (N/U) <code className="bg-muted px-1 rounded">qty</code></p>
                      <pre className="text-[10px] font-mono text-green-400 bg-black/30 p-2 rounded">{`part_number,color_id,condition,bin,qty\n3001,5,N,BIN-A1,50\n3002,11,U,BIN-A2,12\n3003,,N,BIN-B1,`}</pre>
                    </div>
                    <div className="space-y-1 text-[10px] text-muted-foreground">
                      <p>• <code className="bg-muted px-1 rounded">part_number</code> must match a BrickLink item number in your inventory (e.g. <code>3001</code>)</p>
                      <p>• If <code className="bg-muted px-1 rounded">color_id</code> or <code className="bg-muted px-1 rounded">condition</code> are blank, all matching lots get assigned</p>
                      <p>• Existing assignments are skipped automatically</p>
                      <p>• Also accepted: <code className="bg-muted px-1 rounded">part</code>, <code className="bg-muted px-1 rounded">item_no</code>, <code className="bg-muted px-1 rounded">sku</code> for the part column</p>
                    </div>
                  </div>
                </div>
              )}

              {/* CSV textarea */}
              <div className="space-y-1.5">
                <Label className="text-xs">Paste your CSV here</Label>
                <textarea
                  value={importCsvText}
                  onChange={e => setImportCsvText(e.target.value)}
                  rows={9}
                  placeholder={importMode === 'structure' ? 'bin\nBIN-01\nBIN-02\n...' : 'part_number,bin\n3001,BIN-A1\n3002,BIN-A2\n...'}
                  className="w-full rounded-md border border-border bg-background text-xs font-mono p-2 resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                  data-testid="textarea-import-csv"
                />
                <p className="text-[10px] text-muted-foreground">
                  {importCsvText.split('\n').filter(l => l.trim()).length > 1
                    ? `${importCsvText.split('\n').filter(l => l.trim()).length - 1} data rows detected`
                    : 'Add your CSV data above'}
                </p>
              </div>

              <Button
                className="w-full"
                disabled={
                  (importMode === 'structure' ? importCsvMutation.isPending : importLotAssignmentsMutation.isPending) ||
                  importCsvText.trim().split('\n').filter(Boolean).length < 2
                }
                onClick={() => {
                  if (importMode === 'structure') importCsvMutation.mutate(importCsvText);
                  else importLotAssignmentsMutation.mutate(importCsvText);
                }}
                data-testid="button-import-csv-submit"
              >
                {(importCsvMutation.isPending || importLotAssignmentsMutation.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Import
              </Button>
            </div>
          ) : (
            /* Import result */
            <div className="space-y-4">
              <div className="rounded-md border border-green-500/30 bg-green-500/5 p-4 space-y-2">
                <div className="flex items-center gap-2 text-green-400 font-semibold text-sm">
                  <CheckCircle2 className="h-4 w-4" />
                  Import complete
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground">
                  {importResult.created && <>
                    {depth >= 3 && <span>Aisles created: <span className="font-semibold text-foreground">{importResult.created.aisles}</span></span>}
                    {depth >= 2 && <span>Shelves created: <span className="font-semibold text-foreground">{importResult.created.shelves}</span></span>}
                    <span>Bins created: <span className="font-semibold text-foreground">{importResult.created.bins}</span></span>
                    <span>Rows skipped: <span className="font-semibold text-foreground">{importResult.created.skipped}</span></span>
                  </>}
                  {importResult.stats && <>
                    <span>Lots assigned: <span className="font-semibold text-foreground">{importResult.stats.assigned}</span></span>
                    {importResult.stats.skipped > 0 && <span>Already assigned: <span className="font-semibold text-foreground">{importResult.stats.skipped}</span></span>}
                    {importResult.stats.notFound > 0 && <span className="text-yellow-500">Not found: <span className="font-semibold">{importResult.stats.notFound}</span></span>}
                  </>}
                </div>
              </div>

              {importResult.errors.length > 0 && (
                <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-red-400 text-xs font-semibold">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {importResult.errors.length} row{importResult.errors.length !== 1 ? 's' : ''} had errors
                  </div>
                  <ul className="text-[10px] text-red-300/80 font-mono space-y-0.5 max-h-32 overflow-y-auto">
                    {importResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={resetImportDialog}>
                  Import Another
                </Button>
                <Button className="flex-1" onClick={() => setImportCsvOpen(false)}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
