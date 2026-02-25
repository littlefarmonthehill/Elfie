import { useState, useEffect, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
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

type PackageOption = {
  id: string;
  label: string;
  group: "standard" | "usps_priority";
  predefined?: string;
  dims?: { length: number; width: number; height: number };
  customDims?: true;
};

const PACKAGES: PackageOption[] = [
  { id: "padded_envelope", label: "Padded Envelope", group: "standard", dims: { length: 12, width: 9, height: 2 } },
  { id: "box", label: "Box", group: "standard", customDims: true },
  { id: "usps_flat_rate_env", label: "Flat Rate Envelope", group: "usps_priority", predefined: "FlatRateEnvelope", dims: { length: 12.5, width: 9.5, height: 0.5 } },
  { id: "usps_padded_env", label: "Padded Flat Rate Envelope", group: "usps_priority", predefined: "FlatRatePaddedEnvelope", dims: { length: 12.5, width: 9.5, height: 1 } },
  { id: "usps_sm_box", label: "Small Flat Rate Box", group: "usps_priority", predefined: "SmallFlatRateBox", dims: { length: 8.625, width: 5.375, height: 1.625 } },
  { id: "usps_md_box", label: "Medium Flat Rate Box", group: "usps_priority", predefined: "MediumFlatRateBoxTopLoading", dims: { length: 11, width: 8.5, height: 5.5 } },
  { id: "usps_lg_box", label: "Large Flat Rate Box", group: "usps_priority", predefined: "LargeFlatRateBox", dims: { length: 12, width: 12, height: 5.5 } },
];

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
  savedPackageType: string | null;
  savedPackageLength: number | null;
  savedPackageWidth: number | null;
  savedPackageHeight: number | null;
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
  const [packageType, setPackageType] = useState<string>("padded_envelope");
  const [dimL, setDimL] = useState<string>("");
  const [dimW, setDimW] = useState<string>("");
  const [dimH, setDimH] = useState<string>("");

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
  const [carriersExpanded, setCarriersExpanded] = useState(false);
  const hasUserChangedWeight = useRef(false);
  const hasUserChangedPackage = useRef(false);
  const isInitialLoad = useRef(true);

  // Auto-save all shipping fields to DB (debounced)
  const autoSave = (
    w: string, wu: string, pkg: string, l: string, ww: string, h: string
  ) => {
    const selectedPkg = PACKAGES.find(p => p.id === pkg);
    const isBox = !!selectedPkg?.customDims;
    apiRequest("PATCH", `/api/orders/${orderId}`, {
      weight: w !== "" ? Number(w) : null,
      weightUnits: wu,
      packageType: pkg,
      packageLength: isBox && l !== "" ? Number(l) : (selectedPkg?.dims?.length ?? null),
      packageWidth: isBox && ww !== "" ? Number(ww) : (selectedPkg?.dims?.width ?? null),
      packageHeight: isBox && h !== "" ? Number(h) : (selectedPkg?.dims?.height ?? null),
    }).catch(() => {});
  };

  // Auto-refresh rates when weight or units change (debounced, user-initiated only)
  useEffect(() => {
    if (!hasUserChangedWeight.current || !currentAddress || weight === "") return;
    const timer = setTimeout(() => {
      fetchRates(currentAddress, weight, weightUnits, packageType, dimL, dimW, dimH);
      autoSave(weight, weightUnits, packageType, dimL, dimW, dimH);
    }, 700);
    return () => clearTimeout(timer);
  }, [weight, weightUnits]);

  // Auto-refresh rates when package type or box dimensions change
  useEffect(() => {
    if (!hasUserChangedPackage.current || !currentAddress) return;
    const timer = setTimeout(() => {
      fetchRates(currentAddress, weight, weightUnits, packageType, dimL, dimW, dimH);
      autoSave(weight, weightUnits, packageType, dimL, dimW, dimH);
    }, 700);
    return () => clearTimeout(timer);
  }, [packageType, dimL, dimW, dimH]);

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
      const pkg = data.savedPackageType || "padded_envelope";
      const savedPkgDef = PACKAGES.find(p => p.id === pkg);
      const l = savedPkgDef?.customDims && data.savedPackageLength != null ? String(data.savedPackageLength) : "";
      const pw = savedPkgDef?.customDims && data.savedPackageWidth != null ? String(data.savedPackageWidth) : "";
      const ph = savedPkgDef?.customDims && data.savedPackageHeight != null ? String(data.savedPackageHeight) : "";
      setWeight(w);
      setWeightUnits(wu);
      setPackageType(pkg);
      setDimL(l);
      setDimW(pw);
      setDimH(ph);
      isInitialLoad.current = false;
      validateAddress(data.address);
      fetchRates(data.address, w, wu, pkg, l, pw, ph, data.requestedService);
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

  const buildParcel = (
    pkg: string, l: string, w_: string, h: string, weight: string, wu: string
  ) => {
    const selected = PACKAGES.find(p => p.id === pkg);
    const weightVal = weight !== "" ? Number(weight) : 16;
    if (selected?.predefined) {
      return {
        predefinedPackage: selected.predefined,
        length: selected.dims?.length ?? 1,
        width: selected.dims?.width ?? 1,
        height: selected.dims?.height ?? 1,
        weight: weightVal,
        weightUnits: wu,
      };
    }
    if (selected?.customDims) {
      return {
        length: l !== "" ? Number(l) : 6,
        width: w_ !== "" ? Number(w_) : 4,
        height: h !== "" ? Number(h) : 2,
        weight: weightVal,
        weightUnits: wu,
      };
    }
    return {
      length: selected?.dims?.length ?? 12,
      width: selected?.dims?.width ?? 9,
      height: selected?.dims?.height ?? 2,
      weight: weightVal,
      weightUnits: wu,
    };
  };

  const fetchRates = async (
    address: ShipAddress, w: string, wu: string,
    pkg: string, l: string, w_: string, h: string,
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
        parcel: buildParcel(pkg, l, w_, h, w, wu),
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
    fetchRates(editAddress, weight, weightUnits, packageType, dimL, dimW, dimH);
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

        {/* ── Row 1: Order number + preferred service ── */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-white font-mono shrink-0">#{summary.orderNumber}</span>
          {summary.requestedService && (
            <span className="text-[10px] text-blue-300 font-medium truncate text-right">
              {summary.requestedService}
            </span>
          )}
        </div>

        {/* ── Row 2: Package type ── */}
        {(() => {
          const stdPkgs = PACKAGES.filter(p => p.group === "standard");
          const priorityPkgs = PACKAGES.filter(p => p.group === "usps_priority");
          const selectedPkg = PACKAGES.find(p => p.id === packageType);
          return (
            <div className="space-y-1.5">
              <Select
                value={packageType}
                onValueChange={v => {
                  hasUserChangedPackage.current = true;
                  setPackageType(v);
                  if (v !== "box") { setDimL(""); setDimW(""); setDimH(""); }
                }}
              >
                <SelectTrigger
                  className="h-7 w-full bg-gray-900 border-gray-600"
                  style={{ fontSize: '16px' }}
                  data-testid={`select-package-${orderId}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel className="text-[10px] text-gray-500 px-2 py-1">Standard</SelectLabel>
                    {stdPkgs.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        <span className="text-xs">{p.label}</span>
                        {p.dims && !p.customDims && (
                          <span className="text-gray-500 text-[10px] ml-1">
                            {p.dims.length}×{p.dims.width}×{p.dims.height}"
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel className="text-[10px] text-gray-500 px-2 py-1">USPS Priority Mail</SelectLabel>
                    {priorityPkgs.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        <span className="text-xs">{p.label}</span>
                        {p.dims && (
                          <span className="text-gray-500 text-[10px] ml-1">
                            {p.dims.length}×{p.dims.width}×{p.dims.height}"
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>

              {/* Dimensions row — only for custom box */}
              {selectedPkg?.customDims && (
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-gray-500 shrink-0">L×W×H"</span>
                  {[
                    { val: dimL, set: setDimL, placeholder: "L" },
                    { val: dimW, set: setDimW, placeholder: "W" },
                    { val: dimH, set: setDimH, placeholder: "H" },
                  ].map(({ val, set, placeholder }) => (
                    <Input
                      key={placeholder}
                      type="number" step="0.25" min="0"
                      value={val}
                      placeholder={placeholder}
                      onChange={e => { hasUserChangedPackage.current = true; set(e.target.value); }}
                      className="h-7 flex-1 bg-gray-900 border-gray-600 px-1.5 min-w-0"
                      style={{ fontSize: '16px' }}
                      data-testid={`input-dim-${placeholder.toLowerCase()}-${orderId}`}
                    />
                  ))}
                  <span className="text-[10px] text-gray-500 shrink-0">in</span>
                </div>
              )}

              {/* Show fixed dims for non-custom packages */}
              {selectedPkg && !selectedPkg.customDims && selectedPkg.dims && (
                <p className="text-[10px] text-gray-600">
                  {selectedPkg.dims.length}×{selectedPkg.dims.width}×{selectedPkg.dims.height}"
                  {selectedPkg.predefined && <span className="ml-1 text-blue-900">· Flat rate</span>}
                </p>
              )}
            </div>
          );
        })()}

        {/* ── Row 3: Weight ── */}
        <div className="flex items-center gap-1 shrink-0">
          <Input
            type="number" step="0.1" min="0" value={weight}
            onChange={e => { hasUserChangedWeight.current = true; setWeight(e.target.value); }}
            placeholder="oz"
            className="h-7 w-14 bg-gray-900 border-gray-600 px-1.5"
            style={{ fontSize: '16px' }}
            data-testid={`input-weight-${orderId}`}
          />
          <Select value={weightUnits} onValueChange={v => { hasUserChangedWeight.current = true; setWeightUnits(v); }}>
            <SelectTrigger className="h-7 w-14 bg-gray-900 border-gray-600 px-1.5" style={{ fontSize: '16px' }} data-testid={`select-weight-units-${orderId}`}>
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
            <Button size="sm" variant="ghost" onClick={() => fetchRates(currentAddress!, weight, weightUnits, packageType, dimL, dimW, dimH)}>
              Retry
            </Button>
          </div>
        ) : rates.length > 0 ? (
          (() => {
            const uspsRates = rates.filter(r => r.carrier?.toUpperCase().includes("USPS"));
            const otherRates = rates.filter(r => !r.carrier?.toUpperCase().includes("USPS"));
            const otherCarriers = [...new Set(otherRates.map(r => r.carrier).filter(Boolean))];
            return (
              <div className="space-y-1">
                {/* Grid: select fills available space, price is fixed width */}
                <div className="grid gap-1.5" style={{ gridTemplateColumns: "1fr auto" }}>
                  <div className="min-w-0 overflow-hidden">
                    <Select value={selectedRateId ?? ""} onValueChange={setSelectedRateId}>
                      <SelectTrigger
                        className="h-8 w-full bg-gray-900 border-gray-600 truncate"
                        style={{ fontSize: '16px' }}
                        data-testid={`select-service-${orderId}`}
                      >
                        <SelectValue placeholder="Select service..." />
                      </SelectTrigger>
                      <SelectContent className="max-w-[min(320px,90vw)]">
                        {uspsRates.length > 0 && (
                          <SelectGroup>
                            <SelectLabel className="text-[10px] text-gray-500 px-2 py-1">USPS</SelectLabel>
                            {uspsRates.map((rate, idx) => {
                              const cPick = isCustomerPick(rate);
                              return (
                                <SelectItem key={rate.id} value={rate.id}>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-medium text-xs">{rate.service}</span>
                                    <span className="text-gray-400 text-xs">${rate.rate.toFixed(2)}{rate.deliveryDays != null && ` · ${rate.deliveryDays}d`}</span>
                                    {cPick && <span className="text-blue-400 text-[10px]">★</span>}
                                    {idx === 0 && !cPick && <span className="text-green-400 text-[10px]">Low</span>}
                                  </div>
                                </SelectItem>
                              );
                            })}
                          </SelectGroup>
                        )}
                        {carriersExpanded && otherCarriers.map(carrier => (
                          <SelectGroup key={carrier}>
                            <SelectLabel className="text-[10px] text-gray-500 px-2 py-1">{carrier}</SelectLabel>
                            {otherRates.filter(r => r.carrier === carrier).map((rate, idx) => {
                              const cPick = isCustomerPick(rate);
                              return (
                                <SelectItem key={rate.id} value={rate.id}>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-medium text-xs">{rate.service}</span>
                                    <span className="text-gray-400 text-xs">${rate.rate.toFixed(2)}{rate.deliveryDays != null && ` · ${rate.deliveryDays}d`}</span>
                                    {cPick && <span className="text-blue-400 text-[10px]">★</span>}
                                    {idx === 0 && !cPick && <span className="text-green-400 text-[10px]">Low</span>}
                                  </div>
                                </SelectItem>
                              );
                            })}
                          </SelectGroup>
                        ))}
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
                {otherRates.length > 0 && (
                  <button
                    className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
                    onClick={() => setCarriersExpanded(v => !v)}
                    data-testid={`button-expand-carriers-${orderId}`}
                  >
                    {carriersExpanded
                      ? "Show USPS only"
                      : `Show all carriers (${otherCarriers.join(", ")})`}
                  </button>
                )}
              </div>
            );
          })()
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
