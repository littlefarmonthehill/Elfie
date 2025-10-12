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

export function EmbeddingsManager() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [batchSize, setBatchSize] = useState(100);

  // Get embedding statistics
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['/api/embeddings/stats'],
    refetchInterval: 5000, // Refresh every 5 seconds during batch operations
  });

  // Batch embed inventory
  const { mutate: batchEmbed, isPending: isBatchEmbedding } = useMutation({
    mutationFn: async (inventoryIds: number[]) => {
      return apiRequest('/api/embeddings/inventory/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inventoryIds }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/embeddings/stats'] });
    },
  });

  // Semantic search test
  const { mutate: testSearch, isPending: isSearching } = useMutation({
    mutationFn: async (query: string) => {
      return apiRequest('/api/search/inventory/semantic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit: 5 }),
      });
    },
    onSuccess: (data: any) => {
      setSearchResults(data.results || []);
    },
  });

  const handleBatchEmbed = async () => {
    try {
      // Get first batch of inventory items without embeddings
      const response = await fetch('/api/inventory?limit=' + batchSize);
      const items = await response.json();
      
      if (items && items.length > 0) {
        const inventoryIds = items.map((item: any) => item.id);
        batchEmbed(inventoryIds);
      }
    } catch (error) {
      console.error('Error getting inventory for embedding:', error);
    }
  };

  const inventoryProgress = stats?.inventory ? 
    (stats.inventory.embedded / stats.inventory.total) * 100 : 0;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Sparkles className="w-8 h-8 text-purple-400" />
        <div>
          <h1 className="text-2xl font-bold">Semantic Search & AI Intelligence</h1>
          <p className="text-sm text-gray-400">Manage vector embeddings and test semantic search capabilities</p>
        </div>
      </div>

      {/* Statistics */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Database className="w-5 h-5" />
              Inventory Embeddings
            </CardTitle>
            <CardDescription>
              {statsLoading ? 'Loading...' : `${stats?.inventory.embedded || 0} of ${stats?.inventory.total || 0} items embedded`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Progress value={inventoryProgress} className="h-2" />
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">{inventoryProgress.toFixed(1)}% complete</span>
              {inventoryProgress === 100 && (
                <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Complete
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Database className="w-5 h-5" />
              Order Embeddings
            </CardTitle>
            <CardDescription>
              {statsLoading ? 'Loading...' : `${stats?.orders.embedded || 0} of ${stats?.orders.total || 0} orders embedded`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Progress 
              value={stats?.orders ? (stats.orders.embedded / stats.orders.total) * 100 : 0} 
              className="h-2" 
            />
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">
                {stats?.orders ? ((stats.orders.embedded / stats.orders.total) * 100).toFixed(1) : 0}% complete
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Batch Embedding */}
      <Card>
        <CardHeader>
          <CardTitle>Generate Embeddings</CardTitle>
          <CardDescription>
            Create vector embeddings for your inventory to enable semantic search
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Embedding generation uses OpenAI's API and costs approximately $0.002 per 1,000 items.
              For {stats?.inventory.total || 0} items, this will cost ~${((stats?.inventory.total || 0) * 0.000002).toFixed(2)}.
            </AlertDescription>
          </Alert>

          <div className="flex gap-4 items-end">
            <div>
              <label className="text-sm text-gray-400 mb-1 block">Batch Size</label>
              <Input
                type="number"
                value={batchSize}
                onChange={(e) => setBatchSize(parseInt(e.target.value) || 100)}
                className="w-32"
                min={10}
                max={1000}
                data-testid="input-batch-size"
              />
            </div>
            <Button
              onClick={handleBatchEmbed}
              disabled={isBatchEmbedding || inventoryProgress === 100}
              data-testid="button-batch-embed"
            >
              {isBatchEmbedding && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {inventoryProgress === 100 ? 'All Items Embedded' : `Embed Next ${batchSize} Items`}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Semantic Search Test */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="w-5 h-5" />
            Test Semantic Search
          </CardTitle>
          <CardDescription>
            Try semantic search to find items by meaning, not just keywords
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Try: 'red bricks', 'minifigure accessories', 'transparent pieces'..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchQuery && testSearch(searchQuery)}
              data-testid="input-semantic-search"
            />
            <Button
              onClick={() => testSearch(searchQuery)}
              disabled={!searchQuery || isSearching}
              data-testid="button-semantic-search"
            >
              {isSearching && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Search
            </Button>
          </div>

          {searchResults.length > 0 && (
            <div className="space-y-2 mt-4">
              <h3 className="text-sm font-semibold text-gray-300">Results (by semantic similarity):</h3>
              {searchResults.map((result, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-gray-900/50 border border-gray-700 rounded-lg"
                  data-testid={`result-${idx}`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <p className="font-mono text-sm text-purple-400">{result.item_no}</p>
                      <p className="text-white">{result.item_name}</p>
                      <div className="flex gap-2 mt-1 text-xs text-gray-400">
                        {result.color_name && (
                          <Badge variant="outline" className="text-xs">{result.color_name}</Badge>
                        )}
                        <span>{result.quantity} units @ ${result.unit_price}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/30">
                        {(parseFloat(result.similarity) * 100).toFixed(0)}% match
                      </Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* How It Works */}
      <Card className="border-purple-500/30">
        <CardHeader>
          <CardTitle className="text-purple-400">How Semantic Search Works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-gray-300">
          <p>🧠 <strong>Vector Embeddings:</strong> Each item is converted to a 1536-dimensional vector that captures its meaning</p>
          <p>🔍 <strong>Semantic Matching:</strong> Search queries are compared to item vectors using cosine similarity</p>
          <p>✨ <strong>Intelligent Results:</strong> Find items by concept, not just keywords - "transparent pieces" finds all clear/trans items</p>
          <p>🤖 <strong>AI Enhancement:</strong> Elfie uses semantic search to understand context and provide smarter recommendations</p>
        </CardContent>
      </Card>
    </div>
  );
}
