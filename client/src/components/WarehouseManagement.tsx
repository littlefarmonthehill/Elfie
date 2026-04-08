import { useState, useRef, useEffect } from "react";
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
  ChevronLeft,
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
  MoveRight,
  Building2,
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

type LocationFormat = 'numeric' | 'alpha' | 'alphanumeric';

function applyFormat(value: string, format: LocationFormat): string {
  if (format === 'numeric') return value.replace(/[^0-9]/g, '');
  if (format === 'alpha') return value.replace(/[^A-Za-z]/g, '').toUpperCase();
  return value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function formatHint(format: LocationFormat): string {
  if (format === 'numeric') return 'Numbers only';
  if (format === 'alpha') return 'Letters only';
  return 'Letters and numbers';
}

function formatExample(format: LocationFormat, level: 'aisle' | 'shelf' | 'bin'): string {
  const examples: Record<LocationFormat, Record<string, string>> = {
    numeric:      { aisle: '1',  shelf: '1',  bin: '01' },
    alpha:        { aisle: 'A',  shelf: 'A',  bin: 'A'  },
    alphanumeric: { aisle: '1A', shelf: 'A1', bin: '01A' },
  };
  return examples[format][level];
}

const FORMAT_LABELS: Record<LocationFormat, string> = {
  numeric:      'Numbers',
  alpha:        'Letters',
  alphanumeric: 'Both',
};

export default function WarehouseManagement({ onItemClick }: WarehouseManagementProps) {
  const { toast } = useToast();
  const [activeView, setActiveView] = useState<ViewType>('bins');
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
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [showDepthSetup, setShowDepthSetup] = useState(false);

  // Zone filter & CRUD state
  const [activeZoneId, setActiveZoneId] = useState<number | null>(null);
  const [manageZonesOpen, setManageZonesOpen] = useState(false);
  const [createZoneOpen, setCreateZoneOpen] = useState(false);
  const [editZoneOpen, setEditZoneOpen] = useState(false);
  const [editZone, setEditZone] = useState<any>(null);
  const [newZoneName, setNewZoneName] = useState('');
  const [newZoneDesc, setNewZoneDesc] = useState('');
  const [newZoneDepth, setNewZoneDepth] = useState(3);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 280);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Lot locations dialog state
  const [lotDialogOpen, setLotDialogOpen] = useState(false);
  const [selectedLot, setSelectedLot] = useState<any>(null);

  // Bin detail / move state
  const [binDetailOpen, setBinDetailOpen] = useState(false);
  const [binDetailBin, setBinDetailBin] = useState<any>(null);
  const [binDetailSelected, setBinDetailSelected] = useState<Set<number>>(new Set());
  const [binMoveStep, setBinMoveStep] = useState<'select' | 'move'>('select');
  const [binMoveType, setBinMoveType] = useState<'existing' | 'new'>('existing');
  const [binMoveExistingId, setBinMoveExistingId] = useState('');
  const [binMoveNewName, setBinMoveNewName] = useState('');
  const [binMovePending, setBinMovePending] = useState(false);
  const [binMoveQties, setBinMoveQties] = useState<Map<number, string>>(new Map());
  const [addLocBinId, setAddLocBinId] = useState<string>("");
  const [addLocQty, setAddLocQty] = useState<string>("");
  const [addLocBagLabel, setAddLocBagLabel] = useState<string>("");
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [editingLocationId, setEditingLocationId] = useState<number | null>(null);
  const [editLocQty, setEditLocQty] = useState<string>("");

  // Print labels state
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [printLabelSize, setPrintLabelSize] = useState<'avery5160' | 'avery5163' | 'avery5164' | 'dymo30252' | 'dymo30336'>('avery5163');

  // Controlled name input for create/edit dialogs
  const [createName, setCreateName] = useState('');

  // Bulk bin state
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
  const [fillBinTrackQty, setFillBinTrackQty] = useState(false);
  const [fillBinQties, setFillBinQties] = useState<Map<number, string>>(new Map());
  const fillBinListRef = useRef<HTMLDivElement>(null);

  // CSV Import state
  const [importCsvOpen, setImportCsvOpen] = useState(false);
  const [importMode, setImportMode] = useState<'structure' | 'assignments'>('structure');
  const [importCsvText, setImportCsvText] = useState("");
  const [importResult, setImportResult] = useState<{ created?: { aisles: number; shelves: number; bins: number; skipped: number }; stats?: { assigned: number; skipped: number; notFound: number }; errors: string[] } | null>(null);

  const { data: warehouseSettings, isLoading: settingsLoading } = useQuery<{ depth: number; aisleFormat: string; shelfFormat: string; binFormat: string }>({
    queryKey: ['/api/warehouse/settings'],
  });

  // Zones list (always loaded)
  const { data: zones = [], isLoading: zonesLoading } = useQuery<any[]>({
    queryKey: ['/api/warehouse/zones'],
  });

  // Active zone derived values — zone filter overrides global settings
  const activeZone = zones.find((z: any) => z.id === activeZoneId) ?? null;
  const depth = activeZone?.depth ?? warehouseSettings?.depth ?? 3;
  const aisleFormat = (activeZone?.aisleFormat ?? warehouseSettings?.aisleFormat ?? 'numeric') as LocationFormat;
  const shelfFormat = (activeZone?.shelfFormat ?? warehouseSettings?.shelfFormat ?? 'alpha') as LocationFormat;
  const binFormat   = (activeZone?.binFormat   ?? warehouseSettings?.binFormat   ?? 'numeric') as LocationFormat;

  // Warehouse data — loads all by default; filtered by zone when activeZoneId is set
  const { data: aisles = [] } = useQuery<any[]>({
    queryKey: ['/api/warehouse/aisles', activeZoneId],
    queryFn: async () => {
      const url = activeZoneId !== null ? `/api/warehouse/aisles?zoneId=${activeZoneId}` : '/api/warehouse/aisles';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });
  const { data: shelves = [] } = useQuery<any[]>({
    queryKey: ['/api/warehouse/shelves', activeZoneId],
    queryFn: async () => {
      const url = activeZoneId !== null ? `/api/warehouse/shelves?zoneId=${activeZoneId}` : '/api/warehouse/shelves';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });
  const { data: bins = [] } = useQuery<any[]>({
    queryKey: ['/api/warehouse/bins', activeZoneId],
    queryFn: async () => {
      const url = activeZoneId !== null ? `/api/warehouse/bins?zoneId=${activeZoneId}` : '/api/warehouse/bins';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });
  const { data: unassignedInventory = [] } = useQuery<any[]>({ queryKey: ['/api/warehouse/unassigned/inventory'] });
  const { data: unassignedBins = [] } = useQuery<any[]>({ queryKey: ['/api/warehouse/unassigned/bins'] });
  const { data: unassignedShelves = [] } = useQuery<any[]>({ queryKey: ['/api/warehouse/unassigned/shelves'] });
  const { data: inventoryStats } = useQuery<any>({ queryKey: ['/api/inventory/stats'] });
  const { data: locations = [] } = useQuery<any[]>({ queryKey: ['/api/warehouse/locations'] });

  // Server-side search — fires when there's a debounced query, bypasses the pre-load limit
  const { data: serverSearchResults = [], isFetching: serverSearchLoading } = useQuery<any[]>({
    queryKey: ['/api/warehouse/inventory/search', debouncedSearch],
    queryFn: async ({ queryKey }) => {
      const q = queryKey[1] as string;
      const res = await fetch(`/api/warehouse/inventory/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error('Search failed');
      return res.json();
    },
    enabled: debouncedSearch.length > 0,
    staleTime: 30_000,
  });

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
    queryClient.invalidateQueries({ queryKey: ['/api/warehouse/inventory/search'] });
    queryClient.invalidateQueries({ queryKey: ['/api/warehouse/zones'] });
  };

  // Zone CRUD mutations
  const createZoneMutation = useMutation({
    mutationFn: (data: { name: string; description?: string; depth: number }) =>
      apiRequest('POST', '/api/warehouse/zones', data),
    onSuccess: (zone: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/zones'] });
      setCreateZoneOpen(false);
      setNewZoneName(''); setNewZoneDesc(''); setNewZoneDepth(3);
      // Navigate directly into the new zone
      setActiveZoneId(zone.id);
      setActiveView('bins');
      toast({ title: "Zone created" });
    },
    onError: () => toast({ title: "Failed to create zone", variant: "destructive" }),
  });

  const updateZoneMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiRequest('PUT', `/api/warehouse/zones/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/zones'] });
      setEditZoneOpen(false);
      setShowDepthSetup(false);
      toast({ title: "Zone settings updated" });
    },
    onError: () => toast({ title: "Failed to update zone", variant: "destructive" }),
  });

  const deleteZoneMutation = useMutation({
    mutationFn: (id: number) => apiRequest('DELETE', `/api/warehouse/zones/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/zones'] });
      if (activeZoneId) setActiveZoneId(null);
      toast({ title: "Zone deleted" });
    },
    onError: () => toast({ title: "Failed to delete zone", variant: "destructive" }),
  });

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
    mutationFn: (d: number) => {
      if (activeZoneId) return apiRequest('PUT', `/api/warehouse/zones/${activeZoneId}`, { depth: d });
      return apiRequest('PATCH', '/api/warehouse/settings', { depth: d });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/settings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/zones'] });
      setShowDepthSetup(false);
      toast({ title: "Depth updated" });
    },
  });

  const updateFormatMutation = useMutation({
    mutationFn: (data: { aisleFormat?: string; shelfFormat?: string; binFormat?: string }) => {
      if (activeZoneId) return apiRequest('PUT', `/api/warehouse/zones/${activeZoneId}`, data);
      return apiRequest('PATCH', '/api/warehouse/settings', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/settings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/zones'] });
    },
  });

  const createAisleMutation = useMutation({
    mutationFn: (data: { name: string; description?: string; zoneId?: number }) =>
      apiRequest('POST', '/api/warehouse/aisles', data),
    onSuccess: () => { invalidateWarehouse(); toast({ title: "Aisle created" }); setCreateDialogOpen(false); },
  });

  const createShelfMutation = useMutation({
    mutationFn: (data: { name: string; aisleId?: number; description?: string; zoneId?: number }) =>
      apiRequest('POST', '/api/warehouse/shelves', data),
    onSuccess: () => { invalidateWarehouse(); toast({ title: "Shelf created" }); setCreateDialogOpen(false); },
  });

  const createBinMutation = useMutation({
    mutationFn: (data: { name: string; shelfId?: number; description?: string; zoneId?: number }) =>
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
    mutationFn: (data: { inventoryId: number; binId: number; quantity?: number }) =>
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
    const name = createName.trim();
    if (!name) return;
    const description = fd.get('description') as string;
    const zoneId = activeZoneId ?? undefined;
    if (createType === 'aisle') {
      createAisleMutation.mutate({ name, description, zoneId });
    } else if (createType === 'shelf') {
      const aisleId = fd.get('aisleId') as string;
      createShelfMutation.mutate({ name, aisleId: aisleId ? parseInt(aisleId) : undefined, description, zoneId });
    } else {
      const shelfId = fd.get('shelfId') as string;
      createBinMutation.mutate({ name, shelfId: shelfId ? parseInt(shelfId) : undefined, description, zoneId });
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
    setFillBinTrackQty(false);
    setFillBinQties(new Map());
  };

  const handleFillBin = async () => {
    if (!fillBinTargetId || fillBinToAssign.length === 0) return;
    const binId = parseInt(fillBinTargetId);
    setFillBinPending(true);
    try {
      await Promise.all(fillBinToAssign.map(item => {
        const qtyStr = fillBinQties.get(item.id);
        const quantity = fillBinTrackQty && qtyStr ? (parseInt(qtyStr) || undefined) : undefined;
        return assignInventoryMutation.mutateAsync({ inventoryId: item.id, binId, ...(quantity !== undefined ? { quantity } : {}) });
      }));
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
      // When a search query is active, use server-side results (covers full inventory, not just the pre-loaded 2000)
      if (debouncedSearch.length > 0) {
        let items = serverSearchResults.map((item: any) => ({
          ...item,
          binNames: [],
          locationCount: 0,
        }));
        if (filter === 'assigned') items = items.filter((i: any) => i.assigned);
        if (filter === 'unassigned') items = items.filter((i: any) => !i.assigned);
        // Preserve server-returned order: bucket 1 (itemNo prefix matches) always before bucket 2 (name matches)
        return items;
      }

      // No search — use the pre-loaded assigned + unassigned data
      // Group all locations per inventory item (multi-location aware)
      const assignedMap = new Map<number, any>();
      locations.forEach((loc: any) => {
        if (!assignedMap.has(loc.inventoryId)) {
          assignedMap.set(loc.inventoryId, {
            id: loc.inventoryId, itemNo: loc.itemNo, itemType: loc.itemType, itemName: loc.itemName,
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

  // Bin detail: lots stored in the open bin, derived from the already-fetched locations
  const binDetailLots = binDetailBin
    ? locations.filter((l: any) => l.binId === binDetailBin.id)
    : [];

  const resetBinDetail = () => {
    setBinDetailBin(null);
    setBinDetailSelected(new Set());
    setBinMoveStep('select');
    setBinMoveType('existing');
    setBinMoveExistingId('');
    setBinMoveNewName('');
    setBinMoveQties(new Map());
  };

  const openBinDetail = (bin: any) => {
    const lots = locations.filter((l: any) => l.binId === bin.id);
    setBinDetailBin(bin);
    setBinDetailSelected(new Set());
    setBinMoveStep('select');
    setBinMoveType('existing');
    setBinMoveExistingId('');
    setBinMoveNewName('');
    // Pre-fill quantities from existing location records
    const qMap = new Map<number, string>();
    lots.forEach((l: any) => { if (l.quantity != null) qMap.set(l.id, String(l.quantity)); });
    setBinMoveQties(qMap);
    setBinDetailOpen(true);
  };

  const handleMoveLots = async () => {
    if (binDetailSelected.size === 0) return;
    setBinMovePending(true);
    try {
      let targetBinId: number;
      if (binMoveType === 'new') {
        const newBin: any = await apiRequest('POST', '/api/warehouse/bins', { name: binMoveNewName.trim() });
        targetBinId = newBin.id;
      } else {
        targetBinId = parseInt(binMoveExistingId);
      }
      const toLots = binDetailLots.filter((l: any) => binDetailSelected.has(l.id));
      await Promise.all(toLots.map((loc: any) => {
        const qtyStr = binMoveQties.get(loc.id);
        const quantity = qtyStr ? (parseInt(qtyStr) || null) : null;
        return apiRequest('PUT', `/api/warehouse/locations/${loc.id}`, {
          inventoryId: loc.inventoryId, binId: targetBinId,
          quantity, bagLabel: loc.bagLabel ?? null, notes: loc.notes ?? null,
        });
      }));
      invalidateWarehouse();
      const destName = binMoveType === 'new' ? binMoveNewName.trim()
        : bins.find((b: any) => b.id === targetBinId)?.name ?? 'bin';
      toast({ title: `${toLots.length} lot${toLots.length !== 1 ? 's' : ''} moved to ${destName}` });
      setBinDetailOpen(false);
      resetBinDetail();
    } catch {
      toast({ title: 'Failed to move lots', variant: 'destructive' });
    } finally {
      setBinMovePending(false);
    }
  };

  // Auto-compute bulk prefix from selected shelf's hierarchy
  const bulkComputedPrefix = (() => {
    if (!bulkShelfForBins) return '';
    const shelf = shelves.find((s: any) => String(s.id) === bulkShelfForBins);
    if (!shelf) return '';
    if (depth >= 3 && shelf.aisleId) {
      const aisle = aisles.find((a: any) => a.id === shelf.aisleId);
      return aisle ? `${aisle.name}-${shelf.name}-` : `${shelf.name}-`;
    }
    return `${shelf.name}-`;
  })();

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
      names.push(`${bulkComputedPrefix}${pad > 0 ? String(i).padStart(pad, '0') : i}`);
    }
    if (e - s > 2) names.push(`…${bulkComputedPrefix}${pad > 0 ? String(e).padStart(pad, '0') : e}`);
    return names;
  })();


  // Zones list view — shown when no zone is selected
  const zonesView = (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Warehouse Zones</p>
          <p className="text-xs text-muted-foreground mt-0.5">Each zone is an independent area with its own storage hierarchy</p>
        </div>
        <Button
          size="sm"
          className="gap-1.5 shrink-0"
          onClick={() => { setNewZoneName(''); setNewZoneDesc(''); setNewZoneDepth(3); setCreateZoneOpen(true); }}
          data-testid="button-create-zone"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Zone
        </Button>
      </div>

      {zonesLoading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : zones.length === 0 ? (
        <Card className="p-8 text-center">
          <Building2 className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No zones yet</p>
          <p className="text-xs text-muted-foreground/70 mt-1 mb-4">Create your first warehouse zone to start organising your storage</p>
          <Button size="sm" onClick={() => setCreateZoneOpen(true)} data-testid="button-create-first-zone">
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Create Zone
          </Button>
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {zones.map((zone: any) => {
            const dOpt = DEPTH_OPTIONS.find(d => d.value === zone.depth) || DEPTH_OPTIONS[2];
            return (
              <Card
                key={zone.id}
                className="p-4 hover-elevate cursor-pointer"
                onClick={() => { setActiveZoneId(zone.id); setActiveView('bins'); setFilter('all'); setSelectedItems(new Set()); setSearchQuery(''); }}
                data-testid={`card-zone-${zone.id}`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 className="h-4 w-4 text-yellow-400 shrink-0" />
                    <span className="text-sm font-semibold truncate">{zone.name}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => { e.stopPropagation(); setEditZone(zone); setNewZoneName(zone.name); setNewZoneDesc(zone.description || ''); setNewZoneDepth(zone.depth); setEditZoneOpen(true); }}
                      data-testid={`button-edit-zone-${zone.id}`}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); if (confirm(`Delete zone "${zone.name}" and all its aisles, shelves, and bins? This cannot be undone.`)) deleteZoneMutation.mutate(zone.id); }}
                      data-testid={`button-delete-zone-${zone.id}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                {zone.description && (
                  <p className="text-xs text-muted-foreground mb-2 line-clamp-1">{zone.description}</p>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className="text-[10px] px-1.5 py-0 no-default-active-elevate">{dOpt.label}</Badge>
                  {Number(zone.binCount) > 0 && (
                    <span className="text-[10px] text-muted-foreground/70">{zone.binCount} bin{zone.binCount !== 1 ? 's' : ''}</span>
                  )}
                  {Number(zone.assignedLotCount) > 0 && (
                    <span className="text-[10px] text-muted-foreground/70">· {zone.assignedLotCount} lot{zone.assignedLotCount !== 1 ? 's' : ''} stored</span>
                  )}
                </div>
                <div className="flex items-center justify-end mt-2">
                  <span className="text-[10px] text-muted-foreground/50 flex items-center gap-0.5">Enter zone <ChevronRight className="h-3 w-3" /></span>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Zone Dialog */}
      <Dialog open={createZoneOpen} onOpenChange={setCreateZoneOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Create Warehouse Zone</DialogTitle>
            <DialogDescription>Name this area and choose how deep its storage hierarchy goes.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); if (!newZoneName.trim()) return; createZoneMutation.mutate({ name: newZoneName.trim(), description: newZoneDesc.trim() || undefined, depth: newZoneDepth }); }} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Zone Name</Label>
              <Input value={newZoneName} onChange={e => setNewZoneName(e.target.value)} placeholder="e.g. Sets & Minifigs, Parts, Bulk" autoFocus data-testid="input-zone-name" />
            </div>
            <div className="space-y-1.5">
              <Label>Description <span className="text-muted-foreground/60 font-normal">(optional)</span></Label>
              <Input value={newZoneDesc} onChange={e => setNewZoneDesc(e.target.value)} placeholder="e.g. Location A — left side of room" data-testid="input-zone-description" />
            </div>
            <div className="space-y-2">
              <Label>Storage Depth</Label>
              {DEPTH_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setNewZoneDepth(opt.value)}
                  className={`flex items-start gap-3 w-full p-2.5 rounded-md border text-left transition-colors hover-elevate ${newZoneDepth === opt.value ? 'border-yellow-500/60 bg-yellow-500/10' : 'border-border'}`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold">{opt.label}</span>
                      {newZoneDepth === opt.value && <Badge className="text-[9px] px-1 py-0 no-default-active-elevate">Selected</Badge>}
                    </div>
                    <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{opt.example}</p>
                  </div>
                </button>
              ))}
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setCreateZoneOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={!newZoneName.trim() || createZoneMutation.isPending} data-testid="button-save-zone">
                {createZoneMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Create Zone'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Zone Dialog */}
      <Dialog open={editZoneOpen} onOpenChange={setEditZoneOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Zone</DialogTitle>
            <DialogDescription>Update the name, description, or depth of this zone.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); if (!editZone || !newZoneName.trim()) return; updateZoneMutation.mutate({ id: editZone.id, data: { name: newZoneName.trim(), description: newZoneDesc.trim() || null, depth: newZoneDepth } }); }} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Zone Name</Label>
              <Input value={newZoneName} onChange={e => setNewZoneName(e.target.value)} autoFocus data-testid="input-edit-zone-name" />
            </div>
            <div className="space-y-1.5">
              <Label>Description <span className="text-muted-foreground/60 font-normal">(optional)</span></Label>
              <Input value={newZoneDesc} onChange={e => setNewZoneDesc(e.target.value)} data-testid="input-edit-zone-description" />
            </div>
            <div className="space-y-2">
              <Label>Storage Depth</Label>
              {DEPTH_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setNewZoneDepth(opt.value)}
                  className={`flex items-start gap-3 w-full p-2.5 rounded-md border text-left transition-colors hover-elevate ${newZoneDepth === opt.value ? 'border-yellow-500/60 bg-yellow-500/10' : 'border-border'}`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold">{opt.label}</span>
                      {newZoneDepth === opt.value && <Badge className="text-[9px] px-1 py-0 no-default-active-elevate">Selected</Badge>}
                    </div>
                    <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{opt.example}</p>
                  </div>
                </button>
              ))}
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditZoneOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={!newZoneName.trim() || updateZoneMutation.isPending} data-testid="button-save-edit-zone">
                {updateZoneMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );

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
    if (activeView === 'bins') {
      // Show hierarchy once in navigation order — Aisle → Shelf (bin name already has everything encoded)
      const parts = [item.aisleName && `Aisle ${item.aisleName}`, item.shelfName && `Shelf ${item.shelfName}`].filter(Boolean);
      return parts.join(' → ');
    }
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
    mode: 'sheet' | 'dymo';
  }> = {
    avery5160: {
      name: 'Avery 5160 / 8160', desc: '1" × 2⅝"', perSheet: 30,
      w: '2.625in', h: '1in', cols: 3,
      pageMarginV: '0.5in', pageMarginH: '0.1875in',
      colGap: '0.125in', rowGap: '0in',
      qr: 48, font: '9px', sub: '7px',
      previewH: 'h-10', previewQr: 32, mode: 'sheet',
    },
    avery5163: {
      name: 'Avery 5163 / 8163', desc: '2" × 4"', perSheet: 10,
      w: '4in', h: '2in', cols: 2,
      pageMarginV: '0.5in', pageMarginH: '0.15625in',
      colGap: '0.1875in', rowGap: '0in',
      qr: 88, font: '14px', sub: '10px',
      previewH: 'h-16', previewQr: 52, mode: 'sheet',
    },
    avery5164: {
      name: 'Avery 5164 / 8164', desc: '3⅓" × 4"', perSheet: 6,
      w: '4in', h: '3.333in', cols: 2,
      pageMarginV: '0.5in', pageMarginH: '0.15625in',
      colGap: '0.1875in', rowGap: '0in',
      qr: 140, font: '18px', sub: '13px',
      previewH: 'h-24', previewQr: 72, mode: 'sheet',
    },
    dymo30252: {
      name: 'Dymo 30252', desc: '1⅛" × 3½"', perSheet: 1,
      w: '3.5in', h: '1.125in', cols: 1,
      pageMarginV: '0.06in', pageMarginH: '0.06in',
      colGap: '0in', rowGap: '0in',
      qr: 62, font: '11px', sub: '8px',
      previewH: 'h-10', previewQr: 40, mode: 'dymo',
    },
    dymo30336: {
      name: 'Dymo 30336', desc: '1" × 2⅛"', perSheet: 1,
      w: '2.125in', h: '1in', cols: 1,
      pageMarginV: '0.05in', pageMarginH: '0.05in',
      colGap: '0in', rowGap: '0in',
      qr: 48, font: '9px', sub: '7px',
      previewH: 'h-10', previewQr: 32, mode: 'dymo',
    },
  };

  const handlePrint = () => {
    if (printItems.length === 0) return;
    const origin = window.location.origin;
    const tmpl = LABEL_TEMPLATES[printLabelSize];
    const isDymo = tmpl.mode === 'dymo';

    const commonCss = `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'Helvetica Neue', Arial, sans-serif; background: white; }
      .qr { display: block; flex-shrink: 0; }
      .info { flex: 1; min-width: 0; overflow: hidden; }
      .main { font-size: ${tmpl.font}; font-weight: 700; color: #111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .sub { font-size: ${tmpl.sub}; color: #555; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }`;

    const waitScript = `<script>
      window.addEventListener('load', function() {
        var images = Array.from(document.images);
        Promise.all(images.map(function(img) {
          return img.complete ? Promise.resolve() : new Promise(function(resolve) { img.onload = resolve; img.onerror = resolve; });
        })).then(function() { window.print(); });
      });
    <\/script>`;

    let html: string;

    if (isDymo) {
      const labelHtml = printItems.map((item: any, i: number) => {
        const qrData = getLabelQrData(item);
        const sub = getLabelSubtext(item);
        const qrUrl = `${origin}/api/warehouse/labels/qr?data=${encodeURIComponent(qrData)}&size=${tmpl.qr * 2}`;
        const breakStyle = i < printItems.length - 1 ? ' style="page-break-after:always;"' : '';
        const mainStyle = activeView === 'bins'
          ? ' style="font-size: 140%; letter-spacing: 0.02em;"'
          : (!sub ? ' style="font-size: 160%; letter-spacing: 0.02em;"' : '');
        return `<div class="label"${breakStyle}>
          <img class="qr" src="${qrUrl}" width="${tmpl.qr}" height="${tmpl.qr}" />
          <div class="info">
            <div class="main"${mainStyle}>${item.name}</div>
            ${sub ? `<div class="sub">${sub}</div>` : ''}
          </div>
        </div>`;
      }).join('');

      html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
        ${commonCss}
        @page { size: ${tmpl.w} ${tmpl.h}; margin: ${tmpl.pageMarginV}; }
        .label { width: 100%; height: 100%; display: flex; align-items: center; gap: 5px; overflow: hidden; }
      </style>${waitScript}</head><body>${labelHtml}</body></html>`;
    } else {
      const labelHtml = printItems.map((item: any) => {
        const qrData = getLabelQrData(item);
        const sub = getLabelSubtext(item);
        const qrUrl = `${origin}/api/warehouse/labels/qr?data=${encodeURIComponent(qrData)}&size=${tmpl.qr * 2}`;
        const mainStyle = activeView === 'bins'
          ? ' style="font-size: 140%; letter-spacing: 0.02em;"'
          : (!sub ? ' style="font-size: 160%; letter-spacing: 0.02em;"' : '');
        return `<div class="label">
          <img class="qr" src="${qrUrl}" width="${tmpl.qr}" height="${tmpl.qr}" />
          <div class="info">
            <div class="main"${mainStyle}>${item.name}</div>
            ${sub ? `<div class="sub">${sub}</div>` : ''}
          </div>
        </div>`;
      }).join('');

      html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
        ${commonCss}
        @page { size: letter; margin: ${tmpl.pageMarginV} ${tmpl.pageMarginH}; }
        .grid { display: grid; grid-template-columns: repeat(${tmpl.cols}, ${tmpl.w}); column-gap: ${tmpl.colGap}; row-gap: ${tmpl.rowGap}; }
        .label { width: ${tmpl.w}; height: ${tmpl.h}; border: 1px solid #ccc; border-radius: 3px; display: flex; align-items: center; gap: 6px; padding: 6px; page-break-inside: avoid; background: white; overflow: hidden; }
      </style>${waitScript}</head><body><div class="grid">${labelHtml}</div></body></html>`;
    }

    const win = window.open('', '_blank', 'width=800,height=600');
    if (win) {
      win.document.write(html);
      win.document.close();
    }
    setPrintDialogOpen(false);
  };

  return (
    <div className="space-y-4">

      {/* Zone filter indicator — shown when a zone filter is active */}
      {activeZoneId !== null && (
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 h-8 px-2 text-xs"
            onClick={() => { setActiveZoneId(null); setShowDepthSetup(false); setFilter('all'); setSelectedItems(new Set()); }}
            data-testid="button-clear-zone-filter"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            All
          </Button>
          <span className="text-muted-foreground/40 text-xs">/</span>
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="h-3.5 w-3.5 text-yellow-400 shrink-0" />
            <span className="text-sm font-semibold truncate">{activeZone?.name}</span>
          </div>
          {activeZone && (
            <Badge className="text-[10px] px-1.5 py-0 no-default-active-elevate ml-1">
              {DEPTH_OPTIONS.find(d => d.value === activeZone.depth)?.label ?? 'Full Warehouse'}
            </Badge>
          )}
        </div>
      )}

      {/* Depth Selector — only available when a zone filter is active */}
      {showDepthSetup && activeZoneId !== null ? (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Zone Setup — {activeZone?.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Choose how deep the location hierarchy goes in this zone</p>
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

          {/* Naming Format */}
          <div className="pt-1 border-t border-border space-y-3">
            <div>
              <p className="text-sm font-semibold">Naming Format</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Controls what characters are accepted when creating locations.
                Industry standard: Aisles = Numbers, Shelves = Letters, Bins = Numbers (e.g. <span className="font-mono">1-A-01</span>).
              </p>
            </div>
            {(['aisle', 'shelf', 'bin'] as const).filter(level =>
              level === 'bin' || (level === 'shelf' && depth >= 2) || (level === 'aisle' && depth >= 3)
            ).map(level => {
              const current = level === 'aisle' ? aisleFormat : level === 'shelf' ? shelfFormat : binFormat;
              const label = level.charAt(0).toUpperCase() + level.slice(1);
              return (
                <div key={level} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-medium text-muted-foreground w-10 shrink-0">{label}</span>
                    <span className="text-[10px] text-muted-foreground/60 font-mono">e.g. {formatExample(current as LocationFormat, level)}</span>
                  </div>
                  <div className="flex rounded-md border border-border overflow-hidden shrink-0">
                    {(['numeric', 'alpha', 'alphanumeric'] as LocationFormat[]).map(opt => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => updateFormatMutation.mutate({ [`${level}Format`]: opt })}
                        className={`text-[11px] px-2.5 py-1 border-l first:border-l-0 border-border transition-colors ${current === opt ? 'bg-yellow-500/20 text-yellow-300 font-medium' : 'text-muted-foreground hover:bg-muted/40'}`}
                        data-testid={`button-format-${level}-${opt}`}
                      >
                        {FORMAT_LABELS[opt]}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : (
        <div className="md:flex md:gap-0">

          {/* ── Desktop left sidebar ─────────────────────────── */}
          <div className="hidden md:flex md:flex-col md:w-52 md:flex-shrink-0 md:border-r md:border-border md:pr-4 md:mr-4 gap-3">
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7 px-2 gap-1 flex-1"
                onClick={() => { setImportCsvOpen(true); setImportResult(null); setImportCsvText(""); }}
                data-testid="button-import-csv-sidebar"
              >
                <Upload className="h-3 w-3" />
                Import
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDepthSetup(true)}
                className="text-xs h-7 px-2"
                data-testid="button-warehouse-setup-sidebar"
              >
                <Settings2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <nav className="flex flex-col gap-0.5">
              <button
                onClick={() => { setActiveView('bins'); setFilter('all'); setSelectedItems(new Set()); setSearchQuery(''); }}
                className={`flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm font-medium transition-colors text-left ${activeView === 'bins' ? 'bg-yellow-500/15 text-yellow-400' : 'text-muted-foreground hover-elevate'}`}
                data-testid="button-view-bins-sidebar"
              >
                <Archive className="w-4 h-4 shrink-0" />
                Bins
                {bins.length > 0 && <span className="ml-auto text-xs opacity-60">{bins.length}</span>}
              </button>
              <button
                onClick={() => { setActiveView('lots'); setFilter('all'); setSelectedItems(new Set()); setSearchQuery(''); }}
                className={`flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm font-medium transition-colors text-left ${activeView === 'lots' ? 'bg-yellow-500/15 text-yellow-400' : 'text-muted-foreground hover-elevate'}`}
                data-testid="button-view-lots-sidebar"
              >
                <Package className="w-4 h-4 shrink-0" />
                Lots
                {unassignedLots > 0 && <Badge className="ml-auto text-[9px] px-1.5 py-0 no-default-active-elevate">{unassignedLots}</Badge>}
              </button>
              {depth >= 2 && (
                <button
                  onClick={() => { setActiveView('shelves'); setFilter('all'); setSelectedItems(new Set()); setSearchQuery(''); }}
                  className={`flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm font-medium transition-colors text-left ${activeView === 'shelves' ? 'bg-yellow-500/15 text-yellow-400' : 'text-muted-foreground hover-elevate'}`}
                  data-testid="button-view-shelves-sidebar"
                >
                  <Layers className="w-4 h-4 shrink-0" />
                  Shelves
                  {shelves.length > 0 && <span className="ml-auto text-xs opacity-60">{shelves.length}</span>}
                </button>
              )}
              {depth >= 3 && (
                <button
                  onClick={() => { setActiveView('aisles'); setFilter('all'); setSelectedItems(new Set()); setSearchQuery(''); }}
                  className={`flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm font-medium transition-colors text-left ${activeView === 'aisles' ? 'bg-yellow-500/15 text-yellow-400' : 'text-muted-foreground hover-elevate'}`}
                  data-testid="button-view-aisles-sidebar"
                >
                  <MapPin className="w-4 h-4 shrink-0" />
                  Aisles
                  {aisles.length > 0 && <span className="ml-auto text-xs opacity-60">{aisles.length}</span>}
                </button>
              )}
            </nav>
            {/* Zone filter */}
            <div className="border-t border-border pt-3 space-y-1.5">
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <Building2 className="h-3 w-3" />Zone
                </span>
                <button
                  onClick={() => setManageZonesOpen(true)}
                  className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2"
                  data-testid="button-manage-zones-sidebar"
                >Manage</button>
              </div>
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => { setActiveZoneId(null); setFilter('all'); setSelectedItems(new Set()); }}
                  className={`flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-sm font-medium transition-colors text-left ${activeZoneId === null ? 'bg-yellow-500/15 text-yellow-400' : 'text-muted-foreground hover-elevate'}`}
                  data-testid="button-zone-filter-all"
                >
                  All zones
                </button>
                {zones.map((z: any) => (
                  <button
                    key={z.id}
                    onClick={() => { setActiveZoneId(z.id); setFilter('all'); setSelectedItems(new Set()); }}
                    className={`flex items-center gap-2 w-full px-3 py-1.5 rounded-md text-sm font-medium transition-colors text-left truncate ${activeZoneId === z.id ? 'bg-yellow-500/15 text-yellow-400' : 'text-muted-foreground hover-elevate'}`}
                    data-testid={`button-zone-filter-${z.id}`}
                  >
                    <span className="truncate">{z.name}</span>
                    {Number(z.binCount) > 0 && <span className="ml-auto text-xs opacity-60 shrink-0">{z.binCount}</span>}
                  </button>
                ))}
                {zones.length === 0 && (
                  <button
                    onClick={() => setManageZonesOpen(true)}
                    className="flex items-center gap-1.5 w-full px-3 py-1.5 rounded-md text-xs text-muted-foreground/60 hover-elevate text-left"
                  >
                    <Plus className="h-3 w-3" /> Add zone
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ── Right content (always visible) ─────────────── */}
          <div className="flex-1 min-w-0 flex flex-col gap-4">

            {/* Mobile-only: zone filter + actions row */}
            <div className="md:hidden flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
                <button
                  onClick={() => { setActiveZoneId(null); setFilter('all'); setSelectedItems(new Set()); }}
                  className={`shrink-0 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${activeZoneId === null ? 'bg-yellow-500/15 text-yellow-400' : 'text-muted-foreground hover-elevate'}`}
                  data-testid="button-zone-filter-all-mobile"
                >All</button>
                {zones.map((z: any) => (
                  <button
                    key={z.id}
                    onClick={() => { setActiveZoneId(z.id); setFilter('all'); setSelectedItems(new Set()); }}
                    className={`shrink-0 px-2.5 py-1 rounded-md text-xs font-medium transition-colors truncate max-w-[100px] ${activeZoneId === z.id ? 'bg-yellow-500/15 text-yellow-400' : 'text-muted-foreground hover-elevate'}`}
                    data-testid={`button-zone-filter-mobile-${z.id}`}
                  >{z.name}</button>
                ))}
                <button
                  onClick={() => setManageZonesOpen(true)}
                  className="shrink-0 px-2 py-1 rounded-md text-xs text-muted-foreground/60 hover-elevate flex items-center gap-0.5"
                  data-testid="button-manage-zones-mobile"
                ><Building2 className="h-3 w-3" /></button>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button variant="outline" size="sm" className="text-xs h-7 px-2 gap-1"
                  onClick={() => { setImportCsvOpen(true); setImportResult(null); setImportCsvText(""); }}
                  data-testid="button-import-csv-top">
                  <Upload className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowDepthSetup(true)} className="text-xs h-7 px-2"
                  data-testid="button-warehouse-setup">
                  <Settings2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Mobile-only: horizontal tabs — fixed set, no conditional renders */}
            <div className="md:hidden tool-tab-bar overflow-x-auto">
              <button
                onClick={() => { setActiveView('bins'); setFilter('all'); setSelectedItems(new Set()); setSearchQuery(''); }}
                className={`tool-tab shrink-0 ${activeView === 'bins' ? 'text-yellow-400 border-yellow-500' : 'tool-tab-off'}`}
                data-testid="button-view-bins"
              >
                <Archive className="w-3.5 h-3.5" />
                Bins
                {bins.length > 0 && <span className="ml-1 opacity-60 text-[10px]">{bins.length}</span>}
              </button>
              <button
                onClick={() => { setActiveView('lots'); setFilter('all'); setSelectedItems(new Set()); setSearchQuery(''); }}
                className={`tool-tab shrink-0 ${activeView === 'lots' ? 'text-yellow-400 border-yellow-500' : 'tool-tab-off'}`}
                data-testid="button-view-lots"
              >
                <Package className="w-3.5 h-3.5" />
                Lots
                {unassignedLots > 0 && (
                  <Badge className="text-[9px] px-1 py-0 no-default-active-elevate ml-1">{unassignedLots}</Badge>
                )}
              </button>
              {depth >= 2 && (
                <button
                  onClick={() => { setActiveView('shelves'); setFilter('all'); setSelectedItems(new Set()); setSearchQuery(''); }}
                  className={`tool-tab shrink-0 ${activeView === 'shelves' ? 'text-yellow-400 border-yellow-500' : 'tool-tab-off'}`}
                  data-testid="button-view-shelves"
                >
                  <Layers className="w-3.5 h-3.5" />
                  Shelves
                  {shelves.length > 0 && <span className="ml-1 opacity-60 text-[10px]">{shelves.length}</span>}
                </button>
              )}
              {depth >= 3 && (
                <button
                  onClick={() => { setActiveView('aisles'); setFilter('all'); setSelectedItems(new Set()); setSearchQuery(''); }}
                  className={`tool-tab shrink-0 ${activeView === 'aisles' ? 'text-yellow-400 border-yellow-500' : 'tool-tab-off'}`}
                  data-testid="button-view-aisles"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  Aisles
                  {aisles.length > 0 && <span className="ml-1 opacity-60 text-[10px]">{aisles.length}</span>}
                </button>
              )}
            </div>


            {/* List View — for lots/bins/shelves/aisles */}
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
            <div className="relative mb-3">
              <Input
                placeholder="Search by part number or name…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="text-xs pr-7"
                data-testid="input-search-lots"
              />
              {serverSearchLoading && (
                <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
            </div>
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
              {(activeView === 'bins' || activeView === 'shelves' || activeView === 'aisles' || activeView === 'lots') && filteredList.length > 0 && (
                <>
                  {selectedItems.size > 0 && selectedItems.size === filteredList.length ? (
                    <Button size="sm" variant="ghost" onClick={() => setSelectedItems(new Set())}
                      className="text-[10px] md:text-xs" data-testid="button-deselect-all">
                      <CheckSquare className="w-3 h-3 mr-1 text-purple-400" />
                      Deselect All
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={handleSelectAll}
                      className="text-[10px] md:text-xs" data-testid="button-select-all">
                      <Square className="w-3 h-3 mr-1" />
                      Select All {activeView === 'lots' && filteredList.length > 0 ? `(${filteredList.length})` : ''}
                    </Button>
                  )}
                  {activeView !== 'lots' && (
                    <Button size="sm" variant="outline" onClick={handlePrintAll}
                      className="text-[10px] md:text-xs gap-1" data-testid="button-print-all-labels">
                      <Printer className="w-3 h-3" />
                      Print All
                    </Button>
                  )}
                </>
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

          {/* Persistent bin selector for lots view */}
          {activeView === 'lots' && bins.length > 0 && (
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <Select value={bulkBinId} onValueChange={setBulkBinId}>
                <SelectTrigger className="h-8 text-xs flex-1 min-w-[140px]" data-testid="select-assign-bin">
                  <SelectValue placeholder="Select a bin…" />
                </SelectTrigger>
                <SelectContent>
                  {bins.map((b: any) => (
                    <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedItems.size > 0 && (
                <>
                  <span className="text-xs text-muted-foreground shrink-0">{selectedItems.size} selected</span>
                  <Button size="sm" onClick={handleBulkAssign} disabled={!bulkBinId} data-testid="button-assign-lots">
                    Assign
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelectedItems(new Set())} data-testid="button-clear-selection">
                    Clear
                  </Button>
                </>
              )}
            </div>
          )}

          {/* Bulk assignment bar (bins / shelves / aisles) */}
          {selectedItems.size > 0 && activeView !== 'lots' && (
            <div className="flex items-center gap-2 mb-3 p-2 bg-muted/30 rounded-md flex-wrap">
              <span className="text-xs font-medium">{selectedItems.size} selected</span>
              {activeView === 'bins' && depth >= 2 && (
                <Select value={bulkShelfId} onValueChange={setBulkShelfId}>
                  <SelectTrigger className="h-7 text-xs flex-1 min-w-[120px]">
                    <SelectValue placeholder="Assign to shelf…" />
                  </SelectTrigger>
                  <SelectContent>
                    {shelves.map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.aisleName ? `${s.aisleName} → ${s.name}` : s.name}
                      </SelectItem>
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
          <div className="space-y-1 max-h-[calc(100dvh-360px)] min-h-[200px] overflow-y-auto">
            {activeView === 'lots' && debouncedSearch.length > 0 && serverSearchLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-xs">Searching…</span>
              </div>
            ) : filteredList.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground py-8">
                {activeView === 'lots' && debouncedSearch.length > 0 ? `No lots matching "${debouncedSearch}".` : activeView === 'lots' && filter === 'unassigned' ? "All lots are assigned — great job!" : "Nothing here yet."}
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
                  } else if (activeView === 'bins') {
                    openBinDetail(item);
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
                    {activeView === 'lots' && item.itemType && (
                      <span className="text-[10px] text-muted-foreground/70">
                        {item.itemType === 'PART' ? 'Part' : item.itemType === 'MINIFIG' ? 'Fig' : item.itemType === 'SET' ? 'Set' : item.itemType === 'GEAR' ? 'Gear' : item.itemType}
                      </span>
                    )}
                    {activeView === 'lots' && item.colorName && (
                      <span className="text-[10px] text-muted-foreground">{item.colorName}</span>
                    )}
                    {activeView === 'lots' && item.quantity != null && (
                      <span className="text-[10px] text-muted-foreground/70">×{item.quantity}</span>
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
                    {activeView === 'bins' && (
                      <span className="flex items-center gap-2">
                        {item.shelfName && <span>Shelf: {item.shelfName}</span>}
                        {item.itemCount > 0
                          ? <span className="text-green-400 font-medium">{item.itemCount} lot{item.itemCount !== 1 ? 's' : ''}</span>
                          : <span className="text-muted-foreground/60 italic">empty</span>
                        }
                      </span>
                    )}
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
          </div>
        </div>
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
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Sheet labels (Avery)</p>
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
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mt-1">Dymo label maker</p>
                {(['dymo30252', 'dymo30336'] as const).map(key => {
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
                        <div className={`mt-0.5 ${printLabelSize === key ? 'text-primary/70' : 'text-muted-foreground'}`}>{t.desc} — one label at a time</div>
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
      <Dialog open={createDialogOpen} onOpenChange={open => { setCreateDialogOpen(open); if (!open) setCreateName(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create {createType.charAt(0).toUpperCase() + createType.slice(1)}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateSubmit} className="space-y-4">
            <div>
              {(() => {
                const fmt = (createType === 'aisle' ? aisleFormat : createType === 'shelf' ? shelfFormat : binFormat) as LocationFormat;
                const level = createType;
                return (
                  <>
                    <div className="flex items-center justify-between mb-1">
                      <Label>Name *</Label>
                      <span className="text-[10px] text-muted-foreground">{formatHint(fmt)} — e.g. {formatExample(fmt, level)}</span>
                    </div>
                    <Input
                      value={createName}
                      onChange={e => setCreateName(applyFormat(e.target.value, fmt))}
                      required
                      placeholder={formatExample(fmt, level)}
                      data-testid="input-create-name"
                    />
                  </>
                );
              })()}
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
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.aisleName ? `${s.aisleName} → ${s.name}` : s.name}
                      </SelectItem>
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
            {depth >= 2 && (
              <div>
                <Label>Assign to shelf <span className="text-muted-foreground">(optional)</span></Label>
                <Select value={bulkShelfForBins} onValueChange={setBulkShelfForBins}>
                  <SelectTrigger data-testid="select-bulk-shelf">
                    <SelectValue placeholder="No shelf — bins will be unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    {shelves.map((s: any) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.aisleName ? `${s.aisleName} → ${s.name}` : s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {/* Auto prefix display */}
            {bulkComputedPrefix && (
              <div className="flex items-center gap-2 text-xs bg-muted/30 rounded-md px-3 py-2">
                <span className="text-muted-foreground shrink-0">Auto prefix:</span>
                <span className="font-mono text-foreground font-medium">{bulkComputedPrefix}</span>
                <span className="text-muted-foreground/60">derived from shelf hierarchy</span>
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>From #</Label>
                <Input type="number" value={bulkStart} onChange={e => setBulkStart(e.target.value)} data-testid="input-bulk-start" />
              </div>
              <div>
                <Label>To #</Label>
                <Input type="number" value={bulkEnd} onChange={e => setBulkEnd(e.target.value)} data-testid="input-bulk-end" />
              </div>
              <div>
                <Label>Zero-pad</Label>
                <Input type="number" min={0} max={6} value={bulkPad} onChange={e => setBulkPad(e.target.value)} placeholder="2 → 01" data-testid="input-bulk-pad" />
              </div>
            </div>
            {bulkPreviewCount > 0 && (
              <div className="bg-muted/30 rounded-md p-3 text-xs space-y-1">
                <p className="font-medium">Preview — {bulkPreviewCount} bins (existing names on this shelf are skipped)</p>
                <p className="text-muted-foreground font-mono">{bulkPreviewNames.join(', ')}</p>
              </div>
            )}
            <Button
              className="w-full"
              disabled={bulkPreviewCount === 0 || bulkCreateBinsMutation.isPending}
              onClick={() => bulkCreateBinsMutation.mutate({
                prefix: bulkComputedPrefix,
                start: parseInt(bulkStart),
                end: parseInt(bulkEnd),
                padLength: parseInt(bulkPad) || 0,
                shelfId: bulkShelfForBins || undefined,
                zoneId: activeZoneId ?? undefined,
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

            {/* Quantity tracking toggle */}
            <label className="flex items-center gap-2 cursor-pointer select-none w-fit" data-testid="toggle-fill-bin-track-qty">
              <input
                type="checkbox"
                checked={fillBinTrackQty}
                onChange={e => setFillBinTrackQty(e.target.checked)}
                className="h-3.5 w-3.5 rounded shrink-0"
              />
              <span className="text-xs text-muted-foreground">Track quantities per bin <span className="text-muted-foreground/60">(split inventory count)</span></span>
            </label>

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
                <div ref={fillBinListRef} className="bg-muted/30 rounded-md p-2 max-h-52 overflow-y-auto space-y-0.5" data-testid="fill-bin-preview">
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
                        {item.itemType && <span className="text-[10px] text-muted-foreground/60 shrink-0">{item.itemType === 'PART' ? 'Part' : item.itemType === 'MINIFIG' ? 'Fig' : item.itemType === 'SET' ? 'Set' : item.itemType === 'GEAR' ? 'Gear' : item.itemType}</span>}
                        {item.colorName && <span className="text-[10px] text-muted-foreground shrink-0">{item.colorName}</span>}
                        {item.quantity != null && <span className="text-[10px] text-muted-foreground/60 shrink-0">×{item.quantity}</span>}
                        {fillBinTrackQty && checked && (
                          <input
                            type="number"
                            min={1}
                            placeholder={item.quantity ? `of ${item.quantity}` : 'qty'}
                            value={fillBinQties.get(item.id) ?? ''}
                            onChange={e => {
                              const v = e.target.value;
                              setFillBinQties(prev => { const m = new Map(prev); if (v) m.set(item.id, v); else m.delete(item.id); return m; });
                            }}
                            onClick={e => e.stopPropagation()}
                            className="h-5 w-16 text-[10px] rounded border border-border bg-background px-1 shrink-0"
                            data-testid={`input-fill-bin-qty-${item.id}`}
                          />
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
              {fillBinHasMore && (
                <button
                  onClick={() => {
                    const prevLen = fillBinPreview.length;
                    setFillBinCount(String(parseInt(fillBinCount) + 20));
                    // After React re-renders with more items, scroll so the first new item is visible
                    setTimeout(() => {
                      if (fillBinListRef.current) {
                        const children = fillBinListRef.current.children;
                        const target = children[prevLen] as HTMLElement | undefined;
                        if (target) target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                      }
                    }, 30);
                  }}
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
                      {fillBinTrackQty && (
                        <input
                          type="number"
                          min={1}
                          placeholder={item.quantity ? `of ${item.quantity}` : 'qty'}
                          value={fillBinQties.get(item.id) ?? ''}
                          onChange={e => {
                            const v = e.target.value;
                            setFillBinQties(prev => { const m = new Map(prev); if (v) m.set(item.id, v); else m.delete(item.id); return m; });
                          }}
                          className="h-5 w-16 text-[10px] rounded border border-border bg-background px-1 shrink-0"
                          data-testid={`input-fill-bin-qty-manual-${item.id}`}
                        />
                      )}
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
                {fillBinTrackQty && fillBinQties.size > 0 && <span className="text-muted-foreground"> · {fillBinQties.size} with quantities</span>}
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

      {/* Bin Detail / Move Dialog */}
      <Dialog open={binDetailOpen} onOpenChange={open => { setBinDetailOpen(open); if (!open) resetBinDetail(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Archive className="h-4 w-4 text-green-400" />
              {binDetailBin?.name}
              {binMoveStep === 'move' && <span className="text-muted-foreground font-normal text-sm">— Move lots</span>}
            </DialogTitle>
            <DialogDescription>
              {binMoveStep === 'select'
                ? `${binDetailLots.length} lot${binDetailLots.length !== 1 ? 's' : ''} in this bin. Select any to move them to another bin.`
                : `Moving ${binDetailSelected.size} lot${binDetailSelected.size !== 1 ? 's' : ''} — choose a destination.`}
            </DialogDescription>
          </DialogHeader>

          {binMoveStep === 'select' ? (
            <div className="space-y-3">
              {binDetailLots.length === 0 ? (
                <div className="text-center py-6 space-y-3">
                  <p className="text-xs text-muted-foreground italic">This bin is empty.</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setBinDetailOpen(false);
                      resetBinDetail();
                      setFillBinTargetId(String(binDetailBin?.id ?? ''));
                      setFillBinDialogOpen(true);
                    }}
                    data-testid="button-bin-add-items-empty"
                  >
                    <Plus className="h-4 w-4 mr-1.5" />
                    Add items to this bin
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">Check the lots you want to move</p>
                    <div className="flex gap-2 text-[10px] text-muted-foreground">
                      <button className="hover:text-foreground underline underline-offset-2"
                        onClick={() => setBinDetailSelected(new Set(binDetailLots.map((l: any) => l.id)))}>all</button>
                      <button className="hover:text-foreground underline underline-offset-2"
                        onClick={() => setBinDetailSelected(new Set())}>none</button>
                    </div>
                  </div>
                  <div className="bg-muted/30 rounded-md p-2 max-h-60 overflow-y-auto space-y-0.5">
                    {binDetailLots.map((loc: any) => {
                      const checked = binDetailSelected.has(loc.id);
                      return (
                        <label key={loc.id}
                          className={`flex items-center gap-2 px-1.5 py-1 rounded cursor-pointer select-none hover-elevate ${checked ? '' : 'opacity-40'}`}>
                          <input type="checkbox" checked={checked} className="h-3.5 w-3.5 rounded shrink-0"
                            onChange={() => setBinDetailSelected(prev => {
                              const next = new Set(prev);
                              next.has(loc.id) ? next.delete(loc.id) : next.add(loc.id);
                              return next;
                            })} />
                          <span className="font-mono text-xs font-medium shrink-0 w-20 truncate">{loc.itemNo}</span>
                          <span className="text-[11px] text-muted-foreground truncate flex-1">{loc.itemName || '—'}</span>
                          {loc.colorName && <span className="text-[10px] text-muted-foreground shrink-0">{loc.colorName}</span>}
                          {checked && (
                            <input
                              type="number"
                              min={1}
                              placeholder="qty"
                              value={binMoveQties.get(loc.id) ?? ''}
                              onChange={e => {
                                const v = e.target.value;
                                setBinMoveQties(prev => { const m = new Map(prev); if (v) m.set(loc.id, v); else m.delete(loc.id); return m; });
                              }}
                              onClick={e => e.stopPropagation()}
                              className="h-5 w-16 text-[10px] rounded border border-border bg-background px-1 shrink-0"
                              data-testid={`input-move-qty-${loc.id}`}
                            />
                          )}
                          {!checked && loc.quantity != null && (
                            <span className="text-[10px] text-muted-foreground shrink-0">×{loc.quantity}</span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setBinDetailOpen(false);
                        resetBinDetail();
                        setFillBinTargetId(String(binDetailBin?.id ?? ''));
                        setFillBinDialogOpen(true);
                      }}
                      data-testid="button-bin-add-items"
                    >
                      <Plus className="h-4 w-4 mr-1.5" />
                      Add items
                    </Button>
                    <Button
                      className="flex-1"
                      disabled={binDetailSelected.size === 0}
                      onClick={() => setBinMoveStep('move')}
                      data-testid="button-bin-move-next"
                    >
                      <MoveRight className="h-4 w-4 mr-1.5" />
                      {binDetailSelected.size > 0 ? `Move ${binDetailSelected.size} lot${binDetailSelected.size !== 1 ? 's' : ''}` : 'Move selected'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Destination type toggle */}
              <div className="flex gap-2">
                {(['existing', 'new'] as const).map(t => (
                  <button key={t}
                    onClick={() => { setBinMoveType(t); setBinMoveExistingId(''); setBinMoveNewName(''); }}
                    className={`flex-1 rounded-md border py-2 px-3 text-xs text-left transition-colors ${binMoveType === t ? 'border-primary bg-primary/10 text-primary' : 'border-border hover-elevate'}`}
                    data-testid={`button-move-type-${t}`}
                  >
                    <div className="font-semibold capitalize">{t === 'existing' ? 'Existing bin' : 'New bin'}</div>
                    <div className={`mt-0.5 ${binMoveType === t ? 'text-primary/70' : 'text-muted-foreground'}`}>
                      {t === 'existing' ? 'Pick a bin that already exists' : 'Create a new bin and move there'}
                    </div>
                  </button>
                ))}
              </div>

              {binMoveType === 'existing' ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">Destination bin</Label>
                  <Select value={binMoveExistingId} onValueChange={setBinMoveExistingId}>
                    <SelectTrigger data-testid="select-move-bin-target">
                      <SelectValue placeholder="Select a bin…" />
                    </SelectTrigger>
                    <SelectContent>
                      {[...bins].filter((b: any) => b.id !== binDetailBin?.id).sort(alphaNumericSort).map((b: any) => (
                        <SelectItem key={b.id} value={String(b.id)}>
                          {b.name}{b.itemCount > 0 ? ` (${b.itemCount} lots)` : ' (empty)'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label className="text-xs">New bin name</Label>
                  <Input
                    placeholder="e.g. BIN-42"
                    value={binMoveNewName}
                    onChange={e => setBinMoveNewName(e.target.value)}
                    className="text-xs"
                    data-testid="input-move-new-bin-name"
                  />
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => setBinMoveStep('select')} data-testid="button-bin-move-back">
                  Back
                </Button>
                <Button
                  className="flex-1"
                  disabled={binMovePending || (binMoveType === 'existing' ? !binMoveExistingId : !binMoveNewName.trim())}
                  onClick={handleMoveLots}
                  data-testid="button-bin-move-confirm"
                >
                  {binMovePending
                    ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Moving…</>
                    : <><MoveRight className="h-4 w-4 mr-1.5" />Move {binDetailSelected.size} lot{binDetailSelected.size !== 1 ? 's' : ''}</>
                  }
                </Button>
              </div>
            </div>
          )}
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
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.aisleName ? `${s.aisleName} → ${s.name}` : s.name}
                      </SelectItem>
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

      {/* Manage Zones Dialog */}
      <Dialog open={manageZonesOpen} onOpenChange={setManageZonesOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-yellow-400" />
              Warehouse Zones
            </DialogTitle>
            <DialogDescription>Each zone is an independent area with its own storage hierarchy and naming rules.</DialogDescription>
          </DialogHeader>
          <div className="pt-2">
            {zonesView}
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
