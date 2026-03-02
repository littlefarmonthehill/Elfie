import MetricCard from "./MetricCard";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { TrendingDown, AlertCircle, TrendingUp, ShoppingCart, RefreshCw, XCircle, ScanSearch, CheckCircle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import DashboardNotifications from "./DashboardNotifications";

interface DashboardStats {
  totalOrders: number;
  totalInventoryItems: number;
  totalInventoryQuantity: number;
  totalSales: number;
}

interface Order {
  id: number;
  orderNumber: string;
  customerUsername: string;
  orderDate: string;
  orderTotal: string;
  orderStatus: string;
}

interface DashboardOrders {
  pending: Order[];
  recentShipments: Order[];
  highValue: Order[];
}

interface PricingInsight {
  inventoryId: number;
  itemNo: string;
  itemName: string | null;
  itemType: string;
  colorName: string | null;
  condition: string;
  currentPrice: string;
  suggestedPrice: string;
  variance: number;
  quantity: number;
}

interface InsightsData {
  tooHigh: PricingInsight[];
  tooLow: PricingInsight[];
  wellPriced: PricingInsight[];
  summary: {
    total: number;
    tooHigh: number;
    tooLow: number;
    wellPriced: number;
  };
}

interface GeneralDashboardProps {
  onItemClick?: (type: 'order' | 'inventory', id: number | string) => void;
  onOpenFulfillment?: () => void;
  onOpenBrickanalyzer?: () => void;
}

export default function GeneralDashboard({ onItemClick, onOpenFulfillment, onOpenBrickanalyzer }: GeneralDashboardProps) {
  // Fetch dashboard stats (all-time)
  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ['/api/dashboard/stats'],
    queryFn: async () => {
      const response = await fetch('/api/dashboard/stats');
      if (!response.ok) throw new Error('Failed to fetch stats');
      return response.json();
    }
  });

  // Single efficient call — DB-level status filtering, no client-side filtering of huge payloads
  const { data: dashboardOrders } = useQuery<DashboardOrders>({
    queryKey: ['/api/orders/dashboard'],
  });

  // True unfulfilled count (shared cache with home.tsx — no extra network request)
  const { data: fulfillmentStats } = useQuery<{ unfulfilled: number }>({
    queryKey: ['/api/fulfillment/stats'],
  });

  const pendingCount = fulfillmentStats?.unfulfilled ?? dashboardOrders?.pending?.length ?? 0;
  const recentSales = dashboardOrders?.recentShipments ?? [];

  // Fetch pricing opportunities (items priced too low)
  const { data: pricingInsights } = useQuery<{ success: boolean; data: InsightsData }>({
    queryKey: ['/api/priceomatic/insights'],
  });

  // Poll POM sync status to show running indicator in action items
  const { data: pomStatus } = useQuery<{
    success: boolean;
    data: { liveProgress?: { active: boolean; itemsProcessed: number; itemsTotal: number } };
  }>({
    queryKey: ['/api/sync/priceomatic/status'],
    refetchInterval: 5000,
    staleTime: 0,
  });

  const isPomRunning = pomStatus?.data?.liveProgress?.active === true;
  const pomProgress = pomStatus?.data?.liveProgress;

  // Poll inventory sync progress to show running indicator in action items
  const { data: invSyncProgress } = useQuery<{
    status: 'idle' | 'syncing' | 'complete' | 'error';
    currentStep: string;
    progress: number;
    details: { itemsAdded?: number; itemsUpdated?: number };
  }>({
    queryKey: ['/api/sync/bricklink/progress'],
    refetchInterval: 3000,
    staleTime: 0,
  });

  const isInvSyncing = invSyncProgress?.status === 'syncing';
  const isInvComplete = invSyncProgress?.status === 'complete';

  // Poll order sync running state
  const { data: orderSyncRunning } = useQuery<{ running: boolean }>({
    queryKey: ['/api/order-sync/running'],
    refetchInterval: 4000,
    staleTime: 0,
  });
  const isOrderSyncing = orderSyncRunning?.running === true;

  // Poll channel sync running state
  const { data: channelSyncRunning } = useQuery<{ running: boolean }>({
    queryKey: ['/api/channel-sync/running'],
    refetchInterval: 4000,
    staleTime: 0,
  });
  const isChannelSyncing = channelSyncRunning?.running === true;

  // Poll for active Brickanalyzer scan
  const { data: latestScan } = useQuery<{
    id: number;
    status: "processing" | "complete" | "failed";
    totalPieces: number | null;
    identifiedPieces: number | null;
    estimatedValue: string | null;
  } | null>({
    queryKey: ['/api/brickanalyzer/scans/latest'],
    queryFn: async () => {
      const res = await fetch('/api/brickanalyzer/scans/latest', { credentials: 'include' });
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 5000,
    staleTime: 0,
  });

  const dismissScanMutation = useMutation({
    mutationFn: async (scanId: number) => {
      await fetch(`/api/brickanalyzer/scan/${scanId}`, { method: 'DELETE', credentials: 'include' });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/brickanalyzer/scans/latest'] }),
  });

  // Poll recent sync errors (last 24 h) for action items
  const { data: recentErrorsData } = useQuery<{
    errors: Array<{ id: string; label: string; status: string; message: string; time: string | null }>;
  }>({
    queryKey: ['/api/sync/recent-errors'],
    refetchInterval: 30000,
    staleTime: 0,
  });
  const syncErrors = recentErrorsData?.errors ?? [];

  // Get top pricing opportunities (items priced too low, sorted by variance)
  const pricingOpportunities = pricingInsights?.data?.tooLow
    ?.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance))
    ?.slice(0, 5) || [];

  const formatCurrency = (value: string | number) => {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 3,
    }).format(num);
  };

  return (
    <div className="p-2 md:p-4 lg:p-6 space-y-2 md:space-y-4 lg:space-y-6 bg-gradient-to-br from-lego-red/5 to-transparent rounded-lg border border-lego-red/10 shadow-[0_0_15px_rgba(239,68,68,0.1)]">

      {/* Key Metrics */}
      <div className="grid grid-cols-2 gap-2 md:gap-3 lg:gap-4">
        <MetricCard 
          label="Total Revenue" 
          value={`$${(stats?.totalSales || 0).toLocaleString()}`} 
          color="green" 
          data-testid="metric-total-revenue"
        />
        <MetricCard 
          label="Total Orders" 
          value={stats?.totalOrders.toLocaleString() || '0'} 
          color="blue" 
          data-testid="metric-total-orders"
        />
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-4 lg:gap-6 mt-2 md:mt-4 lg:mt-6">
        {/* Action Items */}
        <div className="bg-gray-900/50 border border-orange-500/20 rounded-lg p-2 md:p-4 lg:p-5" data-testid="section-action-items">
          <div className="flex items-center gap-1.5 md:gap-2 lg:gap-2.5 mb-2 md:mb-3 lg:mb-4">
            <AlertCircle className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-orange-400" />
            <h3 className="text-xs md:text-base lg:text-lg font-semibold text-orange-400 uppercase tracking-wide">Action Items</h3>
          </div>

          <div className="space-y-1">
            {pendingCount > 0 && (
              <div
                onClick={onOpenFulfillment}
                className="flex items-center justify-between rounded px-2 py-2 hover-elevate cursor-pointer"
                data-testid="action-orders-to-fulfill"
              >
                <div className="flex items-center gap-2">
                  <ShoppingCart className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-orange-400" />
                  <span className="text-xs md:text-base lg:text-lg text-gray-200">Orders to Fulfill</span>
                </div>
                <span className="font-mono font-bold text-xs md:text-base lg:text-lg text-orange-400">
                  {pendingCount}
                </span>
              </div>
            )}

            {(isInvSyncing || isInvComplete) && (
              <div
                className={`rounded px-2 py-2 space-y-1.5 border ${isInvComplete ? 'bg-green-950/40 border-green-500/20' : 'bg-blue-950/40 border-blue-500/20'}`}
                data-testid="action-inv-syncing"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <RefreshCw className={`w-3.5 h-3.5 flex-shrink-0 ${isInvComplete ? 'text-green-400' : 'text-blue-400 animate-spin'}`} />
                    <span className={`text-xs md:text-sm font-medium ${isInvComplete ? 'text-green-300' : 'text-blue-300'}`}>
                      {isInvComplete ? 'Inventory Sync Complete' : 'Inventory Syncing'}
                    </span>
                  </div>
                  <span className={`text-[10px] font-mono flex-shrink-0 ${isInvComplete ? 'text-green-400' : 'text-blue-400'}`}>
                    {invSyncProgress?.progress ?? 0}%
                  </span>
                </div>
                <div className={`h-1.5 w-full rounded-full overflow-hidden ${isInvComplete ? 'bg-green-950/80' : 'bg-blue-950/80'}`}>
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${isInvComplete ? 'bg-green-500' : 'bg-blue-500'}`}
                    style={{ width: `${invSyncProgress?.progress ?? 0}%` }}
                  />
                </div>
                {invSyncProgress?.currentStep && (
                  <p className={`text-[10px] font-mono truncate ${isInvComplete ? 'text-green-600' : 'text-blue-600'}`}>
                    {invSyncProgress.currentStep}
                  </p>
                )}
              </div>
            )}

            {isPomRunning && (
              <div
                className="rounded px-2 py-2 bg-purple-950/40 border border-purple-500/20 space-y-1.5"
                data-testid="action-pom-running"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 text-purple-400 animate-spin flex-shrink-0" />
                    <span className="text-xs md:text-sm text-purple-300 font-medium">Price-o-Matic Syncing</span>
                  </div>
                  {pomProgress && pomProgress.itemsTotal > 0 && (
                    <span className="text-[10px] font-mono text-purple-400 flex-shrink-0">
                      {Math.round((pomProgress.itemsProcessed / pomProgress.itemsTotal) * 100)}%
                    </span>
                  )}
                </div>
                {pomProgress && pomProgress.itemsTotal > 0 && (
                  <>
                    <div className="h-1.5 w-full rounded-full bg-purple-950/80 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-purple-500 transition-all duration-500"
                        style={{ width: `${Math.min((pomProgress.itemsProcessed / pomProgress.itemsTotal) * 100, 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] font-mono text-purple-600">
                      <span>{pomProgress.itemsProcessed.toLocaleString()} lots priced</span>
                      <span>{pomProgress.itemsTotal.toLocaleString()} total</span>
                    </div>
                  </>
                )}
              </div>
            )}

            {isOrderSyncing && (
              <div
                className="rounded px-2 py-2 bg-cyan-950/40 border border-cyan-500/20 space-y-1"
                data-testid="action-order-sync-running"
              >
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 text-cyan-400 animate-spin flex-shrink-0" />
                  <span className="text-xs md:text-sm text-cyan-300 font-medium">Order Sync Running</span>
                </div>
                <p className="text-[10px] font-mono text-cyan-600">Fetching orders from BrickLink &amp; BrickOwl…</p>
              </div>
            )}

            {isChannelSyncing && (
              <div
                className="rounded px-2 py-2 bg-teal-950/40 border border-teal-500/20 space-y-1"
                data-testid="action-channel-sync-running"
              >
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 text-teal-400 animate-spin flex-shrink-0" />
                  <span className="text-xs md:text-sm text-teal-300 font-medium">Channel Sync Running</span>
                </div>
                <p className="text-[10px] font-mono text-teal-600">Pushing inventory updates to BrickOwl…</p>
              </div>
            )}

            {/* Brickanalyzer scan in progress */}
            {latestScan && latestScan.status === 'processing' && (
              <div
                className="rounded px-2 py-2 bg-yellow-950/40 border border-yellow-500/20 space-y-1"
                data-testid="action-brickanalyzer-processing"
              >
                <div className="flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 text-yellow-400 animate-spin flex-shrink-0" />
                  <span className="text-xs md:text-sm text-yellow-300 font-medium">Brickanalyzer Scanning...</span>
                </div>
                <p className="text-[10px] font-mono text-yellow-600">AI is identifying your LEGO pieces — results coming shortly</p>
              </div>
            )}

            {/* Brickanalyzer scan complete */}
            {latestScan && latestScan.status === 'complete' && (
              <div
                className="rounded px-2 py-2 bg-green-950/40 border border-green-500/20 space-y-1.5"
                data-testid="action-brickanalyzer-complete"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                    <span className="text-xs md:text-sm text-green-300 font-medium">Brickanalyzer Complete</span>
                  </div>
                  <button
                    onClick={() => dismissScanMutation.mutate(latestScan.id)}
                    className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0"
                    data-testid="button-brickanalyzer-dismiss-action"
                  >
                    Dismiss
                  </button>
                </div>
                <p className="text-[10px] font-mono text-green-600">
                  {latestScan.totalPieces ?? 0} pieces found
                  {latestScan.estimatedValue && Number(latestScan.estimatedValue) > 0
                    ? ` · $${Number(latestScan.estimatedValue).toFixed(2)} value`
                    : ''}
                </p>
                <button
                  onClick={onOpenBrickanalyzer}
                  className="text-[10px] text-green-400 underline hover:text-green-300"
                  data-testid="button-brickanalyzer-view-results"
                >
                  View results before they expire
                </button>
              </div>
            )}

            {latestScan && latestScan.status === 'failed' && (
              <div
                className="rounded px-2 py-2 bg-red-950/40 border border-red-500/20 space-y-1"
                data-testid="action-brickanalyzer-failed"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                    <span className="text-xs md:text-sm text-red-300 font-medium">Brickanalyzer Failed</span>
                  </div>
                  <button
                    onClick={() => dismissScanMutation.mutate(latestScan.id)}
                    className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0"
                    data-testid="button-brickanalyzer-dismiss-failed"
                  >
                    Dismiss
                  </button>
                </div>
                <p className="text-[10px] font-mono text-red-600">Scan could not complete. Try again from the Inventory tab.</p>
              </div>
            )}

            {syncErrors.map(err => (
              <div
                key={err.id}
                className={`rounded px-2 py-2 space-y-1 ${err.status === 'partial' ? 'bg-yellow-950/40 border border-yellow-500/20' : 'bg-red-950/40 border border-red-500/20'}`}
                data-testid={`action-sync-error-${err.id}`}
              >
                <div className="flex items-center gap-2">
                  <XCircle className={`w-3.5 h-3.5 flex-shrink-0 ${err.status === 'partial' ? 'text-yellow-400' : 'text-red-400'}`} />
                  <span className={`text-xs md:text-sm font-medium ${err.status === 'partial' ? 'text-yellow-300' : 'text-red-300'}`}>
                    {err.label} {err.status === 'partial' ? 'Partial' : 'Failed'}
                  </span>
                </div>
                <p className={`text-[10px] font-mono truncate ${err.status === 'partial' ? 'text-yellow-600' : 'text-red-600'}`}>
                  {err.message}
                </p>
              </div>
            ))}
          </div>

          <DashboardNotifications />
        </div>

        {/* Top Pricing Opportunities */}
        <div className="bg-gray-900/50 border border-purple-500/20 rounded-lg p-2 md:p-4 lg:p-5" data-testid="section-pricing-opportunities">
          <div className="flex items-center gap-1.5 md:gap-2 lg:gap-2.5 mb-2 md:mb-3 lg:mb-4">
            <TrendingDown className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-purple-400" />
            <h3 className="text-xs md:text-base lg:text-lg font-semibold text-purple-400 uppercase tracking-wide">Top Pricing Opportunities</h3>
          </div>
          <div className="space-y-1.5">
            {pricingOpportunities.length > 0 ? (
              pricingOpportunities.map((item) => (
                <div 
                  key={item.inventoryId} 
                  onClick={() => onItemClick?.('inventory', item.inventoryId)}
                  className="flex justify-between items-start hover-elevate rounded px-2 py-1 cursor-pointer"
                  data-testid={`pricing-item-${item.inventoryId}`}
                >
                  <div className="flex gap-2 flex-1 min-w-0">
                    <TrendingDown className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-purple-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-200 font-mono text-xs md:text-base lg:text-lg font-medium flex-shrink-0">{item.itemNo}</span>
                        {item.itemName && (
                          <span className="text-white text-xs md:text-base lg:text-lg truncate">{item.itemName}</span>
                        )}
                      </div>
                      <div className="flex gap-1.5 text-[11px] md:text-sm lg:text-base text-gray-400 mt-0.5">
                        {item.colorName && <span>{item.colorName}</span>}
                        {item.colorName && <span>•</span>}
                        <span>{item.condition === 'N' ? 'New' : 'Used'}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                    <span className="text-gray-400 font-mono text-[10px] md:text-sm md:text-xs lg:text-sm">{formatCurrency(item.currentPrice)}</span>
                    <span className="text-orange-400 font-mono text-[10px] md:text-sm md:text-xs lg:text-sm font-bold">{item.variance}%</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-[11px] md:text-sm lg:text-base text-gray-500 italic">Run Price-o-Matic to see opportunities</div>
            )}
          </div>
        </div>
      </div>

      {/* Recent Activity - High Value Sales */}
      <div className="bg-gray-900/50 border border-green-500/20 rounded-lg p-3 md:p-5 lg:p-6" data-testid="section-recent-activity">
        <div className="flex items-center gap-1.5 md:gap-2 lg:gap-2.5 mb-2 md:mb-3 lg:mb-4">
          <TrendingUp className="w-3.5 h-3.5 md:w-5 md:h-5 lg:w-6 lg:h-6 text-green-400" />
          <h3 className="text-xs md:text-base lg:text-lg font-semibold text-green-400 uppercase tracking-wide">Recent Activity - Latest Sales</h3>
        </div>
        <div className="space-y-1.5">
          {recentSales.length > 0 ? (
            recentSales.map((order) => (
              <div 
                key={order.id} 
                onClick={() => onItemClick?.('order', order.id)}
                className="flex justify-between items-start hover-elevate rounded px-2 py-1 cursor-pointer"
                data-testid={`activity-order-${order.id}`}
              >
                <div className="flex gap-2 flex-1 min-w-0">
                  <div className={`w-2.5 h-2.5 md:w-3 md:h-3 lg:w-3.5 lg:h-3.5 rounded-full flex-shrink-0 mt-1 ${
                    order.orderStatus === 'shipped' ? 'bg-green-400' : 
                    order.orderStatus === 'awaiting_shipment' ? 'bg-orange-400' : 
                    'bg-gray-400'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-gray-200 font-mono text-xs md:text-base lg:text-lg font-medium">
                      #{order.orderNumber}
                    </div>
                    <div className="flex gap-1.5 text-[11px] md:text-sm lg:text-base text-gray-400 mt-0.5">
                      <span>{order.customerUsername}</span>
                      <span>•</span>
                      <span>{new Date(order.orderDate).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
                <span className="text-lego-green font-mono font-medium text-xs md:text-base lg:text-lg ml-2 flex-shrink-0">${Number(order.orderTotal || 0).toFixed(2)}</span>
              </div>
            ))
          ) : (
            <div className="text-[11px] md:text-sm lg:text-base text-gray-500 italic">No recent sales</div>
          )}
        </div>
      </div>
    </div>
  );
}
