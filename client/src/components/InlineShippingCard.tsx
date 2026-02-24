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
  ExternalLink, Pencil, X, RefreshCw, Truck, Weight,
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

  if (isLoadingSummary) {
    return (
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
        <span className="text-xs text-gray-400">Loading shipping info...</span>
      </div>
    );
  }

  if (!summary) return null;

  if (purchasedLabel) {
    return (
      <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
          <span className="text-sm font-semibold text-green-300">Label Purchased — #{summary.orderNumber}</span>
        </div>
        <div>
          <p className="text-[10px] text-gray-400">Tracking Number</p>
          <p className="text-xs font-mono font-bold text-white">{purchasedLabel.trackingNumber}</p>
        </div>
        {purchasedLabel.labelUrl && (
          <Button asChild variant="outline" size="sm" data-testid={`button-download-label-${orderId}`}>
            <a href={purchasedLabel.labelUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
              Download Label (PDF)
            </a>
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden" data-testid={`shipping-card-${orderId}`}>
      {/* Header */}
      <div className="bg-gray-700/40 px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Truck className="w-3.5 h-3.5 text-purple-400" />
          <span className="text-xs font-bold text-white">#{summary.orderNumber}</span>
          {summary.marketplace && (
            <Badge variant="secondary" className="text-[10px]">{summary.marketplace}</Badge>
          )}
        </div>
        {summary.requestedService && (
          <span className="text-[10px] text-gray-400 italic">Customer chose: {summary.requestedService}</span>
        )}
      </div>

      <div className="p-3 space-y-3">
        {/* Address */}
        {!editingAddress ? (
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Ship To</span>
                {addressStatus === "loading" && <Loader2 className="w-3 h-3 animate-spin text-gray-400" />}
                {addressStatus === "valid" && <CheckCircle2 className="w-3 h-3 text-green-400" />}
                {addressStatus === "invalid" && <AlertTriangle className="w-3 h-3 text-yellow-400" />}
                {addressStatus === "invalid" && (
                  <span className="text-[10px] text-yellow-400">Address issue — please edit</span>
                )}
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
                <div className="mt-0.5 text-[10px] text-yellow-400/80">{addressErrors[0]}</div>
              )}
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs shrink-0"
              onClick={() => { setEditAddress(currentAddress!); setEditingAddress(true); }}
              data-testid={`button-edit-address-${orderId}`}
            >
              <Pencil className="w-3 h-3 mr-1" />
              Edit
            </Button>
          </div>
        ) : (
          <div className="space-y-2 bg-gray-900/60 rounded-md p-2">
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
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setEditingAddress(false)}
              >
                <X className="w-3 h-3 mr-1" />
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={handleSaveAddress}
                data-testid={`button-save-address-${orderId}`}
              >
                Save & Re-validate
              </Button>
            </div>
          </div>
        )}

        {/* Weight */}
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
              est. {summary.weightEstimateOz} oz from inventory
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs ml-auto"
            onClick={handleRefreshRates}
            disabled={isLoadingRates}
            data-testid={`button-refresh-rates-${orderId}`}
          >
            <RefreshCw className={`w-3 h-3 mr-1 ${isLoadingRates ? "animate-spin" : ""}`} />
            Refresh Rates
          </Button>
        </div>

        {/* Rates */}
        <div>
          {isLoadingRates && (
            <div className="flex items-center gap-2 py-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
              <span className="text-xs text-gray-400">Fetching rates...</span>
            </div>
          )}
          {!isLoadingRates && ratesError && (
            <div className="flex items-center gap-2 text-xs text-red-400 py-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span className="flex-1 min-w-0">{ratesError}</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-xs shrink-0"
                onClick={handleRefreshRates}
              >
                Retry
              </Button>
            </div>
          )}
          {!isLoadingRates && rates.length > 0 && (
            <div className="space-y-1">
              {rates.map((rate, idx) => {
                const isSelected = selectedRateId === rate.id;
                const isRequested =
                  summary.requestedService &&
                  (rate.service
                    .toLowerCase()
                    .includes(summary.requestedService.toLowerCase()) ||
                    summary.requestedService
                      .toLowerCase()
                      .includes(rate.service.toLowerCase()));
                return (
                  <div
                    key={rate.id}
                    onClick={() => setSelectedRateId(rate.id)}
                    className={`flex items-center justify-between gap-2 rounded-md p-2 cursor-pointer text-xs transition-colors ${
                      isSelected
                        ? "bg-purple-500/20 border border-purple-500/50"
                        : "bg-gray-900/50 border border-gray-700 hover-elevate"
                    }`}
                    data-testid={`rate-row-${rate.id}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className={`w-3 h-3 rounded-full border-2 shrink-0 ${
                          isSelected ? "border-purple-400 bg-purple-400" : "border-gray-500"
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-white flex items-center gap-1.5 flex-wrap">
                          <span>{rate.carrier} {rate.service}</span>
                          {isRequested && (
                            <Badge className="text-[9px] bg-blue-600/30 text-blue-300 border-0 no-default-active-elevate">
                              Customer pick
                            </Badge>
                          )}
                          {idx === 0 && !isRequested && (
                            <Badge className="text-[9px] bg-green-600/30 text-green-300 border-0 no-default-active-elevate">
                              Lowest
                            </Badge>
                          )}
                        </div>
                        {rate.deliveryDays != null && (
                          <div className="text-gray-400">
                            {rate.deliveryDays} day{rate.deliveryDays !== 1 ? "s" : ""}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0 font-bold text-white">
                      ${rate.rate.toFixed(2)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Purchase button */}
        {!isLoadingRates && rates.length > 0 && (
          <div className="flex justify-end pt-1">
            <Button
              onClick={handlePurchaseLabel}
              disabled={!selectedRateId || isPurchasing}
              className="bg-green-600 text-sm"
              data-testid={`button-purchase-label-${orderId}`}
            >
              {isPurchasing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Purchasing...
                </>
              ) : (
                <>
                  <Package className="w-4 h-4 mr-2" />
                  Purchase Label
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
