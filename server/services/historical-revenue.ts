import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  historicalOrderRecovery,
  orderDetails,
  orders,
  shipstationOrderMappings,
  PLATFORM_ORG_ID,
} from "@shared/schema";
import {
  DUPLICATE_RECONCILIATION_MANIFEST,
} from "./duplicate-cleanup-status-review";
import { getShipStationOrders, type ShipStationOrder } from "./shipstation-recovery";

const EXCLUDED_REVENUE_STATUSES = new Set(["cancelled", "returned"]);
const MAX_REPORT_ORDERS = 100_000;

export type RevenueOrder = {
  orderStatus: string;
  isTest: boolean;
};

export type RevenueLine = {
  quantity: number | null;
  unitPrice: string | number | null;
};

export type RevenueAdjustment = {
  amount: string | number | null;
  type?: string | null;
};

export type HistoricalRevenueOptions = {
  orgId?: string;
  from?: Date;
  to?: Date;
  forceRefresh?: boolean;
};

export type HistoricalRevenueReport = Awaited<ReturnType<typeof getHistoricalRevenueReport>>;

export function isRevenueEligible(order: RevenueOrder): boolean {
  return !order.isTest && !EXCLUDED_REVENUE_STATUSES.has(String(order.orderStatus ?? "").trim().toLowerCase());
}

/**
 * Revenue in the Orders dashboard is based on the stored order total. Keep
 * this calculation separate from line-item recovery: historical status review
 * is allowed to correct a status, but must not invent or rewrite order lines.
 */
export function calculateOrderRevenue(order: { orderTotal: string | number | null }): number {
  const amount = Number(order.orderTotal ?? 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

export function calculateLineRevenue(lines: RevenueLine[]): number {
  return lines.reduce((total, line) => {
    const quantity = Number(line.quantity ?? 0);
    const unitPrice = Number(line.unitPrice ?? 0);
    return Number.isFinite(quantity) && Number.isFinite(unitPrice)
      ? total + Math.round(quantity * unitPrice * 100)
      : total;
  }, 0);
}

function normalizeKey(value: unknown): string {
  return value == null ? "" : String(value).trim().toLowerCase();
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function sourceOrderDate(source: ShipStationOrder): Date | null {
  return parseDate(source.orderDate ?? source.createDate);
}

function sourceRevenue(source: ShipStationOrder): number {
  return calculateOrderRevenue({ orderTotal: source.orderTotal ?? null });
}

function money(cents: number): number {
  return Number((cents / 100).toFixed(2));
}

function withinRange(date: Date | null, options: HistoricalRevenueOptions): boolean {
  if (!date) return !options.from && !options.to;
  return (!options.from || date >= options.from) && (!options.to || date < options.to);
}

function sumSourceItems(source: ShipStationOrder): { count: number; quantity: number } {
  const items = source.orderItems ?? source.items;
  if (!Array.isArray(items)) return { count: 0, quantity: 0 };
  return {
    count: items.length,
    quantity: items.reduce((sum, item) => sum + (Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 0), 0),
  };
}

function discrepancyReason(input: {
  revenueDifference: number;
  localItemCount: number;
  sourceItemCount: number;
  localQuantity: number;
  sourceQuantity: number;
  localStatus: string;
  sourceStatus: string | null;
}): string[] {
  const reasons: string[] = [];
  if (input.revenueDifference !== 0) reasons.push("revenue_total_mismatch");
  if (input.localItemCount !== input.sourceItemCount) reasons.push("line_count_mismatch");
  if (input.localQuantity !== input.sourceQuantity) reasons.push("quantity_mismatch");
  if (input.sourceStatus && input.localStatus.toLowerCase() !== input.sourceStatus.toLowerCase()) {
    reasons.push("status_mismatch");
  }
  return reasons;
}

function sourceSummary(source: ShipStationOrder, localOrderId: string | null = null) {
  const items = sumSourceItems(source);
  return {
    sourceOrderId: source.orderId == null ? null : String(source.orderId),
    sourceOrderKey: source.orderKey ?? null,
    orderNumber: source.orderNumber ?? null,
    orderDate: source.orderDate ?? source.createDate ?? null,
    sourceStatus: source.orderStatus ?? null,
    marketplace: source.marketplaceName ?? null,
    revenue: money(sourceRevenue(source)),
    itemCount: items.count,
    itemQuantity: items.quantity,
    localOrderId,
  };
}

function localSummary(order: any, itemCount: number, quantity: number) {
  return {
    localOrderId: order.id,
    orderNumber: order.orderNumber,
    orderDate: order.orderDate,
    status: order.orderStatus,
    isTest: Boolean(order.isTest),
    revenue: money(calculateOrderRevenue({ orderTotal: order.orderTotal })),
    itemCount,
    itemQuantity: quantity,
  };
}

function suspectManifestEntry(order: any) {
  return DUPLICATE_RECONCILIATION_MANIFEST.find(entry =>
    entry.localOrderId === order.id ||
    (entry.localOrderId === `bl-${String(order.orderNumber)}` && order.orderKey === `BL.${String(order.orderNumber)}`),
  ) ?? null;
}

function reportError(message: string): Error {
  return new Error(message);
}

/**
 * Builds a read-only revenue reconciliation. The source order and local order
 * are matched by immutable ShipStation mapping/order key first. Order number
 * is only a review aid and is explicitly reported as unmatched.
 */
export async function getHistoricalRevenueReport(options: HistoricalRevenueOptions = {}) {
  if (options.from && options.to && options.from >= options.to) {
    throw reportError("The historical revenue range must end after it starts.");
  }

  const shipStationOrgId = options.orgId || process.env.SHIPSTATION_ORG_ID || PLATFORM_ORG_ID;
  const [allLocalOrders, mappings, sourceOrders] = await Promise.all([
    db.select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      orderDate: orders.orderDate,
      orderStatus: orders.orderStatus,
      orderTotal: orders.orderTotal,
      isTest: orders.isTest,
      orderKey: orders.orderKey,
    }).from(orders).where(eq(orders.orgId, shipStationOrgId)),
    db.select().from(shipstationOrderMappings).where(eq(shipstationOrderMappings.orgId, shipStationOrgId)),
    getShipStationOrders(Boolean(options.forceRefresh)),
  ]);

  if (allLocalOrders.length > MAX_REPORT_ORDERS) {
    throw reportError(`Historical revenue report is limited to ${MAX_REPORT_ORDERS.toLocaleString()} local orders.`);
  }
  const localOrders = allLocalOrders.filter(order => withinRange(order.orderDate, options));
  const localOrderIds = allLocalOrders.map(order => order.id);
  const localItems = localOrderIds.length === 0
    ? []
    : await db.select({
      orderId: orderDetails.orderId,
      quantity: orderDetails.quantity,
    }).from(orderDetails).where(inArray(orderDetails.orderId, localOrderIds));

  const localById = new Map<string, any>();
  const localByKey = new Map<string, any[]>();
  const localByNumber = new Map<string, any[]>();
  for (const order of allLocalOrders as any[]) {
    localById.set(normalizeKey(order.id), order);
    const key = normalizeKey(order.orderKey);
    if (key) localByKey.set(key, [...(localByKey.get(key) ?? []), order]);
    const number = normalizeKey(order.orderNumber);
    if (number) localByNumber.set(number, [...(localByNumber.get(number) ?? []), order]);
  }

  const itemsByOrder = new Map<string, { count: number; quantity: number }>();
  for (const item of localItems as any[]) {
    const current = itemsByOrder.get(item.orderId) ?? { count: 0, quantity: 0 };
    current.count += 1;
    current.quantity += Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 0;
    itemsByOrder.set(item.orderId, current);
  }

  const mappingBySource = new Map(mappings.map(mapping => [normalizeKey(mapping.sourceOrderId), mapping]));
  const reviewedSuspects = await db.select({
    candidateKey: historicalOrderRecovery.candidateKey,
    decision: historicalOrderRecovery.decision,
    reason: historicalOrderRecovery.reason,
    reviewedBy: historicalOrderRecovery.reviewedBy,
    reviewedAt: historicalOrderRecovery.reviewedAt,
  }).from(historicalOrderRecovery);
  const reviewByKey = new Map(reviewedSuspects.map(review => [review.candidateKey, review]));
  const matchedLocalIds = new Set<string>();
  const sourceOnly: any[] = [];
  const matchedDiscrepancies: any[] = [];
  const matchedRevenue = { local: 0, source: 0, orders: 0 };
  const legacyClassification = { neverImported: 0, deleted: 0, unmatched: 0 };
  const legacyClassificationRevenue = { neverImported: 0, deleted: 0, unmatched: 0 };

  const filteredSourceOrders = sourceOrders.filter(source => withinRange(sourceOrderDate(source), options));
  const resolveImmutableLocal = (source: ShipStationOrder) => {
    const sourceId = normalizeKey(source.orderId);
    const mapping = sourceId ? mappingBySource.get(sourceId) : undefined;
    const local =
      (mapping ? localById.get(normalizeKey(mapping.localOrderId)) : undefined) ??
      (sourceId ? localById.get(sourceId) : undefined) ??
      (normalizeKey(source.orderKey) ? localByKey.get(normalizeKey(source.orderKey))?.length === 1
        ? localByKey.get(normalizeKey(source.orderKey))![0]
        : undefined : undefined);
    return { sourceId, mapping, local };
  };
  const sourceClaimCountByLocalId = new Map<string, number>();
  const sourceClaimsByLocalId = new Map<string, ShipStationOrder[]>();
  for (const source of sourceOrders) {
    const { local } = resolveImmutableLocal(source);
    if (local) {
      sourceClaimCountByLocalId.set(local.id, (sourceClaimCountByLocalId.get(local.id) ?? 0) + 1);
      sourceClaimsByLocalId.set(local.id, [...(sourceClaimsByLocalId.get(local.id) ?? []), source]);
    }
  }

  for (const source of filteredSourceOrders) {
    const { mapping, local: immutableLocal } = resolveImmutableLocal(source);
    const sourceData = sourceSummary(source, immutableLocal?.id ?? null);

    if (immutableLocal) {
      if ((sourceClaimCountByLocalId.get(immutableLocal.id) ?? 0) > 1) {
        legacyClassification.unmatched += 1;
        legacyClassificationRevenue.unmatched += sourceRevenue(source);
        sourceOnly.push({
          classification: "unmatched",
          evidence: "More than one ShipStation record claimed the same immutable local order identity, so none was used in the matched comparison.",
          source: sourceData,
          localOrderNumberMatches: [localSummary(
            immutableLocal,
            (itemsByOrder.get(immutableLocal.id) ?? { count: 0 }).count,
            (itemsByOrder.get(immutableLocal.id) ?? { quantity: 0 }).quantity,
          )],
        });
        continue;
      }
      matchedLocalIds.add(immutableLocal.id);
      const localItemsForOrder = itemsByOrder.get(immutableLocal.id) ?? { count: 0, quantity: 0 };
      const localRevenue = calculateOrderRevenue({ orderTotal: immutableLocal.orderTotal });
      const sourceAmount = sourceRevenue(source);
      const localInRequestedRange = withinRange(immutableLocal.orderDate, options);
      const manifest = suspectManifestEntry(immutableLocal);
      const candidateKey = manifest ? `duplicate-cleanup-status:${immutableLocal.id}:${manifest.sourceOrderId}` : null;
      const review = candidateKey ? reviewByKey.get(candidateKey) ?? null : null;
      const pendingSuspect = Boolean(manifest && review?.decision !== "confirm_status" && review?.decision !== "correct_status");
      const eligible = isRevenueEligible({ orderStatus: immutableLocal.orderStatus, isTest: Boolean(immutableLocal.isTest) });
      if (localInRequestedRange && eligible && !pendingSuspect) {
        matchedRevenue.local += localRevenue;
        matchedRevenue.source += sourceAmount;
        matchedRevenue.orders += 1;
      }
      const revenueDifference = localRevenue - sourceAmount;
      const reasons = discrepancyReason({
        revenueDifference,
        localItemCount: localItemsForOrder.count,
        sourceItemCount: sourceData.itemCount,
        localQuantity: localItemsForOrder.quantity,
        sourceQuantity: sourceData.itemQuantity,
        localStatus: immutableLocal.orderStatus,
        sourceStatus: source.orderStatus ?? null,
      });
      if (!localInRequestedRange) reasons.push("local_date_outside_requested_range");
      if (reasons.length > 0) {
        matchedDiscrepancies.push({
          classification: "matched_discrepancy",
          reasons,
          identityMatch: mapping ? "verified_mapping" : normalizeKey(source.orderKey) ? "order_key" : "order_id",
          revenueTreatment: !localInRequestedRange
            ? "outside_local_date_range"
            : pendingSuspect ? "excluded_until_verified" : eligible ? "included" : "excluded_by_status",
          local: localSummary(immutableLocal, localItemsForOrder.count, localItemsForOrder.quantity),
          source: sourceData,
          revenueDifference: money(revenueDifference),
        });
      }
      continue;
    }

    const numberMatches = localByNumber.get(normalizeKey(source.orderNumber)) ?? [];
    const classification = mapping && !localById.has(normalizeKey(mapping.localOrderId))
      ? "deleted"
      : numberMatches.length > 0
        ? "unmatched"
        : "never_imported";
    legacyClassification[classification === "deleted" ? "deleted" : classification === "unmatched" ? "unmatched" : "neverImported"] += 1;
    legacyClassificationRevenue[classification === "deleted" ? "deleted" : classification === "unmatched" ? "unmatched" : "neverImported"] += sourceRevenue(source);
    sourceOnly.push({
      classification,
      evidence: classification === "deleted"
        ? "A reviewed ShipStation source mapping points to a local order that is no longer present."
        : classification === "unmatched"
          ? "A local order number exists, but no immutable ShipStation order ID/key links the records."
          : "No local order identity or order-number review lead was found.",
      source: sourceData,
      localOrderNumberMatches: numberMatches.map(order => localSummary(order, (itemsByOrder.get(order.id) ?? { count: 0 }).count, (itemsByOrder.get(order.id) ?? { quantity: 0 }).quantity)),
    });
  }

  const suspectOrders: any[] = [];
  let suspectPendingRevenue = 0;
  let includedRevenue = 0;
  let excludedRevenue = 0;
  let includedOrderCount = 0;
  let excludedOrderCount = 0;

  for (const order of localOrders as any[]) {
    const itemStats = itemsByOrder.get(order.id) ?? { count: 0, quantity: 0 };
    const eligible = isRevenueEligible({ orderStatus: order.orderStatus, isTest: Boolean(order.isTest) });
    const manifest = suspectManifestEntry(order);
    const candidateKey = manifest ? `duplicate-cleanup-status:${order.id}:${manifest.sourceOrderId}` : null;
    const review = candidateKey ? reviewByKey.get(candidateKey) ?? null : null;
    const verified = review?.decision === "confirm_status" || review?.decision === "correct_status";
    const pendingSuspect = Boolean(manifest && !verified);
    const amount = calculateOrderRevenue({ orderTotal: order.orderTotal });

    if (!eligible) {
      excludedOrderCount += 1;
      excludedRevenue += amount;
    }
    else if (pendingSuspect) suspectPendingRevenue += amount;
    else {
      includedRevenue += amount;
      includedOrderCount += 1;
    }

    if (manifest && withinRange(parseDate(order.orderDate), options)) {
      suspectOrders.push({
        classification: pendingSuspect ? "suspect_duplicate_pending_review" : "suspect_duplicate_reviewed",
        verified,
        candidateKey,
        review,
        local: localSummary(order, itemStats.count, itemStats.quantity),
        revenueTreatment: pendingSuspect ? "excluded_until_verified" : eligible ? "included" : "excluded_by_status",
      });
    }
  }

  const localOnly: any[] = [];
  const dateBoundaryMatches: any[] = [];
  for (const order of localOrders as any[]) {
    if (matchedLocalIds.has(order.id) || suspectOrders.some(suspect => suspect.local.localOrderId === order.id)) continue;
    const items = itemsByOrder.get(order.id) ?? { count: 0, quantity: 0 };
    const sourceClaims = sourceClaimsByLocalId.get(order.id) ?? [];
    if (sourceClaims.length > 0) {
      const hasSourceInRequestedRange = sourceClaims.some(source => withinRange(sourceOrderDate(source), options));
      const ambiguousSourceIdentity = sourceClaims.length > 1;
      dateBoundaryMatches.push({
        classification: ambiguousSourceIdentity
          ? "ambiguous_source_identity"
          : "matched_source_outside_requested_range",
        reasons: [ambiguousSourceIdentity
          ? "multiple_source_records_claim_local_identity"
          : "source_date_outside_requested_range"],
        evidence: ambiguousSourceIdentity
          ? "Multiple ShipStation records claim this immutable local identity, so none was included in matched revenue."
          : "A valid ShipStation match exists outside the requested source date range.",
        local: localSummary(order, items.count, items.quantity),
        sources: sourceClaims.map(source => sourceSummary(source, order.id)),
      });
      continue;
    }
    localOnly.push({
      classification: "local_absent_from_shipstation",
      evidence: "The local order has no immutable match in the full ShipStation history.",
      local: localSummary(order, items.count, items.quantity),
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    source: "ShipStation",
    orgId: shipStationOrgId,
    range: {
      from: options.from?.toISOString() ?? null,
      to: options.to?.toISOString() ?? null,
    },
    revenue: {
      included: money(includedRevenue),
      includedOrderCount,
      suspectPending: money(suspectPendingRevenue),
      excludedByStatusOrTest: money(excludedRevenue),
      excludedOrderCount,
      matchedLocal: money(matchedRevenue.local),
      matchedShipStation: money(matchedRevenue.source),
      matchedDifference: money(matchedRevenue.local - matchedRevenue.source),
      legacyShipStationOnly: money(Object.values(legacyClassificationRevenue).reduce((sum, value) => sum + value, 0)),
    },
    summary: {
      localOrders: localOrders.length,
      shipstationOrders: filteredSourceOrders.length,
      matchedOrders: matchedRevenue.orders,
      suspectOrders: suspectOrders.length,
      pendingSuspectOrders: suspectOrders.filter(suspect => suspect.classification === "suspect_duplicate_pending_review").length,
      matchedDiscrepancies: matchedDiscrepancies.length,
      dateBoundaryMatches: dateBoundaryMatches.length,
      localOnlyOrders: localOnly.length,
      shipstationOnlyOrders: sourceOnly.length,
      legacyShipStationOnly: legacyClassification,
    },
    suspectOrders,
    legacyShipStationOnly: sourceOnly,
    discrepancies: {
      matched: [...matchedDiscrepancies, ...dateBoundaryMatches],
      localOnly,
    },
  };
}
