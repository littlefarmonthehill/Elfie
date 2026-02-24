import { useState, useEffect } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, CheckCircle2, AlertTriangle, Package,
  ExternalLink, Pencil, X, RefreshCw, Truck, ChevronDown, ChevronUp, Weight,
} from "lucide-react";

type Rate = {
  id: string;
  carrier: string;
  service: string;
  rate: number;
  deliveryDays: number | null;
  deliveryDate?: string;
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

type Props = {
  orderId: string;
  isTestMode: boolean;
  onShipped?: () => void;
};

const TEST_FROM_ADDRESS = {
  name: "EasyPost Test",
  company: "EasyPost",
  street1: "417 Montgomery Street",
  street2: "Floor 5",
  city: "San Francisco",
  state: "CA",
  zip: "94104",
  country: "US",
  phone: "4155559999",
  email: "test@easypost.com",
};

const PROD_FROM_ADDRESS = {
  name: "PlanetBrick",
  company: "PlanetBrick",
  street1: "PO Box 202",
  city: "Lanesboro",
  state: "MN",
  zip: "55949",
  country: "US",
  phone: "5072670202",
  email: "shipping@planetbrick.com",
};

export default function InlineShippingCard({ orderId, isTestMode, onShipped }: Props) {
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

  const [isPurchasing, setIsPurchasing] = useState(false);
  const [purchasedLabel, setPurchasedLabel] = useState<{ trackingNumber: string; labelUrl?: string } | null>(null);

  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    loadSummary();
  }, [orderId]);

  const loadSummary = async () => {
    setIsLoadingSummary(true);
    try {
      const data: OrderShippingSummary = await fetch(
        `/api/fulfillment/order-shipping/${encodeURIComponent(orderId)}`
      ).then((r) => r.json());

      setSummary(data);
      setCurrentAddress(data.address);
      setEditAddress(data.address);

      const w = data.savedWeight != null
        ? String(data.savedWeight)
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
    setAddressErrors([]);
    try {
      const result = await fetch("/api/fulfillment/validate-address", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      }).then((r) => r.json());

      if (result.valid) {
        setAddressStatus("valid");
      } else {
        setAddressStatus("invalid");
        setAddressErrors(result.errors || ["Address validation failed"]);
      }
    } catch {
      setAddressStatus("unknown");
    }
  };

  const fetchRates = async (
    address: ShipAddress,
    w: string,
    wu: string,
    requestedService: string | null = summary?.requestedService ?? null
  ) => {
    setIsLoadingRates(true);
    setRatesError(null);
    setRates([]);
    setSelectedRateId(null);
    try {
      const fromAddress = isTestMode ? TEST_FROM_ADDRESS : PROD_FROM_ADDRESS;
      const weightNum = w !== "" ? Number(w) : 16;

      const result: any = await apiRequest("POST", "/api/shipments/create", {
        orderId,
        itemIdsToShip: [],
        fromAddress,
        parcel: {
          length: 6,
          width: 4,
          height: 2,
          weight: weightNum,
          weightUnits: wu,
        },
        overrideToAddress: address,
      });

      setShipmentId(result.shipmentId);
      const sorted: Rate[] = [...(result.rates || [])].sort((a, b) => a.rate - b.rate);
      setRates(sorted);

      if (sorted.length > 0) {
        if (requestedService) {
          const reqLower = requestedService.toLowerCase();
          const match = sorted.find(
            (r) =>
              r.service.toLowerCase().includes(reqLower) ||
              reqLower.includes(r.service.toLowerCase())
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

  const handleRefreshRates = () => {
    if (currentAddress) fetchRates(currentAddress, weight, weightUnits);
  };

  const handleSaveAddress = () => {
    setCurrentAddress(editAddress);
    setEditingAddress(false);
    validateAddress(editAddress);
    fetchRates(editAddress, weight, weightUnits);
  };

  const handlePurchaseLabel = async () => {
    if (!selectedRateId || !shipmentId) return;
    setIsPurchasing(true);
    try {
      if (weight !== "") {
        await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ weight: Number(weight), weightUnits }),
        });
      }

      const result: any = await apiRequest("POST", "/api/shipments/purchase", {
        orderId,
        shipmentId,
        rateId: selectedRateId,
      });

      setPurchasedLabel({
        trackingNumber: result.shipment?.trackingNumber || result.trackingNumber || "",
        labelUrl: result.shipment?.labelUrl || result.labelUrl,
      });

      queryClient.invalidateQueries({ queryKey: ["/api/fulfillment"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fulfillment/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders/shipped"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });

      onShipped?.();
      toast({ title: "Label Purchased", description: "Shipping label generated successfully!" });
    } catch (e: any) {
      toast({ title: "Purchase Failed", description: e.message, variant: "destructive" });
    } finally {
      setIsPurchasing(false);
    }
  };

  const selectedRate = rates.find((r) => r.id === selectedRateId);
  const isCustomerPick = (rate: Rate) =>
    summary?.requestedService
      ? rate.service.toLowerCase().includes(summary.requestedService.toLowerCase()) ||
        summary.requestedService.toLowerCase().includes(rate.service.toLowerCase())
      : false;

  if (isLoadingSummary) {
    return (
      <div className="border border-gray-700 rounded-lg p-3 flex items-center gap-2 bg-gray-800/30">
        <Loader2 className="w-4 h-4 animate-spin text-blue-400 shrink-0" />
        <span className="text-xs text-gray-400">Loading...</span>
      </div>
    );
  }

  if (!summary) return null;

  if (purchasedLabel) {
    return (
      <div className="border border-green-500/40 rounded-lg p-3 bg-green-500/10 space-y-1.5">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
          <span className="text-sm font-bold text-green-300">Shipped — #{summary.orderNumber}</span>
        </div>
        <p className="text-[10px] text-gray-400 font-mono pl-6">{purchasedLabel.trackingNumber}</p>
        {purchasedLabel.labelUrl && (
          <div className="pl-6">
            <Button asChild variant="outline" size="sm" data-testid={`button-download-label-${orderId}`}>
              <a href={purchasedLabel.labelUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                Download Label
              </a>
            </Button>
          </div>
        )}
      </div>
    );
  }

  const hasAddressIssue = addressStatus === "invalid";
  const hasRatesError = !!ratesError;

  return (
    <div
      className="border border-gray-700 rounded-lg overflow-hidden bg-gray-800/30"
      data-testid={`shipping-card-${orderId}`}
    >
      {/* ── Main header row ── */}
      <div className="px-3 py-2.5 space-y-2">

        {/* Row 1: Order identity */}
        <div className="flex items-center gap-2 flex-wrap">
          <Truck className="w-3.5 h-3.5 text-purple-400 shrink-0" />
          <span className="text-sm font-bold text-white">#{summary.orderNumber}</span>
          {summary.marketplace && (
            <Badge variant="secondary" className="text-[10px]">{summary.marketplace}</Badge>
          )}
          {/* Address status dot */}
          {addressStatus === "loading" && <Loader2 className="w-3 h-3 animate-spin text-gray-500 ml-auto" />}
          {addressStatus === "valid" && <CheckCircle2 className="w-3 h-3 text-green-400 ml-auto" />}
          {addressStatus === "invalid" && (
            <span className="ml-auto flex items-center gap-1 text-[10px] text-yellow-400">
              <AlertTriangle className="w-3 h-3" />
              Address issue
            </span>
          )}
          {/* Customer requested service note */}
          {summary.requestedService && (
            <span className="text-[10px] text-gray-500 italic ml-auto">
              Requested: {summary.requestedService}
            </span>
          )}
        </div>

        {/* Row 2: Name + address one-liner */}
        {currentAddress && (
          <div className="text-[11px] text-gray-400 pl-5 leading-tight">
            <span className="text-gray-300 font-medium">{currentAddress.name}</span>
            {currentAddress.street1 && <span> · {currentAddress.street1}</span>}
            {(currentAddress.city || currentAddress.state) && (
              <span>
                {" · "}
                {[currentAddress.city, currentAddress.state, currentAddress.zip].filter(Boolean).join(" ")}
              </span>
            )}
          </div>
        )}

        {/* Row 3: Service dropdown + price + Ship button */}
        <div className="flex items-center gap-2 pl-5">
          {isLoadingRates ? (
            <div className="flex items-center gap-2 flex-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
              <span className="text-xs text-gray-400">Fetching rates...</span>
            </div>
          ) : hasRatesError ? (
            <div className="flex items-center gap-2 flex-1">
              <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
              <span className="text-xs text-red-400 flex-1 min-w-0 truncate">{ratesError}</span>
              <Button size="sm" variant="ghost" className="h-7 text-xs shrink-0" onClick={handleRefreshRates}>
                Retry
              </Button>
            </div>
          ) : rates.length > 0 ? (
            <>
              <Select value={selectedRateId ?? ""} onValueChange={setSelectedRateId}>
                <SelectTrigger
                  className="h-8 flex-1 min-w-0 text-xs bg-gray-900 border-gray-600"
                  data-testid={`select-service-${orderId}`}
                >
                  <SelectValue placeholder="Select service..." />
                </SelectTrigger>
                <SelectContent>
                  {rates.map((rate, idx) => {
                    const customerPick = isCustomerPick(rate);
                    const isLowest = idx === 0;
                    return (
                      <SelectItem key={rate.id} value={rate.id}>
                        <span className="flex items-center gap-2">
                          <span className="font-medium">
                            {rate.carrier} {rate.service}
                          </span>
                          <span className="text-gray-400">
                            ${rate.rate.toFixed(2)}
                            {rate.deliveryDays != null && ` · ${rate.deliveryDays}d`}
                          </span>
                          {customerPick && (
                            <span className="text-blue-400 text-[10px]">★ Requested</span>
                          )}
                          {isLowest && !customerPick && (
                            <span className="text-green-400 text-[10px]">Lowest</span>
                          )}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>

              {/* Selected rate price */}
              {selectedRate && (
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold text-white">${selectedRate.rate.toFixed(2)}</div>
                  {selectedRate.deliveryDays != null && (
                    <div className="text-[10px] text-gray-500">{selectedRate.deliveryDays}d</div>
                  )}
                </div>
              )}

              <Button
                onClick={handlePurchaseLabel}
                disabled={!selectedRateId || isPurchasing}
                size="sm"
                className="bg-green-600 hover:bg-green-500 shrink-0"
                data-testid={`button-purchase-label-${orderId}`}
              >
                {isPurchasing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <>
                    <Package className="w-3.5 h-3.5 mr-1.5" />
                    Ship
                  </>
                )}
              </Button>
            </>
          ) : null}
        </div>

        {/* Row 4: Details toggle */}
        <button
          className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-300 transition-colors pl-5"
          onClick={() => setDetailsOpen((v) => !v)}
          data-testid={`button-toggle-details-${orderId}`}
        >
          {detailsOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {detailsOpen ? "Hide details" : "Show details"}
          {hasAddressIssue && !detailsOpen && (
            <span className="ml-1 text-yellow-400">· Address needs attention</span>
          )}
        </button>
      </div>

      {/* ── Collapsible details ── */}
      {detailsOpen && (
        <div className="border-t border-gray-700 px-3 py-3 space-y-3 bg-gray-900/40">

          {/* Address */}
          {!editingAddress ? (
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Ship To</span>
                  {addressStatus === "loading" && <Loader2 className="w-3 h-3 animate-spin text-gray-400" />}
                  {addressStatus === "valid" && <CheckCircle2 className="w-3 h-3 text-green-400" />}
                  {addressStatus === "invalid" && <AlertTriangle className="w-3 h-3 text-yellow-400" />}
                </div>
                <div className="text-xs text-gray-200 leading-snug">
                  {currentAddress?.name && <div className="font-medium">{currentAddress.name}</div>}
                  {currentAddress?.street1 && <div>{currentAddress.street1}</div>}
                  {currentAddress?.street2 && <div>{currentAddress.street2}</div>}
                  <div>
                    {[currentAddress?.city, currentAddress?.state, currentAddress?.zip]
                      .filter(Boolean)
                      .join(" ")}
                  </div>
                </div>
                {addressStatus === "invalid" && addressErrors.length > 0 && (
                  <div className="mt-1 text-[10px] text-yellow-400">{addressErrors[0]}</div>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0"
                onClick={() => { setEditAddress(currentAddress!); setEditingAddress(true); }}
                data-testid={`button-edit-address-${orderId}`}
              >
                <Pencil className="w-3 h-3 mr-1" />
                Edit
              </Button>
            </div>
          ) : (
            <div className="space-y-2 bg-gray-800/60 rounded-md p-2">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Edit Address</p>
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
                      onChange={(e) =>
                        setEditAddress((prev) => ({ ...prev, [field]: e.target.value }))
                      }
                      className="h-7 text-xs bg-gray-900 border-gray-600"
                      data-testid={`input-address-${field}-${orderId}`}
                    />
                  </div>
                ))}
              </div>
              <div className="flex gap-1.5 justify-end">
                <Button size="sm" variant="ghost" onClick={() => setEditingAddress(false)}>
                  <X className="w-3 h-3 mr-1" />
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSaveAddress} data-testid={`button-save-address-${orderId}`}>
                  Save & Re-validate
                </Button>
              </div>
            </div>
          )}

          {/* Weight + refresh */}
          <div className="flex items-center gap-2 flex-wrap">
            <Weight className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <Input
              type="number"
              step="0.1"
              min="0"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="16"
              className="h-7 w-20 text-xs bg-gray-900 border-gray-600"
              data-testid={`input-weight-${orderId}`}
            />
            <Select value={weightUnits} onValueChange={setWeightUnits}>
              <SelectTrigger
                className="h-7 w-16 text-xs bg-gray-900 border-gray-600"
                data-testid={`select-weight-units-${orderId}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="oz">oz</SelectItem>
                <SelectItem value="lb">lb</SelectItem>
                <SelectItem value="g">g</SelectItem>
                <SelectItem value="kg">kg</SelectItem>
              </SelectContent>
            </Select>
            {summary.weightEstimateOz > 0 && (
              <span className="text-[10px] text-gray-500">
                est. {summary.weightEstimateOz} oz
              </span>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={handleRefreshRates}
              disabled={isLoadingRates}
              data-testid={`button-refresh-rates-${orderId}`}
            >
              <RefreshCw className={`w-3 h-3 mr-1 ${isLoadingRates ? "animate-spin" : ""}`} />
              Refresh Rates
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
