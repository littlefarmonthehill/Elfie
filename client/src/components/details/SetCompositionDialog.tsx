import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Layers, Search, Package, AlertTriangle, CheckCircle2, Copy, MapPin, ShoppingCart, Minus, Plus, ArrowUp, ArrowDown, ArrowUpDown, User } from "lucide-react";
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

type SortKey = 'status' | 'partNum' | 'color' | 'owned';
type SortDir = 'asc' | 'desc';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  setNo: string;
  setName?: string | null;
  inventoryId: number;
  onItemClick?: (type: 'inventory', id: number | string) => void;
}

const isMinifig = (partNum: string) => partNum.startsWith('fig-');

export default function SetCompositionDialog({ open, onOpenChange, setNo, setName, inventoryId, onItemClick }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('status');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Local edits keyed by partNum::colorId. We REMOVE the local override as soon
  // as the server confirms the same value, which lets multi-device updates flow
  // back into the row from the next refetch.
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
    staleTime: 0,
    gcTime: 60_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: open ? 8_000 : false, // poll while dialog is open for multi-device updates
  });

  // When the server confirms a value matching our local edit, drop the override
  // so the row reflects authoritative state again (lets other devices win).
  useEffect(() => {
    if (!data?.parts) return;
    setLocalOwned(prev => {
      let changed = false;
      const next = { ...prev };
      for (const p of data.parts) {
        const k = `${p.partNum}::${p.colorId ?? 0}`;
        if (next[k] != null && next[k] === p.setOwned) {
          delete next[k];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
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

  // Capture a stable snapshot of "owned at sort time" so the on-screen order
  // doesn't reshuffle while the user is typing. New sort triggers a re-snapshot.
  const sortSnapshotRef = useRef<{ key: string; dir: SortDir; ownedById: Record<string, number> } | null>(null);
  const sortSnapshot = useMemo(() => {
    const ownedById: Record<string, number> = {};
    for (const p of parts) ownedById[partKey(p)] = getOwned(p);
    sortSnapshotRef.current = { key: sortBy, dir: sortDir, ownedById };
    return sortSnapshotRef.current;
    // Re-snapshot whenever sort key/dir or the underlying parts change (initial load)
    // — but NOT when localOwned changes, so the order stays stable while editing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy, sortDir, parts]);

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
    const ownedAt = sortSnapshot.ownedById;
    const statusRank = (p: CompositionPart) => {
      const o = ownedAt[partKey(p)] ?? p.setOwned;
      if (o >= p.needed) return 2;
      if (o > 0) return 1;
      return 0;
    };
    const compare = (a: CompositionPart, b: CompositionPart) => {
      let cmp = 0;
      if (sortBy === 'partNum') {
        cmp = a.partNum.localeCompare(b.partNum, undefined, { numeric: true });
      } else if (sortBy === 'color') {
        const aC = (a.colorName ?? 'zzz').toLowerCase();
        const bC = (b.colorName ?? 'zzz').toLowerCase();
        cmp = aC.localeCompare(bC) || a.partNum.localeCompare(b.partNum, undefined, { numeric: true });
      } else if (sortBy === 'owned') {
        const aO = ownedAt[partKey(a)] ?? a.setOwned;
        const bO = ownedAt[partKey(b)] ?? b.setOwned;
        const aP = a.needed > 0 ? aO / a.needed : 0;
        const bP = b.needed > 0 ? bO / b.needed : 0;
        cmp = aP - bP || a.partNum.localeCompare(b.partNum, undefined, { numeric: true });
      } else {
        // status: missing → partial → complete (asc)
        cmp = statusRank(a) - statusRank(b) || a.partNum.localeCompare(b.partNum, undefined, { numeric: true });
      }
      return sortDir === 'asc' ? cmp : -cmp;
    };
    return matches.slice().sort(compare);
  }, [parts, search, sortBy, sortDir, sortSnapshot]);

  const toggleSort = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortBy !== k) return <ArrowUpDown className="h-2.5 w-2.5 opacity-40" />;
    return sortDir === 'asc'
      ? <ArrowUp className="h-2.5 w-2.5" />
      : <ArrowDown className="h-2.5 w-2.5" />;
  };

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

  const blSearchUrl = (partNum: string, colorId: number | null) => {
    if (isMinifig(partNum)) return `https://www.bricklink.com/v2/catalog/catalogitem.page?M=${encodeURIComponent(partNum.replace(/^fig-/, ''))}`;
    return colorId
      ? `https://www.bricklink.com/v2/search.page?q=${encodeURIComponent(partNum)}&color=${colorId}`
      : `https://www.bricklink.com/v2/catalog/catalogitem.page?P=${encodeURIComponent(partNum)}`;
  };

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

        {/* Stats strip */}
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
                {isFetching && !isLoading && (
                  <span className="text-[9px] text-gray-500 italic">syncing…</span>
                )}
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

        {/* Search + sortable column header bar */}
        {data?.resolved && parts.length > 0 && (
          <>
            <div className="px-4 pt-3 pb-2 flex-shrink-0">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500" />
                <Input
                  placeholder="Search part #, name, color..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-8 text-xs h-8 bg-black/30 border-white/10 text-white placeholder:text-gray-600"
                  data-testid="input-composition-search"
                />
              </div>
            </div>
            <div className="px-4 pb-1 flex-shrink-0 flex items-center gap-2 text-[10px] uppercase tracking-wide text-gray-500 font-bold border-b border-gray-800/50">
              <span className="w-1" />
              <span className="w-9 flex-shrink-0" />
              <button
                type="button"
                onClick={() => toggleSort('partNum')}
                className="flex items-center gap-1 hover:text-white transition-colors py-2"
                data-testid="header-sort-partNum"
              >
                Part #
                <SortIcon k="partNum" />
              </button>
              <button
                type="button"
                onClick={() => toggleSort('color')}
                className="flex items-center gap-1 hover:text-white transition-colors py-2"
                data-testid="header-sort-color"
              >
                Color
                <SortIcon k="color" />
              </button>
              <button
                type="button"
                onClick={() => toggleSort('status')}
                className="flex items-center gap-1 hover:text-white transition-colors py-2 ml-auto"
                data-testid="header-sort-status"
              >
                Status
                <SortIcon k="status" />
              </button>
              <button
                type="button"
                onClick={() => toggleSort('owned')}
                className="flex items-center gap-1 hover:text-white transition-colors py-2"
                data-testid="header-sort-owned"
              >
                Owned
                <SortIcon k="owned" />
              </button>
            </div>
          </>
        )}

        {/* Rows */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden touch-pan-y px-4 pb-4 min-h-0">
          {isLoading ? (
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
                const fig = isMinifig(p.partNum);
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
                      ) : fig ? (
                        <User className="h-4 w-4 text-gray-500" />
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
                        {fig && (
                          <span className="text-[9px] uppercase tracking-wider text-amber-300/80 bg-amber-500/10 border border-amber-500/30 rounded px-1">
                            minifig
                          </span>
                        )}
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
                        {p.partName || (fig ? 'Minifig' : 'Unknown part')}
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
