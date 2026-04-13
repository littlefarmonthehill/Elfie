import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, CheckCircle2, AlertTriangle,
  Pencil, X, ChevronDown, ChevronUp, Globe, Plus,
  Scissors, Link2, Package, StickyNote, MoreHorizontal,
  Printer, Download, MonitorCheck, Wifi,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { shortCode, hiddenPrint } from "@/components/PackingSlip";
import { shippingTier } from "@/lib/item-utils";
import type { AppSettings } from "@shared/schema";
import PrintMethodSetup from "@/components/PrintMethodSetup";

const EU_COUNTRIES = new Set([
  'AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI',
  'FR','GR','HR','HU','IE','IT','LT','LU','LV','MT',
  'NL','PL','PT','RO','SE','SI','SK',
]);

// US military overseas state codes — require customs forms despite country='US'
const MILITARY_STATES = new Set(['AE','AP','AA']);
function isMilitaryAddress(country?: string, state?: string): boolean {
  return (country ?? 'US').toUpperCase() === 'US' && MILITARY_STATES.has((state ?? '').toUpperCase());
}

// EasyPost returns short USPS service codes — map them to full USPS names
const USPS_SERVICE_LABELS: Record<string, string> = {
  First:                'First Class Mail',
  GroundAdvantage:      'Ground Advantage',
  Priority:             'Priority Mail',
  Express:              'Priority Mail Express',
  ParcelSelect:         'Parcel Select',
  ParcelSelectLightweight: 'Parcel Select Lightweight',
  MediaMail:            'Media Mail',
  LibraryMail:          'Library Mail',
  CriticalMail:         'Critical Mail',
};

// When a predefined package is active, append its short name to "Priority Mail" so
// users can see it's the flat-rate / regional-rate variant, not variable pricing.
const PREDEFINED_SHORT: Record<string, string> = {
  FlatRateEnvelope:           'Flat Rate Env.',
  FlatRateLegalEnvelope:      'Legal Flat Rate Env.',
  FlatRatePaddedEnvelope:     'Padded Flat Rate Env.',
  SmallFlatRateBox:           'Small Flat Rate Box',
  MediumFlatRateBoxTopLoading:'Medium Flat Rate Box',
  MediumFlatRateBoxSideLoading:'Medium Flat Rate Box',
  LargeFlatRateBox:           'Large Flat Rate Box',
  RegionalRateBoxA:           'Regional Rate Box A',
  RegionalRateBoxB:           'Regional Rate Box B',
};

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
  // Max weight in oz before a warning is shown for this package type
  warnOz?: number;
};

const PACKAGES: PackageOption[] = [
  { id: "envelope",        label: "Envelope",        group: "standard", predefined: "Letter", dims: { length: 9.5,  width: 4.125, height: 0.25 }, warnOz: 3.5  },
  { id: "large_envelope",  label: "Large Envelope",  group: "standard", predefined: "Flat",   dims: { length: 15,   width: 12,    height: 0.75 }, warnOz: 13   },
  { id: "padded_envelope", label: "Padded Envelope", group: "standard", dims: { length: 12,   width: 9,     height: 2    }, warnOz: 80   },
  { id: "box",             label: "Box",             group: "standard", customDims: true },
  { id: "usps_flat_rate_env",    label: "Flat Rate Envelope",         group: "usps_priority", predefined: "FlatRateEnvelope",              dims: { length: 12.5,  width: 9.5,    height: 0.5  } },
  { id: "usps_legal_env",        label: "Legal Flat Rate Envelope",   group: "usps_priority", predefined: "FlatRateLegalEnvelope",         dims: { length: 15,    width: 9.5,    height: 0.75 } },
  { id: "usps_padded_env",       label: "Padded Flat Rate Envelope",  group: "usps_priority", predefined: "FlatRatePaddedEnvelope",        dims: { length: 12.5,  width: 9.5,    height: 1    } },
  { id: "usps_sm_box",           label: "Small Flat Rate Box",        group: "usps_priority", predefined: "SmallFlatRateBox",              dims: { length: 8.625, width: 5.375,  height: 1.625} },
  { id: "usps_md_box",           label: "Medium Flat Rate Box",       group: "usps_priority", predefined: "MediumFlatRateBoxTopLoading",   dims: { length: 11,    width: 8.5,    height: 5.5  } },
  { id: "usps_lg_box",           label: "Large Flat Rate Box",        group: "usps_priority", predefined: "LargeFlatRateBox",              dims: { length: 12,    width: 12,     height: 5.5  } },
  { id: "usps_rr_box_a",         label: "Regional Rate Box A",        group: "usps_priority", predefined: "RegionalRateBoxA",              dims: { length: 10.15, width: 7.15,   height: 5    } },
  { id: "usps_rr_box_b",         label: "Regional Rate Box B",        group: "usps_priority", predefined: "RegionalRateBoxB",              dims: { length: 14.5,  width: 11.625, height: 3    } },
];

type ShipAddress = {
  name: string;
  company?: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string;
};

type OrderShippingSummary = {
  orderId: string;
  orderNumber: string;
  marketplace: string | null;
  mergeGroupId: string | null;
  linkedOrderRef: string | null;
  linkedOrderNumber: string | null;
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
  labelFormat?: string;
  carrier?: string;
  service?: string;
  rate?: number;
};

type Props = {
  orderId: string;
  isTestMode: boolean;
  orderItems?: OrderItem[];
  siblingItems?: OrderItem[];
  siblingOrderRef?: string;
  splitFromRef?: string | null;
  internalNotes?: string | null;
  onReadyChange: (orderId: string, state: ShippingReadyState | null) => void;
  purchasedLabel?: PurchasedLabelResult;
  onSplit?: () => void;
  onMerge?: () => void;
  onMarkAsShipped?: () => void;
};

const TEST_FROM_ADDRESS = {
  name: "EasyPost Test", company: "EasyPost",
  street1: "417 Montgomery Street", street2: "Floor 5",
  city: "San Francisco", state: "CA", zip: "94104",
  country: "US", phone: "4155559999", email: "test@easypost.com",
};

const BASE_PROD_FROM_ADDRESS = {
  street1: "PO Box 202", city: "Lanesboro",
  state: "MN", zip: "55949", country: "US",
};

/** Format a ref string like "BO.8362106" with its 2-char short code prefix: "[AB] BO.8362106" */
function fmtRef(ref: string, rawNum?: string | null): string {
  const base = (rawNum ?? ref.replace(/^(BO\.|BL\.)/i, '')).trim();
  const code = shortCode(base || ref);
  return `[${code}] ${ref}`;
}

export default function InlineShippingCard({
  orderId, isTestMode, orderItems = [], siblingItems = [], siblingOrderRef, splitFromRef, internalNotes,
  onReadyChange, purchasedLabel, onSplit, onMerge, onMarkAsShipped,
}: Props) {
  const { toast } = useToast();

  const { data: appSettings } = useQuery<AppSettings>({
    queryKey: ['/api/settings'],
  });

  const { data: org } = useQuery<{ name: string; address?: string; phone?: string }>({
    queryKey: ['/api/org'],
  });

  const { data: serviceMappings = {} } = useQuery<Record<string, string>>({
    queryKey: ['/api/shipping/service-mappings'],
    staleTime: 60000,
  });

  type EpTemplate = { id: string; name: string; length: number; width: number; height: number; predefined: string | null };
  const { data: epTemplates = [] } = useQuery<EpTemplate[]>({
    queryKey: ['/api/shipping/parcel-templates'],
    staleTime: 5 * 60 * 1000,
  });

  const saveServiceMapping = async (label: string, easypostService: string) => {
    try {
      await apiRequest('POST', '/api/shipping/service-mappings', { label, easypostService });
    } catch { /* silent — learning failure shouldn't disrupt shipping */ }
  };

  const [summary, setSummary] = useState<OrderShippingSummary | null>(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState(true);
  const [summaryLoadError, setSummaryLoadError] = useState(false);

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

  type AddrChange = { field: string; original: string; normalized: string };
  const [addrChanges, setAddrChanges] = useState<AddrChange[]>([]);
  const [customsDescription, setCustomsDescription] = useState('Plastic toy parts');
  const [declareAsLetter, setDeclareAsLetter] = useState(false);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [carriersExpanded, setCarriersExpanded] = useState(false);
  const [printLabelPending, setPrintLabelPending] = useState(false);
  const [showPrintSetup, setShowPrintSetup] = useState(false);
  const hasUserChangedWeight = useRef(false);
  const hasUserChangedPackage = useRef(false);
  const isInitialLoad = useRef(true);
  // Tracks the service name the user manually chose so rate refreshes re-select the same service
  const userSelectedService = useRef<string | null>(null);

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

  // Notify parent whenever ready state changes — weight must be filled in
  useEffect(() => {
    const selectedRate = rates.find(r => r.id === selectedRateId);
    if (shipmentId && selectedRateId && selectedRate && weight !== "") {
      onReadyChange(orderId, { shipmentId, rateId: selectedRateId, weight, weightUnits, selectedRate });
    } else {
      onReadyChange(orderId, null);
    }
  }, [shipmentId, selectedRateId, weight, weightUnits, rates]);

  useEffect(() => { loadSummary(); }, [orderId]);

  const loadSummary = async () => {
    setIsLoadingSummary(true);
    setSummaryLoadError(false);
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
      console.warn('[ShippingCard] loadSummary failed (transient):', e.message);
      setSummaryLoadError(true);
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

  // EasyPost always expects weight in ounces
  const toOz = (val: number, unit: string): number => {
    switch (unit.toLowerCase()) {
      case "lb": return val * 16;
      case "g":  return val * 0.035274;
      case "kg": return val * 35.274;
      default:   return val; // already oz
    }
  };

  const getPackageWarning = (pkg: string, w: string, wu: string): string | null => {
    const raw = w !== "" ? Number(w) : 0;
    if (raw <= 0) return null;
    const oz = toOz(raw, wu);
    if (oz > 1120) return `${raw} ${wu} exceeds the 70 lb USPS limit`;
    const selected = PACKAGES.find(p => p.id === pkg);
    if (selected?.warnOz && oz > selected.warnOz) {
      const limitLabel = selected.warnOz < 4
        ? `${selected.warnOz} oz First Class letter limit`
        : selected.warnOz < 14
          ? `${selected.warnOz} oz First Class large envelope limit`
          : `${selected.warnOz / 16} lb limit for this package`;
      return `${raw} ${wu} exceeds the ${limitLabel}`;
    }
    return null;
  };

  const buildParcel = (
    pkg: string, l: string, w_: string, h: string, weight: string, wu: string
  ) => {
    const selected = PACKAGES.find(p => p.id === pkg);
    const rawVal = weight !== "" ? Number(weight) : 1;
    const weightOz = Math.max(0.1, toOz(rawVal, wu)); // EasyPost always oz
    if (selected?.predefined) {
      return {
        predefinedPackage: selected.predefined,
        length: selected.dims?.length ?? 1,
        width: selected.dims?.width ?? 1,
        height: selected.dims?.height ?? 1,
        weight: weightOz,
      };
    }
    if (selected?.customDims) {
      return {
        length: l !== "" ? Number(l) : 6,
        width: w_ !== "" ? Number(w_) : 4,
        height: h !== "" ? Number(h) : 2,
        weight: weightOz,
      };
    }
    if (selected) {
      return {
        length: selected.dims?.length ?? 12,
        width: selected.dims?.width ?? 9,
        height: selected.dims?.height ?? 2,
        weight: weightOz,
      };
    }
    // EasyPost saved template
    const epTpl = epTemplates.find(t => t.id === pkg);
    if (epTpl) {
      const parcel: Record<string, any> = {
        length: epTpl.length,
        width: epTpl.width,
        height: epTpl.height,
        weight: weightOz,
      };
      if (epTpl.predefined) parcel.predefinedPackage = epTpl.predefined;
      return parcel;
    }
    // Fallback
    return { length: 12, width: 9, height: 2, weight: weightOz };
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
    setAddrChanges([]);
    try {
      const fromAddress = isTestMode ? TEST_FROM_ADDRESS : {
        ...BASE_PROD_FROM_ADDRESS,
        name: org?.name ?? "E.L.F.I.E.",
        company: "",
        phone: org?.phone ?? "",
      };
      const result: any = await apiRequest("POST", "/api/shipments/create", {
        orderId, itemIdsToShip: [], fromAddress,
        parcel: buildParcel(pkg, l, w_, h, w, wu),
        overrideToAddress: address,
        customsDescription,
        ...(declareAsLetter ? { contentsType: 'documents' } : {}),
      });
      setShipmentId(result.shipmentId);
      setAddrChanges(result.addressNormalization?.changes ?? []);
      const sorted: Rate[] = [...(result.rates || [])].sort((a, b) => a.rate - b.rate);
      setRates(sorted);
      if (sorted.length > 0) {
        // Priority: 1) user's pick this session, 2) learned mapping, 3) fuzzy requestedService, 4) cheapest
        const userSvc = userSelectedService.current;
        const learnedSvc = requestedService ? (serviceMappings[requestedService] ?? null) : null;
        const resolveSvc = userSvc || learnedSvc;

        if (resolveSvc) {
          const svcLower = resolveSvc.toLowerCase();
          const match = sorted.find(r =>
            r.service.toLowerCase().includes(svcLower) || svcLower.includes(r.service.toLowerCase())
          );
          setSelectedRateId(match?.id || sorted[0].id);
        } else if (requestedService) {
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
    apiRequest("PATCH", `/api/orders/${orderId}`, {
      street1: editAddress.street1,
      street2: editAddress.street2,
      city: editAddress.city,
      state: editAddress.state,
      postalCode: editAddress.zip,
      country: editAddress.country,
      phone: editAddress.phone || "",
    }).catch(() => {});
  };

  const selectedRate = rates.find(r => r.id === selectedRateId);
  const isCustomerPick = (rate: Rate) => {
    if (!summary?.requestedService) return false;
    const req = summary.requestedService;
    // Check learned mapping first, then fall back to fuzzy match
    const learnedSvc = serviceMappings[req];
    if (learnedSvc) {
      return rate.service.toLowerCase().includes(learnedSvc.toLowerCase()) ||
        learnedSvc.toLowerCase().includes(rate.service.toLowerCase());
    }
    return rate.service.toLowerCase().includes(req.toLowerCase()) ||
      req.toLowerCase().includes(rate.service.toLowerCase());
  };
  const isReady = !!(shipmentId && selectedRateId && !isLoadingRates && !ratesError && weight !== "");

  // ── Loading skeleton ──
  if (isLoadingSummary) {
    return (
      <div className="border border-gray-700 rounded-lg p-3 flex items-center gap-2 bg-gray-800/30">
        <Loader2 className="w-4 h-4 animate-spin text-blue-400 shrink-0" />
        <span className="text-xs text-gray-400">Loading shipping info...</span>
      </div>
    );
  }

  // ── Transient load error — quiet retry, no alarm ──
  if (summaryLoadError) {
    return (
      <div className="border border-gray-700 rounded-lg p-3 flex items-center justify-between gap-3 bg-gray-800/30">
        <span className="text-xs text-gray-400">Shipping info unavailable — still loading.</span>
        <Button size="sm" variant="outline" onClick={loadSummary} data-testid="button-retry-shipping-load">
          Retry
        </Button>
      </div>
    );
  }

  if (!summary) return null;

  // ── Purchased state ──
  if (purchasedLabel) {
    return (
      <>
      <PrintMethodSetup
        open={showPrintSetup}
        onClose={() => setShowPrintSetup(false)}
        labelUrl={purchasedLabel.labelUrl}
      />
      <div className="border border-green-500/40 rounded-lg p-3 bg-green-500/10 flex items-center gap-3 flex-wrap">
        <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-bold text-green-300 font-mono">
            {summary.marketplace === 'BrickOwl' ? 'BO.' : 'BL.'}{(summary.orderNumber || '').replace(/^(BL\.|BO\.)/i, '')}
          </span>
          <span className="text-[11px] text-gray-400 ml-2">
            {purchasedLabel.service}
          </span>
          <p className="text-xs font-mono text-gray-300 mt-0.5">{purchasedLabel.trackingNumber}</p>
        </div>
        {purchasedLabel.labelUrl && (() => {
          const printMethod = (appSettings as any)?.printMethod || 'browser';
          const printSetupDone = (appSettings as any)?.printSetupDone;
          const isZpl = purchasedLabel.labelFormat === 'ZPL';

          // First-time setup: prompt user to choose print method
          if (!printSetupDone) {
            return (
              <Button variant="outline" size="sm" data-testid={`button-print-label-${orderId}`}
                onClick={() => setShowPrintSetup(true)}>
                <Printer className="w-3.5 h-3.5 mr-1.5" />Print Label
              </Button>
            );
          }

          // Direct ZPL: one-tap to printer
          if (printMethod === 'direct_zpl' && isZpl) {
            return (
              <Button variant="outline" size="sm" disabled={printLabelPending}
                data-testid={`button-print-label-${orderId}`}
                onClick={async () => {
                  setPrintLabelPending(true);
                  try {
                    await apiRequest('POST', '/api/print/label', { labelUrl: purchasedLabel.labelUrl });
                    toast({ title: 'Label sent to printer' });
                  } catch (err: any) {
                    const isLan = err.message?.includes('LAN_PRINTER') || err.message?.includes('private network');
                    toast({
                      title: isLan ? 'Printer not reachable from the cloud' : 'Print failed',
                      description: isLan
                        ? 'Your printer is on your local network. Open Settings → Printing and switch to "Browser" print.'
                        : err.message,
                      variant: 'destructive',
                    });
                  } finally {
                    setPrintLabelPending(false);
                  }
                }}>
                {printLabelPending
                  ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  : <Printer className="w-3.5 h-3.5 mr-1.5" />}
                Print
              </Button>
            );
          }

          // PDF download
          if (printMethod === 'pdf_download') {
            return (
              <Button asChild variant="outline" size="sm" data-testid={`button-download-label-${orderId}`}>
                <a href={purchasedLabel.labelUrl} download>
                  <Download className="w-3.5 h-3.5 mr-1.5" />Download
                </a>
              </Button>
            );
          }

          // Browser / default: fetch PDF → native print dialog (AirPrint on iOS)
          return (
            <Button variant="outline" size="sm" disabled={printLabelPending}
              data-testid={`button-print-label-${orderId}`}
              onClick={async () => {
                setPrintLabelPending(true);
                try {
                  const res = await fetch(purchasedLabel.labelUrl!);
                  const blob = await res.blob();
                  hiddenPrint(blob, `label-${orderId}.pdf`);
                } catch {
                  toast({ title: 'Could not load label', variant: 'destructive' });
                } finally {
                  setPrintLabelPending(false);
                }
              }}>
              {printLabelPending
                ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                : <Printer className="w-3.5 h-3.5 mr-1.5" />}
              Print Label
            </Button>
          );
        })()}
      </div>
      </>
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

        {/* ── Row 1: Shortcode circle + Order number + badges · Actions menu ── */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
            {(() => {
              const tier = shippingTier(summary.requestedService);
              const code = shortCode(summary.orderNumber || summary.orderId);
              return (
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold font-mono shrink-0 tabular-nums ${
                    tier === 'express'  ? 'bg-blue-700/80 text-blue-100' :
                    tier === 'priority' ? 'bg-red-700/80 text-red-100'   :
                    'bg-gray-800 text-amber-400'
                  }`}
                  title={tier === 'express' ? 'Express shipping' : tier === 'priority' ? 'Priority shipping' : undefined}
                >
                  {code}
                </span>
              );
            })()}
            <span className="text-sm font-bold text-white font-mono">
              {summary.marketplace === 'BrickOwl' ? 'BO.' : 'BL.'}{(summary.orderNumber || '').replace(/^(BL\.|BO\.)/i, '')}
            </span>
            {(summary.linkedOrderNumber || summary.linkedOrderRef) && (
              <span className="flex items-center gap-0.5 text-xs text-amber-400/80 font-mono shrink-0" title="Merged order">
                <Plus className="w-2.5 h-2.5" />
                {summary.linkedOrderNumber ? shortCode(summary.linkedOrderNumber) : summary.linkedOrderRef}
              </span>
            )}
            {isReady && (
              <span className="text-[11px] font-bold bg-green-500/20 text-green-400 border border-green-500/30 rounded px-1 py-0.5 uppercase tracking-wide">
                Ready
              </span>
            )}
            {isTestMode && (
              <span className="text-[11px] font-bold bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded px-1 py-0.5 uppercase tracking-wide">
                Test Rates
              </span>
            )}
          </div>

          {/* Actions dropdown */}
          {(onSplit || onMerge || onMarkAsShipped) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="text-gray-500 hover:text-gray-300 transition-colors p-0.5 rounded shrink-0"
                  data-testid={`button-order-actions-${orderId}`}
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {onSplit && (
                  <DropdownMenuItem onClick={onSplit} data-testid={`button-split-order-${orderId}`}>
                    <Scissors className="w-3.5 h-3.5 mr-2 shrink-0" />
                    Split order
                  </DropdownMenuItem>
                )}
                {onMerge && (
                  <DropdownMenuItem onClick={onMerge} data-testid={`button-merge-order-${orderId}`}>
                    <Link2 className="w-3.5 h-3.5 mr-2 shrink-0" />
                    Merge with order
                  </DropdownMenuItem>
                )}
                {(onSplit || onMerge) && onMarkAsShipped && (
                  <DropdownMenuSeparator />
                )}
                {onMarkAsShipped && (
                  <DropdownMenuItem onClick={onMarkAsShipped} data-testid={`button-ship-no-label-${orderId}`}>
                    <Package className="w-3.5 h-3.5 mr-2 shrink-0" />
                    Mark as shipped
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {/* ── Row 2: Requested shipping service (buyer's preference) ── */}
        {summary.requestedService && (
          <div className="text-xs text-blue-300 font-medium -mt-1">
            {summary.requestedService}
          </div>
        )}

        {/* ── International shipment banner ── */}
        {(() => {
          const destCountry = (currentAddress?.country || 'US').toUpperCase();
          const isMilitary = isMilitaryAddress(currentAddress?.country, currentAddress?.state);
          if (destCountry === 'US' && !isMilitary) return null;

          const isEU = EU_COUNTRIES.has(destCountry);
          const isUK = destCountry === 'GB';
          const marketplace = summary?.marketplace;
          const isBL = marketplace === 'BrickLink';

          const missingFlags: string[] = [];
          if (!appSettings?.customsSigner) missingFlags.push('Customs signer name');
          if (isEU && isBL && !appSettings?.blIossNumber) missingFlags.push('BrickLink EU IOSS number');
          if (isEU && !isBL && !appSettings?.boIossNumber) missingFlags.push('BrickOwl EU IOSS number');
          if (isUK && isBL && !appSettings?.blUkVatNumber) missingFlags.push('BrickLink UK VAT number');
          if (isUK && !isBL && !appSettings?.boUkVatNumber) missingFlags.push('BrickOwl UK VAT number');

          const bannerLabel = isMilitary
            ? `Military Overseas (${currentAddress?.state ?? 'APO/FPO/DPO'}) — Customs Form Required`
            : `International Shipment — ${destCountry}${isEU ? ' (EU)' : ''}${isUK ? ' (UK)' : ''}`;

          return (
            <div className={`rounded-md border px-2.5 py-2 space-y-1 ${missingFlags.length > 0 ? 'border-amber-500/50 bg-amber-950/20' : 'border-blue-500/40 bg-blue-950/20'}`}>
              <div className="flex items-center gap-1.5">
                <Globe className={`w-3.5 h-3.5 shrink-0 ${missingFlags.length > 0 ? 'text-amber-400' : 'text-blue-400'}`} />
                <span className={`text-[11px] font-semibold ${missingFlags.length > 0 ? 'text-amber-300' : 'text-blue-300'}`}>
                  {bannerLabel}
                </span>
              </div>
              <p className="text-xs text-gray-400 leading-snug">
                Customs declaration auto-generated: HS 9503.00 · Merchandise · Non-delivery: return
                {(isEU || isUK) && ' · Tax ID will be included if configured'}
              </p>
              {missingFlags.length > 0 && (
                <div className="text-xs text-amber-400 space-y-0.5">
                  <span className="font-semibold">Missing settings (configure in EasyPost settings):</span>
                  {missingFlags.map(f => (
                    <div key={f} className="flex items-center gap-1 ml-1">
                      <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
                      {f}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Merge indicator ── */}
        {summary?.linkedOrderRef && (
          <div className="flex items-center gap-1.5 text-[11px] text-amber-400/80">
            <Link2 className="w-3 h-3 shrink-0" />
            <span>Ships with <span className="font-mono font-semibold">{fmtRef(summary.linkedOrderRef, summary.linkedOrderNumber)}</span> — one label, shared tracking</span>
          </div>
        )}

        {/* ── Split indicator ── */}
        {splitFromRef && (
          <div className="flex items-center gap-1.5 text-[11px] text-blue-400/70">
            <Scissors className="w-3 h-3 shrink-0" />
            <span>Split from <span className="font-mono font-semibold">{fmtRef(splitFromRef)}</span></span>
          </div>
        )}

        {/* ── Row 2: Package type ── */}
        {(() => {
          const stdPkgs = PACKAGES.filter(p => p.group === "standard");
          const priorityPkgs = PACKAGES.filter(p => p.group === "usps_priority");
          const selectedPkg = PACKAGES.find(p => p.id === packageType);
          const selectedEpTpl = !selectedPkg ? epTemplates.find(t => t.id === packageType) : null;
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
                    <SelectLabel className="text-xs text-gray-500 px-2 py-1">Standard</SelectLabel>
                    {stdPkgs.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        <span className="text-xs">{p.label}</span>
                        {p.dims && !p.customDims && (
                          <span className="text-gray-500 text-xs ml-1">
                            {p.dims.length}×{p.dims.width}×{p.dims.height}"
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel className="text-xs text-gray-500 px-2 py-1">USPS Priority Mail</SelectLabel>
                    {priorityPkgs.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        <span className="text-xs">{p.label}</span>
                        {p.dims && (
                          <span className="text-gray-500 text-xs ml-1">
                            {p.dims.length}×{p.dims.width}×{p.dims.height}"
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  {epTemplates.length > 0 && (
                    <SelectGroup>
                      <SelectLabel className="text-xs text-gray-500 px-2 py-1">Saved in EasyPost</SelectLabel>
                      {epTemplates.map(t => (
                        <SelectItem key={t.id} value={t.id}>
                          <span className="text-xs">{t.name}</span>
                          <span className="text-gray-500 text-xs ml-1">
                            {t.length}×{t.width}×{t.height}"
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>

              {/* Dimensions row — only for custom box */}
              {selectedPkg?.customDims && (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-500 shrink-0">L×W×H"</span>
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
                  <span className="text-xs text-gray-500 shrink-0">in</span>
                </div>
              )}

              {/* Show fixed dims for non-custom packages */}
              {selectedPkg && !selectedPkg.customDims && selectedPkg.dims && (
                <p className="text-xs text-gray-600">
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
            type="text"
            inputMode="decimal"
            value={weight}
            onChange={e => {
              const v = e.target.value;
              if (v === '' || /^\d*\.?\d*$/.test(v)) {
                hasUserChangedWeight.current = true;
                setWeight(v);
              }
            }}
            onFocus={e => {
              e.target.select();
              setTimeout(() => e.target.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 350);
            }}
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

        {/* ── Weight/package validation warning ── */}
        {(() => {
          const warn = getPackageWarning(packageType, weight, weightUnits);
          return warn ? (
            <div className="flex items-center gap-1.5 text-amber-400">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              <span className="text-xs">{warn}</span>
            </div>
          ) : null;
        })()}

        {/* ── Contents description (international + military overseas) ── */}
        {((currentAddress?.country || 'US').toUpperCase() !== 'US' || isMilitaryAddress(currentAddress?.country, currentAddress?.state)) && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-500 shrink-0 whitespace-nowrap">Contents</span>
              <input
                type="text"
                value={customsDescription}
                onChange={e => setCustomsDescription(e.target.value)}
                placeholder="Plastic toy parts"
                maxLength={60}
                className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 h-7 text-xs text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-blue-500/60 min-w-0"
                style={{ fontSize: '16px' }}
                data-testid={`input-customs-description-${orderId}`}
              />
            </div>
            {/* Flat letter toggle — non-military international only.
                Declares contents_type=documents so USPS FCMI rates appear. */}
            {(currentAddress?.country || 'US').toUpperCase() !== 'US' && (
              <label
                className="flex items-center gap-2 cursor-pointer select-none"
                data-testid={`label-declare-as-letter-${orderId}`}
              >
                <input
                  type="checkbox"
                  checked={declareAsLetter}
                  onChange={e => {
                    setDeclareAsLetter(e.target.checked);
                    setRates([]);
                    setSelectedRateId(null);
                    setShipmentId(null);
                  }}
                  className="w-3.5 h-3.5 accent-blue-500"
                  data-testid={`checkbox-declare-as-letter-${orderId}`}
                />
                <span className="text-[11px] text-gray-400">Send as flat letter</span>
                <span className="text-[10px] text-gray-600 italic">(thin stickers, printed sheets — enables FCMI $2 rate)</span>
              </label>
            )}
          </>
        )}

        {/* ── Row 4: Service selector ── */}
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
            // Active predefined package string (for qualifying "Priority Mail" label)
            const activePkg = PACKAGES.find(p => p.id === packageType);
            const activePredefined = activePkg?.predefined ?? null;

            const uspsLabel = (svc: string) => {
              const base = USPS_SERVICE_LABELS[svc] ?? svc;
              if (activePredefined && svc === 'Priority') {
                const suffix = PREDEFINED_SHORT[activePredefined];
                return suffix ? `${base} · ${suffix}` : base;
              }
              return base;
            };

            return (
              <div className="space-y-1">
                <div className="min-w-0">
                  <div className="min-w-0 overflow-hidden">
                    <Select value={selectedRateId ?? ""} onValueChange={id => {
                      setSelectedRateId(id);
                      const svc = rates.find(r => r.id === id)?.service ?? null;
                      userSelectedService.current = svc;
                      // Learn: save marketplace label → EasyPost service for future orders
                      if (svc && summary?.requestedService) {
                        saveServiceMapping(summary.requestedService, svc);
                      }
                    }}>
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
                            <SelectLabel className="text-xs text-gray-500 px-2 py-1">USPS</SelectLabel>
                            {uspsRates.map((rate, idx) => {
                              const cPick = isCustomerPick(rate);
                              return (
                                <SelectItem key={rate.id} value={rate.id}>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-medium text-xs">{uspsLabel(rate.service)}</span>
                                    <span className="text-gray-400 text-xs">${rate.rate.toFixed(2)}{rate.deliveryDays != null && ` · ${rate.deliveryDays}d`}</span>
                                    {cPick && <span className="text-blue-400 text-xs">★</span>}
                                    {idx === 0 && !cPick && <span className="text-green-400 text-xs">Low</span>}
                                  </div>
                                </SelectItem>
                              );
                            })}
                          </SelectGroup>
                        )}
                        {carriersExpanded && otherCarriers.map(carrier => (
                          <SelectGroup key={carrier}>
                            <SelectLabel className="text-xs text-gray-500 px-2 py-1">{carrier}</SelectLabel>
                            {otherRates.filter(r => r.carrier === carrier).map((rate, idx) => {
                              const cPick = isCustomerPick(rate);
                              return (
                                <SelectItem key={rate.id} value={rate.id}>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-medium text-xs">{rate.service}</span>
                                    <span className="text-gray-400 text-xs">${rate.rate.toFixed(2)}{rate.deliveryDays != null && ` · ${rate.deliveryDays}d`}</span>
                                    {cPick && <span className="text-blue-400 text-xs">★</span>}
                                    {idx === 0 && !cPick && <span className="text-green-400 text-xs">Low</span>}
                                  </div>
                                </SelectItem>
                              );
                            })}
                          </SelectGroup>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {otherRates.length > 0 && (
                  <button
                    className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                    onClick={() => setCarriersExpanded(v => !v)}
                    data-testid={`button-expand-carriers-${orderId}`}
                  >
                    {carriersExpanded
                      ? "Show USPS only"
                      : `Show all carriers (${otherCarriers.join(", ")})`}
                  </button>
                )}
                {isTestMode && (
                  <p className="text-[11px] text-yellow-600/80 mt-0.5">
                    Test rates are simulated — switch to Live key in Settings for real pricing.
                  </p>
                )}
                {/* Phone-required warning for non-USPS international shipments */}
                {(() => {
                  if (!selectedRateId || !currentAddress) return null;
                  const selRate = rates.find(r => r.id === selectedRateId);
                  const isUsps = selRate?.carrier?.toUpperCase().includes('USPS');
                  if (isUsps) return null;
                  const isIntl = currentAddress.country?.toUpperCase() !== 'US';
                  const isMilitary = currentAddress.country?.toUpperCase() === 'US' &&
                    ['AE','AP','AA'].includes((currentAddress.state ?? '').toUpperCase());
                  if (!isIntl && !isMilitary) return null;
                  if (currentAddress.phone) return null;
                  return (
                    <button
                      className="text-[11px] text-amber-400/90 mt-0.5 flex items-start gap-1 text-left w-full hover:text-amber-300 transition-colors"
                      onClick={() => {
                        setDetailsOpen(true);
                        setEditAddress(currentAddress!);
                        setEditingAddress(true);
                      }}
                      data-testid={`button-add-phone-${orderId}`}
                    >
                      <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                      <span>{selRate?.carrier ?? 'This carrier'} requires a phone number — <span className="underline">tap to add</span></span>
                    </button>
                  );
                })()}
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
            {(orderItems.length + siblingItems.length) > 0 && !detailsOpen && ` · ${orderItems.length + siblingItems.length} item${(orderItems.length + siblingItems.length) !== 1 ? "s" : ""}${siblingItems.length > 0 ? " (combined)" : ""}`}
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
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Ship To</span>
              {!editingAddress && (
                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs"
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
                {currentAddress?.phone && <div className="text-gray-400">{currentAddress.phone}</div>}
                {currentAddress?.country && currentAddress.country !== 'US' && !currentAddress.phone && (
                  <div className="mt-1 text-xs text-yellow-400">Phone required for international shipments — click Edit to add</div>
                )}
                {addressStatus === "invalid" && addressErrors.length > 0 && (
                  <div className="mt-1 text-xs text-yellow-400">{addressErrors[0]}</div>
                )}
                {addrChanges.length > 0 && (
                  <div className="mt-1.5 rounded border border-blue-500/30 bg-blue-950/20 px-2 py-1.5 space-y-0.5" data-testid="banner-addr-normalized">
                    <div className="flex items-center gap-1 text-[11px] font-semibold text-blue-300">
                      <MonitorCheck className="w-3 h-3 shrink-0" />
                      Address adapted for carrier label
                    </div>
                    {addrChanges.map(c => (
                      <div key={c.field} className="text-[10px] text-gray-400 font-mono pl-4 leading-snug">
                        <span className="text-gray-500">{c.field}:</span>{" "}
                        <span className="text-gray-300 line-through opacity-60">{c.original}</span>{" "}
                        <span className="text-blue-300">→ {c.normalized}</span>
                      </div>
                    ))}
                  </div>
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
                    { label: "Phone", field: "phone", span: 2 },
                  ].map(({ label, field, span }) => (
                    <div key={field} className={span === 2 ? "col-span-2" : ""}>
                      <Label className="text-xs text-gray-500">{label}</Label>
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
          {(orderItems.length > 0 || siblingItems.length > 0) && (
            <div className="px-3 py-2.5 space-y-2">
              {/* This order's items */}
              {orderItems.length > 0 && (
                <div className="space-y-1">
                  {siblingItems.length > 0 && (
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">
                      This Order ({orderItems.length})
                    </span>
                  )}
                  {!siblingItems.length && (
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">
                      Order Items ({orderItems.length})
                    </span>
                  )}
                  <div className="space-y-1 mt-1">
                    {orderItems.map(item => (
                      <div key={item.id} className="flex items-start gap-2 py-0.5">
                        <span className="text-xs font-bold text-gray-400 shrink-0 mt-0.5">×{item.quantity}</span>
                        <div className="min-w-0">
                          <p className="text-[11px] text-gray-200 leading-tight truncate">
                            {item.bricklinkPartNumber && <span className="text-gray-400">{item.bricklinkPartNumber} · </span>}
                            {item.name}
                          </p>
                          {(item.colorName || item.condition || item.binName) && (
                            <p className="text-xs text-gray-500 leading-tight">
                              {[item.colorName, item.condition, item.binName && `Bin: ${item.binName}`].filter(Boolean).join(" · ")}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Merged sibling order's items */}
              {siblingItems.length > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Plus className="w-2.5 h-2.5 text-amber-400/70" />
                    <span className="text-xs font-bold text-amber-400/70 uppercase tracking-wide">
                      {siblingOrderRef ? fmtRef(siblingOrderRef) : "Merged Order"} ({siblingItems.length})
                    </span>
                  </div>
                  <div className="space-y-1">
                    {siblingItems.map(item => (
                      <div key={item.id} className="flex items-start gap-2 py-0.5">
                        <span className="text-xs font-bold text-gray-500 shrink-0 mt-0.5">×{item.quantity}</span>
                        <div className="min-w-0">
                          <p className="text-[11px] text-gray-400 leading-tight truncate">
                            {item.bricklinkPartNumber && <span className="text-gray-500">{item.bricklinkPartNumber} · </span>}
                            {item.name}
                          </p>
                          {(item.colorName || item.condition || item.binName) && (
                            <p className="text-xs text-gray-600 leading-tight">
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

          {/* Internal notes section */}
          {internalNotes && (
            <div className="px-3 py-2.5 space-y-1">
              <div className="flex items-center gap-1 text-xs font-bold text-gray-500 uppercase tracking-wide">
                <StickyNote className="w-3 h-3" />
                <span>Internal Notes</span>
              </div>
              <pre className="text-[11px] text-gray-400 whitespace-pre-wrap font-sans leading-relaxed">
                {internalNotes}
              </pre>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
