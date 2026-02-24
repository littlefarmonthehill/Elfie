import { useState, useEffect, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, CheckCircle2, AlertTriangle, ExternalLink,
  Pencil, X, ChevronDown, ChevronUp,
} from "lucide-react";

export type Rate = {
  id: string;
  carrier: string;
  service: string;
  rate: number;
  deliveryDays: number | null;
};

type ShipAddress = {
  name: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
};

type OrderShippingSummary = {
  orderId: string;
  orderNumber: string;
  marketplace: string | null;
  requestedService: string | null;
  savedWeight: number | null;
  savedWeightUnits: string;
  weightEstimateGrams: number;
  weightEstimateOz: number;
  address: ShipAddress;
};

export type OrderItem = {
  id: string;
  sku: string | null;
  bricklinkPartNumber: string | null;
  name: string;
  quantity: number;
  colorName: string | null;
  condition: string | null;
  binName: string | null;
};

export type ShippingReadyState = {
  shipmentId: string;
  rateId: string;
  weight: string;
  weightUnits: string;
  selectedRate: Rate;
};

export type PurchasedLabelResult = {
  trackingNumber: string;
  labelUrl?: string;
  carrier?: string;
  service?: string;
  rate?: number;
};

type Props = {
  orderId: string;
  isTestMode: boolean;
  orderItems?: OrderItem[];
  onReadyChange: (orderId: string, state: ShippingReadyState | null) => void;
  purchasedLabel?: PurchasedLabelResult;
};

const TEST_FROM_ADDRESS = {
  name: "EasyPost Test", company: "EasyPost",
  street1: "417 Montgomery Street", street2: "Floor 5",
  city: "San Francisco", state: "CA", zip: "94104",
  country: "US", phone: "4155559999", email: "test@easypost.com",
};

const PROD_FROM_ADDRESS = {
  name: "PlanetBrick", company: "PlanetBrick",
  street1: "PO Box 202", city: "Lanesboro",
  state: "MN", zip: "55949", country: "US",
  phone: "5072670202", email: "shipping@planetbrick.com",
};

export default function InlineShippingCard({
  orderId, isTestMode, orderItems = [], onReadyChange, purchasedLabel,
}: Props) {
  const { toast } = useToast();

  const [summary, setSummary] = useState<OrderShippingSummary | null>(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState(true);

  const [weight, setWeight] = useState<string>("");
  const [weightUnits, setWeightUnits] = useState<string>("oz");

  const [addressStatus, setAddressStatus] = useState<"loading" | "valid" | "invalid" | "unknown">("unknown");
  const [addressErrors, setAddressErrors] = useState<string[]>([]);
  const [editingAddress, setEditingAddress] = useState(false);
  const [editAddress, setEditAddress] = useState<ShipAddress>({ name: "", street1: "", street2: "", city: "", state: "", zip: "", country: "US" });
  const [currentAddress, setCurrentAddress] = useState<ShipAddress | null>(null);

  const [shipmentId, setShipmentId] = useState<string | null>(null);
  const [rates, setRates] = useState<Rate[]>([]);
  const [selectedRateId, setSelectedRateId] = useState<string | null>(null);
  const [isLoadingRates, setIsLoadingRates] = useState(false);
  const [ratesError, setRatesError] = useState<string | null>(null);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const hasUserChangedWeight = useRef(false);

  // Auto-refresh rates when weight or units change (debounced, user-initiated only)
  useEffect(() => {
    if (!hasUserChangedWeight.current || !currentAddress || weight === "") return;
    const timer = setTimeout(() => {
      fetchRates(currentAddress, weight, weightUnits);
    }, 700);
    return () => clearTimeout(timer);
  }, [weight, weightUnits]);

  // Notify parent whenever ready state changes
  useEffect(() => {
    const selectedRate = rates.find(r => r.id === selectedRateId);
    if (shipmentId && selectedRateId && selectedRate) {
      onReadyChange(orderId, { shipmentId, rateId: selectedRateId, weight, weightUnits, selectedRate });
    } else {
      onReadyChange(orderId, null);
    }
  }, [shipmentId, selectedRateId, weight, weightUnits, rates]);

  useEffect(() => { loadSummary(); }, [orderId]);

  const loadSummary = async () => {
    setIsLoadingSummary(true);
    try {
      const data: OrderShippingSummary = await fetch(
        `/api/fulfillment/order-shipping/${encodeURIComponent(orderId)}`
      ).then(r => r.json());
      setSummary(data);
      setCurrentAddress(data.address);
      setEditAddress(data.address);
      const w = data.savedWeight != null ? String(data.savedWeight)
        : data.weightEstimateOz > 0 ? String(data.weightEstimateOz) : "";
      const wu = data.savedWeight != null ? data.savedWeightUnits : "oz";
      setWeight(w);
      setWeightUnits(wu);
      validateAddress(data.address);
      fetchRates(data.address, w, wu, data.requestedService);
    } catch (e: any) {
      toast({ title: "Load Failed", description: e.message, variant: "destructive" });
    } finally {
      setIsLoadingSummary(false);
    }
  };

  const validateAddress = async (address: ShipAddress) => {
    setAddressStatus("loading");
    try {
      const result = await fetch("/api/fulfillment/validate-address", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      }).then(r => r.json());
      setAddressStatus(result.valid ? "valid" : "invalid");
      if (!result.valid) setAddressErrors(result.errors || ["Address validation failed"]);
    } catch { setAddressStatus("unknown"); }
  };

  const fetchRates = async (
    address: ShipAddress, w: string, wu: string,
    requestedService: string | null = summary?.requestedService ?? null
  ) => {
    setIsLoadingRates(true);
    setRatesError(null);
    setRates([]);
    setSelectedRateId(null);
    setShipmentId(null);
    try {
      const fromAddress = isTestMode ? TEST_FROM_ADDRESS : PROD_FROM_ADDRESS;
      const result: any = await apiRequest("POST", "/api/shipments/create", {
        orderId, itemIdsToShip: [], fromAddress,
        parcel: { length: 6, width: 4, height: 2, weight: w !== "" ? Number(w) : 16, weightUnits: wu },
        overrideToAddress: address,
      });
      setShipmentId(result.shipmentId);
      const sorted: Rate[] = [...(result.rates || [])].sort((a, b) => a.rate - b.rate);
      setRates(sorted);
      if (sorted.length > 0) {
        if (requestedService) {
          const reqLower = requestedService.toLowerCase();
          const match = sorted.find(r =>
            r.service.toLowerCase().includes(reqLower) || reqLower.includes(r.service.toLowerCase())
          );
          setSelectedRateId(match?.id || sorted[0].id);
        } else {
          setSelectedRateId(sorted[0].id);
        }
      }
    } catch (e: any) {
      setRatesError(e.message || "Failed to fetch rates");
    } finally {
      setIsLoadingRates(false);
    }
  };

  const handleSaveAddress = () => {
    setCurrentAddress(editAddress);
    setEditingAddress(false);
    validateAddress(editAddress);
    fetchRates(editAddress, weight, weightUnits);
  };

  const selectedRate = rates.find(r => r.id === selectedRateId);
  const isCustomerPick = (rate: Rate) =>
    summary?.requestedService
      ? rate.service.toLowerCase().includes(summary.requestedService.toLowerCase()) ||
        summary.requestedService.toLowerCase().includes(rate.service.toLowerCase())
      : false;
  const isReady = !!(shipmentId && selectedRateId && !isLoadingRates && !ratesError);

  // ── Loading skeleton ──
  if (isLoadingSummary) {
    return (
      <div className="border border-gray-700 rounded-lg p-3 flex items-center gap-2 bg-gray-800/30">
        <Loader2 className="w-4 h-4 animate-spin text-blue-400 shrink-0" />
        <span className="text-xs text-gray-400">Loading shipping info...</span>
      </div>
    );
  }

  if (!summary) return null;

  // ── Purchased state ──
  if (purchasedLabel) {
    return (
      <div className="border border-green-500/40 rounded-lg p-3 bg-green-500/10 flex items-center gap-3 flex-wrap">
        <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-bold text-green-300">#{summary.orderNumber}</span>
          <span className="text-[11px] text-gray-400 ml-2">
            {[purchasedLabel.carrier, purchasedLabel.service].filter(Boolean).join(" ")}
            {purchasedLabel.rate != null && ` · $${purchasedLabel.rate.toFixed(2)}`}
          </span>
          <p className="text-[10px] font-mono text-gray-300 mt-0.5">{purchasedLabel.trackingNumber}</p>
        </div>
        {purchasedLabel.labelUrl && (
          <Button asChild variant="outline" size="sm" data-testid={`button-download-label-${orderId}`}>
            <a href={purchasedLabel.labelUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />Label
            </a>
          </Button>
        )}
      </div>
    );
  }

  // ── Configuration card ──
  return (
    <div
      className="border rounded-lg overflow-hidden bg-gray-800/30"
      style={{ borderColor: isReady ? "rgb(34 197 94 / 0.4)" : addressStatus === "invalid" ? "rgb(234 179 8 / 0.3)" : "rgb(55 65 81)" }}
      data-testid={`shipping-card-${orderId}`}
    >
      <div className="px-3 pt-2.5 pb-2 space-y-2">

        {/* ── Row 1: Identity ── */}
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold text-white font-mono">#{summary.orderNumber}</span>
        </div>

        {/* ── Row 2: Weight + Preferred service ── */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Weight */}
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[10px] text-gray-500 uppercase tracking-wide font-bold">Wt</span>
            <Input
              type="number" step="0.1" min="0" value={weight}
              onChange={e => { hasUserChangedWeight.current = true; setWeight(e.target.value); }}
              placeholder="oz" className="h-7 w-14 text-xs bg-gray-900 border-gray-600 px-1.5"
              data-testid={`input-weight-${orderId}`}
            />
            <Select value={weightUnits} onValueChange={v => { hasUserChangedWeight.current = true; setWeightUnits(v); }}>
              <SelectTrigger className="h-7 w-14 text-xs bg-gray-900 border-gray-600 px-1.5" data-testid={`select-weight-units-${orderId}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="oz">oz</SelectItem>
                <SelectItem value="lb">lb</SelectItem>
                <SelectItem value="g">g</SelectItem>
                <SelectItem value="kg">kg</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Divider + Preferred service */}
          {summary.requestedService ? (
            <div className="flex items-center gap-1 min-w-0 flex-1">
              <span className="text-[10px] text-gray-600 shrink-0">|</span>
              <span className="text-[10px] text-gray-500 shrink-0">Preferred:</span>
              <span className="text-[10px] text-blue-300 font-medium truncate">{summary.requestedService}</span>
            </div>
          ) : (
            <span className="text-[10px] text-gray-600 italic">No service preference</span>
          )}
        </div>

        {/* ── Row 3: Service selector (full-width grid, price right) ── */}
        {isLoadingRates ? (
          <div className="flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400 shrink-0" />
            <span className="text-xs text-gray-400">Fetching rates...</span>
          </div>
        ) : ratesError ? (
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
            <span className="text-xs text-red-400 flex-1 min-w-0 truncate">{ratesError}</span>
            <Button size="sm" variant="ghost" onClick={() => fetchRates(currentAddress!, weight, weightUnits)}>
              Retry
            </Button>
          </div>
        ) : rates.length > 0 ? (
          /* Grid: select fills available space, price is fixed width */
          <div className="grid gap-1.5" style={{ gridTemplateColumns: "1fr auto" }}>
            <div className="min-w-0 overflow-hidden">
              <Select value={selectedRateId ?? ""} onValueChange={setSelectedRateId}>
                <SelectTrigger
                  className="h-8 w-full text-xs bg-gray-900 border-gray-600 truncate"
                  data-testid={`select-service-${orderId}`}
                >
                  <SelectValue placeholder="Select service..." />
                </SelectTrigger>
                <SelectContent className="max-w-[min(320px,90vw)]">
                  {rates.map((rate, idx) => {
                    const cPick = isCustomerPick(rate);
                    return (
                      <SelectItem key={rate.id} value={rate.id}>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium text-xs">{rate.carrier} {rate.service}</span>
                          <span className="text-gray-400 text-xs">${rate.rate.toFixed(2)}{rate.deliveryDays != null && ` · ${rate.deliveryDays}d`}</span>
                          {cPick && <span className="text-blue-400 text-[10px]">★</span>}
                          {idx === 0 && !cPick && <span className="text-green-400 text-[10px]">Low</span>}
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            {selectedRate ? (
              <div className="flex flex-col items-end justify-center shrink-0">
                <span className="text-sm font-bold text-white leading-tight">${selectedRate.rate.toFixed(2)}</span>
                {selectedRate.deliveryDays != null && (
                  <span className="text-[10px] text-gray-500">{selectedRate.deliveryDays}d</span>
                )}
              </div>
            ) : <div />}
          </div>
        ) : null}

        {/* ── Row 4: Details toggle ── */}
        <button
          className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-300 transition-colors w-full"
          onClick={() => setDetailsOpen(v => !v)}
          data-testid={`button-toggle-details-${orderId}`}
        >
          {detailsOpen ? <ChevronUp className="w-3 h-3 shrink-0" /> : <ChevronDown className="w-3 h-3 shrink-0" />}
          <span>
            {detailsOpen ? "Hide details" : `Show details`}
            {orderItems.length > 0 && !detailsOpen && ` · ${orderItems.length} item${orderItems.length !== 1 ? "s" : ""}`}
          </span>
          {addressStatus === "invalid" && !detailsOpen && (
            <span className="ml-1 text-yellow-400">· Address needs attention</span>
          )}
        </button>
      </div>

      {/* ── Collapsible details ── */}
      {detailsOpen && (
        <div className="border-t border-gray-700 bg-gray-900/40 divide-y divide-gray-800">

          {/* Address section */}
          <div className="px-3 py-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Ship To</span>
              {!editingAddress && (
                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]"
                  onClick={() => { setEditAddress(currentAddress!); setEditingAddress(true); }}
                  data-testid={`button-edit-address-${orderId}`}
                >
                  <Pencil className="w-2.5 h-2.5 mr-1" />Edit
                </Button>
              )}
            </div>

            {!editingAddress ? (
              <div className="text-xs text-gray-300 leading-snug">
                {currentAddress?.name && <div className="font-medium">{currentAddress.name}</div>}
                {currentAddress?.street1 && <div>{currentAddress.street1}</div>}
                {currentAddress?.street2 && <div>{currentAddress.street2}</div>}
                <div>{[currentAddress?.city, currentAddress?.state, currentAddress?.zip].filter(Boolean).join(", ")}</div>
                {addressStatus === "invalid" && addressErrors.length > 0 && (
                  <div className="mt-1 text-[10px] text-yellow-400">{addressErrors[0]}</div>
                )}
              </div>
            ) : (
              <div className="space-y-1.5 bg-gray-800/60 rounded-md p-2">
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { label: "Name", field: "name", span: 2 },
                    { label: "Street 1", field: "street1", span: 2 },
                    { label: "Street 2", field: "street2", span: 2 },
                    { label: "City", field: "city", span: 1 },
                    { label: "State", field: "state", span: 1 },
                    { label: "ZIP", field: "zip", span: 1 },
                    { label: "Country", field: "country", span: 1 },
                  ].map(({ label, field, span }) => (
                    <div key={field} className={span === 2 ? "col-span-2" : ""}>
                      <Label className="text-[10px] text-gray-500">{label}</Label>
                      <Input
                        value={(editAddress as any)[field] || ""}
                        onChange={e => setEditAddress(prev => ({ ...prev, [field]: e.target.value }))}
                        className="h-7 text-xs bg-gray-900 border-gray-600"
                        data-testid={`input-address-${field}-${orderId}`}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex gap-1.5 justify-end">
                  <Button size="sm" variant="ghost" onClick={() => setEditingAddress(false)}>
                    <X className="w-3 h-3 mr-1" />Cancel
                  </Button>
                  <Button size="sm" onClick={handleSaveAddress} data-testid={`button-save-address-${orderId}`}>
                    Save & Re-validate
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Order items section */}
          {orderItems.length > 0 && (
            <div className="px-3 py-2.5 space-y-1">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">
                Order Items ({orderItems.length})
              </span>
              <div className="space-y-1 mt-1">
                {orderItems.map(item => (
                  <div key={item.id} className="flex items-start gap-2 py-0.5">
                    <span className="text-[10px] font-bold text-gray-400 shrink-0 mt-0.5">×{item.quantity}</span>
                    <div className="min-w-0">
                      <p className="text-[11px] text-gray-200 leading-tight truncate">
                        {item.bricklinkPartNumber && <span className="text-gray-400">{item.bricklinkPartNumber} · </span>}
                        {item.name}
                      </p>
                      {(item.colorName || item.condition || item.binName) && (
                        <p className="text-[10px] text-gray-500 leading-tight">
                          {[item.colorName, item.condition, item.binName && `Bin: ${item.binName}`].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
