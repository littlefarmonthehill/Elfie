import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Layers, Search, Package, ExternalLink, CheckCircle2, AlertTriangle, XCircle, Copy, Loader2, ShoppingCart } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CompositionPart {
  partNum: string;
  colorId: number | null;
  needed: number;
  owned: number;
  lots: number;
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

type Status = 'complete' | 'partial' | 'missing';
function getStatus(p: CompositionPart): Status {
  if (p.owned >= p.needed) return 'complete';
  if (p.owned > 0) return 'partial';
  return 'missing';
}

const STATUS_COLORS: Record<Status, { dot: string; text: string; bg: string; border: string; label: string }> = {
  complete: { dot: 'bg-emerald-400', text: 'text-emerald-300', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', label: 'Complete' },
  partial:  { dot: 'bg-amber-400',   text: 'text-amber-300',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   label: 'Partial'  },
  missing:  { dot: 'bg-rose-400',    text: 'text-rose-300',    bg: 'bg-rose-500/10',    border: 'border-rose-500/30',    label: 'Missing'  },
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  setNo: string;
  setName?: string | null;
  onItemClick?: (type: 'inventory', id: number | string) => void;
}

export default function SetCompositionDialog({ open, onOpenChange, setNo, setName, onItemClick }: Props) {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<Status, boolean>>({
    complete: false,
    partial: true,
    missing: true,
  });

  const { data, isLoading, isFetching } = useQuery<CompositionResponse>({
    queryKey: ['/api/inventory/sets', setNo, 'composition'],
    enabled: open && !!setNo,
    staleTime: 30_000,
    gcTime: 60_000,
    refetchOnMount: 'always',
  });

  const totals = data?.totals;
  const parts = data?.parts ?? [];

  const filteredParts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return parts.filter(p => {
      const status = getStatus(p);
      if (!filters[status]) return false;
      if (!q) return true;
      return (
        p.partNum.toLowerCase().includes(q) ||
        (p.partName ?? '').toLowerCase().includes(q) ||
        (p.colorName ?? '').toLowerCase().includes(q)
      );
    });
  }, [parts, search, filters]);

  const completionPct = totals && totals.piecesNeeded > 0
    ? Math.round((totals.piecesOwned / totals.piecesNeeded) * 100)
    : 0;

  const copyMissingToClipboard = async () => {
    const lines = parts
      .filter(p => p.owned < p.needed)
      .map(p => {
        const need = p.needed - p.owned;
        return [p.partNum, p.colorId ?? '', p.colorName ?? '', need, p.partName ?? ''].join('\t');
      });
    if (lines.length === 0) {
      toast({ title: 'Nothing missing', description: 'You have every part you need.' });
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[88vh] flex flex-col p-0 gap-0 bg-gray-950 border-gray-800" aria-describedby="set-composition-desc">
        <DialogHeader className="p-4 pb-3 border-b border-gray-800 flex-shrink-0">
          <DialogTitle className="text-sm font-bold text-white flex items-center gap-2">
            <Layers className="h-4 w-4 text-emerald-400" />
            <span>Set Completion</span>
            <span className="font-mono text-emerald-300">{data?.setNo ?? setNo}</span>
            {setName && <span className="text-xs font-normal text-gray-400 truncate">— {setName}</span>}
          </DialogTitle>
          <DialogDescription id="set-composition-desc" className="sr-only">
            Compare the official parts list for this set against your current inventory.
          </DialogDescription>
        </DialogHeader>

        {/* Stats strip */}
        <div className="px-4 py-3 border-b border-gray-800 flex-shrink-0 bg-black/30">
          {isLoading ? (
            <div className="h-12 bg-gray-800/40 rounded animate-pulse" />
          ) : !data?.resolved ? (
            <div className="text-[11px] text-gray-400 italic flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
              No part data found for this set. Run a Rebrickable set-parts sync from Settings to populate it.
            </div>
          ) : totals ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="font-bold text-white text-sm">{completionPct}%</span>
                  <span className="text-gray-400">complete</span>
                  <span className="text-gray-600">·</span>
                  <span className="text-gray-300">
                    <span className="font-mono font-bold text-emerald-400">{totals.piecesOwned}</span>
                    <span className="text-gray-500"> / </span>
                    <span className="font-mono font-bold text-white">{totals.piecesNeeded}</span>
                    <span className="text-gray-500"> pieces</span>
                  </span>
                  <span className="text-gray-600">·</span>
                  <span className="text-gray-400 font-mono">{totals.uniqueParts} unique</span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={copyMissingToClipboard}
                  disabled={isLoading || totals.missingParts + totals.partialParts === 0}
                  data-testid="button-copy-missing"
                  className="h-7 text-[10px] bg-white/5 border-white/10 text-white hover:bg-white/10"
                >
                  <Copy className="h-3 w-3 mr-1" />
                  Copy missing
                </Button>
              </div>
              <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${completionPct}%` }}
                />
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {(['complete', 'partial', 'missing'] as Status[]).map(s => {
                  const cfg = STATUS_COLORS[s];
                  const count = s === 'complete' ? totals.completeParts
                              : s === 'partial'  ? totals.partialParts
                              :                    totals.missingParts;
                  const active = filters[s];
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setFilters(f => ({ ...f, [s]: !f[s] }))}
                      data-testid={`filter-${s}`}
                      className={`text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded border transition-colors flex items-center gap-1.5 ${
                        active
                          ? `${cfg.bg} ${cfg.border} ${cfg.text}`
                          : 'bg-white/5 border-white/10 text-gray-500 hover:bg-white/10'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                      {cfg.label}
                      <span className="font-mono opacity-80">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        {/* Search */}
        {data?.resolved && parts.length > 5 && (
          <div className="px-4 pt-3 pb-2 flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500" />
              <Input
                placeholder="Search by part #, name, or color..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 text-xs h-8 bg-black/30 border-white/10 text-white placeholder:text-gray-600"
                data-testid="input-composition-search"
              />
            </div>
          </div>
        )}

        {/* Rows */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden touch-pan-y px-4 pb-4 min-h-0">
          {isLoading || isFetching ? (
            <div className="space-y-1 mt-2">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-12 bg-gray-800/40 rounded animate-pulse" />
              ))}
            </div>
          ) : filteredParts.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Layers className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-xs">
                {parts.length === 0 ? 'No parts to show.' : 'No parts match the current filters.'}
              </p>
            </div>
          ) : (
            <div className="space-y-1 mt-1">
              {filteredParts.map((p) => {
                const status = getStatus(p);
                const cfg = STATUS_COLORS[status];
                const firstInvId = p.inventoryIds[0];
                const clickable = !!firstInvId && !!onItemClick;
                const need = Math.max(0, p.needed - p.owned);
                return (
                  <div
                    key={`${p.partNum}-${p.colorId ?? 'nc'}`}
                    className={`app-card-muted px-2.5 py-1.5 flex items-center gap-2 ${clickable ? 'cursor-pointer hover-elevate' : ''}`}
                    onClick={clickable ? () => onItemClick!('inventory', firstInvId) : undefined}
                    data-testid={`composition-row-${p.partNum}-${p.colorId ?? 'nc'}`}
                  >
                    <span className={`w-1 self-stretch rounded-full ${cfg.dot} flex-shrink-0`} />
                    {/* Thumbnail */}
                    <div className="flex-shrink-0 w-9 h-9 rounded bg-black/30 overflow-hidden flex items-center justify-center border border-white/5">
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
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-mono font-bold text-lego-blue whitespace-nowrap">
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
                    </div>
                    {/* Qty */}
                    <div className="flex flex-col items-end flex-shrink-0 min-w-[64px]">
                      <span className={`text-[11px] font-mono font-bold ${cfg.text}`}>
                        {p.owned} / {p.needed}
                      </span>
                      <span className="text-[9px] text-gray-500">
                        {status === 'missing'
                          ? `need ${need}`
                          : status === 'partial'
                            ? `${need} short · ${p.lots} lot${p.lots === 1 ? '' : 's'}`
                            : `${p.lots} lot${p.lots === 1 ? '' : 's'}`}
                      </span>
                    </div>
                    {/* Action */}
                    {status === 'complete' ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                    ) : (
                      <a
                        href={blSearchUrl(p.partNum, p.colorId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="flex-shrink-0 text-gray-500 hover:text-lego-blue transition-colors p-1"
                        title="Source on BrickLink"
                        data-testid={`link-source-${p.partNum}-${p.colorId ?? 'nc'}`}
                      >
                        <ShoppingCart className="h-3.5 w-3.5" />
                      </a>
                    )}
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
