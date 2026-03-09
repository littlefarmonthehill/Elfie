import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Sparkles, Loader2, CheckCircle2, AlertCircle, Play, Square, Eye, Globe, Download, RefreshCw, Search } from 'lucide-react';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { useToast } from '@/hooks/use-toast';

export function EmbeddingsManager({ searchOnly = false }: { searchOnly?: boolean } = {}) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [inventoryBatchSize, setInventoryBatchSize] = useState(30);
  const [orderBatchSize, setOrderBatchSize] = useState(30);

  const { data: stats } = useQuery({
    queryKey: ['/api/embeddings/stats'],
    refetchInterval: 3000,
  });

  const { data: inventoryJob, refetch: refetchInventoryJob } = useQuery({
    queryKey: ['/api/embeddings/jobs/active/inventory'],
    refetchInterval: 2000,
  });

  const { data: ordersJob, refetch: refetchOrdersJob } = useQuery({
    queryKey: ['/api/embeddings/jobs/active/orders'],
    refetchInterval: 2000,
  });

  useEffect(() => {
    if ((inventoryJob as any)?.status === 'completed') {
      toast({ title: "Inventory Embedding Complete", description: `Embedded ${(inventoryJob as any).itemsProcessed} items` });
      queryClient.invalidateQueries({ queryKey: ['/api/embeddings/stats'] });
    }
  }, [(inventoryJob as any)?.status]);

  useEffect(() => {
    if ((ordersJob as any)?.status === 'completed') {
      toast({ title: "Order Embedding Complete", description: `Embedded ${(ordersJob as any).itemsProcessed} orders` });
      queryClient.invalidateQueries({ queryKey: ['/api/embeddings/stats'] });
    }
  }, [(ordersJob as any)?.status]);

  const { mutate: startInventoryJob, isPending: startingInventoryJob } = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/embeddings/jobs/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'inventory', batchSize: inventoryBatchSize }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Failed'); return d;
    },
    onSuccess: () => { toast({ title: "Job Started", description: `Embedding inventory in background` }); refetchInventoryJob(); queryClient.invalidateQueries({ queryKey: ['/api/embeddings/stats'] }); },
    onError: (e: any) => toast({ title: "Failed to Start", description: e.message, variant: "destructive" }),
  });

  const { mutate: startOrdersJob, isPending: startingOrdersJob } = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/embeddings/jobs/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'orders', batchSize: orderBatchSize }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Failed'); return d;
    },
    onSuccess: () => { toast({ title: "Job Started", description: `Embedding orders in background` }); refetchOrdersJob(); queryClient.invalidateQueries({ queryKey: ['/api/embeddings/stats'] }); },
    onError: (e: any) => toast({ title: "Failed to Start", description: e.message, variant: "destructive" }),
  });

  const { mutate: stopInventoryJob } = useMutation({
    mutationFn: async () => {
      if (!(inventoryJob as any)?.id) throw new Error('No active job');
      const r = await fetch(`/api/embeddings/jobs/${(inventoryJob as any).id}/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Failed'); return d;
    },
    onSuccess: () => { toast({ title: "Job Stopped" }); refetchInventoryJob(); },
  });

  const { mutate: stopOrdersJob } = useMutation({
    mutationFn: async () => {
      if (!(ordersJob as any)?.id) throw new Error('No active job');
      const r = await fetch(`/api/embeddings/jobs/${(ordersJob as any).id}/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Failed'); return d;
    },
    onSuccess: () => { toast({ title: "Job Stopped" }); refetchOrdersJob(); },
  });

  const { data: clipStats, refetch: refetchClipStats } = useQuery({
    queryKey: ['/api/brickspotter/catalog-status'],
    refetchInterval: 5000,
  });

  const clipBuildRunning = !!(clipStats as any)?.buildRunning;

  const { mutate: buildClipCatalog, isPending: startingClipBuild } = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/brickspotter/build-catalog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const d = await r.json(); if (!r.ok && r.status !== 409) throw new Error(d.error || 'Failed'); return { ...d, alreadyRunning: r.status === 409 };
    },
    onSuccess: (data: any) => {
      if (data.alreadyRunning) toast({ title: "Build Already Running" });
      else toast({ title: "Visual Catalog Build Started", description: "Embedding your inventory in background." });
      refetchClipStats();
    },
    onError: (e: any) => toast({ title: "Failed to Start Build", description: e.message, variant: "destructive" }),
  });

  const { mutate: testSearch, isPending: isSearching } = useMutation({
    mutationFn: async (query: string) => {
      const r = await fetch('/api/search/inventory/semantic', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, limit: 5 }) });
      return r.json();
    },
    onSuccess: (d: any) => setSearchResults(d.results || []),
  });

  const inventoryProgress = (inventoryJob as any)?.progress?.percentage || 0;
  const ordersProgress    = (ordersJob as any)?.progress?.percentage || 0;
  const isInventoryRunning = (inventoryJob as any)?.status === 'running';
  const isOrdersRunning    = (ordersJob as any)?.status === 'running';
  const inventoryComplete  = (stats as any)?.inventory?.percentage === 100;
  const ordersComplete     = (stats as any)?.orders?.percentage === 100;

  const clipDone  = (clipStats as any)?.buildDone  ?? 0;
  const clipTotal = (clipStats as any)?.buildTotal  ?? 0;
  const clipPct   = clipTotal > 0 ? Math.round((clipDone / clipTotal) * 100) : 0;

  return (
    <div className="space-y-4">
      {!searchOnly && (
        <>
          {/* ── Inventory — Text Search ─────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <Label className="text-xs font-medium text-gray-300">Inventory — Text Search</Label>
                <p className="text-[10px] text-gray-500 mt-0.5">
                  {(stats as any)?.inventory?.embedded || 0} / {(stats as any)?.inventory?.total || 0} items embedded
                  {inventoryComplete && <span className="text-green-400 ml-1.5 inline-flex items-center gap-0.5"><CheckCircle2 className="w-2.5 h-2.5" /> complete</span>}
                </p>
                <p className="text-[10px] text-gray-600 mt-0.5">~$0.002 / 1,000 items</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="flex flex-col items-end gap-0.5">
                  <Input
                    type="number"
                    value={inventoryBatchSize}
                    onChange={(e) => setInventoryBatchSize(parseInt(e.target.value) || 30)}
                    className="text-xs w-16 text-right"
                    min={10} max={100}
                    disabled={isInventoryRunning}
                    data-testid="input-inventory-batch-size"
                  />
                  <span className="text-[9px] text-gray-600">batch</span>
                </div>
                <Button
                  size="icon" variant="ghost"
                  disabled={startingInventoryJob || (inventoryComplete && !isInventoryRunning)}
                  onClick={() => isInventoryRunning ? stopInventoryJob() : startInventoryJob()}
                  title={isInventoryRunning ? 'Stop job' : inventoryComplete ? 'All done' : 'Start background job'}
                  data-testid={isInventoryRunning ? 'button-stop-inventory-job' : 'button-start-inventory-job'}
                >
                  {isInventoryRunning ? <Square className="h-4 w-4" /> : startingInventoryJob ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            {isInventoryRunning && (
              <div className="space-y-1 pl-0">
                <div className="flex justify-between text-[10px] text-gray-500">
                  <span className="flex items-center gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin text-violet-400" /> Processing {(inventoryJob as any)?.itemsProcessed || 0} items</span>
                  <span>{inventoryProgress}%</span>
                </div>
                <Progress value={inventoryProgress} className="h-1" />
              </div>
            )}
          </div>

          <Separator className="bg-gray-700/50" />

          {/* ── Orders — Text Search ────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <Label className="text-xs font-medium text-gray-300">Orders — Text Search</Label>
                <p className="text-[10px] text-gray-500 mt-0.5">
                  {(stats as any)?.orders?.embedded || 0} / {(stats as any)?.orders?.total || 0} orders embedded
                  {ordersComplete && <span className="text-green-400 ml-1.5 inline-flex items-center gap-0.5"><CheckCircle2 className="w-2.5 h-2.5" /> complete</span>}
                </p>
                <p className="text-[10px] text-gray-600 mt-0.5">~$0.002 / 1,000 orders</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="flex flex-col items-end gap-0.5">
                  <Input
                    type="number"
                    value={orderBatchSize}
                    onChange={(e) => setOrderBatchSize(parseInt(e.target.value) || 30)}
                    className="text-xs w-16 text-right"
                    min={10} max={100}
                    disabled={isOrdersRunning}
                    data-testid="input-order-batch-size"
                  />
                  <span className="text-[9px] text-gray-600">batch</span>
                </div>
                <Button
                  size="icon" variant="ghost"
                  disabled={startingOrdersJob || (ordersComplete && !isOrdersRunning)}
                  onClick={() => isOrdersRunning ? stopOrdersJob() : startOrdersJob()}
                  title={isOrdersRunning ? 'Stop job' : ordersComplete ? 'All done' : 'Start background job'}
                  data-testid={isOrdersRunning ? 'button-stop-orders-job' : 'button-start-orders-job'}
                >
                  {isOrdersRunning ? <Square className="h-4 w-4" /> : startingOrdersJob ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            {isOrdersRunning && (
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-gray-500">
                  <span className="flex items-center gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin text-violet-400" /> Processing {(ordersJob as any)?.itemsProcessed || 0} orders</span>
                  <span>{ordersProgress}%</span>
                </div>
                <Progress value={ordersProgress} className="h-1" />
              </div>
            )}
          </div>

          <Separator className="bg-gray-700/50" />

          {/* ── Inventory — Visual Recognition (CLIP) ──────────────── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <Eye className="w-3 h-3 text-blue-400" />
                  <Label className="text-xs font-medium text-gray-300">Inventory — Visual Recognition</Label>
                </div>
                <p className="text-[10px] text-gray-500 mt-0.5">
                  {(clipStats as any)?.catalog?.toLocaleString() ?? 0} parts embedded — your inventory only
                  {!clipBuildRunning && (clipStats as any)?.catalog > 0 && (
                    <span className="text-green-400 ml-1.5 inline-flex items-center gap-0.5"><CheckCircle2 className="w-2.5 h-2.5" /> active</span>
                  )}
                </p>
                <p className="text-[10px] text-gray-600 mt-0.5">Free — runs on the server</p>
              </div>
              <Button
                size="icon" variant="ghost"
                disabled={startingClipBuild || clipBuildRunning}
                onClick={() => buildClipCatalog()}
                title={clipBuildRunning ? 'Build running…' : (clipStats as any)?.catalog > 0 ? 'Continue / resume build' : 'Start visual catalog build'}
                data-testid="button-build-clip-catalog"
              >
                {(startingClipBuild || clipBuildRunning) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              </Button>
            </div>
            {clipBuildRunning && (
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-gray-500">
                  <span className="flex items-center gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin text-blue-400" /> Building in background</span>
                  <span>{clipDone.toLocaleString()} / {clipTotal.toLocaleString()}</span>
                </div>
                <Progress value={clipPct} className="h-1" />
                {(clipStats as any)?.buildCurrent && (
                  <p className="text-[10px] text-gray-600 truncate">Part: {(clipStats as any).buildCurrent}</p>
                )}
              </div>
            )}
          </div>

          <p className="text-[10px] text-gray-600 italic">
            Jobs run server-side — start one, close this screen, come back later to check progress.
          </p>
        </>
      )}

      {/* Semantic Search Test */}
      {searchOnly && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="Try: 'red bricks', 'transparent'..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchQuery && testSearch(searchQuery)}
              className="text-xs"
              data-testid="input-semantic-search"
            />
            <Button
              onClick={() => testSearch(searchQuery)}
              disabled={!searchQuery || isSearching}
              size="sm"
              variant="outline"
              data-testid="button-semantic-search"
            >
              {isSearching && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
              Search
            </Button>
          </div>
          {searchResults.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-400">Results:</p>
              {searchResults.map((result: any, idx: number) => (
                <div key={idx} className="flex items-start justify-between gap-2 py-1.5 border-b border-gray-700/40 last:border-0">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-200 truncate">{result.item_no || result.itemNo}</p>
                    <p className="text-[10px] text-gray-500 truncate">{result.item_name || result.itemName}</p>
                    {result.color_name && <Badge variant="secondary" className="text-[9px] mt-0.5">{result.color_name}</Badge>}
                  </div>
                  <span className="text-[10px] text-gray-500 shrink-0">{(result.similarity * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Universal CLIP Catalog ─────────────────────────────────────────────────────
export function UniversalCatalogSection() {
  const { toast } = useToast();

  const { data: status } = useQuery({
    queryKey: ['/api/brickspotter/universal-catalog/status'],
    refetchInterval: 4000,
  });

  const s = status as any;
  const queueSize          = s?.queueSize          ?? 0;
  const embedded           = s?.embedded           ?? 0;
  const noImage            = s?.noImage            ?? 0;
  const failed             = s?.failed             ?? 0;
  const pending            = s?.pending            ?? 0;
  const universalInDb      = s?.universalInDb      ?? 0;
  const workerRunning      = s?.workerRunning      ?? false;
  const importing          = s?.importing          ?? false;
  const workerCurrent      = s?.workerCurrent      ?? '';
  const lastImportedAt     = s?.lastImportedAt     ?? null;
  const lastScheduledRun   = s?.lastScheduledRun   ?? null;
  const nextScheduledRun   = s?.nextScheduledRun   ?? null;
  const lastScheduleStatus = s?.lastScheduleStatus ?? null;

  const retryable = noImage + failed;
  const processed = embedded + noImage + failed;
  const pct       = queueSize > 0 ? Math.round((processed / queueSize) * 100) : 0;

  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [refreshMonths, setRefreshMonths]     = useState(1);
  const [retryDays, setRetryDays]             = useState(30);
  const seeded = useRef(false);
  useEffect(() => {
    if (s && !seeded.current) {
      setScheduleEnabled(s.scheduleEnabled ?? false);
      setRefreshMonths(s.refreshMonths ?? 1);
      setRetryDays(s.retryDays ?? 30);
      seeded.current = true;
    }
  }, [s]);

  const lastImportLabel = lastImportedAt ? (() => {
    const mins = Math.round((Date.now() - lastImportedAt) / 60000);
    if (mins < 2)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  })() : null;

  const { mutate: saveSchedule, isPending: savingSchedule } = useMutation({
    mutationFn: (patch: Record<string, unknown>) => fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/brickspotter/universal-catalog/status'] }),
    onError: () => toast({ title: 'Failed to save scheduler settings', variant: 'destructive' }),
  });

  const { mutate: runImport, isPending: importPending } = useMutation({
    mutationFn: () => fetch('/api/brickspotter/universal-catalog/import', { method: 'POST' }).then(r => r.json()),
    onSuccess: (d: any) => {
      if (d?.error) toast({ title: 'Import Already Running', variant: 'destructive' });
      else toast({ title: 'Import Started', description: 'Downloading Rebrickable CSV.' });
      queryClient.invalidateQueries({ queryKey: ['/api/brickspotter/universal-catalog/status'] });
    },
    onError: () => toast({ title: 'Import Failed', variant: 'destructive' }),
  });

  const { mutate: startWorker, isPending: startPending } = useMutation({
    mutationFn: () => fetch('/api/brickspotter/universal-catalog/start', { method: 'POST' }).then(r => r.json()),
    onSuccess: (d: any) => {
      if (d?.error) toast({ title: 'Already Running', description: d.error });
      else toast({ title: 'Worker Started', description: 'Embedding parts in background.' });
      queryClient.invalidateQueries({ queryKey: ['/api/brickspotter/universal-catalog/status'] });
    },
    onError: () => toast({ title: 'Failed to Start Worker', variant: 'destructive' }),
  });

  const { mutate: stopWorker } = useMutation({
    mutationFn: () => fetch('/api/brickspotter/universal-catalog/stop', { method: 'POST' }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: 'Worker Stopping', description: 'Will finish current part then stop.' });
      queryClient.invalidateQueries({ queryKey: ['/api/brickspotter/universal-catalog/status'] });
    },
  });

  const { mutate: retryItems, isPending: retryPending } = useMutation({
    mutationFn: (olderThanDays: number) => fetch('/api/brickspotter/universal-catalog/retry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ olderThanDays }) }).then(r => r.json()),
    onSuccess: (d: any) => {
      toast({ title: 'Parts Queued for Retry', description: `${(d.reset ?? 0).toLocaleString()} parts reset to pending.` });
      queryClient.invalidateQueries({ queryKey: ['/api/brickspotter/universal-catalog/status'] });
    },
    onError: () => toast({ title: 'Retry Failed', variant: 'destructive' }),
  });

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 text-center">
        <div>
          <div className="text-base font-bold" data-testid="text-universal-queue">{queueSize.toLocaleString()}</div>
          <div className="text-[10px] text-gray-500">In Queue</div>
        </div>
        <div>
          <div className="text-base font-bold text-emerald-400" data-testid="text-universal-embedded">{universalInDb.toLocaleString()}</div>
          <div className="text-[10px] text-gray-500">Embedded</div>
        </div>
        <div>
          <div className="text-base font-bold text-gray-500" data-testid="text-universal-no-image">{noImage.toLocaleString()}</div>
          <div className="text-[10px] text-gray-500">No Image</div>
        </div>
        <div>
          <div className="text-base font-bold text-amber-400" data-testid="text-universal-pending">{pending.toLocaleString()}</div>
          <div className="text-[10px] text-gray-500">Pending</div>
        </div>
      </div>

      {queueSize > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-gray-500">
            <span>{pct}% processed</span>
            <span>{processed.toLocaleString()} / {queueSize.toLocaleString()}</span>
          </div>
          <Progress value={pct} className="h-1" />
        </div>
      )}

      {(importing || workerRunning) && (
        <p className="text-[10px] text-emerald-400 flex items-center gap-1">
          <Loader2 className="w-2.5 h-2.5 animate-spin" />
          {importing ? 'Downloading Rebrickable CSV…' : `Embedding in background${workerCurrent ? ` — ${workerCurrent}` : '…'}`}
        </p>
      )}
      {!workerRunning && !importing && universalInDb > 0 && pending === 0 && (
        <p className="text-[10px] text-emerald-400 flex items-center gap-1">
          <CheckCircle2 className="w-2.5 h-2.5" /> {universalInDb.toLocaleString()} parts embedded — full BrickLink visual search active
        </p>
      )}

      <p className="text-[10px] text-gray-600">Free — uses BrickLink CDN images. ~130k parts takes ~36 hours total.</p>

      {/* Step 1 */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <Label className="text-xs font-medium text-gray-300">Step 1 — Load parts list</Label>
          <p className="text-[10px] text-gray-500 mt-0.5">
            {lastImportLabel ? `Last import: ${lastImportLabel}` : 'Import Rebrickable part list'}
            {queueSize > 0 && ' · Re-import monthly to pick up new parts'}
          </p>
        </div>
        <Button
          size="icon" variant="ghost"
          disabled={importPending || importing}
          onClick={() => runImport()}
          title="Import from Rebrickable"
          data-testid="button-universal-import"
        >
          {(importPending || importing) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        </Button>
      </div>

      {/* Step 2 */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <Label className="text-xs font-medium text-gray-300">Step 2 — Embed parts</Label>
          <p className="text-[10px] text-gray-500 mt-0.5">
            {workerRunning ? 'Running in background — stop when needed' : pending === 0 && queueSize > 0 ? 'All parts processed' : 'Start or resume the embedding worker'}
          </p>
        </div>
        <Button
          size="icon" variant="ghost"
          disabled={(startPending || workerRunning) ? false : queueSize === 0 || pending === 0}
          onClick={() => workerRunning ? stopWorker() : startWorker()}
          title={workerRunning ? 'Stop worker' : 'Start / resume embedding'}
          data-testid={workerRunning ? 'button-universal-stop' : 'button-universal-start'}
        >
          {workerRunning ? <Square className="w-4 h-4" /> : startPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
        </Button>
      </div>

      <Separator className="bg-gray-700/50" />

      {/* Auto-Scheduler */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <Label className="text-xs font-medium text-gray-300">Auto-Scheduler</Label>
            <p className="text-[10px] text-gray-500 mt-0.5">Runs import + retry automatically on a recurring schedule</p>
          </div>
          <Switch
            checked={scheduleEnabled}
            onCheckedChange={(val) => { setScheduleEnabled(val); saveSchedule({ universalCatalogScheduleEnabled: val }); }}
            disabled={savingSchedule}
            data-testid="switch-universal-catalog-schedule"
          />
        </div>

        {scheduleEnabled && (
          <div className="ml-4 space-y-3">
            <div className="flex items-center gap-4">
              <div className="space-y-1">
                <Label className="text-[10px] text-gray-500">Every (months)</Label>
                <Input type="number" min={1} max={12} value={refreshMonths}
                  onChange={(e) => setRefreshMonths(Math.max(1, Math.min(12, parseInt(e.target.value) || 1)))}
                  onBlur={() => saveSchedule({ universalCatalogRefreshMonths: refreshMonths })}
                  className="text-xs w-20 text-right" data-testid="input-universal-refresh-months" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-gray-500">Retry if older than (days)</Label>
                <Input type="number" min={0} max={365} value={retryDays}
                  onChange={(e) => setRetryDays(Math.max(0, Math.min(365, parseInt(e.target.value) || 0)))}
                  onBlur={() => saveSchedule({ universalCatalogRetryDays: retryDays })}
                  className="text-xs w-20 text-right" data-testid="input-universal-retry-days" />
              </div>
            </div>
            <div className="text-[10px] text-gray-600 space-y-0.5">
              {lastScheduledRun ? (
                <p>Last auto-run: {new Date(lastScheduledRun).toLocaleDateString()} {new Date(lastScheduledRun).toLocaleTimeString()}
                  {lastScheduleStatus === 'error' && <span className="text-red-400 ml-1">(failed)</span>}
                  {lastScheduleStatus === 'success' && <span className="text-emerald-400 ml-1">(success)</span>}
                </p>
              ) : <p>No auto-run yet</p>}
              {nextScheduledRun && <p>Next run: {new Date(nextScheduledRun).toLocaleDateString()} {new Date(nextScheduledRun).toLocaleTimeString()}</p>}
            </div>
          </div>
        )}
      </div>

      {/* Retry stale */}
      {retryable > 0 && (
        <>
          <Separator className="bg-gray-700/50" />
          <div className="space-y-2">
            <div>
              <Label className="text-xs font-medium text-gray-300">Retry skipped parts</Label>
              <p className="text-[10px] text-gray-500 mt-0.5">{retryable.toLocaleString()} parts previously had no image — BrickLink may have added them since</p>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => retryItems(30)} disabled={retryPending || workerRunning} size="sm" variant="outline" className="flex-1 text-xs gap-1" data-testid="button-universal-retry-30d">
                {retryPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Retry &gt;30d old
              </Button>
              <Button onClick={() => retryItems(0)} disabled={retryPending || workerRunning} size="sm" variant="outline" className="flex-1 text-xs gap-1" data-testid="button-universal-retry-all">
                {retryPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Retry All
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
