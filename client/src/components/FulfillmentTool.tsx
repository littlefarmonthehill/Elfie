import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Truck, Loader2, Printer, AlertTriangle, Tag, Scissors, Package, ExternalLink, CheckCircle2, ClipboardList, PackageCheck, ScanLine, ShieldCheck, Trash2, X, MessageCircle, Globe, Plus, Link2, Search, PanelRight, Star, CheckCheck, RotateCcw, ThumbsUp, ThumbsDown, Minus } from "lucide-react";

import { printPackingSlips, printPicklist, buildShortCodeMap, shortCode } from "./PackingSlip";
import { useToast } from "@/hooks/use-toast";
import { cleanItemName, shippingTier, toggleSetItem } from "@/lib/item-utils";
import InlineShippingCard, { ShippingReadyState, PurchasedLabelResult, OrderItem } from "./InlineShippingCard";
import PicklistTool from "./PicklistTool";

/** Convert an ISO 3166-1 alpha-2 country code to a flag emoji. */
function countryFlag(code: string | null | undefined): string {
  if (!code || code.length !== 2) return '';
  const c = code.toUpperCase();
  return String.fromCodePoint(
    0x1F1E6 + c.charCodeAt(0) - 65,
    0x1F1E6 + c.charCodeAt(1) - 65,
  );
}

type BatchResult = {
  orderId: string;
  orderNumber: string;
} & PurchasedLabelResult;

type PicklistBinItem = {
  picklistItemId: string;
  orderId: string;
  orderNumber: string;
  marketplace: string | null;
  itemName: string;
  quantity: number;
  sku: string;
  partNumber: string | null;
  colorName: string | null;
  condition: string | null;
  pulled: boolean;
  inventoryId: number | null;
  remarks: string | null;
  inventoryQty: number | null;
};
type PicklistBin = { items: PicklistBinItem[] };

const WORKFLOW_STATUSES = ['new', 'processing', 'bump', 'issue', 'on_hold', 'done'] as const;
type WorkflowStatus = typeof WORKFLOW_STATUSES[number];

const WORKFLOW_META: Record<WorkflowStatus, { label: string; dot: string; badge: string; header: string }> = {
  new:        { label: 'New',        dot: 'bg-gray-500',   badge: 'bg-gray-800/60 text-gray-300 border-gray-600/40',   header: 'text-gray-300' },
  processing: { label: 'Processing', dot: 'bg-blue-500',   badge: 'bg-blue-900/50 text-blue-300 border-blue-700/40',   header: 'text-blue-300' },
  bump:       { label: 'Bump',       dot: 'bg-amber-400',  badge: 'bg-amber-900/50 text-amber-300 border-amber-700/40', header: 'text-amber-300' },
  issue:      { label: 'Issue',      dot: 'bg-red-500',    badge: 'bg-red-900/50 text-red-300 border-red-700/40',       header: 'text-red-300' },
  on_hold:    { label: 'On Hold',    dot: 'bg-purple-500', badge: 'bg-purple-900/50 text-purple-300 border-purple-700/40', header: 'text-purple-300' },
  done:       { label: 'Done',       dot: 'bg-green-500',  badge: 'bg-green-900/50 text-green-300 border-green-700/40', header: 'text-green-300' },
};

type Order = {
  id: string;
  orderNumber: string;
  orderStatus: string;
  marketplace: string | null;
  customerUsername: string | null;
  customerNotes: string | null;
  internalNotes: string | null;
  shipTo: any;
  orderDate: string | null;
  requestedShippingService: string | null;
  workflowStatus: WorkflowStatus | null;
  mergeGroupId: string | null;
  parentOrderId: string | null;
  localOnly: boolean;
  orderTotal: string | null;
  insuranceAmount: string | null;
};

type FulfillmentItem = {
  id: string;
  orderId: string;
  orderNumber: string;
  sku: string | null;
  bricklinkPartNumber: string | null;
  name: string;
  quantity: number;
  fulfilled: boolean;
  colorName: string | null;
  condition: string | null;
  binId: number | null;
  binName: string | null;
  shelfName: string | null;
  aisleName: string | null;
};

type FulfillmentData = {
  orders: Order[];
  items: FulfillmentItem[];
};

// ── Fulfillment checklist sub-component (part-grouped view of pulled items) ──
interface FulfillmentChecklistProps {
  pulledItems: PicklistBinItem[];
  selectedOrderIds?: Set<string>;
  fulfilledItems: Set<string>;
  onToggle: (itemId: string) => void;
}

function FulfillmentChecklist({ pulledItems, selectedOrderIds, fulfilledItems, onToggle }: FulfillmentChecklistProps) {
  const visibleItems = selectedOrderIds && selectedOrderIds.size > 0
    ? pulledItems.filter(i => selectedOrderIds.has(i.orderId))
    : pulledItems;

  if (visibleItems.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <PackageCheck className="h-12 w-12 mx-auto mb-3 opacity-40" />
        <p className="font-medium">No picked items to fulfill</p>
        <p className="text-sm mt-1">Items appear here once they have been pulled from the picklist</p>
      </div>
    );
  }

  // Group by part number (or sku fallback), sorted numerically
  const partKey = (item: PicklistBinItem) => item.partNumber || item.sku || '';
  const partGroups = new Map<string, PicklistBinItem[]>();
  for (const item of [...visibleItems].sort((a, b) =>
    partKey(a).localeCompare(partKey(b), undefined, { numeric: true })
  )) {
    const k = partKey(item);
    if (!partGroups.has(k)) partGroups.set(k, []);
    partGroups.get(k)!.push(item);
  }

  return (
    <div className="space-y-3">
      {Array.from(partGroups.entries()).map(([key, variants]) => {
        const allFulfilled = variants.every(v => fulfilledItems.has(v.picklistItemId));
        const someFulfilled = variants.some(v => fulfilledItems.has(v.picklistItemId));
        const rep = variants[0];

        return (
          <div
            key={key}
            className={`rounded-lg border overflow-hidden transition-colors ${
              allFulfilled ? 'border-cyan-800/40' : someFulfilled ? 'border-yellow-700/40' : 'border-gray-700'
            }`}
            data-testid={`fulfill-group-${key}`}
          >
            {/* Part header — no checkbox at group level */}
            <div
              className={`flex items-center gap-2 px-3 py-2 ${
                allFulfilled ? 'bg-cyan-950/30' : someFulfilled ? 'bg-yellow-950/20' : 'bg-gray-800/70'
              }`}
            >
              <div className="flex-1 min-w-0">
                {/* Line 1: part# + color + condition */}
                <div className="flex items-center gap-2 flex-wrap">
                  {(rep.marketplace === 'BrickOwl' ? rep.partNumber : (rep.partNumber || rep.sku)) && (
                    <span className="font-mono text-xs text-cyan-300 shrink-0">
                      {rep.marketplace === 'BrickOwl' ? rep.partNumber : (rep.partNumber || rep.sku)}
                    </span>
                  )}
                  {rep.colorName && (
                    <span className="text-[11px] text-yellow-400">{rep.colorName}</span>
                  )}
                  {rep.condition && (
                    <span className={`text-[11px] ${rep.condition === 'N' ? 'text-green-400' : 'text-orange-400'}`}>
                      {rep.condition === 'N' ? 'New' : rep.condition === 'U' ? 'Used' : rep.condition}
                    </span>
                  )}
                </div>
                {/* Line 2: description (wrapping) */}
                <div className={`text-xs font-medium leading-snug ${allFulfilled ? 'text-gray-500 line-through' : 'text-white'}`}>
                  {rep.itemName}
                </div>
              </div>
              {variants.length > 1 && (
                <span className="shrink-0 text-[10px] font-bold text-gray-400 tabular-nums">
                  {variants.length} lots
                </span>
              )}
            </div>

            {/* Variant rows */}
            <div className="divide-y divide-gray-700/50">
              {variants.map(item => {
                const checked = fulfilledItems.has(item.picklistItemId);
                return (
                  <div
                    key={item.picklistItemId}
                    className={`flex items-start gap-3 px-3 py-1.5 cursor-pointer ${checked ? 'bg-cyan-950/20' : 'bg-gray-900/60'}`}
                    onClick={() => onToggle(item.picklistItemId)}
                    data-testid={`fulfill-item-${item.picklistItemId}`}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => onToggle(item.picklistItemId)}
                      onClick={e => e.stopPropagation()}
                      className="shrink-0 touch-auto"
                      data-testid={`checkbox-fulfill-item-${item.picklistItemId}`}
                    />
                    <div className={`flex-1 min-w-0 text-[10px] ${checked ? 'line-through text-gray-500' : ''}`}>
                      <div className="flex items-center gap-2 flex-wrap text-gray-400">
                        <span className="tabular-nums">{item.quantity}×</span>
                        {item.inventoryQty != null && !checked && (() => {
                          const stock = item.inventoryQty!;
                          const needed = item.quantity;
                          const isShort = stock < needed;
                          const isExact = stock === needed;
                          return (
                            <span className={`tabular-nums font-semibold ${
                              isShort  ? 'text-red-400' :
                              isExact  ? 'text-yellow-400' :
                                         'text-green-500/80'
                            }`}>
                              ({stock} in stock{isShort ? ' — SHORT' : isExact ? ' — last one' : ''})
                            </span>
                          );
                        })()}
                        <span className="text-gray-600">·</span>
                        <span className="font-mono">{item.marketplace === 'BrickOwl' ? 'BO.' : 'BL.'}{(item.orderNumber || '').replace(/^(BL\.|BO\.)/i, '')}</span>
                        {item.inventoryId && (
                          <span className="font-mono text-blue-400/70">Lot {item.inventoryId}</span>
                        )}
                      </div>
                      {item.comment && (
                        <div className="text-gray-400 mt-0.5 italic">{item.comment}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function FulfillmentTool({ onOrderDetail }: { onOrderDetail?: (orderId: string) => void } = {}) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'picklist' | 'shipping' | 'feedback'>('picklist');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const drawerPanelRef = useRef<HTMLDivElement>(null);
  const actionRowRef = useRef<HTMLDivElement>(null);
  const shipBtnRef = useRef<HTMLButtonElement>(null);
  const swipeTouchStartX = useRef<number>(0);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('elfie-fulfillment-selected');
      return saved ? new Set<string>(JSON.parse(saved)) : new Set<string>();
    } catch { return new Set<string>(); }
  });

  // Persist selections to localStorage so they survive drawer close/reopen
  useEffect(() => {
    try {
      localStorage.setItem('elfie-fulfillment-selected', JSON.stringify([...selectedOrders]));
    } catch { /* ignore */ }
  }, [selectedOrders]);

  // Slide-in animation: one frame delay so CSS transition has something to transition from
  useEffect(() => {
    if (drawerOpen) requestAnimationFrame(() => setDrawerVisible(true));
    else setDrawerVisible(false);
  }, [drawerOpen]);
  // Batch shipping state
  const [readyToShip, setReadyToShip] = useState<Map<string, ShippingReadyState>>(new Map());
  const [purchasedLabels, setPurchasedLabels] = useState<Map<string, PurchasedLabelResult>>(new Map());
  const [isShippingAll, setIsShippingAll] = useState(false);
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);

  // End of Day SCAN form state
  const [scanFormUrl, setScanFormUrl] = useState<string | null>(null);

  // Ship confirmation dialog
  const [showShipConfirmDialog, setShowShipConfirmDialog] = useState(false);

  // Split order state
  const [isSplitMode, setIsSplitMode] = useState(false);
  const [splitTargetOrderId, setSplitTargetOrderId] = useState<string | null>(null);
  const [selectedItemsForSplit, setSelectedItemsForSplit] = useState<Set<string>>(new Set());
  const [statusPickerOrderId, setStatusPickerOrderId] = useState<string | null>(null);
  // Merge dialog state
  const [mergeDialog, setMergeDialog] = useState<{ orderId: string; mergeGroupId: string | null } | null>(null);
  const [mergeSearch, setMergeSearch] = useState('');
  // Ship-without-label dialog state
  const [shipFreeDialog, setShipFreeDialog] = useState<{
    orderId: string;
    orderNumber: string;
    marketplace: string | null;
    linkedOrders: Array<{ id: string; orderNumber: string; marketplace: string | null }>;
  } | null>(null);
  const [shipFreeTracking, setShipFreeTracking] = useState('');
  const [shipFreeNote, setShipFreeNote] = useState('');
  const [shipFreeAlsoShip, setShipFreeAlsoShip] = useState<Set<string>>(new Set());
  // Post-label-purchase merge-sibling prompt
  const [mergeShipDialog, setMergeShipDialog] = useState<{
    items: Array<{ orderId: string; orderNumber: string; marketplace: string | null; trackingNumber: string }>;
  } | null>(null);
  const [mergeShipSelected, setMergeShipSelected] = useState<Set<string>>(new Set());
  const [mergeShipPending, setMergeShipPending] = useState(false);
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [activeWorkflowFilter, setActiveWorkflowFilter] = useState<WorkflowStatus | null>(null);

  const updateWorkflowStatus = useMutation({
    mutationFn: ({ orderId, status }: { orderId: string; status: WorkflowStatus }) =>
      apiRequest('PUT', `/api/fulfillment/order/${orderId}/workflow-status`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/fulfillment'] }),
  });

  const updateWorkflowStatusBulk = useMutation({
    mutationFn: async ({ orderIds, status }: { orderIds: string[]; status: WorkflowStatus }) => {
      await Promise.all(orderIds.map(orderId =>
        apiRequest('PUT', `/api/fulfillment/order/${orderId}/workflow-status`, { status })
      ));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/fulfillment'] });
    },
  });

  const [showSplitConfirmDialog, setShowSplitConfirmDialog] = useState(false);
  const [splitOrderNumber, setSplitOrderNumber] = useState<string>("");

  const linkMergeMutation = useMutation({
    mutationFn: ({ orderId, targetOrderId }: { orderId: string; targetOrderId: string }) =>
      apiRequest('POST', `/api/orders/${orderId}/link-merge`, { targetOrderId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/fulfillment'] });
      setMergeSearch('');
      toast({ title: "Orders linked", description: "Both orders are now in the same merge group and will ship together." });
    },
    onError: (err: any) => {
      toast({ title: "Link failed", description: err.message || "Could not link orders.", variant: "destructive" });
    },
  });

  const unlinkMergeMutation = useMutation({
    mutationFn: ({ orderId }: { orderId: string }) =>
      apiRequest('POST', `/api/orders/${orderId}/unlink-merge`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/fulfillment'] });
      toast({ title: "Order unlinked", description: "The order has been removed from the merge group." });
    },
    onError: (err: any) => {
      toast({ title: "Unlink failed", description: err.message || "Could not unlink order.", variant: "destructive" });
    },
  });

  const [shipFreeSubmitting, setShipFreeSubmitting] = useState(false);

  const handleConfirmShipFree = async () => {
    if (!shipFreeDialog || shipFreeSubmitting) return;
    setShipFreeSubmitting(true);
    try {
      await apiRequest('POST', `/api/orders/${shipFreeDialog.orderId}/ship-without-label`, {
        trackingNumber: shipFreeTracking,
        note: shipFreeNote,
      });
      const alsoShip = shipFreeDialog.linkedOrders.filter(o => shipFreeAlsoShip.has(o.id));
      if (alsoShip.length > 0) {
        await Promise.allSettled(alsoShip.map(o =>
          apiRequest('POST', `/api/orders/${o.id}/ship-without-label`, {
            trackingNumber: shipFreeTracking,
            note: shipFreeNote
              ? `${shipFreeNote} (merged with ${shipFreeDialog.orderNumber})`
              : `Shipped together with ${shipFreeDialog.orderNumber}`,
          })
        ));
      }
      queryClient.invalidateQueries({ queryKey: ['/api/fulfillment'] });
      queryClient.invalidateQueries({ queryKey: ['/api/fulfillment/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/orders/dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      setShipFreeDialog(null);
      setShipFreeTracking('');
      setShipFreeNote('');
      setShipFreeAlsoShip(new Set());
      const total = 1 + alsoShip.length;
      toast({
        title: total === 1 ? "Order shipped" : `${total} orders shipped`,
        description: total === 1
          ? "Marked as shipped and selling channel updated."
          : `Primary order and ${alsoShip.length} linked order${alsoShip.length !== 1 ? 's' : ''} marked as shipped.`,
      });
    } catch (err: any) {
      toast({ title: "Ship failed", description: err.message || "Could not mark order as shipped.", variant: "destructive" });
    } finally {
      setShipFreeSubmitting(false);
    }
  };

  const handleMergeShip = async () => {
    if (!mergeShipDialog || mergeShipPending) return;
    const toShip = mergeShipDialog.items.filter(i => mergeShipSelected.has(i.orderId));
    if (toShip.length === 0) { setMergeShipDialog(null); return; }
    setMergeShipPending(true);
    try {
      await Promise.allSettled(toShip.map(item =>
        apiRequest('POST', `/api/orders/${item.orderId}/ship-without-label`, {
          trackingNumber: item.trackingNumber,
          note: 'Shipped together with merged order (no additional label)',
        })
      ));
      queryClient.invalidateQueries({ queryKey: ['/api/fulfillment'] });
      queryClient.invalidateQueries({ queryKey: ['/api/fulfillment/stats'] });
      queryClient.invalidateQueries({ queryKey: ['/api/orders/dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['/api/dashboard/stats'] });
      setMergeShipDialog(null);
      setMergeShipSelected(new Set());
      toast({
        title: `${toShip.length} linked order${toShip.length !== 1 ? 's' : ''} shipped`,
        description: "Marked as shipped with the same tracking number. No additional label purchased.",
      });
    } catch (err: any) {
      toast({ title: "Ship failed", description: err.message || "Could not mark linked orders as shipped.", variant: "destructive" });
    } finally {
      setMergeShipPending(false);
    }
  };

  const { data, isLoading } = useQuery<FulfillmentData>({
    queryKey: ['/api/fulfillment'],
    staleTime: 0,
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
  });

  // Reconcile selection whenever orders data changes — drop any IDs that no longer exist
  useEffect(() => {
    if (!data) return;
    const orders = data.orders;
    if (!orders) return;
    const validIds = new Set(orders.map(o => o.id));
    setSelectedOrders(prev => {
      const next = new Set([...prev].filter(id => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [data]);

  // When new orders appear mid-session (e.g. a BO order synced on another device),
  // the PicklistTool's cached "All" query becomes stale and won't include the new
  // order's picklist items.  Invalidate all picklist cache entries on any order-set
  // change AFTER the initial load so the next render fetches fresh data.
  //
  // NOTE: we use isInitialLoadDone instead of the old "prev.size > 0" guard.
  // The old guard failed when a device started with 0 orders and then received its
  // first order — prev.size was 0 so invalidation was suppressed, leaving the
  // "All" tab serving a stale empty response while "To Pull" (a different query key,
  // never cached) correctly fetched fresh data.
  const prevOrderIdsRef = useRef<Set<string>>(new Set());
  const isInitialOrderLoadDone = useRef(false);
  useEffect(() => {
    if (!data?.orders) return;
    const currentIds = new Set(data.orders.map((o: any) => o.id));
    const prev = prevOrderIdsRef.current;
    const hasNewOrder = [...currentIds].some(id => !prev.has(id));
    if (hasNewOrder && isInitialOrderLoadDone.current) {
      queryClient.invalidateQueries({ queryKey: ['/api/picklist'] });
    }
    isInitialOrderLoadDone.current = true;
    prevOrderIdsRef.current = currentIds;
  }, [data]);

  // Fetch settings to determine EasyPost key mode
  const { data: settings } = useQuery<any>({
    queryKey: ['/api/settings'],
  });

  const { data: org } = useQuery<any>({
    queryKey: ['/api/org'],
  });

  // EOD-eligible EasyPost shipments (purchased, not yet on any SCAN form)
  const { data: endOfDayData } = useQuery<{ count: number; shipments: any[] }>({
    queryKey: ['/api/shipments/end-of-day'],
    staleTime: 0,
    refetchInterval: 15000,
    refetchIntervalInBackground: true,
  });

  const scanFormMutation = useMutation({
    mutationFn: async () => apiRequest('POST', '/api/shipments/scan-form', {}),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/shipments/end-of-day'] });
      if (data?.alreadyManifested) {
        if (data?.formUrl) {
          setScanFormUrl(data.formUrl);
          window.open(data.formUrl, '_blank');
          toast({ title: "Already Manifested", description: "All shipments were already scanned. Reopening your most recent EOD form." });
        } else {
          toast({ title: "Already Manifested", description: "All shipments were already scanned by EasyPost. Your EOD is complete." });
        }
        return;
      }
      if (data?.allVoided) {
        toast({ title: "Nothing to Scan", description: "All shipments appear to have been voided in EasyPost." });
        return;
      }
      if (data?.formUrl) {
        setScanFormUrl(data.formUrl);
        window.open(data.formUrl, '_blank');
        const skipped = data.skippedCount > 0 ? ` — ${data.skippedCount} skipped (not found in EasyPost)` : '';
        toast({ title: "EOD Form Ready", description: `Generated for ${data.shipmentCount} shipment${data.shipmentCount !== 1 ? 's' : ''}${skipped}` });
      }
    },
    onError: (err: any) => {
      toast({ title: "EOD Form Failed", description: err.message || "Could not generate End of Day form", variant: "destructive" });
    },
  });

  const clearEodBacklogMutation = useMutation({
    mutationFn: async () => apiRequest('POST', '/api/shipments/clear-eod-backlog', {}),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/shipments/end-of-day'] });
      toast({ title: "EOD Backlog Cleared", description: `${data.cleared} shipment${data.cleared !== 1 ? 's' : ''} marked as already manifested` });
    },
    onError: (err: any) => {
      toast({ title: "Clear Failed", description: err.message || "Could not clear EOD backlog", variant: "destructive" });
    },
  });

  // Per-order picklist pull completion { orderId: allPulled }
  const { data: picklistOrderStatus = {} } = useQuery<Record<string, boolean>>({
    queryKey: ['/api/picklist/order-status'],
    refetchInterval: 3000,
  });

  // All picklist items (for the Fulfillment tab and second-checkmark logic)
  const { data: picklistBins = [] } = useQuery<PicklistBin[]>({
    queryKey: ['/api/picklist'],
    refetchInterval: 60000,
  });
  const allPicklistItems: PicklistBinItem[] = picklistBins.flatMap(b => b.items);

  type FeedbackOrder = {
    id: string; orderNumber: string; marketplace: string | null;
    customerUsername: string | null; orderStatus: string;
    shipDate: string | null; orderDate: string; orderTotal: string;
    feedbackLeftAt: string | null;
  };
  const { data: feedbackPending = [], refetch: refetchFeedback } = useQuery<FeedbackOrder[]>({
    queryKey: ['/api/orders/feedback-pending'],
    staleTime: 0,
  });
  type FeedbackRating = 'positive' | 'neutral' | 'negative';
  const [feedbackDraft, setFeedbackDraft] = useState<Record<string, { rating: FeedbackRating | null; comment: string }>>({});
  const getFbRating = (id: string): FeedbackRating | null => feedbackDraft[id]?.rating ?? null;
  const getFbComment = (id: string): string => feedbackDraft[id]?.comment ?? '';
  const setFbRating = (id: string, rating: FeedbackRating) =>
    setFeedbackDraft(prev => ({ ...prev, [id]: { comment: prev[id]?.comment ?? '', rating } }));
  const setFbComment = (id: string, comment: string) =>
    setFeedbackDraft(prev => ({ ...prev, [id]: { rating: prev[id]?.rating ?? null, comment } }));

  const markFeedbackMutation = useMutation({
    mutationFn: ({ orderId, rating, comment }: { orderId: string; rating?: string; comment?: string }) =>
      apiRequest('POST', `/api/orders/${orderId}/feedback-left`, { rating, comment }),
    onSuccess: (_data, { orderId }) => {
      setFeedbackDraft(prev => { const next = { ...prev }; delete next[orderId]; return next; });
      queryClient.invalidateQueries({ queryKey: ['/api/orders/feedback-pending'] });
    },
  });
  const undoFeedbackMutation = useMutation({
    mutationFn: (orderId: string) => apiRequest('POST', `/api/orders/${orderId}/feedback-undo`, {}),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/orders/feedback-pending'] }); },
  });
  const pulledItems: PicklistBinItem[] = allPicklistItems.filter(item => item.pulled);

  // Orders that have at least one item with insufficient stock (race / oversell scenario)
  const ordersWithShortStock = new Set<string>(
    allPicklistItems
      .filter(i => i.inventoryQty !== null && i.inventoryQty < i.quantity)
      .map(i => i.orderId)
  );

  const fulfillMutation = useMutation({
    mutationFn: async ({ itemId, fulfilled }: { itemId: string; fulfilled: boolean }) => {
      const result = await apiRequest('PUT', `/api/fulfillment/item/${itemId}/fulfill`, { fulfilled });
      return result;
    },
    onMutate: async ({ itemId, fulfilled }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['/api/fulfillment'] });
      
      // Snapshot the previous value
      const previousData = queryClient.getQueryData<FulfillmentData>(['/api/fulfillment']);
      
      // Optimistically update the cache
      if (previousData) {
        queryClient.setQueryData<FulfillmentData>(['/api/fulfillment'], {
          ...previousData,
          items: previousData.items.map(item => 
            item.id === itemId ? { ...item, fulfilled } : item
          ),
        });
      }
      
      // Return context with snapshot
      return { previousData };
    },
    onError: (err, variables, context) => {
      // Rollback to previous data on error
      if (context?.previousData) {
        queryClient.setQueryData(['/api/fulfillment'], context.previousData);
      }
    },
    onSuccess: () => {
      // Only update stats, don't refetch the main data
      queryClient.invalidateQueries({ queryKey: ['/api/fulfillment/stats'] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  // Within a group: express first, then priority, then others; oldest first within tier
  const tierRank = (o: Order) => {
    const t = shippingTier(o.requestedShippingService);
    if (t === 'express') return 0;
    if (t === 'priority') return 1;
    return 2;
  };
  const sortWithinGroup = (a: Order, b: Order) => {
    const rankDiff = tierRank(a) - tierRank(b);
    if (rankDiff !== 0) return rankDiff;
    const dateA = a.orderDate ? new Date(a.orderDate).getTime() : 0;
    const dateB = b.orderDate ? new Date(b.orderDate).getTime() : 0;
    return dateA - dateB;
  };
  const allOrders = data?.orders || [];
  // Build collision-free 2-char shortcodes for all active orders (same algorithm as picklist/packing slip)
  const orderShortCodeMap = buildShortCodeMap(allOrders.map(o => o.orderNumber).filter(Boolean));
  // Flat sorted list used for select-all / print — excludes done orders
  const sortedOrders = [...allOrders]
    .filter(o => (o.workflowStatus || 'new') !== 'done')
    .sort(sortWithinGroup);
  // All groups (excluding done) — used for filter pills
  const allGroups = WORKFLOW_STATUSES
    .filter(status => status !== 'done')
    .map(status => ({
      status,
      orders: allOrders
        .filter(o => (o.workflowStatus || 'new') === status)
        .sort(sortWithinGroup),
    }))
    .filter(g => g.orders.length > 0);
  // Filtered view — if a filter pill is active only show that group
  const groupedOrders = activeWorkflowFilter
    ? allGroups.filter(g => g.status === activeWorkflowFilter)
    : allGroups;

  // Per-group select/deselect-all handler
  const handleGroupSelectAll = (groupOrders: Order[]) => {
    const ids = groupOrders.map(o => o.id);
    const allSelected = ids.every(id => selectedOrders.has(id));
    setSelectedOrders(prev => {
      const next = new Set(prev);
      if (allSelected) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  };

  // Orders that are both selected AND fully ready to ship
  const shippableOrderIds = [...selectedOrders].filter(id => readyToShip.has(id));
  const shippableCount = shippableOrderIds.length;

  // Derived: single selected order (for ship/split actions that need exactly one)
  const selectedOrderId = selectedOrders.size === 1 ? [...selectedOrders][0] : null;

  const handleOrderToggle = (orderId: string) =>
    setSelectedOrders(prev => toggleSetItem(prev, orderId));

  const handleSelectAll = () => {
    if (selectedOrders.size === sortedOrders.length) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(sortedOrders.map(o => o.id)));
    }
  };

  const handlePrintPackingSlips = async (orderIds: string[]) => {
    if (orderIds.length === 0) return;
    try {
      const response = await fetch('/api/fulfillment/packing-slip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds }),
      });
      const slipData = await response.json();
      await printPackingSlips(slipData, org ? { name: org.name, address: org.address, logoUrl: org.logoUrl } : undefined);

      // Promote any printed orders that are still "new" → "processing"
      const newOrderIds = orderIds.filter(id =>
        data?.orders.find(o => o.id === id)?.workflowStatus === 'new'
      );
      if (newOrderIds.length > 0) {
        await updateWorkflowStatusBulk.mutateAsync({ orderIds: newOrderIds, status: 'processing' });
      }
    } catch (error) {
      console.error('Error fetching packing slip data:', error);
      toast({
        title: "Error",
        description: "Failed to generate packing slips. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handlePrintPicklist = async () => {
    if (selectedOrders.size === 0) return;
    try {
      const freshBins = await queryClient.fetchQuery<PicklistBin[]>({ queryKey: ['/api/picklist'] });
      const freshItems: PicklistBinItem[] = freshBins.flatMap(b => b.items);
      const items = freshItems
        .filter(item => selectedOrders.has(item.orderId))
        .sort((a, b) => {
          const pk = (a.partNumber || a.sku || '').localeCompare(b.partNumber || b.sku || '', undefined, { numeric: true });
          if (pk !== 0) return pk;
          const ck = (a.condition || '').localeCompare(b.condition || '');
          if (ck !== 0) return ck;
          return (a.colorName || '').localeCompare(b.colorName || '');
        });
      printPicklist(items.map(item => ({ ...item, comment: item.comment })));
    } catch (error) {
      console.error('Error fetching picklist data:', error);
      toast({ title: "Error", description: "Failed to generate picklist. Please try again.", variant: "destructive" });
    }
  };

  const handlePrintLotLabels = (orderIds: string[]) => {
    if (orderIds.length === 0) return;
    toast({ title: "Lot Labels", description: "Lot label printing is coming in a future update." });
  };

  const handleReadyChange = (orderId: string, state: ShippingReadyState | null) => {
    setReadyToShip(prev => {
      const next = new Map(prev);
      if (state) {
        next.set(orderId, state);
      } else {
        next.delete(orderId);
      }
      return next;
    });
  };

  const handleShipAll = async () => {
    if (shippableOrderIds.length === 0) return;
    setShowShipConfirmDialog(false);
    setIsShippingAll(true);
    const results: BatchResult[] = [];
    const labelMap = new Map<string, PurchasedLabelResult>();

    const orderIds = shippableOrderIds;
    await Promise.allSettled(
      orderIds.map(async (orderId) => {
        const ready = readyToShip.get(orderId)!;
        const order = data?.orders.find(o => o.id === orderId);
        try {
          // Save weight
          if (ready.weight !== "") {
            await apiRequest("PATCH", `/api/orders/${encodeURIComponent(orderId)}`, {
              weight: Number(ready.weight),
              weightUnits: ready.weightUnits,
            });
          }
          // Purchase label
          const result: any = await apiRequest("POST", "/api/shipments/purchase", {
            orderId,
            shipmentId: ready.shipmentId,
            rateId: ready.rateId,
          });
          const label: PurchasedLabelResult = {
            trackingNumber: result.shipment?.trackingNumber || result.trackingNumber || "",
            labelUrl: result.shipment?.labelUrl || result.labelUrl,
            carrier: ready.selectedRate.carrier,
            service: ready.selectedRate.service,
            rate: ready.selectedRate.rate,
          };
          labelMap.set(orderId, label);
          results.push({ orderId, orderNumber: order?.orderNumber || orderId, ...label });
        } catch (e: any) {
          results.push({
            orderId,
            orderNumber: order?.orderNumber || orderId,
            trackingNumber: "",
            carrier: ready.selectedRate.carrier,
            service: ready.selectedRate.service,
            rate: ready.selectedRate.rate,
          });
          toast({ title: `Failed: ${order?.orderNumber}`, description: e.message, variant: "destructive" });
        }
      })
    );

    setPurchasedLabels(labelMap);
    setBatchResults(results);
    setReadyToShip(new Map());
    setIsShippingAll(false);

    // Before invalidating, detect unshipped merge-group siblings for purchased labels
    const mergeItems: Array<{ orderId: string; orderNumber: string; marketplace: string | null; trackingNumber: string }> = [];
    for (const r of results) {
      if (!r.trackingNumber) continue;
      const order = allOrders.find(o => o.id === r.orderId);
      if (!order?.mergeGroupId) continue;
      const siblings = allOrders.filter(
        o => o.id !== r.orderId
          && o.mergeGroupId === order.mergeGroupId
          && (o.workflowStatus || 'new') !== 'done'
      );
      for (const sib of siblings) {
        if (!mergeItems.some(m => m.orderId === sib.id)) {
          mergeItems.push({ orderId: sib.id, orderNumber: sib.orderNumber, marketplace: sib.marketplace ?? null, trackingNumber: r.trackingNumber });
        }
      }
    }
    if (mergeItems.length > 0) {
      setMergeShipDialog({ items: mergeItems });
      setMergeShipSelected(new Set(mergeItems.map(i => i.orderId)));
    }

    queryClient.invalidateQueries({ queryKey: ["/api/fulfillment"] });
    queryClient.invalidateQueries({ queryKey: ["/api/fulfillment/stats"] });
    queryClient.invalidateQueries({ queryKey: ["/api/orders/dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["/api/orders/shipped"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });

    const successes = results.filter(r => r.trackingNumber).length;
    toast({
      title: `${successes} of ${results.length} labels purchased`,
      description: successes === results.length ? "All labels ready to print." : "Some labels failed — check the results.",
      variant: successes === results.length ? "default" : "destructive",
    });
  };

  const handleInitiateSplit = (orderId: string) => {
    setSplitTargetOrderId(orderId);
    setIsSplitMode(true);
    setSelectedItemsForSplit(new Set());
  };

  const handleCancelSplit = () => {
    setIsSplitMode(false);
    setSplitTargetOrderId(null);
    setSelectedItemsForSplit(new Set());
  };

  const handleItemSplitToggle = (itemId: string) =>
    setSelectedItemsForSplit(prev => toggleSetItem(prev, itemId));

  const handleConfirmSplit = () => {
    if (!splitTargetOrderId || selectedItemsForSplit.size === 0) {
      toast({
        title: "No Items Selected",
        description: "Please select at least one item to split.",
        variant: "destructive",
      });
      return;
    }

    const currentOrder = data?.orders.find(o => o.id === splitTargetOrderId);
    if (!currentOrder) return;

    const newOrderNumber = `${currentOrder.orderNumber}-1`;
    setSplitOrderNumber(newOrderNumber);
    setShowSplitConfirmDialog(true);
  };

  const handleExecuteSplit = async () => {
    if (!splitTargetOrderId || selectedItemsForSplit.size === 0 || !data) return;

    try {
      const orderItems = data.items.filter(item => item.orderId === splitTargetOrderId);
      const itemIdsToKeep = orderItems
        .filter(item => !selectedItemsForSplit.has(item.id))
        .map(item => item.id);

      await apiRequest('POST', `/api/orders/${splitTargetOrderId}/split`, {
        itemIdsToKeep
      });

      toast({
        title: "Order Split Successful",
        description: `Items moved to order ${splitOrderNumber}`,
      });

      setShowSplitConfirmDialog(false);
      setIsSplitMode(false);
      setSplitTargetOrderId(null);
      setSelectedItemsForSplit(new Set());
      
      queryClient.invalidateQueries({ queryKey: ['/api/fulfillment'] });
      queryClient.invalidateQueries({ queryKey: ['/api/fulfillment/stats'] });
    } catch (error: any) {
      console.error('Error splitting order:', error);
      toast({
        title: "Split Failed",
        description: error.message || "Failed to split order. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      {/* ── Order selection flyout ── */}
      {drawerOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black transition-opacity duration-300"
            style={{ opacity: drawerVisible ? 0.5 : 0 }}
            onClick={() => setDrawerOpen(false)}
          />

          {/* Panel — slides in from the right */}
          <div
            ref={drawerPanelRef}
            className="fixed top-0 right-0 bottom-0 z-50 flex flex-col bg-gray-950 border-l border-gray-800 shadow-2xl transition-transform duration-300 ease-out"
            style={{
              width: 'min(320px, 90vw)',
              transform: drawerVisible ? 'translateX(0)' : 'translateX(100%)',
              willChange: 'transform',
            }}
            onClick={e => e.stopPropagation()}
            onTouchStart={e => { swipeTouchStartX.current = e.touches[0].clientX; }}
            onTouchEnd={e => {
              const dx = e.changedTouches[0].clientX - swipeTouchStartX.current;
              if (dx > 72) setDrawerOpen(false);
            }}
            data-testid="panel-orders"
          >
            {/* Header */}
            <div className="flex-shrink-0 border-b border-gray-800">
              {/* Title row */}
              <div className="flex items-center gap-2 px-4 py-3.5">
                <Truck className="w-4 h-4 text-orange-400 flex-shrink-0" />
                <span className="text-sm font-semibold text-gray-100 flex-1">Orders</span>
                {sortedOrders.length > 0 && (
                  <span className="text-xs text-gray-500 tabular-nums">{sortedOrders.length} orders</span>
                )}
                <button
                  onClick={() => setDrawerOpen(false)}
                  className="ml-2 text-gray-500 hover:text-gray-200 transition-colors"
                  data-testid="button-drawer-close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Workflow filter pills */}
              {allGroups.length > 1 && (
                <div className="flex gap-1.5 px-4 pb-2.5 flex-wrap">
                  <button
                    onClick={() => setActiveWorkflowFilter(null)}
                    className={`text-[9px] font-bold px-2 py-1 rounded border leading-none transition-opacity ${
                      activeWorkflowFilter === null
                        ? 'bg-gray-700 text-gray-100 border-gray-500'
                        : 'bg-gray-800/40 text-gray-500 border-gray-700/40 opacity-70 hover:opacity-100'
                    }`}
                    data-testid="filter-workflow-all"
                  >
                    All
                  </button>
                  {allGroups.map(g => {
                    const m = WORKFLOW_META[g.status];
                    return (
                      <button
                        key={g.status}
                        onClick={() => setActiveWorkflowFilter(activeWorkflowFilter === g.status ? null : g.status)}
                        className={`text-[9px] font-bold px-2 py-1 rounded border leading-none transition-opacity ${m.badge} ${
                          activeWorkflowFilter === g.status ? 'opacity-100' : 'opacity-50 hover:opacity-80'
                        }`}
                        data-testid={`filter-workflow-${g.status}`}
                      >
                        {m.label} · {g.orders.length}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Contextual selection + bulk action bar */}
              {sortedOrders.length > 0 && (
                <div className="flex items-center justify-between px-4 pb-2.5">
                  <button
                    onClick={handleSelectAll}
                    className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
                    data-testid="button-select-all"
                  >
                    {selectedOrders.size === 0
                      ? 'Select all'
                      : `${selectedOrders.size} selected · Deselect`}
                  </button>
                  {selectedOrders.size >= 1 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className="text-[9px] font-bold px-2 py-1 rounded border border-gray-600 text-gray-400 hover:text-gray-200 hover:border-gray-400 leading-none transition-colors"
                          data-testid="button-bulk-status"
                          disabled={updateWorkflowStatusBulk.isPending}
                        >
                          Set status…
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-[130px]">
                        {WORKFLOW_STATUSES.filter(s => s !== 'done').map(s => {
                          const sm = WORKFLOW_META[s];
                          return (
                            <DropdownMenuItem
                              key={s}
                              onClick={() => updateWorkflowStatusBulk.mutate({ orderIds: [...selectedOrders], status: s })}
                              data-testid={`bulk-workflow-${s}`}
                            >
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border leading-none ${sm.badge}`}>
                                {sm.label}
                              </span>
                            </DropdownMenuItem>
                          );
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              )}
            </div>

            {/* Order list — scrollable, grouped by workflow status */}
            <div className="flex-1 overflow-y-auto px-4 pt-1 pb-4 min-h-0">
              {allOrders.length === 0 ? (
                <div className="flex items-center justify-center h-40">
                  <div className="text-center text-gray-500">
                    <Truck className="w-10 h-10 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No orders awaiting fulfillment</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  {groupedOrders.map((group, gi) => {
                    const meta = WORKFLOW_META[group.status];
                    return (
                      <div key={group.status}>
                        {/* Group header */}
                        <div className={`flex items-center gap-2 pt-${gi === 0 ? '1' : '3'} pb-1`}>
                          <div className={`w-2 h-2 rounded-full shrink-0 ${meta.dot}`} />
                          <span className={`text-[10px] font-bold uppercase tracking-wider ${meta.header}`}>{meta.label}</span>
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-800 text-gray-400 tabular-nums">{group.orders.length}</span>
                          <button
                            onClick={() => handleGroupSelectAll(group.orders)}
                            className="ml-1 text-[9px] font-bold text-gray-500 hover:text-gray-300 leading-none"
                            data-testid={`group-select-all-${group.status}`}
                          >
                            {group.orders.every(o => selectedOrders.has(o.id)) ? 'Deselect' : 'Select all'}
                          </button>
                        </div>
                        {/* Orders in this group */}
                        <div className="divide-y divide-gray-800/60 rounded-md overflow-hidden">
                          {group.orders.map((order) => {
                            const isSelected = selectedOrders.has(order.id);
                            const lotCount = data?.items.filter(i => i.orderId === order.id).length ?? 0;
                            const tier = shippingTier(order.requestedShippingService);
                            const formattedDate = order.orderDate
                              ? new Date(order.orderDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                              : null;
                            const isPickComplete = !!picklistOrderStatus[order.id];
                            const shipToParsed = (() => {
                              try { return typeof order.shipTo === 'string' ? JSON.parse(order.shipTo) : (order.shipTo || {}); }
                              catch { return {}; }
                            })();
                            const country: string = (shipToParsed?.country || '').toUpperCase();
                            const flag = countryFlag(country);
                            const wfStatus: WorkflowStatus = (order.workflowStatus as WorkflowStatus) || 'new';
                            const wfMeta = WORKFLOW_META[wfStatus];
                            return (
                              <div key={order.id}>
                                <div
                                  onClick={() => handleOrderToggle(order.id)}
                                  className={`flex flex-col py-2 cursor-pointer transition-colors border-l-[3px] ${isSelected ? 'border-l-purple-500 bg-purple-950/30' : 'border-l-transparent'}`}
                                  data-testid={`order-${order.orderNumber}`}
                                >
                                  {/* Line 1: shortcode-circle · flag · order# · lots · meta icons | workflow status */}
                                  <div className="flex items-center gap-2 pl-2 pr-2">
                                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                      {/* 2-char shortcode — circle color encodes shipping tier */}
                                      <span
                                        className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold font-mono shrink-0 tabular-nums ${
                                          tier === 'express'  ? 'bg-blue-700/80 text-blue-100' :
                                          tier === 'priority' ? 'bg-red-700/80 text-red-100'   :
                                          'bg-gray-800 text-amber-400'
                                        }`}
                                        data-testid={`shortcode-${order.id}`}
                                        title={tier === 'express' ? 'Express shipping' : tier === 'priority' ? 'Priority shipping' : undefined}
                                      >
                                        {orderShortCodeMap.get(order.orderNumber) ?? ''}
                                      </span>
                                      {/* Country flag */}
                                      {flag && (
                                        <span className="text-sm leading-none shrink-0" data-testid={`flag-${order.id}`}>{flag}</span>
                                      )}
                                      {/* Order number */}
                                      <span
                                        className={`font-mono text-xs font-semibold shrink-0 ${isSelected ? 'text-purple-300' : 'text-gray-200'}`}
                                        data-testid={`text-order-number-${order.id}`}
                                      >
                                        {order.marketplace === 'BrickOwl' ? 'BO.' : 'BL.'}{(order.orderNumber || '').replace(/^(BL\.|BO\.)/i, '')}
                                      </span>
                                      {/* Lot count */}
                                      {lotCount > 0 && (
                                        <span className="w-5 h-5 rounded-full bg-blue-700/80 flex items-center justify-center text-[9px] font-bold text-white tabular-nums shrink-0" data-testid={`lot-count-${order.id}`}>
                                          {lotCount}
                                        </span>
                                      )}
                                      {/* Customer note — tap to toggle inline */}
                                      {order.customerNotes && (
                                        <button
                                          onClick={(e) => { e.stopPropagation(); setOpenNoteId(openNoteId === order.id ? null : order.id); }}
                                          className={`shrink-0 transition-colors ${openNoteId === order.id ? 'text-amber-400' : 'text-amber-500/50 hover:text-amber-400'}`}
                                          data-testid={`button-customer-note-${order.id}`}
                                          title="Customer note"
                                        >
                                          <MessageCircle className="w-3.5 h-3.5 fill-current" />
                                        </button>
                                      )}
                                      {/* Insurance indicator (BrickLink only) */}
                                      {order.insuranceAmount && Number(order.insuranceAmount) > 0 && (
                                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" title={`Insurance: $${Number(order.insuranceAmount).toFixed(2)}`} data-testid={`icon-insurance-${order.id}`} />
                                      )}
                                      {/* Order total */}
                                      {order.orderTotal && Number(order.orderTotal) > 0 && (
                                        <span className="text-[10px] font-mono text-gray-500 shrink-0 tabular-nums" data-testid={`text-total-${order.id}`}>
                                          ${Number(order.orderTotal).toFixed(2)}
                                        </span>
                                      )}
                                    </div>
                                    {/* Workflow status badge */}
                                    <button
                                      onClick={(e) => { e.stopPropagation(); setStatusPickerOrderId(statusPickerOrderId === order.id ? null : order.id); }}
                                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded border leading-none transition-opacity shrink-0 ${wfMeta.badge}`}
                                      data-testid={`button-workflow-status-${order.id}`}
                                      title="Change workflow status"
                                    >
                                      {wfMeta.label}
                                    </button>
                                    {/* Low-stock race indicator */}
                                    {ordersWithShortStock.has(order.id) && (
                                      <AlertTriangle
                                        className="w-3 h-3 text-amber-400 shrink-0"
                                        data-testid={`icon-short-stock-${order.id}`}
                                        title="One or more items may be short on stock"
                                      />
                                    )}
                                  </div>

                                  {/* Line 2: pick-complete · globe (intl) · date · view order · merge group | comment */}
                                  <div className="flex items-center justify-between pl-2 pr-2 mt-0.5">
                                    <div className="flex items-center gap-1.5">
                                      {isPickComplete && <CheckCircle2 className="w-3 h-3 text-green-400 fill-green-400 shrink-0" />}
                                      {country && country !== 'US' && (
                                        <Globe className="w-3 h-3 text-sky-400 shrink-0" data-testid={`icon-international-${order.id}`} />
                                      )}
                                      {formattedDate && <span className="text-[10px] text-gray-500">{formattedDate}</span>}
                                      {onOrderDetail && (
                                        <button
                                          onClick={(e) => { e.stopPropagation(); onOrderDetail(String(order.id)); }}
                                          className="text-[10px] text-sky-500/70 hover:text-sky-400 transition-colors"
                                          data-testid={`button-order-detail-${order.id}`}
                                        >
                                          view order
                                        </button>
                                      )}
                                      {/* Merge group indicator */}
                                      {order.mergeGroupId && (() => {
                                        const linkedOrder = data?.orders.find(o => o.mergeGroupId === order.mergeGroupId && o.id !== order.id);
                                        const linkedCode = linkedOrder
                                          ? (orderShortCodeMap.get(linkedOrder.orderNumber) ?? shortCode(linkedOrder.orderNumber ?? linkedOrder.id))
                                          : null;
                                        if (!linkedCode) return null;
                                        return (
                                          <span
                                            className="flex items-center gap-0.5 text-[10px] text-amber-400/80 font-mono shrink-0"
                                            data-testid={`text-merge-group-${order.id}`}
                                            title={`Merged with ${linkedCode} — buy a label on one, then mark the other as shipped with same tracking`}
                                          >
                                            <Plus className="w-2.5 h-2.5" />
                                            {linkedCode}
                                          </span>
                                        );
                                      })()}
                                    </div>
                                  </div>
                                </div>


                                {/* Inline customer note */}
                                {openNoteId === order.id && order.customerNotes && (
                                  <div className="ml-5 mb-1 px-2 py-1.5 rounded border border-amber-500/25 bg-amber-500/5 text-[11px] text-amber-200/90 leading-relaxed">
                                    {order.customerNotes}
                                  </div>
                                )}

                                {/* Inline workflow status picker */}
                                {statusPickerOrderId === order.id && (
                                  <div className="ml-5 mb-2 flex flex-wrap gap-1.5" data-testid={`workflow-picker-${order.id}`}>
                                    {WORKFLOW_STATUSES.filter(s => s !== 'done').map(s => {
                                      const sm = WORKFLOW_META[s];
                                      const isActive = wfStatus === s;
                                      return (
                                        <button
                                          key={s}
                                          onClick={() => {
                                            updateWorkflowStatus.mutate({ orderId: order.id, status: s });
                                            setStatusPickerOrderId(null);
                                          }}
                                          disabled={isActive || updateWorkflowStatus.isPending}
                                          className={`text-[9px] font-bold px-2 py-1 rounded border leading-none transition-opacity ${sm.badge} ${isActive ? 'opacity-100 ring-1 ring-offset-1 ring-offset-gray-900 ring-current' : 'opacity-60 hover:opacity-100'}`}
                                          data-testid={`workflow-option-${order.id}-${s}`}
                                        >
                                          {sm.label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Main layout ── */}
      <div>


        {/* ── Customer note banner — all visible orders that have buyer notes ── */}
        {(() => {
          const noteOrders = selectedOrderId
            ? data?.orders.filter(o => o.id === selectedOrderId && o.customerNotes)
            : sortedOrders.filter(o => o.customerNotes);
          if (!noteOrders?.length) return null;
          return (
            <div className="mb-1 space-y-1">
              {noteOrders.map(o => (
                <div key={o.id} className="flex items-start gap-1.5 px-2.5 py-2 rounded border border-amber-500/25 bg-amber-500/5 text-[11px] text-amber-200/90 leading-snug">
                  <MessageCircle className="w-3 h-3 shrink-0 mt-px text-amber-400 fill-current" />
                  <div className="min-w-0 flex-1">
                    <span className="font-mono text-amber-400/70 mr-1">
                      {orderShortCodeMap.get(o.orderNumber) ?? shortCode(o.orderNumber)}
                    </span>
                    <span className="line-clamp-2 break-words">{o.customerNotes}</span>
                  </div>
                </div>
              ))}
            </div>
          );
        })()}

        {/* ── Tab switcher: Fulfillment | Shipping | Orders flyout ── */}
        <div className="tool-tab-bar">
          <button
            onClick={() => setActiveTab('picklist')}
            className={`tool-tab ${activeTab === 'picklist' ? 'border-orange-500 text-orange-400' : 'tool-tab-off'}`}
            data-testid="tab-picklist"
          >
            <ClipboardList className="w-3.5 h-3.5" />
            Fulfillment
          </button>
          <button
            onClick={() => setActiveTab('shipping')}
            className={`tool-tab ${activeTab === 'shipping' ? 'border-purple-500 text-purple-400' : 'tool-tab-off'}`}
            data-testid="tab-shipping"
          >
            <Truck className="w-3.5 h-3.5" />
            Shipping
          </button>
          <button
            onClick={() => setActiveTab('feedback')}
            className={`tool-tab ${activeTab === 'feedback' ? 'border-teal-400 text-teal-300' : 'tool-tab-off'}`}
            data-testid="tab-feedback"
          >
            <Star className="w-3.5 h-3.5" />
            Feedback
            {feedbackPending.length > 0 && (
              <span className="ml-1 text-[9px] font-bold bg-teal-500/20 text-teal-300 rounded-full px-1.5 py-0.5 tabular-nums">
                {feedbackPending.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setDrawerOpen(true)}
            data-testid="button-open-orders-drawer"
            title={sortedOrders.length > 0 ? `${selectedOrders.size} of ${sortedOrders.length} orders selected` : 'Open orders panel'}
            className="ml-auto flex items-center gap-1.5 px-2 py-1 rounded-md text-gray-500 hover:text-gray-200 hover:bg-white/5 transition-colors"
          >
            {sortedOrders.length > 0 && (
              <span className="text-[10px] font-bold tabular-nums text-gray-400">{selectedOrders.size}/{sortedOrders.length}</span>
            )}
            <PanelRight className="w-4 h-4" />
          </button>
        </div>

        {/* ── Tab-specific action bar — full width ── */}
        {activeTab === 'picklist' && (
          <div className="flex items-center justify-center gap-1 px-1 py-1.5 border-b border-gray-700/60 overflow-x-auto scrollbar-hide">
            <Button
              size="sm"
              variant="ghost"
              disabled={selectedOrders.size === 0}
              onClick={handlePrintPicklist}
              className="text-gray-300 text-xs whitespace-nowrap shrink-0"
              data-testid="button-print-picklist"
            >
              <ClipboardList className="w-3.5 h-3.5 mr-1.5" />
              Picklist
            </Button>
            <div className="w-px h-4 bg-gray-700 mx-0.5 shrink-0" />
            <Button
              size="sm"
              variant="ghost"
              disabled={selectedOrders.size === 0}
              onClick={() => handlePrintPackingSlips(Array.from(selectedOrders))}
              className="text-gray-300 text-xs whitespace-nowrap shrink-0"
              data-testid="button-print-packing-slips"
            >
              <Printer className="w-3.5 h-3.5 mr-1.5" />
              Packing Slips
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={selectedOrders.size === 0}
              onClick={() => handlePrintLotLabels(Array.from(selectedOrders))}
              className="text-gray-300 text-xs whitespace-nowrap shrink-0"
              data-testid="button-print-lot-labels"
            >
              <Tag className="w-3.5 h-3.5 mr-1.5" />
              Lot Labels
            </Button>
          </div>
        )}
        {!isSplitMode && activeTab === 'shipping' && (
          <div ref={actionRowRef} className="flex items-center justify-center gap-1 px-1 py-1.5 border-b border-gray-700/60 overflow-x-auto scrollbar-hide">
            <Button
              ref={shipBtnRef}
              size="sm"
              variant="ghost"
              disabled={shippableCount === 0 || isShippingAll}
              onClick={() => setShowShipConfirmDialog(true)}
              className="text-gray-300 text-xs whitespace-nowrap shrink-0"
              data-testid="button-ship-all"
            >
              {isShippingAll
                ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Shipping...</>
                : <><Truck className="w-3.5 h-3.5 mr-1.5" />Ship{shippableCount > 0 ? ` (${shippableCount})` : ''}</>
              }
            </Button>
            <div className="w-px h-4 bg-gray-700 mx-0.5 shrink-0" />
            <Button
              size="sm"
              variant="ghost"
              disabled={scanFormMutation.isPending || (endOfDayData?.count === 0 && !scanFormUrl)}
              onClick={() => scanFormUrl ? window.open(scanFormUrl, '_blank') : scanFormMutation.mutate()}
              className="text-gray-300 text-xs whitespace-nowrap shrink-0"
              data-testid="button-end-of-day-scan"
            >
              {scanFormMutation.isPending
                ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Generating...</>
                : scanFormUrl
                  ? <><ExternalLink className="w-3.5 h-3.5 mr-1.5" />Reopen EOD</>
                  : <><ScanLine className="w-3.5 h-3.5 mr-1.5" />EOD Form{endOfDayData && endOfDayData.count > 0 && ` (${endOfDayData.count})`}</>
              }
            </Button>
            {!scanFormUrl && endOfDayData && endOfDayData.count > 0 && (
              <Button
                size="icon"
                variant="ghost"
                disabled={clearEodBacklogMutation.isPending}
                onClick={() => {
                  if (confirm(`Mark all ${endOfDayData.count} queued shipment${endOfDayData.count !== 1 ? 's' : ''} as already manifested? Use this to clear test/stale data.`)) {
                    clearEodBacklogMutation.mutate();
                  }
                }}
                className="text-gray-500 hover:text-red-400 shrink-0"
                title="Clear EOD backlog (mark all as manifested)"
                data-testid="button-clear-eod-backlog"
              >
                {clearEodBacklogMutation.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Trash2 className="w-3.5 h-3.5" />
                }
              </Button>
            )}
          </div>
        )}

        {/* ── Tab content ── */}
        <div className="mt-3">
        {activeTab === 'picklist' ? (
          <PicklistTool filterOrderIds={selectedOrders} />
        ) : activeTab === 'feedback' ? (
          <div className="space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 text-teal-400" />
                <span className="text-sm font-bold text-teal-300">Customer Feedback</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500">
                  {feedbackPending.length} order{feedbackPending.length !== 1 ? 's' : ''} need feedback
                </span>
                <Button size="sm" variant="ghost" onClick={() => refetchFeedback()} className="text-gray-400 h-7 px-2">
                  <RotateCcw className="w-3 h-3" />
                </Button>
              </div>
            </div>

            {feedbackPending.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <CheckCheck className="w-8 h-8 text-teal-500/60" />
                <p className="text-sm font-semibold text-teal-300">All caught up!</p>
                <p className="text-xs text-gray-500">No shipped orders are missing feedback.</p>
              </div>
            ) : (
              (() => {
                const groups = new Map<string, typeof feedbackPending>();
                for (const o of feedbackPending) {
                  const key = o.marketplace ?? 'Unknown';
                  if (!groups.has(key)) groups.set(key, []);
                  groups.get(key)!.push(o);
                }
                return Array.from(groups.entries()).map(([marketplace, orders]) => (
                  <div key={marketplace} className="app-card-muted rounded-lg overflow-hidden">
                    {/* Marketplace header */}
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-teal-900/10">
                      <Globe className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                      <span className="text-xs font-bold text-teal-300 uppercase tracking-wide">{marketplace}</span>
                      <span className="ml-auto text-[10px] text-gray-500 tabular-nums">{orders.length}</span>
                    </div>
                    {/* Order rows */}
                    <div className="divide-y divide-white/5">
                      {orders.map(o => {
                        const shipped = o.shipDate ? new Date(o.shipDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
                        const total = o.orderTotal ? `$${parseFloat(o.orderTotal).toFixed(2)}` : '—';
                        const isSubmitting = markFeedbackMutation.isPending && markFeedbackMutation.variables?.orderId === o.id;
                        const fbRating = getFbRating(o.id);
                        const fbComment = getFbComment(o.id);
                        return (
                          <div key={o.id} className="px-3 py-2.5 space-y-2" data-testid={`feedback-row-${o.id}`}>
                            {/* Buyer + order meta */}
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="flex-1 min-w-0">
                                <span className="text-xs font-semibold text-white truncate block" data-testid={`text-buyer-${o.id}`}>
                                  {o.customerUsername ?? 'Unknown Buyer'}
                                </span>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-[10px] text-gray-500 font-mono">#{shortCode(o.orderNumber)}</span>
                                  <span className="text-[9px] text-gray-600">·</span>
                                  <span className="text-[10px] text-gray-500">Shipped {shipped}</span>
                                  <span className="text-[9px] text-gray-600">·</span>
                                  <span className="text-[10px] text-gray-400 font-mono tabular-nums">{total}</span>
                                </div>
                              </div>
                            </div>
                            {/* Rating + comment + Done */}
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {/* Rating picker */}
                              <div className="flex items-center gap-0.5 rounded-md border border-white/10 p-0.5 bg-black/20 shrink-0">
                                {([
                                  { value: 'positive' as const, icon: ThumbsUp, label: 'Praise', activeClass: 'text-green-400 bg-green-900/40' },
                                  { value: 'neutral'  as const, icon: Minus,    label: 'Neutral', activeClass: 'text-yellow-400 bg-yellow-900/40' },
                                  { value: 'negative' as const, icon: ThumbsDown, label: 'Complaint', activeClass: 'text-red-400 bg-red-900/40' },
                                ] as const).map(({ value, icon: Icon, label, activeClass }) => (
                                  <button
                                    key={value}
                                    type="button"
                                    title={label}
                                    onClick={() => setFbRating(o.id, value)}
                                    data-testid={`button-fb-${value}-${o.id}`}
                                    className={`flex items-center justify-center w-6 h-6 rounded transition-colors ${fbRating === value ? activeClass : 'text-gray-500 hover:text-gray-300'}`}
                                  >
                                    <Icon className="w-3 h-3" />
                                  </button>
                                ))}
                              </div>
                              {/* Optional comment */}
                              <input
                                type="text"
                                placeholder="Comment (optional)"
                                value={fbComment}
                                onChange={e => setFbComment(o.id, e.target.value)}
                                data-testid={`input-fb-comment-${o.id}`}
                                className="flex-1 min-w-0 bg-black/20 border border-white/10 rounded-md px-2 h-7 text-[11px] text-gray-300 placeholder-gray-600 focus:outline-none focus:border-teal-500/50"
                              />
                              {/* Done button */}
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={isSubmitting || !fbRating}
                                onClick={() => markFeedbackMutation.mutate({ orderId: o.id, rating: fbRating ?? undefined, comment: fbComment || undefined })}
                                className={`text-xs shrink-0 gap-1 h-7 px-2 ${fbRating ? 'text-teal-400' : 'text-gray-600'}`}
                                data-testid={`button-feedback-done-${o.id}`}
                              >
                                {isSubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCheck className="w-3 h-3" />}
                                Done
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ));
              })()
            )}
          </div>
        ) : (
          <div className="space-y-4">

            {/* Batch Labels Results Panel */}
            {batchResults.length > 0 && (
              <div className="border border-green-500/40 rounded-lg overflow-hidden bg-green-950/20">
                <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-green-500/30 bg-green-900/20">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-400" />
                    <span className="text-sm font-bold text-green-300">
                      {batchResults.filter(r => r.trackingNumber).length} of {batchResults.length} Labels Purchased
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-green-500/40 text-green-300"
                      onClick={async () => {
                        const sortedResults = [...batchResults].sort((a, b) =>
                          shortCode(a.orderNumber).localeCompare(shortCode(b.orderNumber))
                        );
                        const urls = sortedResults.map(r => r.labelUrl).filter(Boolean) as string[];
                        if (urls.length === 0) return;
                        if (urls.length === 1) {
                          window.open(urls[0], "_blank");
                          return;
                        }
                        // Open the window SYNCHRONOUSLY within the click event so the
                        // browser never considers it a popup. Then navigate it to the
                        // merged PDF once the server responds.
                        const pw = window.open("", "_blank");
                        if (!pw) {
                          toast({ title: "Popup blocked", description: "Allow popups for this site and try again.", variant: "destructive" });
                          return;
                        }
                        pw.document.write('<html><body style="font-family:sans-serif;padding:2rem;color:#555;background:#111">Merging labels\u2026</body></html>');
                        try {
                          const resp = await fetch("/api/labels/combined", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ labelUrls: urls }),
                          });
                          if (!resp.ok) throw new Error(await resp.text());
                          const blob = await resp.blob();
                          pw.location.href = URL.createObjectURL(blob);
                        } catch (e: any) {
                          pw.close();
                          toast({ title: "Failed to combine labels", description: e.message, variant: "destructive" });
                        }
                      }}
                      data-testid="button-print-all-labels"
                    >
                      <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                      Open All Labels
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-gray-500"
                      onClick={() => {
                        // Only deselect orders that were actually processed in this batch.
                        // Orders that were selected but not shippable (no rate) stay selected.
                        const shippedIds = new Set(batchResults.map(r => r.orderId));
                        setSelectedOrders(prev => {
                          const next = new Set(prev);
                          shippedIds.forEach(id => next.delete(id));
                          return next;
                        });
                        setBatchResults([]);
                        setPurchasedLabels(new Map());
                      }}
                      data-testid="button-dismiss-batch-results"
                    >
                      Done
                    </Button>
                  </div>
                </div>
                <div className="divide-y divide-green-900/30">
                  {batchResults.map((result) => (
                    <div key={result.orderId} className="flex items-center gap-3 px-3 py-2 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-white">{result.orderNumber}</span>
                          {result.service && (
                            <span className="text-xs text-gray-400">{result.service}</span>
                          )}
                        </div>
                        {result.trackingNumber ? (
                          <p className="text-[11px] font-mono text-gray-300 mt-0.5">{result.trackingNumber}</p>
                        ) : (
                          <p className="text-[11px] text-red-400 mt-0.5">Purchase failed</p>
                        )}
                      </div>
                      {result.labelUrl && (
                        <Button asChild variant="outline" size="sm" className="shrink-0 border-green-500/40 text-green-300">
                          <a href={result.labelUrl} target="_blank" rel="noopener noreferrer" data-testid={`button-label-${result.orderId}`}>
                            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                            Label
                          </a>
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Shipping cards — visible when orders are selected */}
            {selectedOrders.size > 0 ? (
              <div>
                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wide flex items-center gap-1.5 mb-3">
                  <Truck className="w-4 h-4 text-purple-400" />
                  Selected Orders
                </h3>
                {/* Pre-group orders so merged pairs render together */}
                {(() => {
                  const toOrderItem = (item: FulfillmentItem): OrderItem => ({
                    id: item.id, sku: item.sku, bricklinkPartNumber: item.bricklinkPartNumber,
                    name: item.name, quantity: item.quantity, colorName: item.colorName,
                    condition: item.condition, binName: item.binName,
                  });

                  // Build groups: merged pairs share a group, standalone orders are alone
                  const orderArr = [...selectedOrders];
                  const seen = new Set<string>();
                  const orderGroups: string[][] = [];
                  for (const oid of orderArr) {
                    if (seen.has(oid)) continue;
                    const o = allOrders.find(x => x.id === oid);
                    const sibId = o?.mergeGroupId
                      ? orderArr.find(id => id !== oid && allOrders.find(x => x.id === id)?.mergeGroupId === o.mergeGroupId)
                      : null;
                    if (sibId && !seen.has(sibId)) {
                      orderGroups.push([oid, sibId]);
                      seen.add(oid); seen.add(sibId);
                    } else {
                      orderGroups.push([oid]);
                      seen.add(oid);
                    }
                  }

                  const renderCard = (orderId: string) => {
                    const order = allOrders.find(o => o.id === orderId);
                    const items: OrderItem[] = (data?.items ?? [])
                      .filter(item => item.orderId === orderId).map(toOrderItem);
                    const siblingOrder = order?.mergeGroupId
                      ? allOrders.find(o => o.mergeGroupId === order.mergeGroupId && o.id !== orderId)
                      : null;
                    const siblingItems: OrderItem[] = siblingOrder
                      ? (data?.items ?? []).filter(item => item.orderId === siblingOrder.id).map(toOrderItem)
                      : [];
                    const siblingOrderRef = siblingOrder
                      ? `${siblingOrder.marketplace === 'BrickOwl' ? 'BO.' : 'BL.'}${(siblingOrder.orderNumber ?? '').replace(/^(BL\.|BO\.)/i, '')}`
                      : undefined;
                    // Split-from reference: find parent order formatted ref
                    const parentOrder = order?.parentOrderId
                      ? allOrders.find(o => o.id === order.parentOrderId)
                      : null;
                    const splitFromRef = parentOrder
                      ? `${parentOrder.marketplace === 'BrickOwl' ? 'BO.' : 'BL.'}${(parentOrder.orderNumber ?? '').replace(/^(BL\.|BO\.)/i, '')}`
                      : (order?.localOnly && order?.parentOrderId ? order.parentOrderId : null);
                    const isThisCardSplitting = isSplitMode && splitTargetOrderId === orderId;
                    const splitItems = (data?.items ?? []).filter(i => i.orderId === orderId);

                    return (
                      <div key={orderId} className="space-y-1">
                        {isThisCardSplitting ? (
                          /* ── Inline split item selector ── */
                          <div className="border border-orange-500/40 rounded-lg bg-orange-950/20 p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5">
                                <Scissors className="w-3.5 h-3.5 text-orange-400" />
                                <span className="text-xs font-semibold text-orange-300">
                                  Select items to split out from {order?.orderNumber}
                                </span>
                              </div>
                              <Button size="sm" variant="ghost" onClick={handleCancelSplit}
                                className="text-gray-400 text-xs h-6 px-2"
                                data-testid="button-cancel-split-inline"
                              >
                                <X className="w-3 h-3 mr-1" />Cancel
                              </Button>
                            </div>
                            <div className="space-y-1 max-h-48 overflow-y-auto">
                              {splitItems.map(item => (
                                <label key={item.id}
                                  className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer rounded px-2 py-1 hover-elevate"
                                >
                                  <input
                                    type="checkbox"
                                    className="accent-orange-500 w-3.5 h-3.5"
                                    checked={selectedItemsForSplit.has(item.id)}
                                    onChange={() => handleItemSplitToggle(item.id)}
                                    data-testid={`checkbox-split-item-${item.id}`}
                                  />
                                  <span className="flex-1 truncate">
                                    {item.bricklinkPartNumber && <span className="font-mono text-gray-400 mr-1">{item.bricklinkPartNumber}</span>}
                                    {item.name}
                                    {item.colorName && <span className="text-gray-500"> · {item.colorName}</span>}
                                    {item.condition && <span className="text-gray-500"> · {item.condition}</span>}
                                  </span>
                                  <span className="text-gray-400 shrink-0">×{item.quantity}</span>
                                </label>
                              ))}
                            </div>
                            <div className="flex justify-end">
                              <Button
                                size="sm"
                                disabled={selectedItemsForSplit.size === 0}
                                onClick={handleConfirmSplit}
                                className="bg-orange-600 text-xs h-7"
                                data-testid="button-confirm-split-inline"
                              >
                                <Scissors className="w-3 h-3 mr-1.5" />
                                Split {selectedItemsForSplit.size > 0 ? `${selectedItemsForSplit.size} item${selectedItemsForSplit.size !== 1 ? 's' : ''}` : ''}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <InlineShippingCard
                            orderId={orderId}
                            isTestMode={settings?.easypostKeyMode === 'test'}
                            onReadyChange={handleReadyChange}
                            purchasedLabel={purchasedLabels.get(orderId)}
                            orderItems={items}
                            siblingItems={siblingItems}
                            siblingOrderRef={siblingOrderRef}
                            splitFromRef={splitFromRef}
                            internalNotes={order?.internalNotes ?? null}
                            onSplit={!isThisCardSplitting ? () => handleInitiateSplit(orderId) : undefined}
                            onMerge={!isThisCardSplitting ? () => { setMergeDialog({ orderId, mergeGroupId: order?.mergeGroupId ?? null }); setMergeSearch(''); } : undefined}
                            onMarkAsShipped={!isThisCardSplitting ? () => {
                              const base = allOrders.find(o => o.id === orderId);
                              const linked = base?.mergeGroupId
                                ? allOrders.filter(o =>
                                    o.id !== orderId
                                    && o.mergeGroupId === base.mergeGroupId
                                    && (o.workflowStatus || 'new') !== 'done'
                                  ).map(o => ({ id: o.id, orderNumber: o.orderNumber, marketplace: o.marketplace ?? null }))
                                : [];
                              setShipFreeDialog({
                                orderId,
                                orderNumber: order?.orderNumber ?? orderId,
                                marketplace: order?.marketplace ?? null,
                                linkedOrders: linked,
                              });
                              setShipFreeTracking('');
                              setShipFreeNote('');
                              setShipFreeAlsoShip(new Set(linked.map(o => o.id)));
                            } : undefined}
                          />
                        )}
                      </div>
                    );
                  }; // end renderCard

                  return (
                    <div className="space-y-2">
                      {orderGroups.map((group) => {
                        if (group.length >= 2) {
                          return (
                            <div key={group.join('-')} className="border-l-2 border-amber-500/30 pl-2 space-y-1">
                              {group.map(oid => renderCard(oid))}
                            </div>
                          );
                        }
                        return renderCard(group[0]);
                      })}
                    </div>
                  );
                })()}
              </div>
            ) : (
              <p className="text-sm text-gray-500 text-center py-8">Select orders above to see shipping options.</p>
            )}

          </div>
        )}

        </div> {/* end tab content */}
      </div> {/* end main layout */}

      {/* Ship Confirmation Dialog */}
      <Dialog open={showShipConfirmDialog} onOpenChange={setShowShipConfirmDialog}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="w-5 h-5 text-purple-400" />
              Confirm Shipment
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Alert className="bg-purple-500/10 border-purple-500/30">
              <ShieldCheck className="h-4 w-4 text-purple-400" />
              <AlertDescription className="text-purple-200">
                <p className="font-semibold mb-1">
                  You are about to ship {shippableCount} order{shippableCount !== 1 ? 's' : ''}.
                </p>
                <p className="text-sm text-purple-300">
                  Each order will be marked as shipped in E.L.F.I.E. and the shipped status will be sent to the marketplace channel (BrickLink / BrickOwl).
                </p>
              </AlertDescription>
            </Alert>

            {/* Warn if some selected orders don't have rates and will be skipped */}
            {selectedOrders.size > shippableCount && (
              <Alert className="bg-amber-500/10 border-amber-500/30">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <AlertDescription className="text-amber-200 text-sm">
                  <span className="font-semibold">{selectedOrders.size - shippableCount} selected order{selectedOrders.size - shippableCount !== 1 ? 's' : ''} will not be shipped</span> — no rate selected yet. They'll stay selected so you can finish configuring them after this batch.
                </AlertDescription>
              </Alert>
            )}

            {/* List the orders being shipped */}
            <div className="app-card p-3">
              <p className="app-label mb-2">
                Orders to ship
              </p>
              <div className="space-y-1 max-h-[180px] overflow-y-auto">
                {shippableOrderIds.map(orderId => {
                  const order = data?.orders.find(o => o.id === orderId);
                  const ready = readyToShip.get(orderId);
                  return (
                    <div key={orderId} className="flex items-center justify-between gap-2 text-xs bg-gray-900/50 rounded px-2 py-1.5 flex-wrap">
                      <span className="font-mono font-semibold text-white">{order?.orderNumber ?? orderId}</span>
                      {ready && (
                        <span className="text-gray-400">
                          {ready.selectedRate.service}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowShipConfirmDialog(false)}
                data-testid="button-cancel-ship-confirm"
              >
                Cancel
              </Button>
              <Button
                onClick={handleShipAll}
                disabled={isShippingAll}
                className="bg-purple-600 hover:bg-purple-700"
                data-testid="button-execute-ship"
              >
                {isShippingAll
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Shipping...</>
                  : <><Truck className="w-4 h-4 mr-2" />Ship {shippableCount} Order{shippableCount !== 1 ? 's' : ''}</>
                }
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Split Order Confirmation Dialog */}
      <Dialog open={showSplitConfirmDialog} onOpenChange={setShowSplitConfirmDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scissors className="w-5 h-5 text-orange-500" />
              Confirm Order Split
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Alert className="bg-orange-500/10 border-orange-500/30">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              <AlertDescription className="text-orange-200">
                <p className="font-semibold mb-1">This action will split the order:</p>
                <p className="text-sm">
                  Current order: <span className="font-mono">{data?.orders.find(o => o.id === splitTargetOrderId)?.orderNumber}</span>
                  <br />
                  New order: <span className="font-mono">{splitOrderNumber}</span>
                </p>
              </AlertDescription>
            </Alert>

            <div className="app-card p-3">
              <p className="text-sm font-semibold text-gray-300 mb-2">
                Items moving to {splitOrderNumber}:
              </p>
              <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                {data?.items
                  .filter(item => selectedItemsForSplit.has(item.id))
                  .map(item => (
                    <div key={item.id} className="text-xs text-gray-400 bg-gray-900/50 rounded px-2 py-1">
                      {item.bricklinkPartNumber && `${item.bricklinkPartNumber} - `}
                      {item.name}
                      {item.colorName && ` • ${item.colorName}`}
                      {item.condition && ` • ${item.condition}`}
                      {` • Qty ${item.quantity}`}
                    </div>
                  ))}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowSplitConfirmDialog(false)}
                data-testid="button-cancel-split-confirm"
              >
                Cancel
              </Button>
              <Button
                onClick={handleExecuteSplit}
                className="bg-orange-600 hover:bg-orange-700"
                data-testid="button-execute-split"
              >
                <Scissors className="w-4 h-4 mr-2" />
                Split Order
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Merge Order Dialog ── */}
      {(() => {
        if (!mergeDialog) return null;
        const sourceOrder = allOrders.find(o => o.id === mergeDialog.orderId);
        const lowerSearch = mergeSearch.toLowerCase();

        // Split candidates into already-linked and others
        const linked: typeof allOrders = [];
        const others: typeof allOrders = [];
        for (const o of allOrders) {
          if (o.id === mergeDialog.orderId) continue;
          if (mergeDialog.mergeGroupId && o.mergeGroupId === mergeDialog.mergeGroupId) {
            linked.push(o);
          } else {
            others.push(o);
          }
        }
        const filteredOthers = lowerSearch
          ? others.filter(o =>
              (o.orderNumber ?? '').toLowerCase().includes(lowerSearch) ||
              (o.customerUsername ?? '').toLowerCase().includes(lowerSearch)
            )
          : others;

        return (
          <Dialog open={!!mergeDialog} onOpenChange={() => { setMergeDialog(null); setMergeSearch(''); }}>
            <DialogContent className="sm:max-w-[480px]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Link2 className="w-5 h-5 text-blue-400" />
                  Merge Order {sourceOrder?.orderNumber}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <p className="text-sm text-gray-400">
                  Link this order with another so they ship together. Already-linked orders are shown first.
                </p>

                {/* Already-linked orders */}
                {linked.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-blue-300 uppercase tracking-wide">Already Linked</p>
                    {linked.map(o => (
                      <div key={o.id}
                        className="flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-blue-500/30 bg-blue-900/20"
                      >
                        <div className="text-sm min-w-0">
                          <span className="font-mono text-white">{o.orderNumber}</span>
                          {o.customerUsername && <span className="text-gray-400 ml-2">· {o.customerUsername}</span>}
                          <span className="text-gray-500 ml-2">{o.marketplace}</span>
                        </div>
                        <button
                          onClick={() => unlinkMergeMutation.mutate({ orderId: o.id })}
                          disabled={unlinkMergeMutation.isPending}
                          className="text-xs text-red-400 hover:text-red-300 font-semibold shrink-0 px-1.5 py-0.5 rounded hover-elevate"
                          data-testid={`button-unlink-merge-${o.id}`}
                        >
                          {unlinkMergeMutation.isPending ? 'Unlinking…' : 'Unlink'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Search other orders */}
                <div className="space-y-1">
                  {linked.length > 0 && (
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Other Orders</p>
                  )}
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                    <input
                      type="text"
                      placeholder="Search by order # or customer…"
                      value={mergeSearch}
                      onChange={e => setMergeSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 text-sm bg-gray-800 border border-gray-700 rounded-md text-gray-200 placeholder-gray-500 outline-none focus:border-blue-500/60"
                      data-testid="input-merge-search"
                    />
                  </div>
                  <div className="space-y-1 max-h-52 overflow-y-auto">
                    {filteredOthers.length === 0 && (
                      <p className="text-xs text-gray-500 text-center py-4">No matching orders.</p>
                    )}
                    {filteredOthers.map(o => (
                      <button
                        key={o.id}
                        onClick={() => linkMergeMutation.mutate({ orderId: mergeDialog.orderId, targetOrderId: o.id })}
                        disabled={linkMergeMutation.isPending}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-left hover-elevate border border-gray-700/60"
                        data-testid={`button-merge-target-${o.id}`}
                      >
                        <div className="text-sm min-w-0">
                          <span className="font-mono text-white">{o.orderNumber}</span>
                          {o.customerUsername && <span className="text-gray-400 ml-2 truncate">· {o.customerUsername}</span>}
                          <span className="text-gray-500 ml-2 shrink-0">{o.marketplace}</span>
                        </div>
                        {linkMergeMutation.isPending && (
                          <Loader2 className="w-3.5 h-3.5 text-gray-500 animate-spin shrink-0" />
                        )}
                        {!linkMergeMutation.isPending && (
                          <Link2 className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button variant="outline" onClick={() => { setMergeDialog(null); setMergeSearch(''); }}
                    data-testid="button-done-merge"
                  >
                    Done
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* ── Ship Without Label Dialog ── */}
      <Dialog
        open={!!shipFreeDialog}
        onOpenChange={(open) => { if (!open) { setShipFreeDialog(null); setShipFreeTracking(''); setShipFreeNote(''); setShipFreeAlsoShip(new Set()); } }}
      >
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5 text-emerald-400" />
              Ship Without Label — {shipFreeDialog?.orderNumber}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Alert className="bg-emerald-500/10 border-emerald-500/30">
              <PackageCheck className="h-4 w-4 text-emerald-400" />
              <AlertDescription className="text-emerald-200 text-sm">
                This will mark the order as shipped and update{' '}
                <span className="font-semibold">{shipFreeDialog?.marketplace ?? 'the marketplace'}</span> directly.
                It bypasses label purchase and end-of-day scanning.
              </AlertDescription>
            </Alert>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                Tracking # <span className="font-normal text-gray-500">(optional)</span>
              </label>
              <input
                type="text"
                value={shipFreeTracking}
                onChange={e => setShipFreeTracking(e.target.value)}
                placeholder="e.g. 9400111899223450523107"
                className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-md text-gray-200 placeholder-gray-500 outline-none focus:border-emerald-500/60"
                data-testid="input-ship-free-tracking"
              />
              <p className="text-xs text-gray-500">
                If provided, sent to the marketplace and stored for your records.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                Internal note <span className="font-normal text-gray-500">(optional)</span>
              </label>
              <textarea
                value={shipFreeNote}
                onChange={e => setShipFreeNote(e.target.value)}
                placeholder="e.g. Shipped via local courier, no tracking available"
                rows={2}
                className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-md text-gray-200 placeholder-gray-500 outline-none focus:border-emerald-500/60 resize-none"
                data-testid="input-ship-free-note"
              />
            </div>

            {shipFreeDialog && shipFreeDialog.linkedOrders.length > 0 && (
              <div className="space-y-2 border border-blue-500/30 rounded-md p-3 bg-blue-500/5">
                <p className="text-xs font-semibold text-blue-300 uppercase tracking-wide flex items-center gap-1.5">
                  <Link2 className="w-3 h-3" />
                  Also ship linked order{shipFreeDialog.linkedOrders.length !== 1 ? 's' : ''} — same tracking, no label
                </p>
                <p className="text-xs text-gray-400">
                  These orders are in the same merge group. Checking them marks them shipped with the same tracking number at no extra cost.
                </p>
                <div className="space-y-1.5 mt-1">
                  {shipFreeDialog.linkedOrders.map(o => (
                    <label key={o.id} className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={shipFreeAlsoShip.has(o.id)}
                        onChange={e => {
                          setShipFreeAlsoShip(prev => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(o.id); else next.delete(o.id);
                            return next;
                          });
                        }}
                        className="accent-blue-400"
                        data-testid={`checkbox-also-ship-${o.id}`}
                      />
                      <span className="text-sm text-gray-200 font-medium">{o.orderNumber}</span>
                      {o.marketplace && (
                        <span className="text-xs text-gray-500">{o.marketplace}</span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => { setShipFreeDialog(null); setShipFreeTracking(''); setShipFreeNote(''); setShipFreeAlsoShip(new Set()); }}
                data-testid="button-cancel-ship-free"
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmShipFree}
                disabled={shipFreeSubmitting}
                className="bg-emerald-600"
                data-testid="button-confirm-ship-free"
              >
                {shipFreeSubmitting
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Shipping...</>
                  : <><PackageCheck className="w-4 h-4 mr-2" />
                      {shipFreeDialog && shipFreeAlsoShip.size > 0
                        ? `Ship ${1 + shipFreeAlsoShip.size} Orders`
                        : 'Mark as Shipped'
                      }
                    </>
                }
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Post-label-purchase merge sibling prompt ── */}
      <Dialog
        open={!!mergeShipDialog}
        onOpenChange={(open) => { if (!open) { setMergeShipDialog(null); setMergeShipSelected(new Set()); } }}
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="w-5 h-5 text-blue-400" />
              Linked Orders Detected
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Alert className="bg-blue-500/10 border-blue-500/30">
              <PackageCheck className="h-4 w-4 text-blue-400" />
              <AlertDescription className="text-blue-200 text-sm">
                The orders below are merged with ones you just shipped. You can mark them shipped with the same tracking number — no additional label purchase required.
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              {mergeShipDialog?.items.map(item => (
                <label key={item.orderId} className="flex items-start gap-3 p-2.5 rounded-md bg-gray-800/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mergeShipSelected.has(item.orderId)}
                    onChange={e => {
                      setMergeShipSelected(prev => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(item.orderId); else next.delete(item.orderId);
                        return next;
                      });
                    }}
                    className="accent-blue-400 mt-0.5"
                    data-testid={`checkbox-merge-ship-${item.orderId}`}
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-200">{item.orderNumber}</div>
                    {item.marketplace && (
                      <div className="text-xs text-gray-500">{item.marketplace}</div>
                    )}
                    <div className="text-xs text-gray-400 mt-0.5 font-mono truncate">
                      Tracking: {item.trackingNumber || '—'}
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => { setMergeShipDialog(null); setMergeShipSelected(new Set()); }}
                data-testid="button-skip-merge-ship"
              >
                Skip
              </Button>
              <Button
                onClick={handleMergeShip}
                disabled={mergeShipPending || mergeShipSelected.size === 0}
                className="bg-blue-600"
                data-testid="button-confirm-merge-ship"
              >
                {mergeShipPending
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Shipping...</>
                  : <><PackageCheck className="w-4 h-4 mr-2" />Ship {mergeShipSelected.size} Order{mergeShipSelected.size !== 1 ? 's' : ''}</>
                }
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </>
  );
}
