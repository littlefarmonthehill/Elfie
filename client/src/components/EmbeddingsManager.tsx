import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Sparkles, Database, Search, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
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
  const [isAutoContinuing, setIsAutoContinuing] = useState(false);

  // Get embedding statistics
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['/api/embeddings/stats'],
    refetchInterval: 5000, // Refresh every 5 seconds during batch operations
  });

  // Batch embed inventory
  const { mutate: batchEmbedInventory, isPending: isBatchEmbeddingInventory } = useMutation({
    mutationFn: async (inventoryIds: number[]) => {
      const response = await fetch('/api/embeddings/inventory/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inventoryIds }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to embed inventory');
      return data;
    },
    onSuccess: async (data) => {
      const successful = data.results?.filter((r: any) => r.success).length || 0;
      const failed = data.results?.filter((r: any) => !r.success).length || 0;
      
      toast({
        title: "Batch Complete",
        description: `Embedded ${successful} items${failed > 0 ? `. ${failed} failed.` : ''}`,
      });
      
      await queryClient.invalidateQueries({ queryKey: ['/api/embeddings/stats'] });
      
      // Auto-continue if more items remain
      if (isAutoContinuing && successful > 0) {
        setTimeout(() => handleBatchEmbedInventory(), 1000);
      } else if (isAutoContinuing) {
        setIsAutoContinuing(false);
        toast({
          title: "All Done!",
          description: "All inventory items have been embedded",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Embedding Failed",
        description: error.message || "Failed to generate embeddings. Check your OpenAI API key.",
        variant: "destructive",
      });
    },
  });

  // Batch embed orders
  const { mutate: batchEmbedOrders, isPending: isBatchEmbeddingOrders } = useMutation({
    mutationFn: async (orderIds: string[]) => {
      const response = await fetch('/api/embeddings/orders/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to embed orders');
      return data;
    },
    onSuccess: async (data) => {
      const successful = data.results?.filter((r: any) => r.success).length || 0;
      const failed = data.results?.filter((r: any) => !r.success).length || 0;
      
      toast({
        title: "Batch Complete",
        description: `Embedded ${successful} orders${failed > 0 ? `. ${failed} failed.` : ''}`,
      });
      
      await queryClient.invalidateQueries({ queryKey: ['/api/embeddings/stats'] });
      
      // Auto-continue if more items remain
      if (isAutoContinuing && successful > 0) {
        setTimeout(() => handleBatchEmbedOrders(), 1000);
      } else if (isAutoContinuing) {
        setIsAutoContinuing(false);
        toast({
          title: "All Done!",
          description: "All orders have been embedded",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Embedding Failed",
        description: error.message || "Failed to generate embeddings. Check your OpenAI API key.",
        variant: "destructive",
      });
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

  const handleBatchEmbedInventory = async () => {
    try {
      // Get inventory items without embeddings
      const response = await fetch('/api/embeddings/inventory/missing?limit=' + inventoryBatchSize);
      const items = await response.json();
      
      if (items && items.length > 0) {
        const inventoryIds = items.map((item: any) => item.id);
        
        if (!isAutoContinuing) {
          setIsAutoContinuing(true);
          toast({
            title: "Auto-Embedding Started",
            description: `Processing all inventory items in batches of ${inventoryBatchSize}...`,
          });
        }
        
        batchEmbedInventory(inventoryIds);
      } else {
        setIsAutoContinuing(false);
        toast({
          title: "All Done!",
          description: "All inventory items already have embeddings.",
        });
      }
    } catch (error: any) {
      console.error('Error getting inventory for embedding:', error);
      setIsAutoContinuing(false);
      toast({
        title: "Error",
        description: error.message || "Failed to fetch items for embedding",
        variant: "destructive",
      });
    }
  };

  const handleBatchEmbedOrders = async () => {
    try {
      // Get orders without embeddings
      const response = await fetch('/api/embeddings/orders/missing?limit=' + orderBatchSize);
      const items = await response.json();
      
      if (items && items.length > 0) {
        const orderIds = items.map((item: any) => item.id);
        
        if (!isAutoContinuing) {
          setIsAutoContinuing(true);
          toast({
            title: "Auto-Embedding Started",
            description: `Processing all orders in batches of ${orderBatchSize}...`,
          });
        }
        
        batchEmbedOrders(orderIds);
      } else {
        setIsAutoContinuing(false);
        toast({
          title: "All Done!",
          description: "All orders already have embeddings.",
        });
      }
    } catch (error: any) {
      console.error('Error getting orders for embedding:', error);
      setIsAutoContinuing(false);
      toast({
        title: "Error",
        description: error.message || "Failed to fetch orders for embedding",
        variant: "destructive",
      });
    }
  };

  const inventoryProgress = (stats as any)?.inventory ? 
    ((stats as any).inventory.embedded / (stats as any).inventory.total) * 100 : 0;

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400">Manage vector embeddings and test semantic search capabilities</p>

      {/* API Key Notice */}
      <Alert className="p-2 border-blue-500/30 bg-blue-500/10">
        <AlertCircle className="h-3 w-3 text-blue-400" />
        <AlertDescription className="text-xs ml-2 text-blue-300">
          <strong>OpenAI API Key Required:</strong> Embeddings use OpenAI's API (separate from OpenRouter). Add your OpenAI API key above to enable semantic search. Get one at platform.openai.com/api-keys
        </AlertDescription>
      </Alert>

      {/* Statistics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-2 p-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Database className="w-4 h-4" />
              Inventory Embeddings
            </CardTitle>
            <CardDescription className="text-xs">
              {statsLoading ? 'Loading...' : `${(stats as any)?.inventory?.embedded || 0} of ${(stats as any)?.inventory?.total || 0} items`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 p-3 pt-0">
            <Progress value={inventoryProgress} className="h-1.5" />
            <div className="flex justify-between items-center text-xs">
              <span className="text-gray-400">{inventoryProgress.toFixed(1)}%</span>
              {inventoryProgress === 100 && (
                <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30 text-xs py-0 h-5">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Done
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 p-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Database className="w-4 h-4" />
              Order Embeddings
            </CardTitle>
            <CardDescription className="text-xs">
              {statsLoading ? 'Loading...' : `${(stats as any)?.orders?.embedded || 0} of ${(stats as any)?.orders?.total || 0} orders`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 p-3 pt-0">
            <Progress 
              value={(stats as any)?.orders ? ((stats as any).orders.embedded / (stats as any).orders.total) * 100 : 0} 
              className="h-1.5" 
            />
            <div className="flex justify-between items-center text-xs">
              <span className="text-gray-400">
                {(stats as any)?.orders ? (((stats as any).orders.embedded / (stats as any).orders.total) * 100).toFixed(1) : 0}%
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Inventory Batch Embedding */}
      <Card>
        <CardHeader className="pb-2 p-3">
          <CardTitle className="text-sm">Generate Inventory Embeddings</CardTitle>
          <CardDescription className="text-xs">
            Embed inventory items to enable semantic search
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-3 pt-0">
          <Alert className="p-2">
            <AlertCircle className="h-3 w-3" />
            <AlertDescription className="text-xs ml-2">
              ~$0.002 per 1,000 items. Total cost: ~${(((stats as any)?.inventory?.total || 0) * 0.000002).toFixed(2)}
            </AlertDescription>
          </Alert>

          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <div className="flex-1">
              <label className="text-xs text-gray-400 mb-1 block">Batch Size</label>
              <Input
                type="number"
                value={inventoryBatchSize}
                onChange={(e) => setInventoryBatchSize(parseInt(e.target.value) || 100)}
                className="w-full sm:w-32 text-xs h-8"
                min={10}
                max={1000}
                data-testid="input-inventory-batch-size"
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleBatchEmbedInventory}
                disabled={isBatchEmbeddingInventory || inventoryProgress === 100}
                size="sm"
                className="text-xs h-8 flex-1"
                data-testid="button-batch-embed-inventory"
              >
                {isBatchEmbeddingInventory && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                {inventoryProgress === 100 ? 'All Done' : isAutoContinuing ? 'Processing...' : `Start Auto-Embed`}
              </Button>
              {isAutoContinuing && (
                <Button
                  onClick={() => setIsAutoContinuing(false)}
                  size="sm"
                  variant="outline"
                  className="text-xs h-8"
                  data-testid="button-stop-auto-embed"
                >
                  Stop
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Orders Batch Embedding */}
      <Card>
        <CardHeader className="pb-2 p-3">
          <CardTitle className="text-sm">Generate Order Embeddings</CardTitle>
          <CardDescription className="text-xs">
            Embed orders to enable semantic search
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-3 pt-0">
          <Alert className="p-2">
            <AlertCircle className="h-3 w-3" />
            <AlertDescription className="text-xs ml-2">
              ~$0.002 per 1,000 orders. Total cost: ~${(((stats as any)?.orders?.total || 0) * 0.000002).toFixed(2)}
            </AlertDescription>
          </Alert>

          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <div className="flex-1">
              <label className="text-xs text-gray-400 mb-1 block">Batch Size</label>
              <Input
                type="number"
                value={orderBatchSize}
                onChange={(e) => setOrderBatchSize(parseInt(e.target.value) || 100)}
                className="w-full sm:w-32 text-xs h-8"
                min={10}
                max={1000}
                data-testid="input-order-batch-size"
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleBatchEmbedOrders}
                disabled={isBatchEmbeddingOrders || ((stats as any)?.orders?.embedded || 0) === ((stats as any)?.orders?.total || 0)}
                size="sm"
                className="text-xs h-8 flex-1"
                data-testid="button-batch-embed-orders"
              >
                {isBatchEmbeddingOrders && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                {((stats as any)?.orders?.embedded || 0) === ((stats as any)?.orders?.total || 0) ? 'All Done' : isAutoContinuing ? 'Processing...' : `Start Auto-Embed`}
              </Button>
              {isAutoContinuing && (
                <Button
                  onClick={() => setIsAutoContinuing(false)}
                  size="sm"
                  variant="outline"
                  className="text-xs h-8"
                  data-testid="button-stop-auto-embed-orders"
                >
                  Stop
                </Button>
              )}
            </div>
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
              <h3 className="text-xs font-semibold text-gray-300">Results (by similarity):</h3>
              {searchResults.map((result, idx) => (
                <div
                  key={idx}
                  className="p-2 bg-gray-900/50 border border-gray-700 rounded-lg"
                  data-testid={`result-${idx}`}
                >
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-xs text-purple-400">{result.item_no}</p>
                      <p className="text-xs text-white truncate">{result.item_name}</p>
                      <div className="flex gap-1 mt-1 text-xs text-gray-400 flex-wrap">
                        {result.color_name && (
                          <Badge variant="outline" className="text-xs py-0 h-4">{result.color_name}</Badge>
                        )}
                        <span className="text-xs">{result.quantity} @ ${result.unit_price}</span>
                      </div>
                    </div>
                    <Badge variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/30 text-xs py-0 h-5 shrink-0">
                      {(parseFloat(result.similarity) * 100).toFixed(0)}%
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* How It Works */}
      <Card className="border-purple-500/30">
        <CardHeader className="pb-2 p-3">
          <CardTitle className="text-sm text-purple-400">How Semantic Search Works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-xs text-gray-300 p-3 pt-0">
          <p>🧠 <strong>Vector Embeddings:</strong> Items converted to 1536-dim vectors</p>
          <p>🔍 <strong>Semantic Matching:</strong> Queries compared via cosine similarity</p>
          <p>✨ <strong>Intelligent Results:</strong> Find by concept, not just keywords</p>
          <p>🤖 <strong>AI Enhancement:</strong> Elfie uses this for smarter responses</p>
        </CardContent>
      </Card>
    </div>
  );
}
