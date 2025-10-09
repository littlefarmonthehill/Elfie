import { TrendingUp, Users, MousePointerClick, DollarSign } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface MarketingDetailProps {
  data: {
    campaignName: string;
    status: 'Active' | 'Paused' | 'Completed';
    platform: string;
    impressions: number;
    clicks: number;
    conversions: number;
    spent: number;
    revenue: number;
    startDate: string;
    endDate?: string;
  };
}

export default function MarketingDetail({ data }: MarketingDetailProps) {
  const ctr = ((data.clicks / data.impressions) * 100).toFixed(2);
  const conversionRate = ((data.conversions / data.clicks) * 100).toFixed(2);
  const roi = (((data.revenue - data.spent) / data.spent) * 100).toFixed(1);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Active': return 'bg-lego-green/20 text-lego-green border-lego-green/30';
      case 'Paused': return 'bg-lego-yellow/20 text-lego-yellow border-lego-yellow/30';
      case 'Completed': return 'bg-gray-700 text-gray-400 border-gray-600';
      default: return 'bg-gray-800 text-gray-400 border-gray-700';
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold text-gray-100">{data.campaignName}</h3>
          <Badge className={getStatusColor(data.status)}>{data.status}</Badge>
        </div>
        <Badge variant="outline" className="text-xs">{data.platform}</Badge>
      </div>

      <Separator className="bg-gray-700" />

      {/* Performance Metrics */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-800 border border-lego-blue/20 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <Users className="h-4 w-4 text-lego-blue" />
            <span className="text-xs text-gray-400">Impressions</span>
          </div>
          <p className="text-xl font-mono font-semibold text-gray-100">{data.impressions.toLocaleString()}</p>
        </div>

        <div className="bg-gray-800 border border-lego-blue/20 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <MousePointerClick className="h-4 w-4 text-lego-blue" />
            <span className="text-xs text-gray-400">Clicks</span>
          </div>
          <p className="text-xl font-mono font-semibold text-gray-100">{data.clicks.toLocaleString()}</p>
        </div>

        <div className="bg-gray-800 border border-lego-green/20 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="h-4 w-4 text-lego-green" />
            <span className="text-xs text-gray-400">Conversions</span>
          </div>
          <p className="text-xl font-mono font-semibold text-lego-green">{data.conversions.toLocaleString()}</p>
        </div>

        <div className="bg-gray-800 border border-lego-green/20 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="h-4 w-4 text-lego-green" />
            <span className="text-xs text-gray-400">Revenue</span>
          </div>
          <p className="text-xl font-mono font-semibold text-lego-green">${data.revenue.toLocaleString()}</p>
        </div>
      </div>

      <Separator className="bg-gray-700" />

      {/* Calculated Metrics */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
        <h4 className="text-sm font-semibold text-gray-300 mb-3">Performance Analysis</h4>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">Click-Through Rate (CTR):</span>
            <span className="font-mono text-lego-blue">{ctr}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Conversion Rate:</span>
            <span className="font-mono text-lego-green">{conversionRate}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Cost Per Click:</span>
            <span className="font-mono text-gray-100">${(data.spent / data.clicks).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Cost Per Conversion:</span>
            <span className="font-mono text-gray-100">${(data.spent / data.conversions).toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Financial Summary */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
        <h4 className="text-sm font-semibold text-gray-300 mb-3">Financial Summary</h4>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">Amount Spent:</span>
            <span className="font-mono text-gray-100">${data.spent.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Revenue Generated:</span>
            <span className="font-mono text-lego-green">${data.revenue.toLocaleString()}</span>
          </div>
          <Separator className="bg-gray-700" />
          <div className="flex justify-between">
            <span className="text-gray-400">Return on Investment:</span>
            <span className={`font-mono font-semibold ${parseFloat(roi) >= 0 ? 'text-lego-green' : 'text-lego-red'}`}>
              {roi}%
            </span>
          </div>
        </div>
      </div>

      {/* Campaign Period */}
      <div className="text-xs text-gray-400">
        <p>Started: {new Date(data.startDate).toLocaleDateString()}</p>
        {data.endDate && <p>Ended: {new Date(data.endDate).toLocaleDateString()}</p>}
      </div>
    </div>
  );
}
