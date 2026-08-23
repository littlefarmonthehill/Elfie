import { and, eq, inArray, ne } from "drizzle-orm";
import { createHash } from "crypto";
import { db } from "../db";
import { historicalOrderRecovery, orderDetails, orders, shipstationOrderMappings, PLATFORM_ORG_ID } from "@shared/schema";

const SHIPSTATION_API_URL = "https://ssapi.shipstation.com";
const PAGE_SIZE = 500;
const MAX_PAGES = 1_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

export type RecoveryDecision = "confirm_add" | "confirm_quantity" | "skip";
export type RecoveryCandidateType = "missing_line_item" | "quantity_mismatch" | "ambiguous";

export interface ShipStationOrderItem {
  orderItemId?: number | string | null;
  lineItemKey?: string | null;
  sku?: string | null;
  name?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  taxAmount?: number | null;
  weight?: { value?: number | null; units?: string | null } | null;
  options?: unknown;
  productId?: number | string | null;
  adjustment?: boolean | null;
  upc?: string | null;
  imageUrl?: string | null;
  warehouseLocation?: string | null;
  fulfillmentSku?: string | null;
  customField1?: string | null;
  customField2?: string | null;
  customField3?: string | null;
}

export interface ShipStationOrder {
  orderId?: number | string | null;
  orderNumber?: string | null;
  orderKey?: string | null;
  orderStatus?: string | null;
  orderDate?: string | null;
  createDate?: string | null;
  modifyDate?: string | null;
  marketplaceId?: string | null;
  marketplaceName?: string | null;
  orderTotal?: number | string | null;
  amountPaid?: number | string | null;
  taxAmount?: number | string | null;
  shippingAmount?: number | string | null;
  orderItems?: ShipStationOrderItem[] | null;
  // Kept as a compatibility alias for archived exports and API proxies that
  // normalize ShipStation's canonical `orderItems` field.
  items?: ShipStationOrderItem[] | null;
}

export interface RecoveryCandidate {
  candidateKey: string;
  candidateType: RecoveryCandidateType;
  reason: string | null;
  order: {
    id: string;
    orgId: string | null;
    orderNumber: string;
    orderDate: Date;
    orderStatus: string;
    marketplace: string | null;
    orderTotal: string;
  };
  sourceOrder: {
    orderId: string | null;
    orderNumber: string | null;
    orderKey: string | null;
    orderStatus: string | null;
    orderDate: string | null;
    modifyDate: string | null;
    marketplaceName: string | null;
  };
  sourceItem: ReturnType<typeof normalizeSourceItem>;
  localItem: ReturnType<typeof serializeLocalItem> | null;
  sourceSnapshotHash: string;
  orderMappingStatus: "verified" | "order_number_only";
  review: {
    decision: string;
    reason: string | null;
    reviewedBy: string;
    reviewedAt: Date;
  } | null;
}

let cachedOrders: { expiresAt: number; orders: ShipStationOrder[] } | null = null;

function getCredentials() {
  const apiKey = process.env.SHIPSTATION_API_KEY;
  const apiSecret = process.env.SHIPSTATION_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error("ShipStation credentials are not configured");
  }
  return { apiKey, apiSecret };
}

async function shipStationRequest<T>(path: string): Promise<T> {
  const { apiKey, apiSecret } = getCredentials();
  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");
  const response = await fetch(`${SHIPSTATION_API_URL}${path}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${auth}`,
    },
  });
  if (!response.ok) {
    throw new Error(`ShipStation returned HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function getShipStationOrders(forceRefresh = false): Promise<ShipStationOrder[]> {
  if (!forceRefresh && cachedOrders && cachedOrders.expiresAt > Date.now()) {
    return cachedOrders.orders;
  }

  const allOrders: ShipStationOrder[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await shipStationRequest<{ orders?: ShipStationOrder[]; pages?: number }>(
      `/orders?page=${page}&pageSize=${PAGE_SIZE}`,
    );
    const pageOrders = Array.isArray(data.orders) ? data.orders : [];
    allOrders.push(...pageOrders);
    if (pageOrders.length < PAGE_SIZE && (!data.pages || page >= data.pages)) break;
    if (page === MAX_PAGES) {
      throw new Error(`ShipStation recovery stopped after ${MAX_PAGES} pages; scan coverage is incomplete and no repair candidates were produced.`);
    }
  }

  cachedOrders = { orders: allOrders, expiresAt: Date.now() + CACHE_TTL_MS };
  return allOrders;
}

function valueKey(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function numberKey(value: unknown): string {
  if (value == null || value === "") return "";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(4) : "";
}

function itemFingerprint(item: {
  sku?: unknown;
  name?: unknown;
  unitPrice?: unknown;
}): string {
  return [
    valueKey(item.sku).toLowerCase(),
    valueKey(item.name).toLowerCase(),
    numberKey(item.unitPrice),
  ].join("|");
}

function sourceLineItemKey(item: ShipStationOrderItem, index: number): string {
  return valueKey(item.orderItemId) || valueKey(item.lineItemKey) || `source-row-${index}`;
}

function normalizeSourceItem(item: ShipStationOrderItem, index: number) {
  const quantity = item.quantity == null ? null : Number(item.quantity);
  const unitPrice = item.unitPrice == null ? null : Number(item.unitPrice);
  const taxAmount = item.taxAmount == null ? null : Number(item.taxAmount);
  const weightValue = item.weight?.value == null ? null : Number(item.weight.value);
  return {
    lineItemKey: sourceLineItemKey(item, index),
    hasStableKey: Boolean(valueKey(item.orderItemId) || valueKey(item.lineItemKey)),
    sku: item.sku ?? null,
    name: item.name ?? null,
    quantity: Number.isInteger(quantity) ? quantity : null,
    unitPrice: Number.isFinite(unitPrice) ? unitPrice : null,
    taxAmount: Number.isFinite(taxAmount) ? taxAmount : null,
    weight: Number.isFinite(weightValue) ? weightValue : null,
    weightUnits: item.weight?.units ?? null,
    options: item.options ?? null,
    description: item.name ?? null,
    customField1: item.customField1 ?? null,
    customField2: item.customField2 ?? null,
    customField3: item.customField3 ?? null,
  };
}

function serializeLocalItem(item: typeof orderDetails.$inferSelect) {
  return {
    id: item.id,
    lineItemKey: item.lineItemKey,
    sku: item.sku,
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    taxAmount: item.taxAmount,
    weight: item.weight,
    weightUnits: item.weightUnits,
    description: item.description,
    fulfilled: item.fulfilled,
  };
}

function normalizeKey(value: unknown): string | null {
  const key = valueKey(value).toLowerCase();
  return key || null;
}

function indexOrder<T extends { id: string }>(
  index: Map<string, T[]>,
  key: string | null,
  order: T,
) {
  if (!key) return;
  const list = index.get(key) ?? [];
  list.push(order);
  index.set(key, list);
}

function uniqueMatch<T extends { id: string }>(...lists: (T[] | undefined)[]) {
  const matched = new Map<string, T>();
  for (const list of lists) {
    for (const order of list ?? []) matched.set(order.id, order);
  }
  return matched.size === 1 ? [...matched.values()][0] : null;
}

export function classifyRecoveryOrderMatch<T extends { id: string }>(
  immutableCandidates: T[],
  orderNumberCandidates: T[],
): { kind: "verified"; order: T } | { kind: "order_number_only"; order: T } | { kind: "immutable_conflict" } | { kind: "unmatched" } {
  const immutableIds = new Set(immutableCandidates.map(order => order.id));
  if (immutableIds.size === 1) {
    return { kind: "verified", order: immutableCandidates[0] };
  }
  // An immutable identifier that maps to multiple local orders is a hard stop.
  // Do not paper over the conflict with an otherwise unique order number.
  if (immutableIds.size > 1) return { kind: "immutable_conflict" };

  const orderNumberMatch = uniqueMatch(orderNumberCandidates);
  return orderNumberMatch
    ? { kind: "order_number_only", order: orderNumberMatch }
    : { kind: "unmatched" };
}

export function canConfirmShipStationLineItem(sourceItem: { hasStableKey: boolean }): boolean {
  return sourceItem.hasStableKey;
}

export function isImmutableLineConflict(error: { code?: string; constraint?: string } | null | undefined): boolean {
  return error?.code === "23505" && error.constraint === "order_details_order_line_item_key_unique";
}

function sourceSnapshotHash(sourceOrder: RecoveryCandidate["sourceOrder"], sourceItem: RecoveryCandidate["sourceItem"]) {
  return createHash("sha256").update(JSON.stringify({
    sourceOrderId: sourceOrder.orderId,
    sourceOrderModifyDate: sourceOrder.modifyDate,
    sourceLineItemKey: sourceItem.lineItemKey,
    sku: sourceItem.sku,
    name: sourceItem.name,
    quantity: sourceItem.quantity,
    unitPrice: sourceItem.unitPrice,
    taxAmount: sourceItem.taxAmount,
    weight: sourceItem.weight,
    weightUnits: sourceItem.weightUnits,
    options: sourceItem.options,
  })).digest("hex");
}

export async function getHistoricalRecoveryCandidates(options: { forceRefresh?: boolean } = {}) {
  // Credentials are account-wide. The recovery tool must not use one account's
  // ShipStation history to repair another tenant's rows. An installation with a
  // dedicated account can explicitly set SHIPSTATION_ORG_ID; the platform org is
  // the safe default for the shared platform credentials.
  const shipStationOrgId = process.env.SHIPSTATION_ORG_ID || PLATFORM_ORG_ID;
  const [localOrders, localItems, savedMappings, sourceOrders] = await Promise.all([
    db.select({
      id: orders.id,
      orgId: orders.orgId,
      orderNumber: orders.orderNumber,
      orderKey: orders.orderKey,
      orderDate: orders.orderDate,
      orderStatus: orders.orderStatus,
      marketplace: orders.marketplace,
      orderTotal: orders.orderTotal,
    }).from(orders).where(and(
      eq(orders.orgId, shipStationOrgId),
      eq(orders.isTest, false),
      ne(orders.orderStatus, "purged"),
    )),
    db.select().from(orderDetails),
    db.select().from(shipstationOrderMappings).where(eq(shipstationOrderMappings.orgId, shipStationOrgId)),
    getShipStationOrders(Boolean(options.forceRefresh)),
  ]);

  const localById = new Map<string, typeof localOrders>();
  const localByOrderKey = new Map<string, typeof localOrders>();
  const localByOrderNumber = new Map<string, typeof localOrders>();
  for (const order of localOrders) {
    indexOrder(localById, normalizeKey(order.id), order);
    indexOrder(localByOrderKey, normalizeKey(order.orderKey), order);
    indexOrder(localByOrderNumber, normalizeKey(order.orderNumber), order);
  }
  const itemsByOrder = new Map<string, typeof localItems>();
  const savedMappingBySourceId = new Map(savedMappings.map(mapping => [valueKey(mapping.sourceOrderId), mapping.localOrderId]));
  for (const item of localItems) {
    const list = itemsByOrder.get(item.orderId) ?? [];
    list.push(item);
    itemsByOrder.set(item.orderId, list);
  }

  const sourceByLocalOrder = new Map<string, ShipStationOrder>();
  const orderNumberOnlySourceByLocalOrder = new Map<string, ShipStationOrder>();
  for (const sourceOrder of sourceOrders) {
    // Only immutable ShipStation identifiers can establish a repairable
    // source-to-local mapping. Order number is merely a review aid: it can
    // collide across channels and legacy imports, so those rows are strictly
    // ambiguous and may never be confirmed as a repair.
    const mappedLocalId = savedMappingBySourceId.get(valueKey(sourceOrder.orderId));
    const immutableCandidates = [
      ...(mappedLocalId ? (localById.get(mappedLocalId) ?? []) : []),
      ...(localById.get(normalizeKey(sourceOrder.orderId) ?? "") ?? []),
      ...(localByOrderKey.get(normalizeKey(sourceOrder.orderKey) ?? "") ?? []),
    ];
    const match = classifyRecoveryOrderMatch(
      immutableCandidates,
      localByOrderNumber.get(normalizeKey(sourceOrder.orderNumber) ?? "") ?? [],
    );
    if (match.kind === "verified" && !sourceByLocalOrder.has(match.order.id)) {
      sourceByLocalOrder.set(match.order.id, sourceOrder);
      continue;
    }
    if (match.kind === "order_number_only" && !sourceByLocalOrder.has(match.order.id)) {
      orderNumberOnlySourceByLocalOrder.set(match.order.id, sourceOrder);
    }
  }

  const orderCandidates: Omit<RecoveryCandidate, "review">[] = [];
  for (const localOrder of localOrders) {
    const sourceOrder = sourceByLocalOrder.get(localOrder.id) ?? orderNumberOnlySourceByLocalOrder.get(localOrder.id);
    if (!sourceOrder) continue;
    const immutableOrderMatch = sourceByLocalOrder.has(localOrder.id);
    const sourceItems = sourceOrder.orderItems ?? sourceOrder.items;
    if (!Array.isArray(sourceItems)) continue;
    const localOrderItems = itemsByOrder.get(localOrder.id) ?? [];
    const localByLineKey = new Map<string, typeof localOrderItems[number][]>();
    const localByFingerprint = new Map<string, typeof localOrderItems[number][]>();
    for (const localItem of localOrderItems) {
      const lineKey = valueKey(localItem.lineItemKey);
      if (lineKey) {
        const list = localByLineKey.get(lineKey) ?? [];
        list.push(localItem);
        localByLineKey.set(lineKey, list);
      }
      const fingerprint = itemFingerprint({
        sku: localItem.sku,
        name: localItem.name,
        unitPrice: localItem.unitPrice,
      });
      if (fingerprint !== "||") {
        const list = localByFingerprint.get(fingerprint) ?? [];
        list.push(localItem);
        localByFingerprint.set(fingerprint, list);
      }
    }

    sourceItems.forEach((rawItem, index) => {
      const sourceItem = normalizeSourceItem(rawItem, index);
      const stableKey = valueKey(rawItem.orderItemId) || valueKey(rawItem.lineItemKey);
      const keyedMatches = stableKey ? (localByLineKey.get(stableKey) ?? []) : [];
      const fingerprintMatches = localByFingerprint.get(itemFingerprint(rawItem)) ?? [];
      let localItem = keyedMatches.length === 1 ? keyedMatches[0] : null;
      let reason: string | null = null;

      if (!localItem && !stableKey) {
        if (fingerprintMatches.length === 1) localItem = fingerprintMatches[0];
        else reason = fingerprintMatches.length > 1
          ? "The source line has no stable key and matches multiple local rows."
          : "The source line has no stable key.";
      } else if (keyedMatches.length > 1) {
        reason = "The source line key matches multiple local rows.";
      } else if (!localItem && fingerprintMatches.length > 0) {
        // A source key discrepancy is not evidence of a missing line. The
        // same SKU/name/price may be a legacy source format, so never insert a
        // second row without an independently verified mapping.
        localItem = fingerprintMatches.length === 1 ? fingerprintMatches[0] : null;
        reason = fingerprintMatches.length === 1
          ? "The source line key differs from an otherwise matching local row."
          : "The source line key differs and matches multiple plausible local rows.";
      }

      const candidateKey = `${localOrder.id}:${sourceItem.lineItemKey}${immutableOrderMatch ? "" : ":order-number-only"}`;
      const sourceOrderSummary = {
        orderId: valueKey(sourceOrder.orderId) || null,
        orderNumber: sourceOrder.orderNumber ?? null,
        orderKey: sourceOrder.orderKey ?? null,
        orderStatus: sourceOrder.orderStatus ?? null,
        orderDate: sourceOrder.orderDate ?? sourceOrder.createDate ?? null,
        modifyDate: sourceOrder.modifyDate ?? null,
        marketplaceName: sourceOrder.marketplaceName ?? null,
      };
      const base = {
        candidateKey,
        order: localOrder,
        sourceOrder: sourceOrderSummary,
        sourceItem,
        localItem: localItem ? serializeLocalItem(localItem) : null,
        sourceSnapshotHash: sourceSnapshotHash(sourceOrderSummary, sourceItem),
        orderMappingStatus: immutableOrderMatch ? "verified" as const : "order_number_only" as const,
      };

      if (!canConfirmShipStationLineItem(sourceItem)) {
        orderCandidates.push({
          ...base,
          candidateType: "ambiguous",
          reason: "The ShipStation line has no immutable line-item ID/key. It can be skipped but cannot be repaired from a fingerprint match.",
        });
      } else if (!immutableOrderMatch) {
        orderCandidates.push({
          ...base,
          candidateType: "ambiguous",
          reason: "The order number matches, but ShipStation's immutable order ID/key is not stored locally. This record can be skipped but cannot be repaired.",
        });
      } else if (reason) {
        orderCandidates.push({ ...base, candidateType: "ambiguous", reason });
      } else if (!localItem) {
        orderCandidates.push({
          ...base,
          candidateType: "missing_line_item",
          reason: sourceItem.hasStableKey ? null : "No stable ShipStation line-item key was available.",
        });
      } else if (localItem.quantity !== sourceItem.quantity && sourceItem.quantity != null) {
        orderCandidates.push({
          ...base,
          candidateType: "quantity_mismatch",
          reason: null,
        });
      }
    });
  }

  if (orderCandidates.length === 0) {
    return { candidates: [], summary: { total: 0, missingOrders: 0, missingItems: 0, quantityDifferences: 0, ambiguous: 0, reviewed: 0 } };
  }

  const keys = orderCandidates.map(candidate => candidate.candidateKey);
  const reviews = await db.select({
    candidateKey: historicalOrderRecovery.candidateKey,
    decision: historicalOrderRecovery.decision,
    reason: historicalOrderRecovery.reason,
    reviewedBy: historicalOrderRecovery.reviewedBy,
    reviewedAt: historicalOrderRecovery.reviewedAt,
  }).from(historicalOrderRecovery).where(inArray(historicalOrderRecovery.candidateKey, keys));
  const reviewByKey = new Map(reviews.map(review => [review.candidateKey, review]));
  const candidates = orderCandidates.map(candidate => ({ ...candidate, review: reviewByKey.get(candidate.candidateKey) ?? null }));
  return {
    candidates,
    summary: {
      total: candidates.length,
      missingOrders: new Set(candidates.filter(c => c.candidateType === "missing_line_item").map(c => c.order.id)).size,
      missingItems: candidates.filter(c => c.candidateType === "missing_line_item").length,
      quantityDifferences: candidates.filter(c => c.candidateType === "quantity_mismatch").length,
      ambiguous: candidates.filter(c => c.candidateType === "ambiguous").length,
      reviewed: candidates.filter(c => c.review != null).length,
    },
  };
}

export function clearShipStationRecoveryCache() {
  cachedOrders = null;
}
