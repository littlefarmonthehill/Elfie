import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle, Info } from "lucide-react";

interface DiagnosticData {
  success: boolean;
  summary: Array<{
    marketplace: string | null;
    count: number;
    percentage: number;
  }>;
  unknownSamples: Array<{
    order_number: string;
    order_key: string;
    marketplace: string | null;
    order_date: string;
    detected_pattern: string;
  }>;
  insights: {
    totalOrders: number;
    unknownCount: number;
    detectionMethods: Array<{
      priority: number;
      method: string;
      description: string;
    }>;
    detectionPatterns: Array<{
      pattern: string;
      platform: string;
    }>;
  };
}

export default function MarketplaceDiagnostic() {
  const { data, isLoading } = useQuery<DiagnosticData>({
    queryKey: ['/api/orders/marketplace-diagnostic'],
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-lego-blue border-t-transparent mx-auto"></div>
      </div>
    );
  }

  if (!data) return null;

  const unknownCount = data.insights?.unknownCount || 0;
  const totalOrders = data.insights?.totalOrders || 0;
  const unknownPercent = totalOrders > 0 ? Math.round((unknownCount / totalOrders) * 100) : 0;

  return (
    <div className="p-4 space-y-4 bg-gray-900/50 rounded-lg border border-gray-700">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-orange-400" />
        <h2 className="text-lg font-bold text-white">Marketplace Detection Analysis</h2>
      </div>

      {/* Summary Stats */}
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {data.summary?.map((stat: any) => (
            <div key={stat.marketplace || 'unknown'} className="bg-gray-900 rounded p-3">
              <div className="text-xs text-gray-500 mb-1">
                {stat.marketplace || 'Unknown'}
              </div>
              <div className="text-lg font-bold text-white font-mono">
                {stat.count}
              </div>
              <div className="text-xs text-gray-400">
                {stat.percentage}%
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Issue Highlight */}
      {unknownPercent > 0 && (
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-orange-400 mb-1">
                {unknownPercent}% of orders have unknown marketplace
              </h4>
              <p className="text-xs text-gray-300 mb-2">
                {unknownCount} out of {totalOrders} orders couldn't be identified because their order numbers don't match any known patterns.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Enhanced Detection Methods */}
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Enhanced Multi-Field Detection</h3>
        <p className="text-xs text-gray-400 mb-3">
          The system now checks 8 different data sources in priority order to identify marketplaces:
        </p>
        <div className="space-y-2">
          {data.insights?.detectionMethods?.map((method: any, idx: number) => (
            <div key={idx} className="flex items-start gap-3 text-xs">
              <div className="bg-blue-500/20 text-blue-400 rounded px-1.5 py-0.5 font-mono text-[10px] md:text-sm flex-shrink-0">
                P{method.priority}
              </div>
              <div className="flex-1">
                <div className="font-semibold text-gray-300">{method.method}</div>
                <div className="text-gray-500 text-[10px] md:text-sm">{method.description}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detection Patterns */}
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Order Number Patterns</h3>
        <div className="space-y-2">
          {data.insights?.detectionPatterns?.map((pattern: any, idx: number) => (
            <div key={idx} className="flex items-center gap-3 text-xs">
              <CheckCircle className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
              <code className="bg-gray-900 px-2 py-1 rounded text-gray-300 font-mono">
                {pattern.pattern}
              </code>
              <span className="text-gray-400">→</span>
              <span className="text-gray-300">{pattern.platform}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Sample Unknown Orders */}
      {data.unknownSamples && data.unknownSamples.length > 0 && (
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">
            Sample "Unknown" Orders (Most Recent)
          </h3>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {data.unknownSamples.map((order: any, idx: number) => (
              <div key={idx} className="bg-gray-900 rounded p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Order #:</span>
                  <code className="text-xs text-gray-300 font-mono bg-gray-800 px-2 py-0.5 rounded">
                    {order.order_number}
                  </code>
                </div>
                {order.order_key && order.order_key !== order.order_number && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Order Key:</span>
                    <code className="text-xs text-gray-300 font-mono bg-gray-800 px-2 py-0.5 rounded">
                      {order.order_key}
                    </code>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Detection:</span>
                  <span className={`text-xs ${
                    order.detected_pattern === 'Pattern not recognized' 
                      ? 'text-orange-400' 
                      : 'text-green-400'
                  }`}>
                    {order.detected_pattern}
                  </span>
                </div>
                {order.order_date && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">Date:</span>
                    <span className="text-xs text-gray-400">
                      {new Date(order.order_date).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-blue-400 mb-2 flex items-center gap-2">
          <Info className="w-4 h-4" />
          What's Happening & How to Fix It
        </h3>
        <div className="text-xs text-gray-300 space-y-2">
          <p>
            <strong className="text-white">The Issue:</strong> ShipStation is storing generic internal order numbers (like "963", "2166") instead of the marketplace-specific order numbers. These don't match any detection patterns.
          </p>
          <p>
            <strong className="text-white">Why This Happens:</strong> When orders are imported into ShipStation from different sources, the original marketplace order number isn't always preserved in the order_number field. It may be in a different field or not synced at all.
          </p>
          <p>
            <strong className="text-white">Solutions:</strong>
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Check your ShipStation settings to ensure marketplace order IDs are being imported</li>
            <li>Run a Full Sync to re-extract marketplace data for all orders</li>
            <li>For orders that truly can't be detected, they'll remain as "Unknown"</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
