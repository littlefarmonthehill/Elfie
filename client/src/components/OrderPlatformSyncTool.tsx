import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { RefreshCw, CheckCircle, XCircle, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function OrderPlatformSyncTool() {
  const { toast } = useToast();
  const [syncResults, setSyncResults] = useState<any>(null);
  
  const syncMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/sync/all-platforms/orders", { 
        fullSync: false,
      });
      const data = await response.json();
      return data;
    },
    onSuccess: (data) => {
      setSyncResults(data);
      
      if (data.allSkipped) {
        toast({
          title: "Configuration Required",
          description: "Please configure BrickLink and/or BrickOwl API credentials in Settings.",
          variant: "destructive",
        });
      } else if (data.success) {
        const successCount = [
          data.results.bricklink.success,
          data.results.brickowl.success,
        ].filter(Boolean).length;
        
        toast({
          title: "Sync Complete",
          description: `Successfully synced ${successCount} platform(s)`,
        });
      } else {
        toast({
          title: "Sync Completed with Errors",
          description: "Some platforms failed to sync. See details below.",
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync orders",
        variant: "destructive",
      });
    },
  });
  
  const handleSync = () => {
    setSyncResults(null);
    syncMutation.mutate();
  };
  
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-200">Platform Order Sync</h3>
          <p className="text-xs text-gray-400 mt-1">
            Sync orders from BrickLink and BrickOwl platforms
          </p>
        </div>
        <Button
          onClick={handleSync}
          disabled={syncMutation.isPending}
          size="sm"
          className="gap-2"
          data-testid="button-sync-platforms"
        >
          {syncMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Syncing...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4" />
              Sync Now
            </>
          )}
        </Button>
      </div>
      
      {/* Progress/Status */}
      {syncMutation.isPending && (
        <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 text-blue-400 animate-spin flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-200">Syncing platforms...</p>
              <p className="text-xs text-gray-400 mt-1">
                This may take a few moments depending on the number of orders
              </p>
            </div>
          </div>
        </div>
      )}
      
      {/* Results */}
      {syncResults && syncResults.results && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wide">
            Sync Results
          </h4>
          
          {/* BrickLink */}
          <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-3">
            <div className="flex items-start gap-3">
              {syncResults.results.bricklink?.success ? (
                <CheckCircle className="h-5 w-5 text-green-400 flex-shrink-0 mt-0.5" />
              ) : syncResults.results.bricklink?.skipped ? (
                <AlertCircle className="h-5 w-5 text-yellow-400 flex-shrink-0 mt-0.5" />
              ) : (
                <XCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-200">BrickLink</p>
                  {syncResults.results.bricklink?.skipped && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400">
                      SKIPPED
                    </span>
                  )}
                </div>
                
                {syncResults.results.bricklink?.success && syncResults.results.bricklink?.data && (
                  <div className="mt-2 space-y-1 text-xs text-gray-400">
                    <div className="flex justify-between">
                      <span>Orders Fetched:</span>
                      <span className="text-gray-300 font-mono">{syncResults.results.bricklink.data.ordersFetched || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Orders Added:</span>
                      <span className="text-green-400 font-mono">{syncResults.results.bricklink.data.ordersAdded || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Orders Updated:</span>
                      <span className="text-blue-400 font-mono">{syncResults.results.bricklink.data.ordersUpdated || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Items Added:</span>
                      <span className="text-green-400 font-mono">{syncResults.results.bricklink.data.itemsAdded || 0}</span>
                    </div>
                  </div>
                )}
                
                {syncResults.results.bricklink?.error && (
                  <p className="text-xs text-red-400 mt-2">
                    {syncResults.results.bricklink.error}
                  </p>
                )}
              </div>
            </div>
          </div>
          
          {/* BrickOwl */}
          <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-3">
            <div className="flex items-start gap-3">
              {syncResults.results.brickowl?.success ? (
                <CheckCircle className="h-5 w-5 text-green-400 flex-shrink-0 mt-0.5" />
              ) : syncResults.results.brickowl?.skipped ? (
                <AlertCircle className="h-5 w-5 text-yellow-400 flex-shrink-0 mt-0.5" />
              ) : (
                <XCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-200">BrickOwl</p>
                  {syncResults.results.brickowl?.skipped && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400">
                      SKIPPED
                    </span>
                  )}
                </div>
                
                {syncResults.results.brickowl?.success && syncResults.results.brickowl?.data && (
                  <div className="mt-2 space-y-1 text-xs text-gray-400">
                    <div className="flex justify-between">
                      <span>Orders Fetched:</span>
                      <span className="text-gray-300 font-mono">{syncResults.results.brickowl.data.ordersFetched || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Orders Added:</span>
                      <span className="text-green-400 font-mono">{syncResults.results.brickowl.data.ordersAdded || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Orders Updated:</span>
                      <span className="text-blue-400 font-mono">{syncResults.results.brickowl.data.ordersUpdated || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Items Added:</span>
                      <span className="text-green-400 font-mono">{syncResults.results.brickowl.data.itemsAdded || 0}</span>
                    </div>
                  </div>
                )}
                
                {syncResults.results.brickowl?.error && (
                  <p className="text-xs text-red-400 mt-2">
                    {syncResults.results.brickowl.error}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Info */}
      {!syncMutation.isPending && !syncResults && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-blue-300">
              <p className="font-medium mb-1">About Platform Sync</p>
              <ul className="space-y-1 text-blue-400/80">
                <li>• Syncs orders from BrickLink and BrickOwl</li>
                <li>• Only fetches orders modified since last sync</li>
                <li>• Automatically adjusts inventory when order status changes</li>
                <li>• Requires API credentials configured in Settings</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
