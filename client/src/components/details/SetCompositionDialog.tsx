import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Layers, Search, Package, AlertTriangle, CheckCircle2, Copy, MapPin, ShoppingCart, Minus, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface CompositionPart {
  partNum: string;
  colorId: number | null;
  needed: number;
  setOwned: number;
  invQty: number;
  invLots: number;
  binNames: string | null;
  partName: string | null;
  colorName: string | null;
  colorRgb: string | null;
  thumbnailUrl: string | null;
  storedImageKey: string | null;
  inventoryIds: number[];
}

interface CompositionResponse {
  setNo: string;
  resolved: boolean;
  parts: CompositionPart[];
  totals: {
    uniqueParts: number;
    completeParts: number;
    partialParts: number;
    missingParts: number;
    piecesNeeded: number;
    piecesOwned: number;
  };
}

type SortKey = 'status' | 'partNum' | 'color';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  setNo: string;
  setName?: string | null;
  inventoryId: number;
  onItemClick?: (type: 'inventory', id: number | string) => void;
}

export default function SetCompositionDialog({ open, onOpenChange, setNo, setName, inventoryId, onItemClick }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('status');
  const [localOwned, setLocalOwned] = useState<Record<string, number>>({});

  const queryKey = ['/api/inventory/sets', setNo, 'composition', inventoryId] as const;

  const { data, isLoading, isFetching } = useQuery<CompositionResponse>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/inventory/sets/${encodeURIComponent(setNo)}/composition?inventoryId=${inventoryId}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Failed to load composition (${res.status})`);
      return res.json();
    },
    enabled: open && !!setNo && !!inventoryId,
    staleTime: 30_000,
    gcTime: 60_000,
    refetchOnMount: 'always',
  });

  // Reset local edits whenever a new payload arrives
  useEffect(() => {
    if (data?.parts) setLocalOwned({});
  }, [data?.parts]);

  const upsertOwned = useMutation({
    mutationFn: async (vars: { partNum: string; colorId: number | null; ownedQty: number }) => {
      return apiRequest('PATCH', `/api/inventory/sets/${inventoryId}/owned`, vars);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
    },
    onError: (e: any) => {
      toast({ title: 'Could not save', description: e?.message || 'Try again', variant: 'destructive' });
    },
  });

  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const queueSave = (key: string, partNum: string, colorId: number | null, ownedQty: number) => {
    if (debounceTimers.current[key]) clearTimeout(debounceTimers.current[key]);
    debounceTimers.current[key] = setTimeout(() => {
      upsertOwned.mutate({ partNum, colorId, ownedQty });
    }, 450);
  };

  const partKey = (p: { partNum: string; colorId: number | null }) =>
    `${p.partNum}::${p.colorId ?? 0}`;

  const getOwned = (p: CompositionPart) => {
    const k = partKey(p);
    return localOwned[k] ?? p.setOwned;
  };

  const setOwnedFor = (p: CompositionPart, val: number) => {
    const next = Math.max(0, Math.min(99999, Math.floor(val)));
    const k = partKey(p);
    setLocalOwned(prev => ({ ...prev, [k]: next }));
    queueSave(k, p.partNum, p.colorId, next);
  };

  const parts = data?.parts ?? [];

  // Live totals reflect optimistic edits
  const liveTotals = useMemo(() => {
    let needed = 0, owned = 0, complete = 0, partial = 0, missing = 0;
    for (const p of parts) {
      const o = getOwned(p);
      needed += p.needed;
      owned += Math.min(o, p.needed);
      if (o >= p.needed) complete += 1;
      else if (o > 0)    partial += 1;
      else               missing += 1;
    }
    return {
      uniqueParts: parts.length,
      completeParts: complete,
      partialParts: partial,
      missingParts: missing,
      piecesNeeded: needed,
      piecesOwned: owned,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts, localOwned]);

  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = parts.filter(p => {
      if (!q) return true;
      return (
        p.partNum.toLowerCase().includes(q) ||
        (p.partName ?? '').toLowerCase().includes(q) ||
        (p.colorName ?? '').toLowerCase().includes(q)
      );
    });
    const statusRank = (p: CompositionPart) => {
      const o = getOwned(p);
      if (o >= p.needed) return 2;
      if (o > 0) return 1;
      return 0;
    };
    const compare = (a: CompositionPart, b: CompositionPart) => {
      if (sortBy === 'partNum') return a.partNum.localeCompare(b.partNum, undefined, { numeric: true });
      if (sortBy === 'color') {
        const aC = (a.colorName ?? 'zzz').toLowerCase();
        const bC = (b.colorName ?? 'zzz').toLowerCase();
        if (aC !== bC) return aC.localeCompare(bC);
        return a.partNum.localeCompare(b.partNum, undefined, { numeric: true });
      }
      // status: missing → partial → complete
      const sa = statusRank(a), sb = statusRank(b);
      if (sa !== sb) return sa - sb;
      return a.partNum.localeCompare(b.partNum, undefined, { numeric: true });
    };
    return matches.slice().sort(compare);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts, search, sortBy, localOwned]);

  const copyMissingToClipboard = async () => {
    const lines = parts
      .map(p => ({ p, o: getOwned(p) }))
      .filter(({ p, o }) => o < p.needed)
      .map(({ p, o }) => {
        const need = p.needed - o;
        return [p.partNum, p.colorId ?? '', p.colorName ?? '', need, p.partName ?? ''].join('\t');
      });
    if (lines.length === 0) {
      toast({ title: 'Nothing missing', description: 'Every part is marked complete.' });
      return;
    }
    const header = ['part_no', 'color_id', 'color_name', 'qty_needed', 'part_name'].join('\t');
    await navigator.clipboard.writeText([header, ...lines].join('\n'));
    toast({ title: 'Copied to clipboard', description: `${lines.length} missing/partial part rows copied.` });
  };

  const blSearchUrl = (partNum: string, colorId: number | null) =>
    colorId
      ? `https://www.bricklink.com/v2/search.page?q=${encodeURIComponent(partNum)}&color=${colorId}`
      : `https://www.bricklink.com/v2/catalog/catalogitem.page?P=${encodeURIComponent(partNum)}`;

  const status = (p: CompositionPart) => {
    const o = getOwned(p);
    if (o >= p.needed) return 'complete' as const;
    if (o > 0) return 'partial' as const;
    return 'missing' as const;
  };

  const dotColor: Record<string, string> = {
    complete: 'bg-emerald-400',
    partial: 'bg-amber-400',
    missing: 'bg-rose-400',
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[88vh] flex flex-col p-0 gap-0 bg-gray-950 border-gray-800" aria-describedby="set-composition-desc">
        <DialogHeader className="p-4 pb-3 border-b border-gray-800 flex-shrink-0">
          <DialogTitle className="text-sm font-bold text-white flex items-center gap-2 flex-wrap">
            <Layers className="h-4 w-4 text-emerald-400" />
            <span>Set Completion</span>
            <span className="font-mono text-emerald-300">{data?.setNo ?? setNo}</span>
            {setName && <span className="text-xs font-normal text-gray-400 truncate">— {setName}</span>}
          </DialogTitle>
          <DialogDescription id="set-composition-desc" className="sr-only">
            Track which parts you have for this specific set.
          </DialogDescription>
        </DialogHeader>

        {/* Stats strip — owned/needed ratio, no progress bar fluff */}
        <div className="px-4 py-3 border-b border-gray-800 flex-shrink-0 bg-black/30">
          {isLoading ? (
            <div className="h-10 bg-gray-800/40 rounded animate-pulse" />
          ) : !data?.resolved ? (
            <div className="text-[11px] text-gray-400 italic flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
              No part data found for this set. Run a Rebrickable set-parts sync from Settings to populate it.
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3 text-[11px] flex-wrap">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-mono font-bold text-emerald-400 text-base" data-testid="text-owned-total">{liveTotals.piecesOwned}</span>
                  <span className="text-gray-500">/</span>
                  <span className="font-mono font-bold text-white text-base" data-testid="text-needed-total">{liveTotals.piecesNeeded}</span>
                  <span className="text-gray-400 text-[10px] uppercase tracking-wide">pieces</span>
                </div>
                <span className="text-gray-700">·</span>
                <span className="text-gray-400 font-mono text-[10px]">
                  <span className="text-emerald-400">{liveTotals.completeParts}</span>
                  <span className="text-gray-600"> · </span>
                  <span className="text-amber-400">{liveTotals.partialParts}</span>
                  <span className="text-gray-600"> · </span>
                  <span className="text-rose-400">{liveTotals.missingParts}</span>
                  <span className="text-gray-500"> of {liveTotals.uniqueParts} unique</span>
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={copyMissingToClipboard}
                disabled={isLoading || liveTotals.missingParts + liveTotals.partialParts === 0}
                data-testid="button-copy-missing"
                className="h-7 text-[10px] bg-white/5 border-white/10 text-white hover:bg-white/10"
              >
                <Copy className="h-3 w-3 mr-1" />
                Copy missing
              </Button>
            </div>
          )}
        </div>

        {/* Search + Sort */}
        {data?.resolved && parts.length > 0 && (
          <div className="px-4 pt-3 pb-2 flex-shrink-0 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500" />
              <Input
                placeholder="Search part #, name, color..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 text-xs h-8 bg-black/30 border-white/10 text-white placeholder:text-gray-600"
                data-testid="input-composition-search"
              />
            </div>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
              <SelectTrigger className="w-[150px] h-8 text-xs bg-black/30 border-white/10 text-white" data-testid="select-sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="status">Sort: Status</SelectItem>
                <SelectItem value="partNum">Sort: Part #</SelectItem>
                <SelectItem value="color">Sort: Color</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Rows */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden touch-pan-y px-4 pb-4 min-h-0">
          {isLoading || isFetching ? (
            <div className="space-y-1 mt-2">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-14 bg-gray-800/40 rounded animate-pulse" />
              ))}
            </div>
          ) : filteredSorted.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Layers className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-xs">{parts.length === 0 ? 'No parts to show.' : 'No matches.'}</p>
            </div>
          ) : (
            <div className="space-y-1 mt-1">
              {filteredSorted.map((p) => {
                const st = status(p);
                const owned = getOwned(p);
                const firstInvId = p.inventoryIds[0];
                const clickable = !!firstInvId && !!onItemClick;
                return (
                  <div
                    key={partKey(p)}
                    className="app-card-muted px-2.5 py-1.5 flex items-center gap-2"
                    data-testid={`composition-row-${p.partNum}-${p.colorId ?? 'nc'}`}
                  >
                    <span className={`w-1 self-stretch rounded-full ${dotColor[st]} flex-shrink-0`} />
                    {/* Thumbnail */}
                    <div
                      className={`flex-shrink-0 w-9 h-9 rounded bg-black/30 overflow-hidden flex items-center justify-center border border-white/5 ${clickable ? 'cursor-pointer hover-elevate' : ''}`}
                      onClick={clickable ? () => onItemClick!('inventory', firstInvId) : undefined}
                    >
                      {p.thumbnailUrl ? (
                        <img
                          src={p.thumbnailUrl}
                          alt={p.partName || p.partNum}
                          className="w-full h-full object-contain"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : (
                        <Package className="h-4 w-4 text-gray-600" />
                      )}
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className={`text-[11px] font-mono font-bold whitespace-nowrap ${clickable ? 'text-lego-blue cursor-pointer hover:underline' : 'text-lego-blue'}`}
                          onClick={clickable ? () => onItemClick!('inventory', firstInvId) : undefined}
                        >
                          {p.partNum}
                        </span>
                        {p.colorName && (
                          <div className="flex items-center gap-1 min-w-0">
                            <span
                              className="w-2.5 h-2.5 rounded-full border border-gray-700 flex-shrink-0"
                              style={{ backgroundColor: p.colorRgb ? `#${p.colorRgb}` : '#666' }}
                            />
                            <span className="text-[10px] text-gray-400 truncate">{p.colorName}</span>
                          </div>
                        )}
                      </div>
                      <p className="text-[10px] text-gray-400 truncate mt-0.5">
                        {p.partName || 'Unknown part'}
                      </p>
                      {(p.invLots > 0 || p.binNames) && (
                        <div className="flex items-center gap-2 text-[9px] text-gray-500 mt-0.5 flex-wrap">
                          {p.invLots > 0 && (
                            <span className="font-mono">
                              {p.invLots} lot{p.invLots === 1 ? '' : 's'} · {p.invQty} loose
                            </span>
                          )}
                          {p.binNames && (
                            <span className="flex items-center gap-0.5 truncate max-w-[180px]">
                              <MapPin className="h-2.5 w-2.5 flex-shrink-0" />
                              <span className="truncate">{p.binNames}</span>
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    {/* Owned editor */}
                    <div className="flex flex-col items-end flex-shrink-0">
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={() => setOwnedFor(p, owned - 1)}
                          disabled={owned <= 0}
                          data-testid={`button-dec-${p.partNum}-${p.colorId ?? 'nc'}`}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          value={owned}
                          onChange={(e) => setOwnedFor(p, parseInt(e.target.value || '0', 10))}
                          onFocus={(e) => e.target.select()}
                          className="w-12 h-7 text-[11px] text-center font-mono bg-black/30 border-white/10 text-white px-1"
                          data-testid={`input-owned-${p.partNum}-${p.colorId ?? 'nc'}`}
                        />
                        <span className="text-[11px] font-mono text-gray-500">/ {p.needed}</span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={() => setOwnedFor(p, owned + 1)}
                          data-testid={`button-inc-${p.partNum}-${p.colorId ?? 'nc'}`}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        {st === 'complete' ? (
                          <span className="text-[9px] text-emerald-400 flex items-center gap-0.5">
                            <CheckCircle2 className="h-2.5 w-2.5" /> complete
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setOwnedFor(p, p.needed)}
                            className="text-[9px] text-gray-500 hover:text-emerald-400 underline-offset-2 hover:underline"
                            data-testid={`button-fill-${p.partNum}-${p.colorId ?? 'nc'}`}
                          >
                            mark all
                          </button>
                        )}
                        <a
                          href={blSearchUrl(p.partNum, p.colorId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="text-gray-500 hover:text-lego-blue transition-colors"
                          title="Source on BrickLink"
                          data-testid={`link-source-${p.partNum}-${p.colorId ?? 'nc'}`}
                        >
                          <ShoppingCart className="h-2.5 w-2.5" />
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
