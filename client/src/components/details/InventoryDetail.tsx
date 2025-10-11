import { Package, DollarSign, Weight, Calendar, ExternalLink, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface InventoryDetailProps {
  data: {
    partNumber: string;
    name: string;
    category: string;
    color: string;
    quantity: number;
    condition: 'New' | 'Used';
    costPerUnit: number;
    pricePerUnit: number;
    weight: number;
    dateAdded: string;
    bricklinkUrl?: string;
    imageUrl?: string;
  };
}

export default function InventoryDetail({ data }: InventoryDetailProps) {
  const totalCost = data.quantity * data.costPerUnit;
  const totalValue = data.quantity * data.pricePerUnit;
  const profit = totalValue - totalCost;
  const profitMargin = ((profit / totalValue) * 100).toFixed(1);

  return (
    <div className="space-y-2.5">
      {/* Header with Image and Full Item Info */}
      <div className="bg-gradient-to-r from-lego-blue/15 via-lego-blue/5 to-transparent border border-lego-blue/30 rounded-lg p-2.5">
        <div className="flex items-start gap-3">
          {data.imageUrl && (
            <div className="flex-shrink-0 w-20 h-20 bg-gray-900 rounded-lg border border-gray-700 p-1">
              <img 
                src={data.imageUrl} 
                alt={data.name}
                className="w-full h-full object-contain"
              />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <h3 className="text-[10px] font-black text-lego-blue font-mono">{data.partNumber}</h3>
              <Badge className={`text-[8px] h-3.5 px-1.5 font-bold ${
                data.condition === 'New' 
                  ? 'bg-lego-green/20 text-lego-green border-lego-green/40' 
                  : 'bg-lego-orange/20 text-lego-orange border-lego-orange/40'
              }`}>
                {data.condition}
              </Badge>
            </div>
            <p className="text-[10px] text-white font-medium mb-1.5 leading-tight" title={data.name}>
              {data.name}
            </p>
            <div className="flex items-center gap-1.5">
              <Badge className="bg-gray-800 text-gray-300 border-gray-700 text-[8px] h-3.5 px-1.5 font-medium">
                {data.category}
              </Badge>
              <Badge className="bg-gray-800 text-gray-300 border-gray-700 text-[8px] h-3.5 px-1.5 font-medium">
                {data.color}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Key Metrics Grid - Colorful */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-gradient-to-br from-lego-blue/20 to-lego-blue/5 border border-lego-blue/40 rounded-lg p-2 text-center">
          <Package className="h-3.5 w-3.5 text-lego-blue mx-auto mb-0.5" />
          <p className="text-[9px] text-gray-400 font-bold mb-0.5">QUANTITY</p>
          <p className="text-xl font-black font-mono text-lego-blue leading-none">{data.quantity}</p>
        </div>

        <div className="bg-gradient-to-br from-lego-green/20 to-lego-green/5 border border-lego-green/40 rounded-lg p-2 text-center">
          <DollarSign className="h-3.5 w-3.5 text-lego-green mx-auto mb-0.5" />
          <p className="text-[9px] text-gray-400 font-bold mb-0.5">UNIT PRICE</p>
          <p className="text-xl font-black font-mono text-lego-green leading-none">${data.pricePerUnit.toFixed(2)}</p>
        </div>

        <div className="bg-gradient-to-br from-lego-yellow/20 to-lego-yellow/5 border border-lego-yellow/40 rounded-lg p-2 text-center">
          <Weight className="h-3.5 w-3.5 text-lego-yellow mx-auto mb-0.5" />
          <p className="text-[9px] text-gray-400 font-bold mb-0.5">WEIGHT</p>
          <p className="text-xl font-black font-mono text-lego-yellow leading-none">{data.weight}<span className="text-xs">oz</span></p>
        </div>
      </div>

      {/* Financial Grid - Compact */}
      <div className="grid grid-cols-2 gap-2">
        {/* Cost Breakdown */}
        <div className="bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-700 rounded-lg p-2">
          <p className="text-[9px] font-bold text-gray-400 mb-1.5">COST ANALYSIS</p>
          <div className="space-y-1 text-[10px]">
            <div className="flex justify-between">
              <span className="text-gray-400">Unit Cost</span>
              <span className="font-mono text-white">${data.costPerUnit.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Total Cost</span>
              <span className="font-mono text-lego-red">${totalCost.toFixed(2)}</span>
            </div>
            <div className="flex justify-between pt-0.5 border-t border-gray-700">
              <span className="text-gray-400">Total Value</span>
              <span className="font-mono font-bold text-lego-green">${totalValue.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Profit Display */}
        <div className="bg-gradient-to-br from-lego-green/20 to-lego-green/5 border-2 border-lego-green/50 rounded-lg p-2 flex flex-col justify-center">
          <div className="flex items-center justify-center gap-1 mb-0.5">
            <TrendingUp className="h-3 w-3 text-lego-green" />
            <span className="text-[9px] font-bold text-gray-400">PROFIT</span>
          </div>
          <p className="text-2xl font-black font-mono text-lego-green text-center leading-none mb-0.5">
            ${profit.toFixed(2)}
          </p>
          <p className="text-[10px] font-bold text-lego-green/70 text-center">
            {profitMargin}% margin
          </p>
        </div>
      </div>

      {/* Footer - Compact Info */}
      <div className="flex items-center justify-between bg-gray-800 border border-gray-700 rounded-lg p-2">
        <div className="flex items-center gap-1.5">
          <Calendar className="h-3 w-3 text-gray-400" />
          <span className="text-[9px] text-gray-400">
            Added <span className="font-bold text-white">{new Date(data.dateAdded).toLocaleDateString()}</span>
          </span>
        </div>
        {data.bricklinkUrl && (
          <a 
            href={data.bricklinkUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[9px] font-bold text-lego-blue hover:text-lego-blue/80 transition-colors"
            data-testid="link-bricklink"
          >
            VIEW ON BRICKLINK
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}
