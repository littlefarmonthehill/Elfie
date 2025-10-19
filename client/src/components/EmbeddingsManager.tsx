import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Sparkles, Database, Search, Loader2, CheckCircle2, AlertCircle, Play, Square } from 'lucide-react';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
