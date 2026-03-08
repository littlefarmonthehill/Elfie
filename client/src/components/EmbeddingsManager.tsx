import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Sparkles, Database, Search, Loader2, CheckCircle2, AlertCircle, Play, Square, Eye, Globe, Download, RefreshCw } from 'lucide-react';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';

export function EmbeddingsManager() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [inventoryBatchSize, setInventoryBatchSize] = useState(30);
  const [orderBatchSize, setOrderBatchSize] = useState(30);
  // Get embedding statistics
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['/api/embeddings/stats'],
    refetchInterval: 3000, // Refresh every 3 seconds
  });

  // Get active inventory job
  const { data: inventoryJob, refetch: refetchInventoryJob } = useQuery({
    queryKey: ['/api/embeddings/jobs/active/inventory'],
    refetchInterval: 2000, // Poll every 2 seconds
  });

  // Get active orders job
  const { data: ordersJob, refetch: refetchOrdersJob } = useQuery({
    queryKey: ['/api/embeddings/jobs/active/orders'],
    refetchInterval: 2000, // Poll every 2 seconds
  });

  // Show completion toast when job finishes and refresh stats
  useEffect(() => {
    if ((inventoryJob as any)?.status === 'completed') {
      toast({
        title: "✅ Inventory Embedding Complete!",
        description: `Successfully embedded ${(inventoryJob as any).itemsProcessed} items`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/embeddings/stats'] });
    }
  }, [(inventoryJob as any)?.status]);

  useEffect(() => {
    if ((ordersJob as any)?.status === 'completed') {
      toast({
        title: "✅ Order Embedding Complete!",
        description: `Successfully embedded ${(ordersJob as any).itemsProcessed} orders`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/embeddings/stats'] });
    }
  }, [(ordersJob as any)?.status]);

  // Start inventory job
  const { mutate: startInventoryJob, isPending: startingInventoryJob } = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/embeddings/jobs/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'inventory', batchSize: inventoryBatchSize }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to start job');
      return data;
    },
    onSuccess: () => {
      toast({
        title: "🚀 Background Job Started",
        description: `Embedding inventory items in batches of ${inventoryBatchSize}. You can close this screen!`,
      });
      refetchInventoryJob();
      queryClient.invalidateQueries({ queryKey: ['/api/embeddings/stats'] });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Start Job",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Start orders job
  const { mutate: startOrdersJob, isPending: startingOrdersJob } = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/embeddings/jobs/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'orders', batchSize: orderBatchSize }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to start job');
      return data;
    },
    onSuccess: () => {
      toast({
        title: "🚀 Background Job Started",
        description: `Embedding orders in batches of ${orderBatchSize}. You can close this screen!`,
      });
      refetchOrdersJob();
      queryClient.invalidateQueries({ queryKey: ['/api/embeddings/stats'] });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Start Job",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Stop inventory job
  const { mutate: stopInventoryJob } = useMutation({
    mutationFn: async () => {
      if (!(inventoryJob as any)?.id) throw new Error('No active job');
      const response = await fetch(`/api/embeddings/jobs/${(inventoryJob as any).id}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to stop job');
      return data;
    },
    onSuccess: () => {
      toast({
        title: "Job Stopped",
        description: "Inventory embedding job has been paused",
      });
      refetchInventoryJob();
    },
  });

  // Stop orders job
  const { mutate: stopOrdersJob } = useMutation({
    mutationFn: async () => {
      if (!(ordersJob as any)?.id) throw new Error('No active job');
      const response = await fetch(`/api/embeddings/jobs/${(ordersJob as any).id}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to stop job');
      return data;
    },
    onSuccess: () => {
      toast({
        title: "Job Stopped",
        description: "Order embedding job has been paused",
      });
      refetchOrdersJob();
    },
  });

  // CLIP catalog stats — always poll so UI reflects real server state even after closing/reopening
  const { data: clipStats, refetch: refetchClipStats } = useQuery({
    queryKey: ['/api/brickspotter/catalog-status'],
    refetchInterval: 5000,
  });

  const clipBuildRunning = !!(clipStats as any)?.buildRunning;

  // Start CLIP catalog build
  const { mutate: buildClipCatalog, isPending: startingClipBuild } = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/brickspotter/build-catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (!response.ok && response.status !== 409) throw new Error(data.error || 'Failed to start build');
      return { ...data, alreadyRunning: response.status === 409 };
    },
    onSuccess: (data: any) => {
      if (data.alreadyRunning) {
        toast({ title: "Build Already Running", description: `${data.buildDone?.toLocaleString() ?? 0} of ${data.buildTotal?.toLocaleString() ?? 0} done so far.` });
      } else {
        toast({
          title: "Visual Catalog Build Started",
          description: `Embedding ${data.queued?.toLocaleString()} inventory items in the background. You can close this screen!`,
        });
      }
      refetchClipStats();
    },
    onError: (error: any) => {
      toast({ title: "Failed to Start Build", description: error.message, variant: "destructive" });
    },
  });

  // Semantic search test
  const { mutate: testSearch, isPending: isSearching } = useMutation({
    mutationFn: async (query: string) => {
      const response = await fetch('/api/search/inventory/semantic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit: 5 }),
      });
      return response.json();
    },
    onSuccess: (data: any) => {
      setSearchResults(data.results || []);
    },
  });

  const inventoryProgress = (inventoryJob as any)?.progress?.percentage || 0;
  const ordersProgress = (ordersJob as any)?.progress?.percentage || 0;
  const isInventoryRunning = (inventoryJob as any)?.status === 'running';
  const isOrdersRunning = (ordersJob as any)?.status === 'running';
  
  // Check if all items are embedded (from stats, not job progress)
  const inventoryComplete = (stats as any)?.inventory?.percentage === 100;
  const ordersComplete = (stats as any)?.orders?.percentage === 100;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-violet-400" />
        <h3 className="text-base font-semibold">AI Intelligence & Embeddings</h3>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card className="bg-card/50">
          <CardHeader className="pb-2 p-3">
            <CardTitle className="text-xs text-muted-foreground">Inventory Embeddings</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold" data-testid="text-inventory-embedded">
                {(stats as any)?.inventory?.embedded || 0}
              </span>
              <span className="text-sm text-muted-foreground">
                / {(stats as any)?.inventory?.total || 0}
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {(stats as any)?.inventory?.percentage || 0}% complete
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50">
          <CardHeader className="pb-2 p-3">
            <CardTitle className="text-xs text-muted-foreground">Order Embeddings</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold" data-testid="text-orders-embedded">
                {(stats as any)?.orders?.embedded || 0}
              </span>
              <span className="text-sm text-muted-foreground">
                / {(stats as any)?.orders?.total || 0}
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {(stats as any)?.orders?.percentage || 0}% complete
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Inventory Background Job */}
      <Card>
        <CardHeader className="pb-2 p-3">
          <CardTitle className="text-sm">🚀 Inventory Background Job</CardTitle>
          <CardDescription className="text-xs">
            Runs on server - close your phone and it keeps going!
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-3 pt-0">
          {isInventoryRunning && (
            <Alert className="p-2 bg-violet-500/10 border-violet-500/20">
              <Loader2 className="h-3 w-3 animate-spin text-violet-400" />
              <AlertDescription className="text-xs ml-2">
                Processing: {(inventoryJob as any)?.itemsProcessed || 0} items • {(inventoryJob as any)?.errors || 0} errors
              </AlertDescription>
            </Alert>
          )}

          <Alert className="p-2">
            <AlertCircle className="h-3 w-3" />
            <AlertDescription className="text-xs ml-2">
              ~$0.002 per 1,000 items. Total: ~${(((stats as any)?.inventory?.total || 0) * 0.000002).toFixed(2)}
            </AlertDescription>
          </Alert>

          {isInventoryRunning && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span>Progress</span>
                <span>{inventoryProgress}%</span>
              </div>
              <Progress value={inventoryProgress} className="h-2" />
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <div className="flex-1">
              <label className="text-xs text-gray-400 mb-1 block">Batch Size</label>
              <Input
                type="number"
                value={inventoryBatchSize}
                onChange={(e) => setInventoryBatchSize(parseInt(e.target.value) || 30)}
                className="w-full sm:w-32 text-xs h-8"
                min={10}
                max={100}
                disabled={isInventoryRunning}
                data-testid="input-inventory-batch-size"
              />
            </div>
            
            {!isInventoryRunning ? (
              <Button
                onClick={() => startInventoryJob()}
                disabled={startingInventoryJob || inventoryComplete}
                size="sm"
                className="text-xs h-8 gap-1"
                data-testid="button-start-inventory-job"
              >
                <Play className="w-3 h-3" />
                {inventoryComplete ? 'All Done' : 'Start Background Job'}
              </Button>
            ) : (
              <Button
                onClick={() => stopInventoryJob()}
                size="sm"
                variant="outline"
                className="text-xs h-8 gap-1"
                data-testid="button-stop-inventory-job"
              >
                <Square className="w-3 h-3" />
                Stop
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Orders Background Job */}
      <Card>
        <CardHeader className="pb-2 p-3">
          <CardTitle className="text-sm">🚀 Orders Background Job</CardTitle>
          <CardDescription className="text-xs">
            Runs on server - close your phone and it keeps going!
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-3 pt-0">
          {isOrdersRunning && (
            <Alert className="p-2 bg-violet-500/10 border-violet-500/20">
              <Loader2 className="h-3 w-3 animate-spin text-violet-400" />
              <AlertDescription className="text-xs ml-2">
                Processing: {(ordersJob as any)?.itemsProcessed || 0} orders • {(ordersJob as any)?.errors || 0} errors
              </AlertDescription>
            </Alert>
          )}

          <Alert className="p-2">
            <AlertCircle className="h-3 w-3" />
            <AlertDescription className="text-xs ml-2">
              ~$0.002 per 1,000 orders. Total: ~${(((stats as any)?.orders?.total || 0) * 0.000002).toFixed(2)}
            </AlertDescription>
          </Alert>

          {isOrdersRunning && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span>Progress</span>
                <span>{ordersProgress}%</span>
              </div>
              <Progress value={ordersProgress} className="h-2" />
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <div className="flex-1">
              <label className="text-xs text-gray-400 mb-1 block">Batch Size</label>
              <Input
                type="number"
                value={orderBatchSize}
                onChange={(e) => setOrderBatchSize(parseInt(e.target.value) || 30)}
                className="w-full sm:w-32 text-xs h-8"
                min={10}
                max={100}
                disabled={isOrdersRunning}
                data-testid="input-order-batch-size"
              />
            </div>
            
            {!isOrdersRunning ? (
              <Button
                onClick={() => startOrdersJob()}
                disabled={startingOrdersJob || ordersComplete}
                size="sm"
                className="text-xs h-8 gap-1"
                data-testid="button-start-orders-job"
              >
                <Play className="w-3 h-3" />
                {ordersComplete ? 'All Done' : 'Start Background Job'}
              </Button>
            ) : (
              <Button
                onClick={() => stopOrdersJob()}
                size="sm"
                variant="outline"
                className="text-xs h-8 gap-1"
                data-testid="button-stop-orders-job"
              >
                <Square className="w-3 h-3" />
                Stop
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* CLIP Visual Catalog */}
      <Card>
        <CardHeader className="pb-2 p-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Eye className="w-4 h-4 text-blue-400" />
            Visual Catalog (Brick Spotter)
          </CardTitle>
          <CardDescription className="text-xs">
            One-time build: embeds your inventory using CLIP vision AI so Brick Spotter can visually recognize parts
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-3 pt-0">
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center">
              <div className="text-xl font-bold" data-testid="text-clip-catalog-count">{(clipStats as any)?.catalog?.toLocaleString() ?? 0}</div>
              <div className="text-xs text-muted-foreground">Catalog</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-green-400" data-testid="text-clip-scan-count">{(clipStats as any)?.scan?.toLocaleString() ?? 0}</div>
              <div className="text-xs text-muted-foreground">Confirmed</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold" data-testid="text-clip-total-count">{(clipStats as any)?.total?.toLocaleString() ?? 0}</div>
              <div className="text-xs text-muted-foreground">Total</div>
            </div>
          </div>

          {clipBuildRunning && (() => {
            const done = (clipStats as any)?.buildDone ?? 0;
            const total = (clipStats as any)?.buildTotal ?? 0;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            return (
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-blue-400 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Building in background…
                  </span>
                  <span className="text-xs text-muted-foreground">{done.toLocaleString()} / {total.toLocaleString()}</span>
                </div>
                <Progress value={pct} className="h-1.5" />
                <div className="text-[10px] text-muted-foreground truncate">
                  {(clipStats as any)?.buildCurrent ? `Part: ${(clipStats as any).buildCurrent}` : 'Starting…'}
                </div>
              </div>
            );
          })()}

          {!clipBuildRunning && (clipStats as any)?.catalog > 0 && (
            <div className="flex items-center gap-1 text-xs text-green-400">
              <CheckCircle2 className="w-3 h-3" />
              <span>{(clipStats as any).catalog.toLocaleString()} parts embedded — Brick Spotter visual search active</span>
            </div>
          )}

          {!clipBuildRunning && (
            <Alert className="p-2">
              <AlertCircle className="h-3 w-3" />
              <AlertDescription className="text-xs ml-2">
                Free — runs on the server, takes several hours for a full catalog. Your phone can sleep.
              </AlertDescription>
            </Alert>
          )}

          <Button
            onClick={() => buildClipCatalog()}
            disabled={startingClipBuild || clipBuildRunning}
            size="sm"
            className="w-full text-xs gap-1"
            data-testid="button-build-clip-catalog"
          >
            {startingClipBuild ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : clipBuildRunning ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3" />
            )}
            {clipBuildRunning ? 'Build Running…' : (clipStats as any)?.catalog > 0 ? 'Continue / Resume Build' : 'Start Visual Catalog Build'}
          </Button>
        </CardContent>
      </Card>

      {/* Universal CLIP Catalog */}
      <UniversalCatalogCard />

      {/* Semantic Search Test */}
      <Card>
        <CardHeader className="pb-2 p-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Search className="w-4 h-4" />
            Test Semantic Search
          </CardTitle>
          <CardDescription className="text-xs">
            Find items by meaning, not just keywords
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-3 pt-0">
          <div className="flex gap-2">
            <Input
              placeholder="Try: 'red bricks', 'transparent'..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchQuery && testSearch(searchQuery)}
              className="text-xs h-8"
              data-testid="input-semantic-search"
            />
            <Button
              onClick={() => testSearch(searchQuery)}
              disabled={!searchQuery || isSearching}
              size="sm"
              className="text-xs h-8"
              data-testid="button-semantic-search"
            >
              {isSearching && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
              Search
            </Button>
          </div>

          {searchResults.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-medium">Results:</div>
              {searchResults.map((result: any, idx: number) => (
                <Card key={idx} className="p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">
                        {result.item_no || result.itemNo}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {result.item_name || result.itemName}
                      </div>
                      {result.color_name && (
                        <Badge variant="secondary" className="text-xs mt-1">
                          {result.color_name}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground shrink-0">
                      {(result.similarity * 100).toFixed(0)}% match
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info Card */}
      <Alert>
        <Database className="h-4 w-4" />
        <AlertDescription className="text-xs">
          <strong>Background jobs run on the server.</strong> Start a job and close this screen - even lock your phone! 
          The job continues running. Come back anytime to check progress.
        </AlertDescription>
      </Alert>
    </div>
  );
}

// ── Universal CLIP Catalog Card ───────────────────────────────────────────────
function UniversalCatalogCard() {
  const { toast } = useToast();

  const { data: status } = useQuery({
    queryKey: ['/api/brickspotter/universal-catalog/status'],
    refetchInterval: 4000,
  });

  const s = status as any;
  const queueSize         = s?.queueSize         ?? 0;
  const embedded          = s?.embedded          ?? 0;
  const noImage           = s?.noImage           ?? 0;
  const failed            = s?.failed            ?? 0;
  const pending           = s?.pending           ?? 0;
  const universalInDb     = s?.universalInDb     ?? 0;
  const workerRunning     = s?.workerRunning     ?? false;
  const importing         = s?.importing         ?? false;
  const workerCurrent     = s?.workerCurrent     ?? '';
  const lastImportedAt    = s?.lastImportedAt    ?? null;
  const lastScheduledRun  = s?.lastScheduledRun  ?? null;
  const nextScheduledRun  = s?.nextScheduledRun  ?? null;
  const lastScheduleStatus = s?.lastScheduleStatus ?? null;

  const retryable = noImage + failed;

  // Scheduler settings — local state, synced from status
  const [scheduleEnabled, setScheduleEnabled] = useState<boolean>(false);
  const [refreshMonths, setRefreshMonths]     = useState<number>(1);
  const [retryDays, setRetryDays]             = useState<number>(30);
  const seeded = useRef(false);
  useEffect(() => {
    if (s && !seeded.current) {
      setScheduleEnabled(s.scheduleEnabled ?? false);
      setRefreshMonths(s.refreshMonths  ?? 1);
      setRetryDays(s.retryDays          ?? 30);
      seeded.current = true;
    }
  }, [s]);

  const { mutate: saveSchedule, isPending: savingSchedule } = useMutation({
    mutationFn: (patch: Record<string, unknown>) => fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/brickspotter/universal-catalog/status'] });
    },
    onError: () => toast({ title: 'Failed to save scheduler settings', variant: 'destructive' }),
  });

  // Progress based on embedded + noImage (processed) vs queue total
  const processed = embedded + noImage + failed;
  const pct = queueSize > 0 ? Math.round((processed / queueSize) * 100) : 0;

  // Relative time since last import
  const lastImportLabel = lastImportedAt
    ? (() => {
        const mins = Math.round((Date.now() - lastImportedAt) / 60000);
        if (mins < 2)  return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.round(mins / 60);
        if (hrs < 24)  return `${hrs}h ago`;
        return `${Math.round(hrs / 24)}d ago`;
      })()
    : null;

  const { mutate: runImport, isPending: importPending } = useMutation({
    mutationFn: () => fetch('/api/brickspotter/universal-catalog/import', { method: 'POST' }).then(r => r.json()),
    onSuccess: (data: any) => {
      if (data?.error) {
        toast({ title: 'Import Already Running', description: 'The CSV import is already in progress.', variant: 'destructive' });
      } else {
        toast({ title: 'Import Started', description: 'Downloading Rebrickable CSV. New parts will be added to the queue automatically.' });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/brickspotter/universal-catalog/status'] });
    },
    onError: () => toast({ title: 'Import Failed', variant: 'destructive' }),
  });

  const { mutate: startWorker, isPending: startPending } = useMutation({
    mutationFn: () => fetch('/api/brickspotter/universal-catalog/start', { method: 'POST' }).then(r => r.json()),
    onSuccess: (data: any) => {
      if (data?.error) {
        toast({ title: 'Already Running', description: data.error });
      } else {
        toast({ title: 'Worker Started', description: 'Embedding parts in the background. You can close this screen!' });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/brickspotter/universal-catalog/status'] });
    },
    onError: () => toast({ title: 'Failed to Start Worker', variant: 'destructive' }),
  });

  const { mutate: stopWorker } = useMutation({
    mutationFn: () => fetch('/api/brickspotter/universal-catalog/stop', { method: 'POST' }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: 'Worker Stopping', description: 'Will finish the current part then stop.' });
      queryClient.invalidateQueries({ queryKey: ['/api/brickspotter/universal-catalog/status'] });
    },
  });

  const { mutate: retryItems, isPending: retryPending } = useMutation({
    mutationFn: (olderThanDays: number) => fetch('/api/brickspotter/universal-catalog/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ olderThanDays }),
    }).then(r => r.json()),
    onSuccess: (data: any) => {
      toast({
        title: 'Parts Queued for Retry',
        description: `${(data.reset ?? 0).toLocaleString()} parts reset to pending — start the worker to re-embed them.`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/brickspotter/universal-catalog/status'] });
    },
    onError: () => toast({ title: 'Retry Failed', variant: 'destructive' }),
  });

  return (
    <Card>
      <CardHeader className="pb-2 p-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Globe className="w-4 h-4 text-emerald-400" />
          Universal Part Catalog
        </CardTitle>
        <CardDescription className="text-xs">
          Embeds all ~130k BrickLink parts so BrickSpotter recognizes anything — not just your inventory
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 p-3 pt-0">

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-2 text-center">
          <div>
            <div className="text-lg font-bold" data-testid="text-universal-queue">{queueSize.toLocaleString()}</div>
            <div className="text-[10px] text-muted-foreground">In Queue</div>
          </div>
          <div>
            <div className="text-lg font-bold text-emerald-400" data-testid="text-universal-embedded">{universalInDb.toLocaleString()}</div>
            <div className="text-[10px] text-muted-foreground">Embedded</div>
          </div>
          <div>
            <div className="text-lg font-bold text-muted-foreground" data-testid="text-universal-no-image">{noImage.toLocaleString()}</div>
            <div className="text-[10px] text-muted-foreground">No Image</div>
          </div>
          <div>
            <div className="text-lg font-bold text-amber-400" data-testid="text-universal-pending">{pending.toLocaleString()}</div>
            <div className="text-[10px] text-muted-foreground">Pending</div>
          </div>
        </div>

        {/* Progress bar — shows once there's queue data */}
        {queueSize > 0 && (
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-xs text-muted-foreground">{pct}% processed</span>
              <span className="text-xs text-muted-foreground">{processed.toLocaleString()} / {queueSize.toLocaleString()}</span>
            </div>
            <Progress value={pct} className="h-1.5" />
          </div>
        )}

        {/* Live worker status */}
        {(importing || workerRunning) && (
          <Alert className="p-2 bg-emerald-500/10 border-emerald-500/20">
            <Loader2 className="h-3 w-3 animate-spin text-emerald-400" />
            <AlertDescription className="text-xs ml-2">
              {importing
                ? 'Downloading Rebrickable CSV and populating queue…'
                : `Embedding in background${workerCurrent ? ` — ${workerCurrent}` : '…'}`}
            </AlertDescription>
          </Alert>
        )}

        {/* Completion badge */}
        {!workerRunning && !importing && universalInDb > 0 && pending === 0 && (
          <div className="flex items-center gap-1 text-xs text-emerald-400">
            <CheckCircle2 className="w-3 h-3" />
            <span>{universalInDb.toLocaleString()} parts embedded — Universal recognition active</span>
          </div>
        )}

        <Alert className="p-2">
          <AlertCircle className="h-3 w-3" />
          <AlertDescription className="text-xs ml-2">
            Free — uses BrickLink CDN images. At 1 part/sec, ~130k parts takes ~36 hours total.
          </AlertDescription>
        </Alert>

        {/* Step 1: Import CSV — always available for monthly refresh to pick up new parts */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-muted-foreground">Step 1 — Load parts list</div>
            {lastImportLabel && (
              <span className="text-[10px] text-muted-foreground">Last: {lastImportLabel}</span>
            )}
          </div>
          <Button
            onClick={() => runImport()}
            disabled={importPending || importing}
            size="sm"
            variant="outline"
            className="w-full text-xs gap-1"
            data-testid="button-universal-import"
          >
            {(importPending || importing) ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Download className="w-3 h-3" />
            )}
            {importing
              ? 'Importing CSV…'
              : queueSize > 0
                ? 'Re-import (pick up new parts)'
                : 'Import from Rebrickable'}
          </Button>
          {queueSize > 0 && (
            <p className="text-[10px] text-muted-foreground">
              Re-import monthly — idempotent, never overwrites existing rows.
            </p>
          )}
        </div>

        {/* Step 2: Embed */}
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">Step 2 — Embed parts</div>
          {!workerRunning ? (
            <Button
              onClick={() => startWorker()}
              disabled={startPending || workerRunning || queueSize === 0 || pending === 0}
              size="sm"
              className="w-full text-xs gap-1"
              data-testid="button-universal-start"
            >
              {startPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {pending === 0 && queueSize > 0 ? 'All Done' : 'Start / Resume Embedding'}
            </Button>
          ) : (
            <Button
              onClick={() => stopWorker()}
              size="sm"
              variant="outline"
              className="w-full text-xs gap-1"
              data-testid="button-universal-stop"
            >
              <Square className="w-3 h-3" />
              Stop Worker
            </Button>
          )}
        </div>

        {/* ── Auto-Scheduler ──────────────────────────────────────────────── */}
        <Separator className="my-1" />
        <div className="space-y-2.5">
          {/* Header row with enable toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium">Auto-Scheduler</p>
              <p className="text-[10px] text-muted-foreground">Runs import + retry automatically on a schedule</p>
            </div>
            <Switch
              checked={scheduleEnabled}
              onCheckedChange={(val) => {
                setScheduleEnabled(val);
                saveSchedule({ universalCatalogScheduleEnabled: val });
              }}
              disabled={savingSchedule}
              data-testid="switch-universal-catalog-schedule"
            />
          </div>

          {scheduleEnabled && (
            <div className="ml-1 space-y-2.5 pl-2 border-l border-border">
              {/* Frequency */}
              <div className="flex items-center gap-4">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Every (months)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={12}
                    value={refreshMonths}
                    onChange={(e) => setRefreshMonths(Math.max(1, Math.min(12, parseInt(e.target.value) || 1)))}
                    onBlur={() => saveSchedule({ universalCatalogRefreshMonths: refreshMonths })}
                    className="text-xs w-20 text-right"
                    data-testid="input-universal-refresh-months"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Retry if older than (days)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={365}
                    value={retryDays}
                    onChange={(e) => setRetryDays(Math.max(0, Math.min(365, parseInt(e.target.value) || 0)))}
                    onBlur={() => saveSchedule({ universalCatalogRetryDays: retryDays })}
                    className="text-xs w-20 text-right"
                    data-testid="input-universal-retry-days"
                  />
                </div>
              </div>

              {/* Last run / next run */}
              <div className="text-[10px] text-muted-foreground space-y-0.5">
                {lastScheduledRun ? (
                  <p>Last auto-run: {new Date(lastScheduledRun).toLocaleDateString()} {new Date(lastScheduledRun).toLocaleTimeString()}
                    {lastScheduleStatus === 'error' && <span className="text-red-400 ml-1">(failed)</span>}
                    {lastScheduleStatus === 'success' && <span className="text-emerald-400 ml-1">(success)</span>}
                  </p>
                ) : (
                  <p>No auto-run yet</p>
                )}
                {nextScheduledRun && (
                  <p>Next run: {new Date(nextScheduledRun).toLocaleDateString()} {new Date(nextScheduledRun).toLocaleTimeString()}</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Retry stale — only visible once there are no_image or failed rows */}
        {retryable > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">
              Retry — {retryable.toLocaleString()} parts previously skipped
            </div>
            <p className="text-[10px] text-muted-foreground">
              BrickLink sometimes adds images for parts that had none. Retry re-checks them.
            </p>
            <div className="flex gap-2">
              <Button
                onClick={() => retryItems(30)}
                disabled={retryPending || workerRunning}
                size="sm"
                variant="outline"
                className="flex-1 text-xs gap-1"
                data-testid="button-universal-retry-30d"
              >
                {retryPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Retry &gt;30d old
              </Button>
              <Button
                onClick={() => retryItems(0)}
                disabled={retryPending || workerRunning}
                size="sm"
                variant="outline"
                className="flex-1 text-xs gap-1"
                data-testid="button-universal-retry-all"
              >
                {retryPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Retry All
              </Button>
            </div>
          </div>
        )}

      </CardContent>
    </Card>
  );
}
