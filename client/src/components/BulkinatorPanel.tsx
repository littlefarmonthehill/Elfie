import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Package, Search, Trash2, Plus, X,
  ChevronRight, ChevronDown, Wand2, Pencil, Check, AlertCircle,
  Layers, ArrowLeft, RefreshCw
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────
interface BulkLot {
  id: number;
  name: string;
  description: string | null;
  bulk_type: 'same_part' | 'mixed_parts';
  unit_price: string | null;
  status: 'draft' | 'active' | 'inactive';
  bo_lot_id: string | null;
  last_synced_at: string | null;
  sync_error: string | null;
  item_count: number;
  total_quantity: number;
  created_at: string;
  updated_at: string;
}

interface BulkLotWithItems extends BulkLot {
  items: BulkLotItem[];
}

interface BulkLotItem {
  id: number;
  bl_inventory_id: number;
  quantity: number;
  item_no: string;
  item_type: string;
  color_id: number | null;
  item_name: string;
  color_name: string;
  inv_quantity: number;
  inv_unit_price: string | null;
  new_or_used: 'N' | 'U';
  remarks: string | null;
}

interface InventorySearchResult {
  id: number;
  item_no: string;
  item_type: string;
  color_id: number | null;
  quantity: number;
  unit_price: string | null;
  new_or_used: 'N' | 'U';
  item_name: string;
  color_name: string;
  category_name: string;
  is_stock_room: boolean;
  stock_room_id: string | null;
}

interface AISuggestion {
  title: string;
  type: 'same_part' | 'mixed_parts';
  rationale: string;
  inventoryIds: number[];
  suggestedPrice: number;
  items: InventorySearchResult[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const STATUS_COLORS = {
  draft:    'bg-gray-700/50 text-gray-300 border-gray-600/40',
  active:   'bg-green-900/50 text-green-300 border-green-600/40',
  inactive: 'bg-amber-900/50 text-amber-300 border-amber-600/40',
};
const STATUS_LABELS = { draft: 'Draft', active: 'Active', inactive: 'Inactive' };
const TYPE_LABELS = { same_part: 'Same Part', mixed_parts: 'Mixed Parts' };
const TYPE_COLORS = {
  same_part:   'text-blue-300 bg-blue-900/30 border-blue-600/30',
  mixed_parts: 'text-purple-300 bg-purple-900/30 border-purple-600/30',
};

// ── Sub-components ─────────────────────────────────────────────────────────────

function InlineEdit({ value, onSave, className, placeholder }: {
  value: string; onSave: (v: string) => void; className?: string; placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const commit = () => { if (draft.trim() !== value) onSave(draft.trim()); setEditing(false); };
  if (editing) return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        className={cn("bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-gray-100 outline-none focus:border-blue-500", className)}
        placeholder={placeholder}
      />
      <button onClick={commit} className="text-green-400 hover:text-green-300"><Check className="w-3 h-3" /></button>
      <button onClick={() => { setDraft(value); setEditing(false); }} className="text-gray-500 hover:text-gray-300"><X className="w-3 h-3" /></button>
    </div>
  );
  return (
    <button
      onClick={() => { setDraft(value); setEditing(true); }}
      className={cn("flex items-center gap-1 group hover:text-gray-100 transition-colors", className)}
    >
      <span>{value || placeholder}</span>
      <Pencil className="w-2.5 h-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
    </button>
  );
}

// ── Lot List View ──────────────────────────────────────────────────────────────
function LotList({ lots, onSelect, onCreate }: {
  lots: BulkLot[];
  onSelect: (id: number) => void;
  onCreate: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {lots.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-xs">
          No bulk lots yet. Create one or use AI suggestions.
        </div>
      ) : (
        lots.map(lot => (
          <button
            key={lot.id}
            onClick={() => onSelect(lot.id)}
            data-testid={`bulk-lot-${lot.id}`}
            className="flex items-center gap-2.5 rounded-lg border border-gray-700/60 bg-gray-800/30 px-3 py-2.5 text-left hover-elevate active-elevate-2 transition-all"
          >
            <div className="p-1.5 rounded-md bg-gray-700/60 ring-1 ring-gray-600/40">
              <Layers className="w-3.5 h-3.5 text-gray-300" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-semibold text-gray-100 truncate">{lot.name}</span>
                <Badge variant="outline" className={cn("text-[9px] px-1 py-0 border", TYPE_COLORS[lot.bulk_type])}>
                  {TYPE_LABELS[lot.bulk_type]}
                </Badge>
                <Badge variant="outline" className={cn("text-[9px] px-1 py-0 border", STATUS_COLORS[lot.status])}>
                  {STATUS_LABELS[lot.status]}
                </Badge>
              </div>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-[10px] text-gray-500">{lot.item_count} lot{lot.item_count !== 1 ? 's' : ''} · {lot.total_quantity} pcs</span>
                {lot.unit_price && <span className="text-[10px] text-green-400">${parseFloat(lot.unit_price).toFixed(2)}</span>}
                {lot.bo_lot_id && <span className="text-[10px] text-blue-400">On BrickOwl</span>}
              </div>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" />
          </button>
        ))
      )}
      <Button size="sm" variant="outline" onClick={onCreate} data-testid="button-create-bulk-lot"
        className="mt-1 border-gray-600/60 text-gray-300 text-xs">
        <Plus className="w-3.5 h-3.5 mr-1" /> New Bulk Lot
      </Button>
    </div>
  );
}

// ── Create Modal (inline) ──────────────────────────────────────────────────────
function CreateLotForm({ onCreated, onCancel }: {
  onCreated: (lot: BulkLot) => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [bulkType, setBulkType] = useState<'same_part' | 'mixed_parts'>('mixed_parts');

  const createMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/bulk-lots', { name: name.trim(), bulkType }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/bulk-lots'] });
      onCreated(data);
    },
    onError: () => toast({ title: 'Failed to create bulk lot', variant: 'destructive' }),
  });

  return (
    <div className="rounded-lg border border-gray-600/60 bg-gray-800/40 p-3 space-y-2.5">
      <p className="text-xs font-semibold text-gray-200">New Bulk Lot</p>
      <Input
        placeholder="Lot name (e.g. Mixed 1×2 Plates)"
        value={name}
        onChange={e => setName(e.target.value)}
        className="h-8 text-xs bg-gray-800 border-gray-600 text-gray-100"
        data-testid="input-bulk-lot-name"
      />
      <div className="flex gap-2">
        {(['same_part', 'mixed_parts'] as const).map(t => (
          <button
            key={t}
            onClick={() => setBulkType(t)}
            className={cn(
              "flex-1 rounded-md border px-2 py-1.5 text-[10px] font-medium transition-colors",
              bulkType === t ? "border-blue-500/60 bg-blue-900/40 text-blue-200" : "border-gray-600/60 text-gray-400 hover:text-gray-200"
            )}
            data-testid={`select-bulk-type-${t}`}
          >
            {TYPE_LABELS[t]}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-gray-500 leading-relaxed">
        {bulkType === 'same_part'
          ? 'One part number across multiple colors — e.g. 100× 1×2 Plates in assorted colors.'
          : 'Multiple different parts grouped by theme or category — e.g. City Police Parts Lot.'}
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onCancel} className="flex-1 text-xs border-gray-600 text-gray-400">Cancel</Button>
        <Button size="sm" onClick={() => createMutation.mutate()} disabled={!name.trim() || createMutation.isPending}
          className="flex-1 text-xs bg-blue-700 hover:bg-blue-600 text-white" data-testid="button-confirm-create-bulk-lot">
          {createMutation.isPending ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </div>
  );
}

// ── AI Suggestions Panel ───────────────────────────────────────────────────────
function AISuggestionsPanel({ onApply }: { onApply: (s: AISuggestion) => void }) {
  const [expanded, setExpanded] = useState(false);
  const { data, isFetching, refetch } = useQuery<{ suggestions: AISuggestion[] }>({
    queryKey: ['/api/bulk-lots/suggestions'],
    enabled: expanded,
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-950/20">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
        data-testid="button-bulkinator-ai-suggestions"
      >
        <div className="p-1 rounded bg-amber-900/60 ring-1 ring-amber-500/40">
          <Wand2 className="w-3 h-3 text-amber-300" />
        </div>
        <span className="text-xs font-semibold text-amber-200 flex-1">AI Suggestions</span>
        {isFetching && <RefreshCw className="w-3 h-3 text-amber-400 animate-spin" />}
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-amber-500" /> : <ChevronRight className="w-3.5 h-3.5 text-amber-500" />}
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-amber-500/20">
          {isFetching ? (
            <div className="py-4 text-center text-xs text-gray-500">Analyzing inventory…</div>
          ) : !data?.suggestions.length ? (
            <div className="py-3 flex flex-col items-center gap-2">
              <p className="text-xs text-gray-500">No suggestions yet or not enough inventory.</p>
              <Button size="sm" variant="outline" onClick={() => refetch()} className="text-xs border-amber-600/40 text-amber-300">
                <RefreshCw className="w-3 h-3 mr-1" /> Try Again
              </Button>
            </div>
          ) : (
            <>
              {data.suggestions.map((s, i) => (
                <div key={i} className="rounded-md border border-gray-700/60 bg-gray-800/20 p-2.5 space-y-1.5">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-100">{s.title}</p>
                      <Badge variant="outline" className={cn("text-[9px] px-1 py-0 border mt-0.5", TYPE_COLORS[s.type])}>
                        {TYPE_LABELS[s.type]}
                      </Badge>
                    </div>
                    <span className="text-xs font-semibold text-green-400 flex-shrink-0">
                      ${s.suggestedPrice?.toFixed(2) ?? '?'}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-400 leading-relaxed">{s.rationale}</p>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] text-gray-500">{s.items.length} lots matched</span>
                    <Button size="sm" onClick={() => onApply(s)} disabled={s.items.length === 0}
                      className="text-[10px] h-6 px-2 bg-amber-800/60 hover:bg-amber-700/60 text-amber-200 border border-amber-600/40"
                      data-testid={`button-apply-suggestion-${i}`}>
                      Apply
                    </Button>
                  </div>
                </div>
              ))}
              <Button size="sm" variant="ghost" onClick={() => refetch()} className="text-[10px] text-gray-500 w-full">
                <RefreshCw className="w-3 h-3 mr-1" /> Regenerate
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Lot Detail View ────────────────────────────────────────────────────────────
function LotDetail({ lotId, onBack }: { lotId: number; onBack: () => void }) {
  const { toast } = useToast();
  const [searchQ, setSearchQ] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceInput, setPriceInput] = useState('');
  const [generatingDesc, setGeneratingDesc] = useState(false);

  const { data: lot, isLoading } = useQuery<BulkLotWithItems>({
    queryKey: ['/api/bulk-lots', lotId],
    queryFn: () => fetch(`/api/bulk-lots/${lotId}`).then(r => r.json()),
  });

  const { data: searchResults, isFetching: isSearching } = useQuery<InventorySearchResult[]>({
    queryKey: ['/api/bulk-lots/inventory-search', searchQ],
    queryFn: () => fetch(`/api/bulk-lots/inventory-search?q=${encodeURIComponent(searchQ)}&limit=20`).then(r => r.json()),
    enabled: searchOpen,
    staleTime: 30000,
  });

  const patchMutation = useMutation({
    mutationFn: (patch: Record<string, any>) => apiRequest('PATCH', `/api/bulk-lots/${lotId}`, patch),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/bulk-lots', lotId] }); queryClient.invalidateQueries({ queryKey: ['/api/bulk-lots'] }); },
    onError: () => toast({ title: 'Save failed', variant: 'destructive' }),
  });

  const addItemMutation = useMutation({
    mutationFn: (blInventoryId: number) => apiRequest('POST', `/api/bulk-lots/${lotId}/items`, { blInventoryId, quantity: 1 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/bulk-lots', lotId] });
      queryClient.invalidateQueries({ queryKey: ['/api/bulk-lots'] });
    },
    onError: () => toast({ title: 'Failed to add item', variant: 'destructive' }),
  });

  const removeItemMutation = useMutation({
    mutationFn: (itemId: number) => apiRequest('DELETE', `/api/bulk-lots/${lotId}/items/${itemId}`, {}),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/bulk-lots', lotId] }); queryClient.invalidateQueries({ queryKey: ['/api/bulk-lots'] }); },
    onError: () => toast({ title: 'Failed to remove item', variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest('DELETE', `/api/bulk-lots/${lotId}`, {}),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/bulk-lots'] }); onBack(); },
    onError: () => toast({ title: 'Failed to delete', variant: 'destructive' }),
  });

  const generateDesc = useCallback(async () => {
    setGeneratingDesc(true);
    try {
      const res = await apiRequest('POST', `/api/bulk-lots/${lotId}/generate-description`, {});
      const data = res as any;
      if (data?.description) {
        patchMutation.mutate({ description: data.description });
        toast({ title: 'Description generated' });
      }
    } catch {
      toast({ title: 'Generation failed', variant: 'destructive' });
    } finally { setGeneratingDesc(false); }
  }, [lotId, patchMutation, toast]);

  if (isLoading || !lot) return (
    <div className="py-6 text-center text-xs text-gray-500">Loading…</div>
  );

  const existingIds = new Set((lot.items || []).map(i => i.bl_inventory_id));
  const price = lot.unit_price ? parseFloat(lot.unit_price) : null;

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="text-gray-500 hover:text-gray-200 transition-colors" data-testid="button-bulk-lot-back">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <InlineEdit
            value={lot.name}
            onSave={v => patchMutation.mutate({ name: v })}
            className="text-sm font-bold text-gray-100"
            placeholder="Lot name"
          />
          <div className="flex items-center gap-1.5 mt-0.5">
            <Badge variant="outline" className={cn("text-[9px] px-1 py-0 border", TYPE_COLORS[lot.bulk_type])}>
              {TYPE_LABELS[lot.bulk_type]}
            </Badge>
            <span className="text-[10px] text-gray-500">{lot.item_count} lots · {lot.total_quantity} pcs</span>
            {lot.bo_lot_id && <Badge variant="outline" className="text-[9px] px-1 py-0 border border-blue-600/40 text-blue-300">On BrickOwl</Badge>}
          </div>
        </div>
        {/* Status toggle */}
        <select
          value={lot.status}
          onChange={e => patchMutation.mutate({ status: e.target.value })}
          className="text-[10px] rounded border px-1.5 py-1 bg-gray-800 border-gray-600 text-gray-300 outline-none"
          data-testid="select-bulk-lot-status"
        >
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* Price */}
      <div className="rounded-md border border-gray-700/60 bg-gray-800/20 px-3 py-2.5 flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 w-10">Price</span>
        {editingPrice ? (
          <div className="flex items-center gap-1.5 flex-1">
            <span className="text-xs text-gray-400">$</span>
            <input
              autoFocus
              type="number" min="0" step="0.01"
              value={priceInput}
              onChange={e => setPriceInput(e.target.value)}
              onBlur={() => {
                const v = parseFloat(priceInput);
                patchMutation.mutate({ unitPrice: isNaN(v) ? null : v });
                setEditingPrice(false);
              }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditingPrice(false); }}
              className="flex-1 bg-transparent text-xs text-gray-100 outline-none border-b border-blue-500"
              data-testid="input-bulk-price"
            />
          </div>
        ) : (
          <button
            className="flex-1 text-left text-xs text-gray-100 hover:text-gray-200 group flex items-center gap-1"
            onClick={() => { setPriceInput(price?.toFixed(2) ?? ''); setEditingPrice(true); }}
            data-testid="button-edit-bulk-price"
          >
            {price != null ? <span className="font-semibold text-green-400">${price.toFixed(2)}</span> : <span className="text-gray-500">Set price…</span>}
            <Pencil className="w-2.5 h-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
          </button>
        )}
      </div>

      {/* Description */}
      <div className="rounded-md border border-gray-700/60 bg-gray-800/20 p-2.5 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Description</span>
          <Button size="sm" variant="ghost" onClick={generateDesc} disabled={generatingDesc || !lot.items?.length}
            className="text-[10px] h-5 px-1.5 text-amber-400 hover:text-amber-300" data-testid="button-generate-description">
            <Wand2 className="w-2.5 h-2.5 mr-0.5" />
            {generatingDesc ? 'Generating…' : 'Generate'}
          </Button>
        </div>
        <Textarea
          value={lot.description ?? ''}
          onChange={e => patchMutation.mutate({ description: e.target.value })}
          placeholder="BrickOwl listing description…"
          className="text-[10px] bg-transparent border-0 text-gray-300 placeholder-gray-600 resize-none min-h-[60px] focus-visible:ring-0 p-0"
          data-testid="textarea-bulk-description"
        />
      </div>

      {/* Sync error */}
      {lot.sync_error && (
        <div className="flex items-start gap-1.5 rounded-md border border-red-600/40 bg-red-900/20 px-2.5 py-2">
          <AlertCircle className="w-3 h-3 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-[10px] text-red-300">{lot.sync_error}</p>
        </div>
      )}

      {/* Items in this lot */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Lots in Bundle</p>
          <button
            onClick={() => setSearchOpen(o => !o)}
            className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
            data-testid="button-add-lot-to-bulk"
          >
            <Plus className="w-3 h-3" /> Add Lot
          </button>
        </div>

        {/* Item search */}
        {searchOpen && (
          <div className="mb-2 space-y-1.5 rounded-md border border-blue-600/30 bg-blue-950/20 p-2.5">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500" />
              <Input
                autoFocus
                placeholder="Search part #, name…"
                value={searchQ}
                onChange={e => setSearchQ(e.target.value)}
                className="h-7 pl-6 text-xs bg-gray-800 border-gray-600 text-gray-100"
                data-testid="input-bulk-lot-search"
              />
            </div>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {isSearching ? (
                <p className="text-[10px] text-gray-500 text-center py-2">Searching…</p>
              ) : searchResults?.map(inv => {
                const alreadyAdded = existingIds.has(inv.id);
                return (
                  <div key={inv.id} className="flex items-center gap-2 rounded px-2 py-1.5 bg-gray-800/40">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-medium text-gray-200 truncate">{inv.item_name}</p>
                      <p className="text-[9px] text-gray-500">{inv.item_no} · {inv.color_name} · Qty: {inv.quantity}</p>
                    </div>
                    {inv.unit_price && <span className="text-[10px] text-green-400">${parseFloat(inv.unit_price).toFixed(2)}</span>}
                    <button
                      disabled={alreadyAdded || addItemMutation.isPending}
                      onClick={() => addItemMutation.mutate(inv.id)}
                      className={cn(
                        "text-[9px] rounded px-1.5 py-0.5 border transition-colors",
                        alreadyAdded
                          ? "text-gray-600 border-gray-700 cursor-default"
                          : "text-blue-300 border-blue-600/40 hover:bg-blue-900/30"
                      )}
                      data-testid={`button-add-inv-${inv.id}`}
                    >
                      {alreadyAdded ? 'Added' : 'Add'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Item list */}
        {!lot.items?.length ? (
          <p className="text-[10px] text-gray-600 text-center py-3">No lots added yet.</p>
        ) : (
          <div className="space-y-1">
            {lot.items.map(item => (
              <div key={item.id} className="flex items-center gap-2 rounded-md border border-gray-700/40 bg-gray-800/20 px-2.5 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-medium text-gray-200 truncate">{item.item_name}</p>
                  <p className="text-[9px] text-gray-500">{item.item_no} · {item.color_name} · {item.new_or_used === 'N' ? 'New' : 'Used'}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[10px] text-gray-400">Stock: {item.inv_quantity}</p>
                  {item.inv_unit_price && <p className="text-[10px] text-green-400">${parseFloat(item.inv_unit_price).toFixed(2)}</p>}
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => removeItemMutation.mutate(item.id)}
                      className="text-gray-600 hover:text-red-400 transition-colors ml-1"
                      data-testid={`button-remove-bulk-item-${item.id}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="text-xs">Remove from bundle</TooltipContent>
                </Tooltip>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete */}
      <div className="pt-1 border-t border-gray-800">
        <button
          onClick={() => { if (confirm(`Disband "${lot.name}"? This permanently removes the bulk lot.`)) deleteMutation.mutate(); }}
          className="text-[10px] text-red-500 hover:text-red-400 transition-colors flex items-center gap-1"
          data-testid="button-disband-bulk-lot"
        >
          <Trash2 className="w-3 h-3" /> Disband bulk lot
        </button>
      </div>
    </div>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────────────
export default function BulkinatorPanel() {
  const { toast } = useToast();
  const [selectedLotId, setSelectedLotId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: lots, isLoading } = useQuery<BulkLot[]>({
    queryKey: ['/api/bulk-lots'],
    staleTime: 30000,
  });

  const createFromSuggestion = useMutation({
    mutationFn: async (s: AISuggestion) => {
      const lot: any = await apiRequest('POST', '/api/bulk-lots', {
        name: s.title,
        bulkType: s.type,
        unitPrice: s.suggestedPrice ?? null,
      });
      for (const item of s.items) {
        await apiRequest('POST', `/api/bulk-lots/${lot.id}/items`, { blInventoryId: item.id, quantity: 1 });
      }
      return lot;
    },
    onSuccess: (lot: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/bulk-lots'] });
      toast({ title: 'Bulk lot created from suggestion' });
      setSelectedLotId(lot.id);
    },
    onError: () => toast({ title: 'Failed to apply suggestion', variant: 'destructive' }),
  });

  if (selectedLotId !== null) {
    return <LotDetail lotId={selectedLotId} onBack={() => setSelectedLotId(null)} />;
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-md bg-orange-900/60 ring-1 ring-orange-500/40">
          <Package className="w-3.5 h-3.5 text-orange-300" />
        </div>
        <div className="flex-1">
          <p className="text-xs font-bold text-orange-100">Bulkinator</p>
          <p className="text-[10px] text-gray-500">Bundle lots for BrickOwl</p>
        </div>
        {(lots?.length ?? 0) > 0 && (
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-orange-600/40 text-orange-300">
            {lots!.length} lot{lots!.length !== 1 ? 's' : ''}
          </Badge>
        )}
      </div>

      {/* AI Suggestions */}
      <AISuggestionsPanel onApply={s => {
        if (createFromSuggestion.isPending) return;
        createFromSuggestion.mutate(s);
      }} />

      {/* Create form */}
      {creating ? (
        <CreateLotForm
          onCreated={lot => { setCreating(false); setSelectedLotId(lot.id); }}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      {/* Lots list */}
      {isLoading ? (
        <p className="text-xs text-gray-500 text-center py-3">Loading…</p>
      ) : (
        <LotList
          lots={lots ?? []}
          onSelect={setSelectedLotId}
          onCreate={() => setCreating(true)}
        />
      )}

    </div>
  );
}
