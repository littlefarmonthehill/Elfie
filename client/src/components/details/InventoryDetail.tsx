import { Package, DollarSign, Weight, Calendar, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-4">
        {data.imageUrl && (
          <img 
            src={data.imageUrl} 
            alt={data.name}
            className="w-24 h-24 object-contain bg-gray-800 rounded-lg"
          />
        )}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-lg font-semibold text-gray-100">{data.partNumber}</h3>
            <Badge variant="outline" className="text-xs">{data.condition}</Badge>
          </div>
          <p className="text-sm text-gray-300 mb-2">{data.name}</p>
          <div className="flex gap-2">
            <Badge variant="secondary" className="text-xs">{data.category}</Badge>
            <Badge variant="secondary" className="text-xs">{data.color}</Badge>
          </div>
        </div>
      </div>

      <Separator className="bg-gray-700" />

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-800 border border-lego-blue/20 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <Package className="h-4 w-4 text-lego-blue" />
            <span className="text-xs text-gray-400">Quantity</span>
          </div>
          <p className="text-xl font-mono font-semibold text-gray-100">{data.quantity}</p>
        </div>

        <div className="bg-gray-800 border border-lego-blue/20 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <Weight className="h-4 w-4 text-lego-blue" />
            <span className="text-xs text-gray-400">Weight</span>
          </div>
          <p className="text-xl font-mono font-semibold text-gray-100">{data.weight} oz</p>
        </div>

        <div className="bg-gray-800 border border-lego-green/20 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="h-4 w-4 text-lego-green" />
            <span className="text-xs text-gray-400">Unit Price</span>
          </div>
          <p className="text-xl font-mono font-semibold text-lego-green">${data.pricePerUnit.toFixed(2)}</p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="h-4 w-4 text-gray-400" />
            <span className="text-xs text-gray-400">Unit Cost</span>
          </div>
          <p className="text-xl font-mono font-semibold text-gray-100">${data.costPerUnit.toFixed(2)}</p>
        </div>
      </div>

      <Separator className="bg-gray-700" />

      {/* Financial Summary */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-gray-300 mb-3">Financial Summary</h4>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Total Cost:</span>
            <span className="font-mono text-gray-100">${totalCost.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Total Value:</span>
            <span className="font-mono text-lego-green">${totalValue.toFixed(2)}</span>
          </div>
          <Separator className="bg-gray-700" />
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Potential Profit:</span>
            <span className="font-mono text-lego-green">${profit.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Profit Margin:</span>
            <span className="font-mono text-lego-green">{profitMargin}%</span>
          </div>
        </div>
      </div>

      {/* Additional Info */}
      <div className="flex items-center justify-between text-xs text-gray-400">
        <div className="flex items-center gap-1">
          <Calendar className="h-3 w-3" />
          <span>Added {new Date(data.dateAdded).toLocaleDateString()}</span>
        </div>
        {data.bricklinkUrl && (
          <a 
            href={data.bricklinkUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-lego-blue hover:underline"
            data-testid="link-bricklink"
          >
            View on BrickLink
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}
