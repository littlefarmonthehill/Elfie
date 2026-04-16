import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, real, timestamp, boolean, index, uniqueIndex, jsonb, serial, date, primaryKey, customType } from "drizzle-orm/pg-core";

export const PLATFORM_ORG_ID = 'platform';

const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() { return 'bytea'; },
});
import { vector } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table - REQUIRED for Replit Auth
// Reference: blueprint:javascript_log_in_with_replit
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table - Email/Password Authentication
// NOTE: Keeping default config for id column as per previous blueprint requirements
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique().notNull(),
  password: varchar("password"), // bcrypt hashed password
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  isApproved: boolean("is_approved").notNull().default(false),
  role: varchar("role").notNull().default("customer"), // 'customer', 'employee', or 'admin'
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  // BrickNSpotter heatmap preferences
  heatmapCondition: varchar("heatmap_condition").default('new'),   // 'new' | 'used'
  heatmapSource: varchar("heatmap_source").default('sold'),        // 'sold' | 'listed'
  heatmapMetric: varchar("heatmap_metric").default('max'),         // 'max' | 'avg'
  // Multi-tenant org membership
  orgId: varchar("org_id"),                                        // FK → organizations.id
  orgRole: varchar("org_role").default("owner"),                   // 'owner' | 'admin' | 'member'
  superAdmin: boolean("super_admin").notNull().default(false),     // platform-level super admin
}, (table) => ({
  orgIdIdx: index("users_org_id_idx").on(table.orgId),
}));

export const insertUserSchema = createInsertSchema(users).omit({
  createdAt: true,
  updatedAt: true,
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// ─── Organizations (multi-tenant SaaS) ───────────────────────────────────────
export const organizations = pgTable("organizations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  slug: varchar("slug").unique().notNull(),          // URL-safe lowercase identifier
  plan: varchar("plan").notNull().default("trial"),   // 'trial' | 'foundation' | 'core' | 'flagship'
  trialEndsAt: timestamp("trial_ends_at"),               // null = no trial expiry (paid or flagship)
  isActive: boolean("is_active").notNull().default(true),
  address: text("address"),
  phone: varchar("phone", { length: 50 }),
  website: varchar("website", { length: 255 }),
  logoUrl: text("logo_url"),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  // Stripe billing
  stripeCustomerId: varchar("stripe_customer_id"),
  stripeSubscriptionId: varchar("stripe_subscription_id"),
  subscriptionStatus: varchar("subscription_status").default('trial').notNull(), // 'active'|'past_due'|'canceled'|'trial'
  subscriptionInterval: varchar("subscription_interval").default('monthly').notNull(), // 'monthly'|'annual'
  subscriptionEndsAt: timestamp("subscription_ends_at"),  // null = trial/no sub; set from Stripe current_period_end
  cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(), // true = subscription will cancel at period end (auto-renew off)
  // BrickSpotter monthly scan tracking
  brickspotterScansThisMonth: integer("brickspotter_scans_this_month").notNull().default(0),
  brickspotterScansResetDate: timestamp("brickspotter_scans_reset_date").defaultNow().notNull(),
  // Per-org limit overrides (null = use tier default)
  seatLimitOverride: integer("seat_limit_override"),
  brickspotterLimitOverride: integer("brickspotter_limit_override"),
  automationLimitOverride: integer("automation_limit_override"),
  // BL API call limit override — null = platform default (5000/24h). Only settable by super admins.
  blApiCallLimitOverride: integer("bl_api_call_limit_override"),
  // Per-org feature gate overrides (null = use plan defaults). Keys: elfieAiMode, brickSpotter, pom, warehouseModule, universalCatalog, dataEnrichment
  featureOverrides: jsonb("feature_overrides").$type<Record<string, boolean>>(),
  tosAcceptedAt: timestamp("tos_accepted_at"),
  // Billing start date — read-only. Auto-set to the date of the org's first inventory sync.
  // Represents when the org became an active customer (trial period is tracked separately).
  billingStartDate: timestamp("billing_start_date"),
  // Sales-percentage billing plan (references plans.id). Null = no plan assigned.
  planId: integer("plan_id"),
  // Warehouse depth: 1 = bins only, 2 = shelves + bins, 3 = aisles + shelves + bins (default)
  warehouseDepth: integer("warehouse_depth").default(3).notNull(),
  aisleFormat: text("aisle_format").default('numeric').notNull(),
  shelfFormat: text("shelf_format").default('alpha').notNull(),
  binFormat: text("bin_format").default('numeric').notNull(),
  // One lot per bin: true = strict (one lot ID → one bin, moves replace), false = loose (one lot can span multiple bins)
  oneLotPerBin: boolean("one_lot_per_bin").default(true).notNull(),
});

export const insertOrganizationSchema = createInsertSchema(organizations).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type Organization = typeof organizations.$inferSelect;

// BrickLink Categories
export const blCategories = pgTable("bl_categories", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  priorityTier: text("priority_tier").default('standard').notNull(), // 'top' | 'standard' | 'commodity'
  sortingPhase: text("sorting_phase"), // 'category' | 'subcategory' | 'finalsort' | 'listing' | 'file' | null (unassigned)
  flagged: boolean("flagged").default(false).notNull(), // doubles phase score in listing phase only
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertBlCategorySchema = createInsertSchema(blCategories).omit({
  syncedAt: true,
  updatedAt: true,
});

export type InsertBlCategory = z.infer<typeof insertBlCategorySchema>;
export type BlCategory = typeof blCategories.$inferSelect;

// BrickLink Colors
export const blColors = pgTable("bl_colors", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  rgb: text("rgb"),
  type: text("type"),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertBlColorSchema = createInsertSchema(blColors).omit({
  syncedAt: true,
  updatedAt: true,
});

export type InsertBlColor = z.infer<typeof insertBlColorSchema>;
export type BlColor = typeof blColors.$inferSelect;

// BrickLink Inventory
export const blInventory = pgTable("bl_inventory", {
  id: integer("id").primaryKey(),
  itemNo: text("item_no").notNull(),
  itemType: text("item_type").notNull(),
  colorId: integer("color_id"),
  quantity: integer("quantity").notNull(),
  newOrUsed: text("new_or_used").notNull(),
  completeness: text("completeness"),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }),
  myCost: decimal("my_cost", { precision: 10, scale: 4 }),
  bindId: integer("bind_id"),
  description: text("description"),
  remarks: text("remarks"),
  bulk: integer("bulk"),
  isRetain: boolean("is_retain").default(false),
  isStockRoom: boolean("is_stock_room").default(false),
  stockRoomId: text("stock_room_id"),
  dateCreated: timestamp("date_created"),
  saleRate: integer("sale_rate"),
  tierPrice1: decimal("tier_price_1", { precision: 10, scale: 2 }),
  tierPrice2: decimal("tier_price_2", { precision: 10, scale: 2 }),
  tierPrice3: decimal("tier_price_3", { precision: 10, scale: 2 }),
  tierQuantity1: integer("tier_quantity_1"),
  tierQuantity2: integer("tier_quantity_2"),
  tierQuantity3: integer("tier_quantity_3"),
  myWeight: decimal("my_weight", { precision: 10, scale: 4 }),
  orgId: varchar("org_id"),                          // FK → organizations.id
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),               // Soft delete: set when item disappears from BL; cleared if it reappears
  // Sale readiness fields (primarily for sets)
  hasInstructions: boolean("has_instructions"),
  hasBox: boolean("has_box"),
  pctComplete: integer("pct_complete"),             // 0–100
  completenessNotes: text("completeness_notes"),    // max 50 chars
  missingPieces: integer("missing_pieces"),
  missingLots: integer("missing_lots"),
  saleLocation: varchar("sale_location", { length: 5 }),
}, (table) => ({
  // Index for quantity-based filtering (general queries)
  quantityIdx: index("bl_inv_qty_idx").on(table.quantity),
  // Index for item lookup
  itemNoIdx: index("bl_inv_item_no_idx").on(table.itemNo),
  orgIdIdx: index("bl_inv_org_id_idx").on(table.orgId),
}));

export const insertBlInventorySchema = createInsertSchema(blInventory).omit({
  syncedAt: true,
  updatedAt: true,
});

export type InsertBlInventory = z.infer<typeof insertBlInventorySchema>;
export type BlInventory = typeof blInventory.$inferSelect;

// ── Channel Lot Links ──────────────────────────────────────────────────────────
// Global BL lot ID → channel lot ID mapping table.
// BrickLink inventory is the source of truth (SOT); every external channel
// (BrickOwl, Amazon, eBay, …) gets one row per BL lot it mirrors.
// Populated/refreshed during each channel sync run (upsert on conflict).
//
//   blInvId + orgId + channel → channelLotId   (forward:  BL → channel)
//   channel + channelLotId    → blInvId         (reverse:  channel → BL)
export const channelLotLinks = pgTable("channel_lot_links", {
  blInvId:      integer("bl_inv_id").notNull().references(() => blInventory.id, { onDelete: 'cascade' }),
  orgId:        varchar("org_id").notNull(),
  channel:      text("channel").notNull(),        // 'brickowl' | 'amazon' | 'ebay' | …
  channelLotId: text("channel_lot_id").notNull(), // Lot / listing ID on the external channel
  syncedAt:     timestamp("synced_at").defaultNow().notNull(),
}, (table) => ({
  pk:             primaryKey({ columns: [table.blInvId, table.orgId, table.channel] }),
  // Reverse lookup — given a channel lot ID, resolve the BL inventory item
  channelLotIdx:  index("cll_channel_lot_idx").on(table.channel, table.channelLotId),
  // All linked lots for an org × channel (e.g. "list all BO lots we've synced for org-a")
  orgChannelIdx:  index("cll_org_channel_idx").on(table.orgId, table.channel),
}));

export const insertChannelLotLinkSchema = createInsertSchema(channelLotLinks);
export type InsertChannelLotLink = z.infer<typeof insertChannelLotLinkSchema>;
export type ChannelLotLink = typeof channelLotLinks.$inferSelect;

// ── Shared Part Catalog ────────────────────────────────────────────────────────
// One row per (itemNo, itemType, colorId) — no org_id.
// Stores physical truth and enrichment data shared across ALL companies.
// bl_inventory rows reference this via (itemNo, itemType, colorId).
export const blCatalog = pgTable("bl_catalog", {
  itemNo: text("item_no").notNull(),
  itemType: text("item_type").notNull(),
  colorId: integer("color_id").notNull().default(0),
  // Display / identity
  itemName: text("item_name"),
  colorName: text("color_name"),
  categoryId: integer("category_id"),
  // Physical properties (color-agnostic, but stored per-color for simplicity)
  blCatalogWeight: decimal("bl_catalog_weight", { precision: 10, scale: 4 }),
  blDimensionX: decimal("bl_dimension_x", { precision: 10, scale: 2 }),
  blDimensionY: decimal("bl_dimension_y", { precision: 10, scale: 2 }),
  blDimensionZ: decimal("bl_dimension_z", { precision: 10, scale: 2 }),
  yearReleased: integer("year_released"),
  // Images (color-specific LDraw renders from Rebrickable)
  imageUrl: text("image_url"),
  thumbnailUrl: text("thumbnail_url"),
  // Object-storage key for permanently stored processed PNG (null = not yet stored)
  storedImageKey: text("stored_image_key"),
  // Set true when all CDN sources 404 — harvester skips rows with this flag
  imageFetchFailed: boolean("image_fetch_failed").default(false),
  // BrickLink catalog lifecycle: is_obsolete=true means BL has retired this item ID;
  // alternate_no is the replacement item_no (new ID created while old is maintained temporarily).
  isObsolete: boolean("is_obsolete").default(false),
  alternateNo: text("alternate_no"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.itemNo, table.itemType, table.colorId] }),
  itemNoIdx: index("bl_catalog_item_no_idx").on(table.itemNo),
  categoryIdx: index("bl_catalog_category_idx").on(table.categoryId),
  itemTypeIdx: index("bl_catalog_item_type_idx").on(table.itemType),
}));

export const insertBlCatalogSchema = createInsertSchema(blCatalog).omit({
  updatedAt: true,
});
export type InsertBlCatalog = z.infer<typeof insertBlCatalogSchema>;
export type BlCatalog = typeof blCatalog.$inferSelect;

// Set-Part Relationships (from Rebrickable)
// Cross-channel part ID mapping — lazy cache populated as Brick Spotter resolves numbers
export const partIdMappings = pgTable("part_id_mappings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  blId: text("bl_id"),          // BrickLink part number (canonical)
  legoId: text("lego_id"),      // Official LEGO part number
  brickOwlId: text("brickowl_id"), // BrickOwl BOID
  rebrickableId: text("rebrickable_id"), // Rebrickable part_num
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  blIdIdx:         index("part_mappings_bl_id_idx").on(table.blId),
  legoIdIdx:       index("part_mappings_lego_id_idx").on(table.legoId),
  rebrickableIdx:  index("part_mappings_rebrickable_id_idx").on(table.rebrickableId),
}));

export const insertPartIdMappingSchema = createInsertSchema(partIdMappings).omit({ id: true, updatedAt: true } as any);
export type InsertPartIdMapping = z.infer<typeof insertPartIdMappingSchema>;
export type PartIdMapping = typeof partIdMappings.$inferSelect;

export const setPartRelationships = pgTable("set_part_relationships", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  setNum: text("set_num").notNull(), // e.g., "10179-1"
  setName: text("set_name"), // e.g., "Millennium Falcon UCS"
  partNum: text("part_num").notNull(), // BrickLink part number
  colorId: integer("color_id"), // BrickLink color ID
  quantity: integer("quantity").notNull(), // How many of this part in the set
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
}, (table) => ({
  partColorIdx: index("set_parts_part_color_idx").on(table.partNum, table.colorId),
  setIdx: index("set_parts_set_idx").on(table.setNum),
}));

export const insertSetPartRelationshipSchema = createInsertSchema(setPartRelationships).omit({
  syncedAt: true,
});

export type InsertSetPartRelationship = z.infer<typeof insertSetPartRelationshipSchema>;
export type SetPartRelationship = typeof setPartRelationships.$inferSelect;

// Rebrickable part-to-part relationships (type A = Alternate, M = Mold, P = Print, etc.)
export const partRelationships = pgTable("part_relationships", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  relType: text("rel_type").notNull(),           // A, M, P, R, T, B
  childPartNum: text("child_part_num").notNull(), // Rebrickable child/alternate part num
  parentPartNum: text("parent_part_num").notNull(), // Rebrickable parent/canonical part num
}, (table) => ({
  childIdx:  index("part_rel_child_idx").on(table.childPartNum, table.relType),
  parentIdx: index("part_rel_parent_idx").on(table.parentPartNum, table.relType),
}));

export const insertPartRelationshipSchema = createInsertSchema(partRelationships).omit({ id: true } as any);
export type InsertPartRelationship = z.infer<typeof insertPartRelationshipSchema>;
export type PartRelationship = typeof partRelationships.$inferSelect;

// Orders (from platforms and locally created splits)
export const orders = pgTable("orders", {
  id: varchar("id").primaryKey(),
  orderNumber: text("order_number").notNull(),
  orderKey: text("order_key"),
  marketplace: text("marketplace"), // Selling platform (BrickLink, eBay, Amazon, etc.)
  orderDate: timestamp("order_date").notNull(),
  orderStatus: text("order_status").notNull(),
  previousStatus: text("previous_status"), // Track previous status for inventory adjustment logic
  customerUsername: text("customer_username"),
  customerEmail: text("customer_email"),
  shipTo: text("ship_to").notNull(),
  billTo: text("bill_to"),
  shipByDate: timestamp("ship_by_date"),
  orderTotal: decimal("order_total", { precision: 10, scale: 2 }).notNull(),
  shippingAmount: decimal("shipping_amount", { precision: 10, scale: 2 }),
  taxAmount: decimal("tax_amount", { precision: 10, scale: 2 }),
  insuranceAmount: decimal("insurance_amount", { precision: 10, scale: 2 }),
  internalNotes: text("internal_notes"),
  customerNotes: text("customer_notes"),
  requestedShippingService: text("requested_shipping_service"),
  carrierCode: text("carrier_code"),
  serviceCode: text("service_code"),
  packageCode: text("package_code"),
  confirmation: text("confirmation"),
  shipDate: timestamp("ship_date"),
  weight: decimal("weight", { precision: 10, scale: 2 }), // Total package weight (including packaging) for EasyPost
  weightUnits: text("weight_units"), // Weight unit: oz, lb, g, kg
  packageType: text("package_type"), // e.g. 'padded_envelope', 'box', 'usps_flat_rate_env', etc.
  packageLength: decimal("package_length", { precision: 6, scale: 2 }), // inches
  packageWidth: decimal("package_width", { precision: 6, scale: 2 }), // inches
  packageHeight: decimal("package_height", { precision: 6, scale: 2 }), // inches
  localOnly: boolean("local_only").default(false).notNull(), // True for split orders that don't sync to platforms
  parentOrderId: varchar("parent_order_id"), // Reference to parent order if this is a split
  inventoryDeducted: boolean("inventory_deducted").default(false).notNull(), // True once inventory has been reduced for this order
  isTest: boolean("is_test").default(false).notNull(), // True for test/return orders — excluded from all dashboards
  orgId: varchar("org_id"),                            // FK → organizations.id
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  workflowStatus: text("workflow_status").default('new').notNull(),
  mergeDetectedAt: timestamp("merge_detected_at"), // Legacy: was set when BO order merge detected. No longer actively written.
  mergeGroupId: varchar("merge_group_id"),           // Set on both the original and delta order when a BO merge spawns a new order
  feedbackLeftAt: timestamp("feedback_left_at"),     // Set when seller manually confirms feedback was left on the channel
}, (table) => ({
  orgIdIdx: index("orders_org_id_idx").on(table.orgId),
  orgIdDateIdx: index("orders_org_id_date_idx").on(table.orgId, table.orderDate),
  orgIdStatusIdx: index("orders_org_id_status_idx").on(table.orgId, table.orderStatus),
}));

export const insertOrderSchema = createInsertSchema(orders).omit({
  syncedAt: true,
  updatedAt: true,
});

export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof orders.$inferSelect;

// ShipStation Order Details
export const orderDetails = pgTable("order_details", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").notNull(),
  lineItemKey: text("line_item_key"), // Unique identifier from ShipStation for deduplication
  sku: text("sku"),
  name: text("name").notNull(),
  quantity: integer("quantity").notNull(),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }),
  taxAmount: decimal("tax_amount", { precision: 10, scale: 2 }),
  weight: decimal("weight", { precision: 10, scale: 2 }),
  weightUnits: text("weight_units"),
  description: text("description"), // ShipStation item description (may contain color/condition)
  options: text("options"), // JSON: ShipStation options array (where BrickLink stores metadata)
  customField1: text("custom_field_1"), // ShipStation custom field 1
  customField2: text("custom_field_2"), // ShipStation custom field 2
  customField3: text("custom_field_3"), // ShipStation custom field 3
  bricklinkInventoryId: integer("bricklink_inventory_id"), // BrickLink inventory ID (from options/description)
  boLotId: text("bo_lot_id"),               // BrickOwl lot_id of the purchased lot (from BO order item)
  itemNo: text("item_no"), // BrickLink part/item number (e.g. "3001")
  colorId: integer("color_id"), // BrickLink color ID (from options/description)
  condition: text("condition"), // New/Used (from options/description)
  fulfilled: boolean("fulfilled").default(false).notNull(), // Track fulfillment status
  fulfilledAt: timestamp("fulfilled_at"),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orderIdIdx:    index("order_details_order_id_idx").on(table.orderId),        // JOIN from orders — most frequent
  blInvIdx:      index("order_details_bl_inv_idx").on(table.bricklinkInventoryId), // BL inventory lookup
  fulfilledIdx:  index("order_details_fulfilled_idx").on(table.fulfilled),     // Fulfillment queue filter
}));

export const insertOrderDetailSchema = createInsertSchema(orderDetails).omit({
  id: true,
  syncedAt: true,
  updatedAt: true,
});

// Schema for updating fulfillment status
export const updateFulfillmentSchema = z.object({
  fulfilled: z.boolean(),
});

export type InsertOrderDetail = z.infer<typeof insertOrderDetailSchema>;
export type OrderDetail = typeof orderDetails.$inferSelect;
export type UpdateFulfillment = z.infer<typeof updateFulfillmentSchema>;

// Order Splits - Track order splitting for partial shipments
export const orderSplits = pgTable("order_splits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parentOrderId: varchar("parent_order_id").notNull(), // Original order that was split
  splitOrderId: varchar("split_order_id").notNull(), // New order created from split
  splitSuffix: text("split_suffix").notNull(), // e.g., "-1", "-2"
  reason: text("reason"), // Why the order was split (e.g., "partial shipment", "backorder")
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  parentOrderIdx: index("order_splits_parent_order_idx").on(table.parentOrderId),
  splitOrderIdx:  index("order_splits_split_order_idx").on(table.splitOrderId),
}));

export const insertOrderSplitSchema = createInsertSchema(orderSplits).omit({
  id: true,
  createdAt: true,
});

export type InsertOrderSplit = z.infer<typeof insertOrderSplitSchema>;
export type OrderSplit = typeof orderSplits.$inferSelect;

// Order Split Items - Track which items moved to which split
export const orderSplitItems = pgTable("order_split_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  splitId: varchar("split_id").notNull(), // Reference to order_splits.id
  orderDetailId: varchar("order_detail_id").notNull(), // Reference to order_details.id
  quantityAssigned: integer("quantity_assigned").notNull(), // How many of this item went to the split
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  splitIdIdx:       index("order_split_items_split_id_idx").on(table.splitId),
  orderDetailIdIdx: index("order_split_items_detail_id_idx").on(table.orderDetailId),
}));

export const insertOrderSplitItemSchema = createInsertSchema(orderSplitItems).omit({
  id: true,
  createdAt: true,
});

export type InsertOrderSplitItem = z.infer<typeof insertOrderSplitItemSchema>;
export type OrderSplitItem = typeof orderSplitItems.$inferSelect;

// Shipments - Track shipping labels, tracking, and costs
export const shipments = pgTable("shipments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").notNull(), // Reference to orders.id
  vendorCode: text("vendor_code").notNull(), // e.g., "easypost"
  vendorShipmentId: text("vendor_shipment_id"), // External shipment ID from vendor
  carrier: text("carrier"), // e.g., "USPS", "UPS", "FedEx"
  service: text("service"), // e.g., "Priority", "Ground"
  trackingNumber: text("tracking_number"),
  labelUrl: text("label_url"), // URL to download shipping label
  labelFormat: text("label_format").default('PNG'), // PNG, PDF, ZPL
  cost: decimal("cost", { precision: 10, scale: 2 }), // Shipping cost
  currency: text("currency").default('USD'),
  status: text("status").default('pending').notNull(), // pending, purchased, voided, delivered
  metadata: text("metadata"), // JSON: Vendor-specific data
  errorMessage: text("error_message"), // If label creation failed
  createdAt: timestamp("created_at").defaultNow().notNull(),
  purchasedAt: timestamp("purchased_at"),
  voidedAt: timestamp("voided_at"),
  deliveredAt: timestamp("delivered_at"),
  orgId: varchar("org_id"),                            // FK → organizations.id
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  eodFormId: integer("eod_form_id"), // FK to eodForms.id — set after SCAN form creation
  isTest: boolean("is_test").default(false).notNull(), // true when purchased with test API key
  trackerId: text("tracker_id"),                       // EasyPost tracker ID
  trackingStatus: text("tracking_status"),             // pre_transit|in_transit|out_for_delivery|delivered|return_to_sender|failure
  trackingStatusDetail: text("tracking_status_detail"),// human-readable detail from EasyPost
  trackingUpdatedAt: timestamp("tracking_updated_at"), // when we last fetched status from EasyPost
}, (table) => ({
  orgIdIdx: index("shipments_org_id_idx").on(table.orgId),
  orgIdStatusIdx: index("shipments_org_id_status_idx").on(table.orgId, table.status),
}));

export const insertShipmentSchema = createInsertSchema(shipments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertShipment = z.infer<typeof insertShipmentSchema>;
export type Shipment = typeof shipments.$inferSelect;

// EOD (End-of-Day) SCAN form records — tracks EasyPost SCAN forms and which shipments are included
export const eodForms = pgTable("eod_forms", {
  id: serial("id").primaryKey(),
  formUrl: text("form_url").notNull(),
  scanFormId: text("scan_form_id"), // EasyPost scan form object ID
  shipmentCount: integer("shipment_count").notNull(),
  orgId: varchar("org_id"),                            // FK → organizations.id
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  orgIdIdx: index("eod_forms_org_id_idx").on(table.orgId),
}));

export type EodForm = typeof eodForms.$inferSelect;

// Relations
export const blInventoryRelations = relations(blInventory, ({ one }) => ({
  catalog: one(blCatalog, {
    fields: [blInventory.itemNo, blInventory.itemType, blInventory.colorId],
    references: [blCatalog.itemNo, blCatalog.itemType, blCatalog.colorId],
  }),
}));

export const blCatalogRelations = relations(blCatalog, ({ many }) => ({
  inventory: many(blInventory),
}));

export const ordersRelations = relations(orders, ({ many }) => ({
  items: many(orderDetails),
  shipments: many(shipments),
}));

export const orderDetailsRelations = relations(orderDetails, ({ one }) => ({
  order: one(orders, {
    fields: [orderDetails.orderId],
    references: [orders.id],
  }),
}));

export const shipmentsRelations = relations(shipments, ({ one }) => ({
  order: one(orders, {
    fields: [shipments.orderId],
    references: [orders.id],
  }),
}));

// App Settings
export const appSettings = pgTable("app_settings", {
  id: varchar("id").primaryKey().default('default'),
  orgId: varchar("org_id"),                            // FK → organizations.id
  aiEnabled: boolean("ai_enabled").default(true).notNull(),
  bricklinkConsumerKey: text("bricklink_consumer_key"),
  bricklinkConsumerSecret: text("bricklink_consumer_secret"),
  bricklinkTokenValue: text("bricklink_token_value"),
  bricklinkTokenSecret: text("bricklink_token_secret"),
  blApiCallLimit: integer("bl_api_call_limit").default(4900).notNull(),  // org's own daily ceiling
  brickowlApiKey: text("brickowl_api_key"),
  easypostApiKey: text("easypost_api_key"),
  easypostTestApiKey: text("easypost_test_api_key"),
  easypostKeyMode: text("easypost_key_mode").default('test').notNull(), // 'test' or 'production'
  // International Shipping / Customs
  customsSigner: text("customs_signer"),           // Name to sign customs declarations
  blIossNumber: text("bl_ioss_number"),            // BrickLink EU IOSS number
  boIossNumber: text("bo_ioss_number"),            // BrickOwl EU IOSS number
  blUkVatNumber: text("bl_uk_vat_number"),         // BrickLink UK VAT number
  boUkVatNumber: text("bo_uk_vat_number"),         // BrickOwl UK VAT number
  orgTimezone: text("org_timezone").default('America/Chicago'),  // Org's local timezone (for display + order sync windows)
  // Automation & Scheduling
  inventorySyncEnabled: boolean("inventory_sync_enabled").default(false).notNull(),
  inventorySyncTime: text("inventory_sync_time").default('02:00'), // Legacy: time of day (HH:MM) — kept for backward compat
  inventorySyncFrequency: integer("inventory_sync_frequency").default(24), // Hours between automated inventory syncs
  priceOMaticEnabled: boolean("price_o_matic_enabled").default(false).notNull(),
  ordersSyncEnabled: boolean("orders_sync_enabled").default(false).notNull(),
  ordersSyncFrequency: integer("orders_sync_frequency").default(15).notNull(), // minutes
  ordersSyncStartTime: text("orders_sync_start_time").default('08:00'),        // Active window start (HH:MM, org timezone)
  ordersSyncEndTime: text("orders_sync_end_time").default('20:00'),            // Active window end   (HH:MM, org timezone)
  // Rebrickable Configuration (org-level image sync; set-sync moved to platform_settings)
  rebrickableImageSyncEnabled: boolean("rebrickable_image_sync_enabled").default(true).notNull(),
  // Price-o-Matic 4-Tier Refresh Settings
  pomTier1RefreshDays: integer("pom_tier1_refresh_days").default(1).notNull(),   // T1 High Volatility: daily
  pomTier2RefreshDays: integer("pom_tier2_refresh_days").default(3).notNull(),   // T2 Strong Demand: every 2-3 days
  pomTier3RefreshDays: integer("pom_tier3_refresh_days").default(7).notNull(),   // T3 Commodity: weekly
  pomTier4RefreshDays: integer("pom_tier4_refresh_days").default(30).notNull(),  // T4 Deep Inventory: monthly
  // Quantity-Based Override Thresholds
  pomQtyPromoteThreshold: integer("pom_qty_promote_threshold").default(5).notNull(),   // Stock ≤ N → promote 1 tier
  pomQtyDemoteThreshold: integer("pom_qty_demote_threshold").default(500).notNull(),   // Stock ≥ N → demote 1 tier
  // Revenue-Based Overlay
  pomRevenueTopPct: integer("pom_revenue_top_pct").default(20).notNull(),  // Top N% revenue lots → T1/T2
  // Price-o-Matic Formula Settings
  pomBasePremium: integer("pom_base_premium").default(10).notNull(),           // Base premium % over avg price
  pomMinifigPremium: integer("pom_minifig_premium").default(5).notNull(),      // Minifig base premium %
  pomScarcityThreshold1: integer("pom_scarcity_threshold1").default(50).notNull(),   // Very low supply lot count
  pomScarcityBonus1: integer("pom_scarcity_bonus1").default(15).notNull(),           // Very low supply bonus %
  pomScarcityThreshold2: integer("pom_scarcity_threshold2").default(200).notNull(),  // Low supply lot count
  pomScarcityBonus2: integer("pom_scarcity_bonus2").default(8).notNull(),            // Low supply bonus %
  pomScarcityThreshold3: integer("pom_scarcity_threshold3").default(500).notNull(),  // Medium supply lot count
  pomScarcityBonus3: integer("pom_scarcity_bonus3").default(3).notNull(),            // Medium supply bonus %
  pomTooHighThreshold: integer("pom_too_high_threshold").default(20).notNull(),  // % above suggested = too high
  pomTooLowThreshold: integer("pom_too_low_threshold").default(20).notNull(),    // % below suggested = too low
  pomUnderpricedScore: real("pom_underpriced_score").default(1.5).notNull(),     // Opportunity score >= this = underpriced
  pomOverpricedScore: real("pom_overpriced_score").default(0.8).notNull(),       // Opportunity score <= this = overpriced
  // Repricing score weights (must sum to 1.0)
  pomWeightCeiling: real("pom_weight_ceiling").default(0.4).notNull(),           // Price Ceiling Ratio weight
  pomWeightVelocity: real("pom_weight_velocity").default(0.3).notNull(),         // Demand Velocity weight
  pomWeightScarcity: real("pom_weight_scarcity").default(0.2).notNull(),         // Market Scarcity Index weight
  pomWeightUndercut: real("pom_weight_undercut").default(0.1).notNull(),         // Undercut Ratio weight
  // Demand Velocity thresholds
  pomVelocityHigh: real("pom_velocity_high").default(2.0).notNull(),             // Velocity >= this = high demand
  pomVelocityLow: real("pom_velocity_low").default(0.3).notNull(),               // Velocity <= this = low demand
  // Market Scarcity thresholds
  pomScarcityHigh: real("pom_scarcity_high").default(0.1).notNull(),             // Scarcity >= this = very scarce (≤10 sellers)
  pomScarcityLow: real("pom_scarcity_low").default(0.005).notNull(),             // Scarcity <= this = very common (≥200 sellers)
  // Undercut Ratio thresholds
  pomUndercutHigh: real("pom_undercut_high").default(1.5).notNull(),             // Undercut >= this = heavily undercut
  pomUndercutLow: real("pom_undercut_low").default(0.8).notNull(),               // Undercut <= this = cheapest seller
  pomBatchSize: integer("pom_batch_size").default(1500).notNull(),               // Items per sync run
  pomApiCallLimit: integer("pom_api_call_limit").default(4500).notNull(),        // POM daily API call ceiling
  pomCostFloorPct: integer("pom_cost_floor_pct").default(0).notNull(),           // Min % margin above my_cost (0 = off)
  pomMinPrice: decimal("pom_min_price", { precision: 10, scale: 4 }).default('0.02').notNull(), // Absolute min price per item
  // Sales velocity (trending) bonus
  pomTrendingEnabled: boolean("pom_trending_enabled").default(false).notNull(),
  pomTrendingDays: integer("pom_trending_days").default(30).notNull(),           // Look-back window in days
  pomTrendingThreshold: integer("pom_trending_threshold").default(5).notNull(),  // Min units sold to count as trending
  pomTrendingBonus: integer("pom_trending_bonus").default(5).notNull(),          // % bonus for trending items
  // High global supply penalty
  pomHighSupplyEnabled: boolean("pom_high_supply_enabled").default(false).notNull(),
  pomHighSupplyThreshold: integer("pom_high_supply_threshold").default(5000).notNull(), // Global total-qty threshold
  pomHighSupplyPenalty: integer("pom_high_supply_penalty").default(5).notNull(),        // % discount for flooded market
  pomFreshnessDays: integer("pom_freshness_days").default(180).notNull(),       // Skip items with price data newer than N days
  pomZeroStockSkip: boolean("pom_zero_stock_skip").default(true).notNull(),     // Skip items with 0 stock across platform
  pomGuideFocus: text("pom_guide_focus").default('both').notNull(),             // 'stock', 'sold', or 'both' — controls which price guide types to fetch
  // Suggested Pricing weights
  pomSugSoldAvgW: real("pom_sug_sold_avg_w").default(0.5).notNull(),
  pomSugStockMinW: real("pom_sug_stock_min_w").default(0.3).notNull(),
  pomSugSoldMaxW: real("pom_sug_sold_max_w").default(0.2).notNull(),
  pomSugDemandMult: real("pom_sug_demand_mult").default(0.25).notNull(),
  pomSugCompCap: real("pom_sug_comp_cap").default(1.15).notNull(),
  pomSugFloor: real("pom_sug_floor").default(0.95).notNull(),
  pomSugStorePremium: real("pom_sug_store_premium").default(1.10).notNull(),
  pomSugPremThreshold: real("pom_sug_prem_threshold").default(0.40).notNull(),
  pomSugPremVelW: real("pom_sug_prem_vel_w").default(0.6).notNull(),
  pomSugPremScarcW: real("pom_sug_prem_scarc_w").default(0.4).notNull(),
  pomSugPremMult: real("pom_sug_prem_mult").default(0.5).notNull(),
  // Channel Sync (Local DB → BrickOwl / other platforms)
  channelSyncEnabled: boolean("channel_sync_enabled").default(false).notNull(), // Push local inventory to all sales channels on a schedule
  channelSyncTime: text("channel_sync_time").default('03:00'),                  // Legacy: time of day (HH:MM) — kept for backward compat
  channelSyncFrequency: integer("channel_sync_frequency").default(4),           // Hours between automated channel syncs
  channelSyncMode: text("channel_sync_mode").default('analysis').notNull(), // 'analysis' = read-only compare only, 'full_control' = create + update all, 'matched_sync' = full sync of matched/tagged items only (no creates)
  pomDeepSpaceKeys: text("pom_deep_space_keys").default('[]'),                  // JSON array of item keys excluded from POM orbit view
  pomFutureMissionsKeys: text("pom_future_missions_keys").default('[]'),        // JSON array of item keys queued in Future Missions
  // List-o-Matic Priority Scores — editable weight per sorting phase (0-100 scale)
  lomCategoryScore: integer("lom_category_score").default(25).notNull(),       // Phase 1 — Category
  lomSubcategoryScore: integer("lom_subcategory_score").default(50).notNull(), // Phase 2 — Subcategory
  lomFinalsortScore: integer("lom_finalsort_score").default(75).notNull(),     // Phase 3 — Final Sort
  lomListingScore: integer("lom_listing_score").default(100).notNull(),        // Phase 4 — Listing (flagged cats get 2x)
  // E.L.F.I.E. Mode: 'search' = keyword/tool search only, 'ai' = full AI with data enrichment
  elfieMode: text("elfie_mode").default('search').notNull(),
  // Buyer Feedback generation
  feedbackPrompt: text("feedback_prompt"),
  // Printing configuration
  printMethod: text("print_method").default('browser'),       // 'browser' | 'direct_zpl' | 'pdf_download'
  labelPrinterIp: text("label_printer_ip"),                   // Printer IP (for direct_zpl)
  labelPrinterPort: integer("label_printer_port").default(9100), // Raw print port (default 9100)
  labelSize: text("label_size").default('4x6'),               // '4x6' | '2x7'
  printSetupDone: boolean("print_setup_done").default(false), // Has user been through first-time prompt
  // Shipping weight defaults
  defaultWeightMode: text("default_weight_mode").default('none'),           // 'none' | 'order'
  defaultWeightItemsPct: decimal("default_weight_items_pct", { precision: 10, scale: 2 }).default('0'),    // legacy — kept for backwards compat, no longer used in UI
  defaultWeightPerLotOz: decimal("default_weight_per_lot_oz", { precision: 10, scale: 3 }).default('0'),  // oz added per lot (line item) for poly bags etc
  defaultWeightPlusAmount: decimal("default_weight_plus_amount", { precision: 10, scale: 2 }).default('0'), // Fixed oz to add for overall packaging (envelope, label, tape)
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Learned shipping service mappings — one row per (org, marketplace label)
export const shippingServiceMappings = pgTable("shipping_service_mappings", {
  id: serial("id").primaryKey(),
  orgId: varchar("org_id").notNull(),
  label: text("label").notNull(),           // Marketplace label e.g. "Economy Shipping from China"
  easypostService: text("easypost_service").notNull(), // EasyPost service name e.g. "GroundAdvantage"
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [uniqueIndex("ssm_org_label_idx").on(t.orgId, t.label)]);

export const insertShippingServiceMappingSchema = createInsertSchema(shippingServiceMappings).omit({ id: true, updatedAt: true });
export type ShippingServiceMapping = typeof shippingServiceMappings.$inferSelect;

// Push notification subscriptions — one row per device per org
export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  orgId: varchar("org_id").notNull(),
  userId: varchar("user_id"),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  notifyAllOrders: boolean("notify_all_orders").notNull().default(true),
  notifyPriorityOrders: boolean("notify_priority_orders").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  orgIdIdx:  index("push_subscriptions_org_id_idx").on(table.orgId),
  userIdIdx: index("push_subscriptions_user_id_idx").on(table.userId),
}));
export type PushSubscription = typeof pushSubscriptions.$inferSelect;

export const insertAppSettingsSchema = createInsertSchema(appSettings).omit({
  id: true,
  updatedAt: true,
}).extend({
  // Hard cap: BrickLink enforces ~5,000 API calls per 24h per credential set.
  blApiCallLimit: z.number().int().min(100).max(5000).default(4900),
});

export type InsertAppSettings = z.infer<typeof insertAppSettingsSchema>;
export type AppSettings = typeof appSettings.$inferSelect;

// Platform Settings — platform-owned fields separated from org-level app_settings.
// Single row with id='platform'. Accessed via getPlatformSettings() in routes.ts.
export const platformSettings = pgTable("platform_settings", {
  id: varchar("id").primaryKey().default('platform'),
  // Branding & AI credentials
  platformName: text("platform_name"),
  tagline: text("tagline"),
  // Shop brand (Landing page "Shop" button)
  shopName: text("shop_name"),
  shopTagline: text("shop_tagline"),
  // Studio / App brand (Landing page "Studio" button)
  studioName: text("studio_name"),
  studioTagline: text("studio_tagline"),
  openaiApiKey: text("openai_api_key"),
  selectedModel: text("selected_model").default('gpt-4o-mini'),
  systemPrompt: text("system_prompt"),
  feedbackPrompt: text("feedback_prompt"),  // Custom instructions for E.L.F.I.E. feedback generation
  // Billing
  stripeSecretKey: text("stripe_secret_key"),
  stripeEnvironment: text("stripe_environment").default('live').notNull(),
  // BrickLink API credentials (used by all platform-level background schedulers)
  blConsumerKey: text("bl_consumer_key"),
  blConsumerSecret: text("bl_consumer_secret"),
  blTokenValue: text("bl_token_value"),
  blTokenSecret: text("bl_token_secret"),
  // Global API budget (platform ceiling for background schedulers)
  blApiCallLimit: integer("bl_api_call_limit").default(4900).notNull(),
  pomApiBudgetPct: integer("pom_api_budget_pct").default(70).notNull(),
  catalogDetailApiBudgetPct: integer("catalog_detail_api_budget_pct").default(20).notNull(),
  // POM scheduler
  pomScheduleEnabled: boolean("pom_schedule_enabled").default(false).notNull(),
  pomSyncTime: text("pom_sync_time").default('14:00'),
  pomScheduleBatchSize: integer("pom_schedule_batch_size").default(1500).notNull(),
  // Catalog Detail enrichment scheduler
  catalogDetailEnabled: boolean("catalog_detail_enabled").default(false).notNull(),
  catalogDetailFrequencyHours: integer("catalog_detail_frequency_hours").default(1).notNull(),
  catalogDetailBatchSize: integer("catalog_detail_batch_size").default(500).notNull(),
  catalogDetailFreshnessDays: integer("catalog_detail_freshness_days").default(90).notNull(),
  catalogDetailZeroStockSkip: boolean("catalog_detail_zero_stock_skip").default(true).notNull(),
  // Inventory catalog scan scheduler
  catalogScanEnabled: boolean("catalog_scan_enabled").default(false).notNull(),
  catalogScanFrequencyHours: integer("catalog_scan_frequency_hours").default(2).notNull(),
  catalogScanZeroStockSkip: boolean("catalog_scan_zero_stock_skip").default(true).notNull(),
  // Universal CLIP Catalog auto-refresh scheduler
  universalCatalogScheduleEnabled: boolean("universal_catalog_schedule_enabled").default(false).notNull(),
  universalCatalogRefreshMonths: integer("universal_catalog_refresh_months").default(1).notNull(),
  universalCatalogRetryDays: integer("universal_catalog_retry_days").default(30).notNull(),
  // Forum sync scheduler
  forumSyncEnabled: boolean("forum_sync_enabled").default(false).notNull(),
  forumSyncFrequency: integer("forum_sync_frequency").default(60).notNull(),
  // Market news scheduler
  marketNewsSyncEnabled: boolean("market_news_sync_enabled").default(false).notNull(),
  marketNewsSyncFrequency: integer("market_news_sync_frequency").default(360).notNull(),
  marketNewsQueries: text("market_news_queries").array().default(sql`ARRAY['LEGO set retirement announcements', 'LEGO reseller market news pricing trends', 'BrickLink marketplace updates sellers', 'LEGO collectible investing value 2026', 'LEGO supply chain new releases']`),
  // Business intel scheduler
  businessIntelEnabled: boolean("business_intel_enabled").default(false).notNull(),
  businessIntelFrequency: integer("business_intel_frequency").default(360).notNull(),
  // Rebrickable set-parts sync scheduler
  rebrickableSetSyncEnabled: boolean("rebrickable_set_sync_enabled").default(false).notNull(),
  rebrickableSetSyncTime: text("rebrickable_set_sync_time").default('04:00'),
  // Platform timezone (used by schedulers for time-of-day gates)
  timezone: text("timezone").default('America/Chicago'),
  // Org-sync scheduler admin — global defaults & emergency pause
  defaultInventoryFreqHours: integer("default_inventory_freq_hours").default(24).notNull(),
  defaultOrdersFreqMins: integer("default_orders_freq_mins").default(30).notNull(),
  defaultChannelFreqHours: integer("default_channel_freq_hours").default(4).notNull(),
  globalSyncPaused: boolean("global_sync_paused").default(false).notNull(),
  // Per-plan frequency floors — minimum interval each plan tier is allowed to use
  // Structure: { inventory: { beta: 24, core: 12, pro: 6 }, orders: { ... }, channel: { ... } }
  syncFloorsByPlan: jsonb("sync_floors_by_plan"),
  // eBay Developer App credentials (platform-level — shared across all orgs)
  // Production environment
  ebayProdAppId: text("ebay_prod_app_id"),
  ebayProdCertId: text("ebay_prod_cert_id"),
  ebayProdDevId: text("ebay_prod_dev_id"),
  ebayProdRuName: text("ebay_prod_ru_name"),
  // Sandbox environment
  ebaySandboxAppId: text("ebay_sandbox_app_id"),
  ebaySandboxCertId: text("ebay_sandbox_cert_id"),
  ebaySandboxDevId: text("ebay_sandbox_dev_id"),
  ebaySandboxRuName: text("ebay_sandbox_ru_name"),
  // Notification compliance token — set once in eBay Developer Portal → Notifications
  ebayNotificationToken: text("ebay_notification_token"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPlatformSettingsSchema = createInsertSchema(platformSettings).omit({
  id: true,
  updatedAt: true,
});

export type InsertPlatformSettings = z.infer<typeof insertPlatformSettingsSchema>;
export type PlatformSettings = typeof platformSettings.$inferSelect;

// Channel Sync per-field configuration — which fields are synced from BL → BO
// Stored separately to avoid adding columns to the 1600-column-limited app_settings table.
// Qty is always synced; only these optional fields are user-configurable.
export const channelSyncConfig = pgTable("channel_sync_config", {
  id: serial("id").primaryKey(),
  orgId:      varchar("org_id").notNull(),
  channelKey: varchar("channel_key").notNull().default('brickowl'), // e.g. 'brickowl', 'ebay'
  syncPrice:       boolean("sync_price").default(true).notNull(),
  syncRemarks:     boolean("sync_remarks").default(true).notNull(),       // personal_note (BL remarks)
  syncDescription: boolean("sync_description").default(true).notNull(),   // public_note (BL description)
  syncTierPrice:   boolean("sync_tier_price").default(true).notNull(),
  syncSalePercent:      boolean("sync_sale_percent").default(true).notNull(),    // sale_percent — syncs BL saleRate → BO sale_percent (clears per-lot discounts when BL rate is 0)
  syncBulkQty:          boolean("sync_bulk_qty").default(true).notNull(),        // bulk_qty — min order quantity (BL bulk)
  syncLotWeight:        boolean("sync_lot_weight").default(true).notNull(),      // lot_weight — custom weight (BL myWeight)
  // Per-stockroom sync mode: 'skip' = ignore entirely, 'hidden' = sync but force for_sale=0 on BO, 'active' = sync as normal for-sale lot
  syncStockroomModes:   jsonb("sync_stockroom_modes").$type<Record<string, 'skip' | 'hidden' | 'active'>>().notNull().default({ A: 'skip', B: 'skip', C: 'skip' }),
  // Per-item-type sync inclusion: { 'P': false } excludes Parts; missing key or true = include.
  // Empty object (default) means all types are synced.
  syncItemTypes:        jsonb("sync_item_types").$type<Record<string, boolean>>().notNull().default({}),
  // Price floor: lots with unit_price below this value are skipped (and any existing listing is deactivated).
  // null / 0 = no floor (sync everything regardless of price).
  syncPriceFloor:       decimal("sync_price_floor").$type<number>(),
  // Bulk Lots sync toggle — include all active bulk lots in this channel sync
  syncBulkLots:         boolean("sync_bulk_lots").default(false).notNull(),
  // Channel-specific extra config (eBay: blIdField, catalogMatch, listingDuration, imageSync, etc.)
  channelConfig:        jsonb("channel_config").$type<Record<string, unknown>>().default({}),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("channel_sync_config_org_channel_unique").on(t.orgId, t.channelKey),
]);
export type ChannelSyncConfig = typeof channelSyncConfig.$inferSelect;
export const insertChannelSyncConfigSchema = createInsertSchema(channelSyncConfig).omit({ id: true, updatedAt: true });

// ── Bulk Lots ──────────────────────────────────────────────────────────────────
// A bulk lot is a virtual multi-item listing created by the BundleTron tool.
// It collects one or more bl_inventory lots into a named bundle for sale on
// channels that support multi-item listings (e.g. BrickOwl).  BrickLink is
// intentionally excluded — it has no native bundle concept.
//
// Bulk types:
//   'same_part'   — e.g. "100× 1×2 Plates, mixed colors" (single item type, many colors)
//   'mixed_parts' — e.g. "City Police Parts Lot" (multiple item types / categories)
export const bulkLots = pgTable("bulk_lots", {
  id:          serial("id").primaryKey(),
  orgId:       varchar("org_id").notNull(),
  name:        text("name").notNull(),
  description: text("description"),                   // AI-generated or user-written listing description
  bulkType:    text("bulk_type").notNull(),             // 'same_part' | 'mixed_parts'
  unitPrice:   decimal("unit_price", { precision: 10, scale: 2 }), // Price for the entire bundle
  quantity:    integer("quantity").notNull().default(1),            // How many copies of this bundle are for sale
  condition:   text("condition").notNull().default('U'),            // 'N' = New, 'U' = Used — channel-agnostic
  status:      text("status").notNull().default('draft'), // 'draft' | 'active' | 'inactive'
  // Channel metadata — populated once the lot is pushed to BO
  boBoid:      text("bo_boid"),            // Generated unique identifier used as the item reference on BrickOwl
  boLotId:     text("bo_lot_id"),          // BO inventory lot_id returned after creating the listing
  lastSyncedAt: timestamp("last_synced_at"),
  syncError:   text("sync_error"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgIdIdx:  index("bulk_lots_org_id_idx").on(table.orgId),
  orgStatusIdx: index("bulk_lots_org_status_idx").on(table.orgId, table.status),
}));
export type BulkLot = typeof bulkLots.$inferSelect;
export const insertBulkLotSchema = createInsertSchema(bulkLots).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBulkLot = z.infer<typeof insertBulkLotSchema>;

// Items (bl_inventory lots) that make up a bulk lot.
// Each row links one BL inventory lot to one bulk lot, with the quantity
// that is being contributed to the bundle (may be less than the full lot qty).
export const bulkLotItems = pgTable("bulk_lot_items", {
  id:          serial("id").primaryKey(),
  bulkLotId:   integer("bulk_lot_id").notNull().references(() => bulkLots.id, { onDelete: 'cascade' }),
  blInventoryId: integer("bl_inventory_id").notNull().references(() => blInventory.id, { onDelete: 'cascade' }),
  quantity:    integer("quantity").notNull().default(1),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
});
export type BulkLotItem = typeof bulkLotItems.$inferSelect;
export const insertBulkLotItemSchema = createInsertSchema(bulkLotItems).omit({ id: true, createdAt: true });
export type InsertBulkLotItem = z.infer<typeof insertBulkLotItemSchema>;

// Conversation Threads — chat session metadata
export const conversationThreads = pgTable("conversation_threads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: text("session_id").notNull().unique(),
  orgId: varchar("org_id").notNull(),
  title: text("title").default('New conversation'),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgIdIdx: index("conversation_threads_org_idx").on(table.orgId),
  updatedAtIdx: index("conversation_threads_updated_idx").on(table.updatedAt),
}));

export type ConversationThread = typeof conversationThreads.$inferSelect;

// Conversation History for E.L.F.I.E. learning
export const conversations = pgTable("conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: text("session_id").notNull(),
  role: text("role").notNull(), // 'user' or 'assistant'
  content: text("content").notNull(),
  context: text("context"), // dashboard context
  orgId: varchar("org_id"),                            // FK → organizations.id
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  orgIdSessionIdx: index("conversations_org_session_idx").on(table.orgId, table.sessionId),
}));

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
});

export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Conversation = typeof conversations.$inferSelect;

// Support Tickets — escalated Elfie conversations
export const supportTickets = pgTable("support_tickets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  sessionId: text("session_id").notNull(),
  status: text("status").notNull().default('escalated'), // escalated | active | resolved
  subject: text("subject"),
  assignedTo: varchar("assigned_to"), // platform admin user id
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
}, (table) => ({
  orgIdx: index("support_tickets_org_idx").on(table.orgId),
  statusIdx: index("support_tickets_status_idx").on(table.status),
}));

export const insertSupportTicketSchema = createInsertSchema(supportTickets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
});
export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;
export type SupportTicket = typeof supportTickets.$inferSelect;

// BrickLink API Call Tracking
export const blApiCalls = pgTable("bl_api_calls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  endpoint: text("endpoint").notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  success: boolean("success").default(true).notNull(),
  orgId: varchar("org_id"),                            // FK → organizations.id
}, (table) => ({
  orgIdTimestampIdx: index("bl_api_calls_org_ts_idx").on(table.orgId, table.timestamp),
}));

export const insertBlApiCallSchema = createInsertSchema(blApiCalls).omit({
  id: true,
  timestamp: true,
});

export type InsertBlApiCall = z.infer<typeof insertBlApiCallSchema>;
export type BlApiCall = typeof blApiCalls.$inferSelect;

// Sync Metadata - Track last successful sync times for incremental syncs
export const syncMetadata = pgTable("sync_metadata", {
  id: varchar("id").primaryKey(), // e.g., 'bricklink_inventory', 'bricklink_categories', 'shipstation_orders'
  lastSyncTime: timestamp("last_sync_time"), // null = no successful sync yet (triggers full sync)
  lastSyncStatus: text("last_sync_status").notNull(), // 'success', 'failed', 'in_progress'
  recordsAdded: integer("records_added").default(0),
  recordsUpdated: integer("records_updated").default(0),
  errorMessage: text("error_message"),
  orgId: varchar("org_id"),                            // FK → organizations.id
  lastSyncMetaJson: text("last_sync_meta_json"),       // JSON blob of last full sync result (lotsCreated, updated, skipped, errors, mode, etc.)
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgIdIdx: index("sync_metadata_org_id_idx").on(table.orgId),
}));

export const insertSyncMetadataSchema = createInsertSchema(syncMetadata).omit({
  updatedAt: true,
});

export type InsertSyncMetadata = z.infer<typeof insertSyncMetadataSchema>;
export type SyncMetadata = typeof syncMetadata.$inferSelect;

// Sync Issues - Track issues that arise during sync operations
export const syncIssues = pgTable("sync_issues", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  syncType: text("sync_type").notNull(), // 'order_sync', 'inventory_sync'
  platform: text("platform").notNull(), // 'bricklink', 'brickowl', 'shipstation', etc.
  itemId: text("item_id"), // ID of the specific item/order with the issue
  itemNo: text("item_no"), // Part/item number for context
  issueType: text("issue_type").notNull(), // 'missing', 'quantity_mismatch', 'price_mismatch', 'api_error', etc.
  issueDescription: text("issue_description").notNull(),
  severity: text("severity").notNull(), // 'low', 'medium', 'high', 'critical'
  status: text("status").notNull().default('open'), // 'open', 'resolved', 'ignored'
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by"), // User or 'system'
  metadata: text("metadata"), // JSON string for additional context
  orgId: varchar("org_id"),                            // FK → organizations.id
}, (table) => ({
  orgIdStatusIdx: index("sync_issues_org_status_idx").on(table.orgId, table.status),
}));

export const insertSyncIssueSchema = createInsertSchema(syncIssues).omit({
  id: true,
  createdAt: true,
});

export type InsertSyncIssue = z.infer<typeof insertSyncIssueSchema>;
export type SyncIssue = typeof syncIssues.$inferSelect;

// Price-o-Matic Cache - Stores merged BrickLink item details and price guide data
export const priceGuideCache = pgTable("price_guide_cache", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  itemNo: text("item_no").notNull(),
  itemType: text("item_type").notNull(),
  colorId: integer("color_id"),
  newOrUsed: text("new_or_used").notNull().default('N'), // 'N' for New, 'U' for Used
  
  // Item Details from BrickLink
  itemName: text("item_name"),
  imageUrl: text("image_url"),
  thumbnailUrl: text("thumbnail_url"),
  categoryId: integer("category_id"),
  weight: decimal("weight", { precision: 10, scale: 4 }),
  dimensionX: decimal("dimension_x", { precision: 10, scale: 2 }),
  dimensionY: decimal("dimension_y", { precision: 10, scale: 2 }),
  dimensionZ: decimal("dimension_z", { precision: 10, scale: 2 }),
  yearReleased: integer("year_released"),
  
  // Price Guide - Stock (current market)
  stockAvgPrice: decimal("stock_avg_price", { precision: 10, scale: 2 }),
  stockMinPrice: decimal("stock_min_price", { precision: 10, scale: 2 }),
  stockMaxPrice: decimal("stock_max_price", { precision: 10, scale: 2 }),
  stockTotalLots: integer("stock_total_lots"),
  
  // Price Guide - Sold (historical)
  soldAvgPrice: decimal("sold_avg_price", { precision: 10, scale: 2 }),
  soldMinPrice: decimal("sold_min_price", { precision: 10, scale: 2 }),
  soldMaxPrice: decimal("sold_max_price", { precision: 10, scale: 2 }),
  soldTotalLots: integer("sold_total_lots"),
  
  // Price-O-Matic Suggested Price (with premium)
  suggestedPrice: decimal("suggested_price", { precision: 10, scale: 2 }),
  premiumPercentage: integer("premium_percentage").default(15), // Default 15% premium
  
  // Cache management
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  soldFetchedAt: timestamp("sold_fetched_at"),
  stockFetchedAt: timestamp("stock_fetched_at"),
  nextRefresh: timestamp("next_refresh"), // When this item should be refreshed next
  volatilityTier: text("volatility_tier").default('stable'), // 'hot' | 'active' | 'stable'
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPriceGuideCacheSchema = createInsertSchema(priceGuideCache).omit({
  id: true,
  fetchedAt: true,
  updatedAt: true,
});

export type InsertPriceGuideCache = z.infer<typeof insertPriceGuideCacheSchema>;
export type PriceGuideCache = typeof priceGuideCache.$inferSelect;

// Part Price History — append-only snapshots written on every POM sync
// Preserves market data beyond BrickLink's 6-month rolling window
export const partPriceHistory = pgTable("part_price_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  itemNo: text("item_no").notNull(),
  itemType: text("item_type").notNull(),
  colorId: integer("color_id"),
  newOrUsed: text("new_or_used").notNull().default('N'),
  snapshotDate: date("snapshot_date").notNull(),

  // Stock guide — current market listings
  stockAvgPrice: decimal("stock_avg_price", { precision: 10, scale: 4 }),
  stockMinPrice: decimal("stock_min_price", { precision: 10, scale: 4 }),
  stockMaxPrice: decimal("stock_max_price", { precision: 10, scale: 4 }),
  stockUnitQty: integer("stock_unit_qty"),
  stockTotalLots: integer("stock_total_lots"),
  stockQtyAvg: integer("stock_qty_avg"),
  stockP10: decimal("stock_p10", { precision: 10, scale: 4 }),
  stockP25: decimal("stock_p25", { precision: 10, scale: 4 }),
  stockP50: decimal("stock_p50", { precision: 10, scale: 4 }),
  stockP75: decimal("stock_p75", { precision: 10, scale: 4 }),
  stockP85: decimal("stock_p85", { precision: 10, scale: 4 }),
  stockP95: decimal("stock_p95", { precision: 10, scale: 4 }),

  // Sold guide — last 6 months of completed transactions
  soldAvgPrice: decimal("sold_avg_price", { precision: 10, scale: 4 }),
  soldMinPrice: decimal("sold_min_price", { precision: 10, scale: 4 }),
  soldMaxPrice: decimal("sold_max_price", { precision: 10, scale: 4 }),
  soldUnitQty: integer("sold_unit_qty"),
  soldTotalLots: integer("sold_total_lots"),
  soldQtyAvg: integer("sold_qty_avg"),
  soldP10: decimal("sold_p10", { precision: 10, scale: 4 }),
  soldP25: decimal("sold_p25", { precision: 10, scale: 4 }),
  soldP50: decimal("sold_p50", { precision: 10, scale: 4 }),
  soldP75: decimal("sold_p75", { precision: 10, scale: 4 }),
  soldP85: decimal("sold_p85", { precision: 10, scale: 4 }),
  soldP95: decimal("sold_p95", { precision: 10, scale: 4 }),

  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
}, (table) => ({
  partDateIdx: index("part_price_history_part_date_idx").on(table.itemNo, table.itemType, table.colorId, table.newOrUsed, table.snapshotDate),
}));

export const insertPartPriceHistorySchema = createInsertSchema(partPriceHistory).omit({
  id: true,
  fetchedAt: true,
});
export type InsertPartPriceHistory = z.infer<typeof insertPartPriceHistorySchema>;
export type PartPriceHistory = typeof partPriceHistory.$inferSelect;

// Vector Embeddings - For semantic search and AI intelligence
export const inventoryEmbeddings = pgTable("inventory_embeddings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  inventoryId: integer("inventory_id").notNull(), // Reference to bl_inventory.id
  embedding: vector("embedding", { dimensions: 1536 }), // OpenAI text-embedding-3-small uses 1536 dimensions
  content: text("content").notNull(), // The text that was embedded (item details, description, etc.)
  embeddingModel: text("embedding_model").default('text-embedding-3-small').notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertInventoryEmbeddingSchema = createInsertSchema(inventoryEmbeddings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertInventoryEmbedding = z.infer<typeof insertInventoryEmbeddingSchema>;
export type InventoryEmbedding = typeof inventoryEmbeddings.$inferSelect;

// Order Embeddings - For order pattern analysis
export const orderEmbeddings = pgTable("order_embeddings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").notNull(), // Reference to orders.id
  embedding: vector("embedding", { dimensions: 1536 }),
  content: text("content").notNull(), // Order details, items, customer patterns
  embeddingModel: text("embedding_model").default('text-embedding-3-small').notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertOrderEmbeddingSchema = createInsertSchema(orderEmbeddings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertOrderEmbedding = z.infer<typeof insertOrderEmbeddingSchema>;
export type OrderEmbedding = typeof orderEmbeddings.$inferSelect;

// Order Detail Embeddings - For line-item level analysis (SKU performance, category trends)
export const orderDetailEmbeddings = pgTable("order_detail_embeddings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderDetailId: varchar("order_detail_id").notNull(), // Reference to order_details.id
  embedding: vector("embedding", { dimensions: 1536 }),
  content: text("content").notNull(), // SKU, quantity, price, category, sale date
  embeddingModel: text("embedding_model").default('text-embedding-3-small').notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertOrderDetailEmbeddingSchema = createInsertSchema(orderDetailEmbeddings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertOrderDetailEmbedding = z.infer<typeof insertOrderDetailEmbeddingSchema>;
export type OrderDetailEmbedding = typeof orderDetailEmbeddings.$inferSelect;

// Set-Part Embeddings - For AI understanding of set-part relationships
export const setPartEmbeddings = pgTable("set_part_embeddings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  setNum: text("set_num").notNull(), // Reference to set_part_relationships.set_num
  embedding: vector("embedding", { dimensions: 1536 }),
  content: text("content").notNull(), // Set details, parts list, context
  embeddingModel: text("embedding_model").default('text-embedding-3-small').notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  setNumIdx: index("set_part_embeddings_set_num_idx").on(table.setNum),
}));

export const insertSetPartEmbeddingSchema = createInsertSchema(setPartEmbeddings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSetPartEmbedding = z.infer<typeof insertSetPartEmbeddingSchema>;
export type SetPartEmbedding = typeof setPartEmbeddings.$inferSelect;

// Catalog CLIP Embeddings — 512-dim visual fingerprints keyed to bl_catalog entries
// Shared across all orgs (no org_id). One embedding per (itemNo, itemType, colorId, source).
// source='catalog':  embedded from BrickLink CDN reference image (batch-built)
// source='scan':     embedded from a confirmed Brick Spotter crop (higher quality)
// source='universal': color-agnostic embedding from Rebrickable images
export const blCatalogClipEmbeddings = pgTable("bl_catalog_clip_embeddings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  itemNo: text("item_no").notNull(),
  itemType: text("item_type").notNull().default('PART'),
  colorId: integer("color_id"),
  embedding: vector("embedding", { dimensions: 512 }),
  source: text("source").notNull().default('catalog'),
  clipModel: text("clip_model").notNull().default('ViT-B/32'),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  blCatalogClipEmbPartIdx: index("bl_catalog_clip_emb_part_idx").on(table.itemNo, table.itemType, table.colorId),
}));

export const insertBlCatalogClipEmbeddingSchema = createInsertSchema(blCatalogClipEmbeddings).omit({
  id: true,
  createdAt: true,
});
export type InsertBlCatalogClipEmbedding = z.infer<typeof insertBlCatalogClipEmbeddingSchema>;
export type BlCatalogClipEmbedding = typeof blCatalogClipEmbeddings.$inferSelect;

export const blCatalogClipEmbeddingsRelations = relations(blCatalogClipEmbeddings, ({ one }) => ({
  catalog: one(blCatalog, {
    fields: [blCatalogClipEmbeddings.itemNo, blCatalogClipEmbeddings.itemType, blCatalogClipEmbeddings.colorId],
    references: [blCatalog.itemNo, blCatalog.itemType, blCatalog.colorId],
  }),
}));

// Background Embedding Jobs - For async embedding generation
export const embeddingJobs = pgTable("embedding_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobType: text("job_type").notNull(), // 'inventory', 'orders', 'sets'
  status: text("status").notNull(), // 'pending', 'processing', 'completed', 'failed'
  triggeredBy: text("triggered_by").notNull(), // 'manual_sync', 'automated_sync', 'system'
  
  // Progress tracking
  totalItems: integer("total_items"),
  processedItems: integer("processed_items").default(0),
  
  // Metadata
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  orgId: varchar("org_id"),                            // FK → organizations.id
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  statusIdx: index("embedding_jobs_status_idx").on(table.status),
  createdAtIdx: index("embedding_jobs_created_idx").on(table.createdAt),
  orgIdIdx: index("embedding_jobs_org_id_idx").on(table.orgId),
}));

export const insertEmbeddingJobSchema = createInsertSchema(embeddingJobs).omit({
  id: true,
  createdAt: true,
});

export type InsertEmbeddingJob = z.infer<typeof insertEmbeddingJobSchema>;
export type EmbeddingJob = typeof embeddingJobs.$inferSelect;

// Warehouse Management - Zones (top-level named areas, each with its own depth)
export const whZones = pgTable("wh_zones", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  orgId: varchar("org_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  depth: integer("depth").notNull().default(3),          // 1=bins, 2=shelf+bin, 3=aisle+shelf+bin
  sortOrder: integer("sort_order").default(0),
  aisleFormat: varchar("aisle_format", { length: 20 }).default('numeric'),
  shelfFormat: varchar("shelf_format", { length: 20 }).default('alpha'),
  binFormat: varchar("bin_format", { length: 20 }).default('numeric'),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgIdIdx: index("wh_zones_org_id_idx").on(table.orgId),
}));

export const insertWhZoneSchema = createInsertSchema(whZones).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
} as any);

export type InsertWhZone = z.infer<typeof insertWhZoneSchema>;
export type WhZone = typeof whZones.$inferSelect;

// Warehouse Management - Aisles
export const whAisles = pgTable("wh_aisles", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(), // e.g., "Aisle 1", "A", etc.
  description: text("description"),
  orgId: varchar("org_id"),                            // FK → organizations.id
  zoneId: integer("zone_id").references(() => whZones.id, { onDelete: 'cascade' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgIdIdx: index("wh_aisles_org_id_idx").on(table.orgId),
}));

export const insertWhAisleSchema = createInsertSchema(whAisles).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertWhAisle = z.infer<typeof insertWhAisleSchema>;
export type WhAisle = typeof whAisles.$inferSelect;

// Warehouse Management - Shelves
export const whShelves = pgTable("wh_shelves", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(), // e.g., "Shelf 1", "Top Shelf", etc.
  aisleId: integer("aisle_id").references(() => whAisles.id, { onDelete: 'cascade' }),
  position: integer("position"), // Optional: ordering within aisle
  description: text("description"),
  orgId: varchar("org_id"),                            // FK → organizations.id
  zoneId: integer("zone_id").references(() => whZones.id, { onDelete: 'cascade' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgIdIdx: index("wh_shelves_org_id_idx").on(table.orgId),
}));

export const insertWhShelfSchema = createInsertSchema(whShelves).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertWhShelf = z.infer<typeof insertWhShelfSchema>;
export type WhShelf = typeof whShelves.$inferSelect;

// Warehouse Management - Bins
export const whBins = pgTable("wh_bins", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(), // e.g., "Bin A1", "Box 23", etc.
  shelfId: integer("shelf_id").references(() => whShelves.id, { onDelete: 'cascade' }),
  position: integer("position"), // Optional: ordering on shelf
  description: text("description"),
  orgId: varchar("org_id"),                            // FK → organizations.id
  zoneId: integer("zone_id").references(() => whZones.id, { onDelete: 'cascade' }),
  isFilingQueue: boolean("is_filing_queue").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgIdIdx: index("wh_bins_org_id_idx").on(table.orgId),
}));

export const insertWhBinSchema = createInsertSchema(whBins).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertWhBin = z.infer<typeof insertWhBinSchema>;
export type WhBin = typeof whBins.$inferSelect;

// Warehouse Management - Inventory Locations (mapping table)
export const inventoryLocations = pgTable("inventory_locations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  inventoryId: integer("inventory_id").notNull().references(() => blInventory.id, { onDelete: 'cascade' }), 
  binId: integer("bin_id").notNull().references(() => whBins.id, { onDelete: 'cascade' }),
  bagLabel: text("bag_label"), // Optional: label on the physical bag
  quantity: integer("quantity"), // Optional: if splitting inventory across multiple bins
  notes: text("notes"),
  orgId: varchar("org_id"),                            // FK → organizations.id
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgIdIdx: index("inv_locations_org_id_idx").on(table.orgId),
  inventoryIdx: index("inv_locations_inventory_idx").on(table.inventoryId),
}));

export const insertInventoryLocationSchema = createInsertSchema(inventoryLocations).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertInventoryLocation = z.infer<typeof insertInventoryLocationSchema>;
export type InventoryLocation = typeof inventoryLocations.$inferSelect;

// Relations for warehouse management
export const whZonesRelations = relations(whZones, ({ many }) => ({
  aisles: many(whAisles),
  shelves: many(whShelves),
  bins: many(whBins),
}));

export const whAislesRelations = relations(whAisles, ({ one, many }) => ({
  zone: one(whZones, { fields: [whAisles.zoneId], references: [whZones.id] }),
  shelves: many(whShelves),
}));

export const whShelvesRelations = relations(whShelves, ({ one, many }) => ({
  zone: one(whZones, { fields: [whShelves.zoneId], references: [whZones.id] }),
  aisle: one(whAisles, {
    fields: [whShelves.aisleId],
    references: [whAisles.id],
  }),
  bins: many(whBins),
}));

export const whBinsRelations = relations(whBins, ({ one, many }) => ({
  zone: one(whZones, { fields: [whBins.zoneId], references: [whZones.id] }),
  shelf: one(whShelves, {
    fields: [whBins.shelfId],
    references: [whShelves.id],
  }),
  inventoryLocations: many(inventoryLocations),
}));

export const inventoryLocationsRelations = relations(inventoryLocations, ({ one }) => ({
  inventory: one(blInventory, {
    fields: [inventoryLocations.inventoryId],
    references: [blInventory.id],
  }),
  bin: one(whBins, {
    fields: [inventoryLocations.binId],
    references: [whBins.id],
  }),
}));

// Picklist Items - Track pulled/reshelved status for warehouse picking
export const picklistItems = pgTable("picklist_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderDetailId: varchar("order_detail_id").notNull().references(() => orderDetails.id, { onDelete: 'cascade' }),
  orderId: varchar("order_id").notNull().references(() => orders.id, { onDelete: 'cascade' }),
  inventoryId: integer("inventory_id").references(() => blInventory.id, { onDelete: 'set null' }),
  binId: integer("bin_id").references(() => whBins.id, { onDelete: 'set null' }),
  pulled: boolean("pulled").default(false).notNull(),
  reshelved: boolean("reshelved").default(false).notNull(),
  pulledAt: timestamp("pulled_at"),
  reshelvedAt: timestamp("reshelved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orderIdPulledIdx: index("picklist_order_pulled_idx").on(table.orderId, table.pulled),
  orderIdReshelvedIdx: index("picklist_order_reshelved_idx").on(table.orderId, table.reshelved),
  binIdIdx: index("picklist_bin_idx").on(table.binId),
  inventoryIdIdx: index("picklist_inventory_idx").on(table.inventoryId),
}));

export const insertPicklistItemSchema = createInsertSchema(picklistItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPicklistItem = z.infer<typeof insertPicklistItemSchema>;
export type PicklistItem = typeof picklistItems.$inferSelect;

// Relations for picklist
export const picklistItemsRelations = relations(picklistItems, ({ one }) => ({
  orderDetail: one(orderDetails, {
    fields: [picklistItems.orderDetailId],
    references: [orderDetails.id],
  }),
  order: one(orders, {
    fields: [picklistItems.orderId],
    references: [orders.id],
  }),
  inventory: one(blInventory, {
    fields: [picklistItems.inventoryId],
    references: [blInventory.id],
  }),
  bin: one(whBins, {
    fields: [picklistItems.binId],
    references: [whBins.id],
  }),
}));

// Backup & Restore System Tables

// Restore Jobs - Track database restore operations
export const restoreJobs = pgTable("restore_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  restoreTimestamp: timestamp("restore_timestamp").notNull(), // Target restore point
  initiatedBy: text("initiated_by").notNull(), // Username or system
  status: text("status").notNull(), // pending, restoring, syncing, differential, verifying, complete, failed
  currentStep: text("current_step"), // Current operation description
  progress: integer("progress").default(0), // 0-100
  
  // Tracking metadata
  dbRestoreStarted: timestamp("db_restore_started"),
  dbRestoreCompleted: timestamp("db_restore_completed"),
  platformSyncStarted: timestamp("platform_sync_started"),
  platformSyncCompleted: timestamp("platform_sync_completed"),
  differentialStarted: timestamp("differential_started"),
  differentialCompleted: timestamp("differential_completed"),
  verificationStarted: timestamp("verification_started"),
  verificationCompleted: timestamp("verification_completed"),
  
  // Results
  errorMessage: text("error_message"),
  verificationResults: text("verification_results"), // JSON string with verification metrics
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  statusIdx: index("restore_jobs_status_idx").on(table.status),
  createdAtIdx: index("restore_jobs_created_idx").on(table.createdAt),
}));

export const insertRestoreJobSchema = createInsertSchema(restoreJobs).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});

export type InsertRestoreJob = z.infer<typeof insertRestoreJobSchema>;
export type RestoreJob = typeof restoreJobs.$inferSelect;

// Differential Batches - Track BrickLink update batches during differential recovery
export const differentialBatches = pgTable("differential_batches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  restoreJobId: varchar("restore_job_id").notNull().references(() => restoreJobs.id, { onDelete: 'cascade' }),
  batchNumber: integer("batch_number").notNull(),
  totalBatches: integer("total_batches").notNull(),
  
  // Batch contents
  inventoryIds: text("inventory_ids").notNull(), // JSON array of BL inventory IDs to update
  
  // Update details
  quantityUpdates: integer("quantity_updates").default(0),
  priceUpdates: integer("price_updates").default(0),
  remarksUpdates: integer("remarks_updates").default(0),
  descriptionUpdates: integer("description_updates").default(0),
  
  // Execution status
  status: text("status").notNull(), // pending, processing, completed, failed
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  errorMessage: text("error_message"),
  
  // Rate limiting
  rateLimitRemaining: integer("rate_limit_remaining"),
  rateLimitReset: timestamp("rate_limit_reset"),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  restoreJobIdx: index("diff_batches_job_idx").on(table.restoreJobId),
  statusIdx: index("diff_batches_status_idx").on(table.status),
}));

export const insertDifferentialBatchSchema = createInsertSchema(differentialBatches).omit({
  id: true,
  createdAt: true,
});

export type InsertDifferentialBatch = z.infer<typeof insertDifferentialBatchSchema>;
export type DifferentialBatch = typeof differentialBatches.$inferSelect;

// Anomaly Events - Track fraud detection and suspicious changes
export const anomalyEvents = pgTable("anomaly_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  restoreJobId: varchar("restore_job_id").references(() => restoreJobs.id, { onDelete: 'set null' }),
  
  // Anomaly details
  anomalyType: text("anomaly_type").notNull(), // massive_quantity_change, price_swing, remarks_wipe, suspicious_pattern
  severity: text("severity").notNull(), // low, medium, high, critical
  description: text("description").notNull(),
  
  // Metrics
  affectedItems: integer("affected_items"),
  metricValue: decimal("metric_value", { precision: 12, scale: 2 }), // Percentage or delta
  threshold: decimal("threshold", { precision: 12, scale: 2 }), // Threshold that triggered alert
  
  // Details payload
  details: text("details"), // JSON string with additional context
  
  // Resolution
  acknowledged: boolean("acknowledged").default(false),
  acknowledgedBy: text("acknowledged_by"),
  acknowledgedAt: timestamp("acknowledged_at"),
  resolution: text("resolution"), // proceeded, aborted, reviewed
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  restoreJobIdx: index("anomaly_restore_job_idx").on(table.restoreJobId),
  severityIdx: index("anomaly_severity_idx").on(table.severity),
  acknowledgedIdx: index("anomaly_acknowledged_idx").on(table.acknowledged),
  createdAtIdx: index("anomaly_created_idx").on(table.createdAt),
}));

export const insertAnomalyEventSchema = createInsertSchema(anomalyEvents).omit({
  id: true,
  createdAt: true,
});

export type InsertAnomalyEvent = z.infer<typeof insertAnomalyEventSchema>;
export type AnomalyEvent = typeof anomalyEvents.$inferSelect;

// Relations for backup/restore system
export const restoreJobsRelations = relations(restoreJobs, ({ many }) => ({
  differentialBatches: many(differentialBatches),
  anomalyEvents: many(anomalyEvents),
}));

export const differentialBatchesRelations = relations(differentialBatches, ({ one }) => ({
  restoreJob: one(restoreJobs, {
    fields: [differentialBatches.restoreJobId],
    references: [restoreJobs.id],
  }),
}));

export const anomalyEventsRelations = relations(anomalyEvents, ({ one }) => ({
  restoreJob: one(restoreJobs, {
    fields: [anomalyEvents.restoreJobId],
    references: [restoreJobs.id],
  }),
}));

// BrickLink Forum Posts - For community knowledge tracking
export const blForumPosts = pgTable("bl_forum_posts", {
  id: varchar("id").primaryKey(), // Forum message ID from BrickLink
  threadId: text("thread_id").notNull(), // Thread ID for grouping conversations
  
  // Post content
  title: text("title").notNull(),
  content: text("content"), // Full post content (if available)
  excerpt: text("excerpt"), // Preview/summary shown in list view
  
  // Author info
  username: text("username").notNull(),
  userFeedbackCount: integer("user_feedback_count"), // Feedback rating
  
  // Timestamps
  postedAt: timestamp("posted_at").notNull(),
  lastReplyAt: timestamp("last_reply_at"), // When the last reply was made (null if no replies)
  
  // URLs
  postUrl: text("post_url").notNull(),
  threadUrl: text("thread_url").notNull(),
  
  // Metadata
  hasReplies: boolean("has_replies").default(false),
  replyCount: integer("reply_count").default(0),
  
  // Scraping metadata
  lastScrapedAt: timestamp("last_scraped_at").defaultNow().notNull(),
  scrapedContent: boolean("scraped_content").default(false), // Whether full content was scraped
  orgId: varchar("org_id"),                            // FK → organizations.id
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  threadIdx: index("bl_forum_thread_idx").on(table.threadId),
  postedAtIdx: index("bl_forum_posted_idx").on(table.postedAt),
  usernameIdx: index("bl_forum_username_idx").on(table.username),
  orgIdIdx: index("bl_forum_posts_org_id_idx").on(table.orgId),
}));

export const insertBlForumPostSchema = createInsertSchema(blForumPosts).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertBlForumPost = z.infer<typeof insertBlForumPostSchema>;
export type BlForumPost = typeof blForumPosts.$inferSelect;

// Order Adjustments - Manual financial adjustments (refunds, credits, discounts)
export const orderAdjustments = pgTable("order_adjustments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: varchar("order_id").notNull().references(() => orders.id, { onDelete: 'cascade' }),
  type: text("type").notNull().default('refund'), // 'refund' | 'credit' | 'discount'
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(), // Negative = refund/deduction
  paymentMethod: text("payment_method"), // 'paypal' | 'stripe' | 'cash' | 'other'
  externalTransactionId: text("external_transaction_id"), // PayPal/Stripe transaction ID
  reason: text("reason"), // e.g., "Customer return - item damaged"
  notes: text("notes"),
  orgId: varchar("org_id"),                            // FK → organizations.id
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgIdIdx: index("order_adjustments_org_id_idx").on(table.orgId),
  orderIdIdx: index("order_adjustments_order_id_idx").on(table.orderId),
}));

export const insertOrderAdjustmentSchema = createInsertSchema(orderAdjustments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertOrderAdjustment = z.infer<typeof insertOrderAdjustmentSchema>;
export type OrderAdjustment = typeof orderAdjustments.$inferSelect;

export const brickanalyzerScans = pgTable("brickanalyzer_scans", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("processing"), // processing | complete | failed
  totalPieces: integer("total_pieces"),
  identifiedPieces: integer("identified_pieces"),
  estimatedValue: decimal("estimated_value", { precision: 10, scale: 2 }),
  results: jsonb("results"), // Array of { partNo, partName, colorName, colorId, ourPrice, qty, confidence, note }
  errorMessage: text("error_message"),
  orgId: varchar("org_id"),                            // FK → organizations.id
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  imgWidth: integer("img_width"),
  imgHeight: integer("img_height"),
  blApiCalls: integer("bl_api_calls"),
  imageData: bytea("image_data"),
}, (table) => ({
  orgIdIdx: index("brickanalyzer_scans_org_id_idx").on(table.orgId),
}));

export type BrickanalyzerScan = typeof brickanalyzerScans.$inferSelect;

export const blForumEmbeddings = pgTable("bl_forum_embeddings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  postId: varchar("post_id").notNull(), // Reference to bl_forum_posts.id
  embedding: vector("embedding", { dimensions: 1536 }),
  content: text("content").notNull(), // Searchable content: title + excerpt/content + username
  embeddingModel: text("embedding_model").default('text-embedding-3-small').notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  postIdIdx: index("bl_forum_embeddings_post_idx").on(table.postId),
}));

export const insertBlForumEmbeddingSchema = createInsertSchema(blForumEmbeddings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertBlForumEmbedding = z.infer<typeof insertBlForumEmbeddingSchema>;
export type BlForumEmbedding = typeof blForumEmbeddings.$inferSelect;

export const marketNews = pgTable("market_news", {
  id: serial("id").primaryKey(),
  query: text("query").notNull(),
  title: text("title").notNull(),
  snippet: text("snippet"),
  url: text("url").notNull(),
  source: text("source"),
  publishedAt: timestamp("published_at"),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  urlIdx: index("market_news_url_idx").on(table.url),
  fetchedAtIdx: index("market_news_fetched_idx").on(table.fetchedAt),
  queryIdx: index("market_news_query_idx").on(table.query),
}));

export const insertMarketNewsSchema = createInsertSchema(marketNews).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertMarketNews = z.infer<typeof insertMarketNewsSchema>;
export type MarketNews = typeof marketNews.$inferSelect;

export const marketNewsEmbeddings = pgTable("market_news_embeddings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  articleId: integer("article_id").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
  content: text("content").notNull(),
  embeddingModel: text("embedding_model").default('text-embedding-3-small').notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  articleIdIdx: index("market_news_embeddings_article_idx").on(table.articleId),
}));

export const insertMarketNewsEmbeddingSchema = createInsertSchema(marketNewsEmbeddings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertMarketNewsEmbedding = z.infer<typeof insertMarketNewsEmbeddingSchema>;
export type MarketNewsEmbedding = typeof marketNewsEmbeddings.$inferSelect;

// Business Insights — org-specific actionable intelligence from market data cross-referenced with inventory/sales
export const businessInsights = pgTable("business_insights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  category: text("category").notNull(), // 'pricing' | 'acquisition' | 'risk' | 'opportunity' | 'trend'
  urgency: text("urgency").notNull().default('medium'), // 'high' | 'medium' | 'low'
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  details: jsonb("details"), // structured data: affected items, numbers, sources
  sourceType: text("source_type"), // 'market_news' | 'forum' | 'sales' | 'inventory' | 'pricing'
  sourceRef: text("source_ref"), // reference ID or URL
  agentId: text("agent_id"), // 'inventory' | 'pricing' | 'market' | 'orders' | 'customer' | null = legacy general
  dismissed: boolean("dismissed").default(false).notNull(),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgIdIdx: index("business_insights_org_id_idx").on(table.orgId),
  categoryIdx: index("business_insights_category_idx").on(table.category),
  createdAtIdx: index("business_insights_created_at_idx").on(table.createdAt),
}));

export const insertBusinessInsightSchema = createInsertSchema(businessInsights).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertBusinessInsight = z.infer<typeof insertBusinessInsightSchema>;
export type BusinessInsight = typeof businessInsights.$inferSelect;

// App Feedback — user-submitted requests tracked for Replit backlog
export const appFeedback = pgTable("app_feedback", {
  id: serial("id").primaryKey(),
  type: text("type").notNull().default('enhancement'), // 'defect' | 'enhancement' | 'feature'
  title: text("title").notNull(),
  rawDescription: text("raw_description").notNull(),
  refinedDescription: text("refined_description"),
  acceptanceCriteria: text("acceptance_criteria"),
  status: text("status").notNull().default('new'), // 'new' | 'in_progress' | 'on_hold' | 'done'
  sourcePage: text("source_page"), // URL path where feedback was submitted
  orgId: varchar("org_id"),                            // FK → organizations.id
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgIdIdx: index("app_feedback_org_id_idx").on(table.orgId),
}));

export const insertAppFeedbackSchema = createInsertSchema(appFeedback).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAppFeedback = z.infer<typeof insertAppFeedbackSchema>;
export type AppFeedback = typeof appFeedback.$inferSelect;

// ── Universal CLIP Catalog Queue ──────────────────────────────────────────────
// Tracks every BrickLink part number for the universal visual training catalog.
// Worker processes 'pending' rows, embeds via CLIP, stores in bl_catalog_clip_embeddings
// with source='universal'. Survives restarts — picks up from 'pending' rows.
export const universalCatalogQueue = pgTable("universal_catalog_queue", {
  partNo: text("part_no").primaryKey(),
  partName: text("part_name"),
  status: text("status").notNull().default('pending'), // pending | embedded | no_image | failed
  attemptedAt: timestamp("attempted_at"),
  errorMsg: text("error_msg"),
}, (table) => [
  index("ucq_status_idx").on(table.status),
]);

export type UniversalCatalogItem = typeof universalCatalogQueue.$inferSelect;

// ── Per-Org Selling Channel Integrations ──────────────────────────────────────
// Stores credentials for BrickOwl, eBay, Amazon, Stripe, and any future channel.
// Each (orgId, channel) pair is unique. Credentials are stored as JSONB.
export const orgIntegrations = pgTable("org_integrations", {
  id: serial("id").primaryKey(),
  orgId: varchar("org_id").notNull(),
  channel: varchar("channel").notNull(), // 'brickowl' | 'ebay' | 'amazon' | 'easypost' | 'shipstation' etc.
  type: varchar("type").notNull().default('sales_channel'), // 'sales_channel' | 'shipping'
  displayName: text("display_name"),     // Human-readable label, e.g. "My eBay Store"
  credentials: jsonb("credentials").notNull().default({}),
  isConnected: boolean("is_connected").default(false).notNull(),
  lastTestedAt: timestamp("last_tested_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  orgIdIdx: index("org_integrations_org_id_idx").on(table.orgId),
  orgChannelIdx: index("org_integrations_org_channel_idx").on(table.orgId, table.channel),
}));

export const insertOrgIntegrationSchema = createInsertSchema(orgIntegrations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertOrgIntegration = z.infer<typeof insertOrgIntegrationSchema>;
export type OrgIntegration = typeof orgIntegrations.$inferSelect;

// ── Platform Plan Configurations ──────────────────────────────────────────────
// DB-backed plan definitions. Seeded from tierConfig.ts values on first run.
// Super admins can edit unlocked plans, sunset any plan, and see org counts.
export const planConfigs = pgTable("plan_configs", {
  id: serial("id").primaryKey(),
  planKey: varchar("plan_key", { length: 50 }).notNull().unique(), // 'trial' | 'foundation' | 'core' | 'flagship'
  name: varchar("name", { length: 100 }).notNull(),
  tagline: text("tagline"),
  trialDurationDays: integer("trial_duration_days").notNull().default(0),
  // Pricing (in cents; 0 = free)
  priceMonthly: integer("price_monthly").notNull().default(0),
  priceAnnual: integer("price_annual").notNull().default(0),
  priceAnnualMonthly: integer("price_annual_monthly").notNull().default(0),
  // Limits (-1 = unlimited)
  limitSeats: integer("limit_seats").notNull().default(1),
  limitScans: integer("limit_scans").notNull().default(0),
  limitAutomationRules: integer("limit_automation_rules").notNull().default(0),
  limitOrderHistoryDays: integer("limit_order_history_days").notNull().default(30),
  limitInventoryItems: integer("limit_inventory_items").notNull().default(100),
  limitOrders: integer("limit_orders").notNull().default(-1),
  limitElfieQueries: integer("limit_elfie_queries").notNull().default(0),
  limitBusinessIntel: integer("limit_business_intel").notNull().default(0),
  limitBrickspotterApiCalls: integer("limit_brickspotter_api_calls").notNull().default(0), // daily BL API calls via platform account (-1 = unlimited, 0 = no BrickSpotter)
  // Features
  isBrickspotterOnly: boolean("is_brickspotter_only").notNull().default(false), // when true, org sees BrickSpotter UI only — no store management
  featureBrickOwl: boolean("feature_brick_owl").notNull().default(false),
  featureElfieAi: boolean("feature_elfie_ai").notNull().default(false),
  featureElfieCustom: boolean("feature_elfie_custom").notNull().default(false),
  featureElfieLiveSupport: boolean("feature_elfie_live_support").notNull().default(false),
  featurePriceOMatic: boolean("feature_price_o_matic").notNull().default(false),
  featureEasypost: boolean("feature_easypost").notNull().default(false),
  featureDataImages: boolean("feature_data_images").notNull().default(false),
  featureDataSemantic: boolean("feature_data_semantic").notNull().default(false),
  featureFullEnrichment: boolean("feature_full_enrichment").notNull().default(false),
  featurePaymentSync: boolean("feature_payment_sync").notNull().default(false),
  // Status
  isSunset: boolean("is_sunset").notNull().default(false),
  isPublic: boolean("is_public").notNull().default(true), // false = private/invite-only (not shown on public pricing page)
  sortOrder: integer("sort_order").notNull().default(0), // 0=trial, 1=foundation, 2=core, 3=flagship
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPlanConfigSchema = createInsertSchema(planConfigs).omit({ id: true, updatedAt: true });
export type InsertPlanConfig = z.infer<typeof insertPlanConfigSchema>;
export type PlanConfig = typeof planConfigs.$inferSelect;

// ── Sales-Percentage Billing Plans ────────────────────────────────────────────
// Each plan defines a base monthly fee + a % of GMV over a free-sales threshold.
// Formula: totalDue = basePrice + salesPercentage% × max(0, monthlySales − freeSalesThreshold)
export const plans = pgTable("plans", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  basePrice: integer("base_price").notNull().default(3900),          // cents, e.g. 3900 = $39
  salesPercentage: real("sales_percentage").notNull().default(1.9),  // e.g. 1.9 = 1.9%
  freeSalesThreshold: integer("free_sales_threshold").notNull().default(100000), // cents, e.g. 100000 = $1000
  // 'live' → visible to new subscribers; 'in_progress' → draft (not yet launched); 'sunset' → legacy, no new sign-ups
  status: varchar("status", { length: 20 }).notNull().default('live'),
  // Date when a sunset plan officially ends — users on this plan must switch by this date
  sunsetAt: timestamp("sunset_at"),
  // Exactly one live plan should be marked as default — assigned to orgs that don't pick a plan during onboarding
  isDefault: boolean("is_default").notNull().default(false),
  // false = private/invite-only — admin can assign to an org but it is never shown on the public pricing page or self-serve flow
  isPublic: boolean("is_public").notNull().default(true),
  // Free trial before first charge — 0 means no trial; ignored for default/free plans
  trialDurationDays: integer("trial_duration_days").notNull().default(0),
  // BrickSpotter settings — -1 = unlimited, 0 = not included, >0 = specific limit
  isBrickspotterOnly: boolean("is_brickspotter_only").notNull().default(false),
  limitBrickspotterScans: integer("limit_brickspotter_scans").notNull().default(0),
  limitBrickspotterApiCalls: integer("limit_brickspotter_api_calls").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPlanSchema = createInsertSchema(plans).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPlan = z.infer<typeof insertPlanSchema>;
export type Plan = typeof plans.$inferSelect;

export const pricingModel = pgTable("pricing_model", {
  id: serial("id").primaryKey(),
  basePrice: integer("base_price").notNull().default(3900),
  overageBump: integer("overage_bump").notNull().default(500),
  monthlyCap: integer("monthly_cap").notNull().default(9900),
  trialDays: integer("trial_days").notNull().default(14),
  baseInventoryLots: integer("base_inventory_lots").notNull().default(5000),
  bumpInventoryLots: integer("bump_inventory_lots").notNull().default(2500),
  baseOrdersPerMonth: integer("base_orders_per_month").notNull().default(100),
  bumpOrdersPerMonth: integer("bump_orders_per_month").notNull().default(50),
  baseConnectedStores: integer("base_connected_stores").notNull().default(2),
  bumpConnectedStores: integer("bump_connected_stores").notNull().default(1),
  baseAiCalls: integer("base_ai_calls").notNull().default(200),
  bumpAiCalls: integer("bump_ai_calls").notNull().default(100),
  baseScans: integer("base_scans").notNull().default(50),
  bumpScans: integer("bump_scans").notNull().default(25),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type PricingModel = typeof pricingModel.$inferSelect;

export const aiUsageLog = pgTable("ai_usage_log", {
  id: serial("id").primaryKey(),
  service: varchar("service", { length: 30 }).notNull(),
  model: varchar("model", { length: 80 }).notNull(),
  operation: varchar("operation", { length: 50 }).notNull(),
  orgId: varchar("org_id", { length: 100 }),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  estimatedCost: real("estimated_cost").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AiUsageLog = typeof aiUsageLog.$inferSelect;

export const productVision = pgTable("product_vision", {
  id: serial("id").primaryKey(),
  whatChanges: text("what_changes").notNull().default(''),
  howIFeel: text("how_i_feel").notNull().default(''),
  whatPeopleSay: text("what_people_say").notNull().default(''),
  visionStatement: text("vision_statement").notNull().default(''),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type ProductVision = typeof productVision.$inferSelect;

export const productOkrs = pgTable("product_okrs", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 500 }).notNull(),
  timeframe: varchar("timeframe", { length: 50 }).notNull(),
  status: varchar("status", { length: 30 }).notNull().default('active'),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const insertProductOkrSchema = createInsertSchema(productOkrs).omit({ id: true, createdAt: true });
export type InsertProductOkr = z.infer<typeof insertProductOkrSchema>;
export type ProductOkr = typeof productOkrs.$inferSelect;

export const productKeyResults = pgTable("product_key_results", {
  id: serial("id").primaryKey(),
  okrId: integer("okr_id").notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  progress: integer("progress").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const insertProductKeyResultSchema = createInsertSchema(productKeyResults).omit({ id: true, createdAt: true });
export type InsertProductKeyResult = z.infer<typeof insertProductKeyResultSchema>;
export type ProductKeyResult = typeof productKeyResults.$inferSelect;

export const productRoadmapItems = pgTable("product_roadmap_items", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description").default(''),
  lane: varchar("lane", { length: 20 }).notNull().default('later'),
  okrId: integer("okr_id"),
  targetDate: timestamp("target_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const insertProductRoadmapItemSchema = createInsertSchema(productRoadmapItems).omit({ id: true, createdAt: true });
export type InsertProductRoadmapItem = z.infer<typeof insertProductRoadmapItemSchema>;
export type ProductRoadmapItem = typeof productRoadmapItems.$inferSelect;

export const productBacklogItems = pgTable("product_backlog_items", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description").default(''),
  priority: varchar("priority", { length: 20 }).notNull().default('medium'),
  effort: varchar("effort", { length: 10 }).notNull().default('M'),
  status: varchar("status", { length: 20 }).notNull().default('new'),
  roadmapItemId: integer("roadmap_item_id"),
  capabilityId: integer("capability_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const insertProductBacklogItemSchema = createInsertSchema(productBacklogItems).omit({ id: true, createdAt: true });
export type InsertProductBacklogItem = z.infer<typeof insertProductBacklogItemSchema>;
export type ProductBacklogItem = typeof productBacklogItems.$inferSelect;

export const productCapabilities = pgTable("product_capabilities", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 500 }).notNull(),
  description: text("description").default(''),
  level: integer("level").notNull().default(1),
  parentId: integer("parent_id"),
  sortOrder: integer("sort_order").notNull().default(0),
  status: varchar("cap_status", { length: 20 }).notNull().default('built'),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const insertProductCapabilitySchema = createInsertSchema(productCapabilities).omit({ id: true, createdAt: true });
export type InsertProductCapability = z.infer<typeof insertProductCapabilitySchema>;
export type ProductCapability = typeof productCapabilities.$inferSelect;

export const featureVotes = pgTable("feature_votes", {
  id: serial("id").primaryKey(),
  capabilityId: integer("capability_id").notNull(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  orgId: varchar("org_id", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  uniqueVote: uniqueIndex("feature_votes_unique_idx").on(table.capabilityId, table.userId),
  capabilityIdx: index("feature_votes_capability_idx").on(table.capabilityId),
}));

export type FeatureVote = typeof featureVotes.$inferSelect;

// ── AI Pricing (Price-o-Matic AI opt-in) ─────────────────────────────────────
// IE Strategies — per-org, per-agent business strategy statements.
// Each agent reads its relevant strategy and uses it as a baseline for AI suggestions.
export const ieStrategies = pgTable("ie_strategies", {
  orgId: varchar("org_id", { length: 255 }).primaryKey(),
  // Foundational context — injected into every agent
  visionMission: text("vision_mission"),       // Where we're going and why we exist
  successFactors: text("success_factors"),      // Vivid Vision: what changed, how it feels, what people say
  // Per-agent strategy directives
  pricingStrategy: text("pricing_strategy"),
  pricingStrategyPreset: varchar("pricing_strategy_preset", { length: 50 }), // premium | market_rate | balanced | clear_inventory
  inventoryStrategy: text("inventory_strategy"),
  ordersStrategy: text("orders_strategy"),
  customerStrategy: text("customer_strategy"),
  marketStrategy: text("market_strategy"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type IeStrategies = typeof ieStrategies.$inferSelect;

export const pomAiSettings = pgTable("pom_ai_settings", {
  orgId: varchar("org_id", { length: 255 }).primaryKey(),
  aiEnabled: boolean("ai_enabled").default(false).notNull(),
  aiStrategy: text("ai_strategy"), // Natural language pricing strategy statement
  decisionCount: integer("decision_count").default(0).notNull(), // Logged pricing decisions
  sortMode: text("sort_mode").default('scoring').notNull(), // 'scoring' | 'suggested' — primary sort mode for POM inventory screen
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type PomAiSettings = typeof pomAiSettings.$inferSelect;

// ─── Inventory Change History ─────────────────────────────────────────────────
// One row per changed field per event. Sources: 'bricklink_sync', 'order', 'order_restore'.
export const inventoryHistory = pgTable("inventory_history", {
  id: serial("id").primaryKey(),
  orgId: varchar("org_id", { length: 256 }).notNull(),
  inventoryId: integer("inventory_id").notNull(),
  itemNo: text("item_no").notNull(),
  colorId: integer("color_id"),
  changedAt: timestamp("changed_at").defaultNow().notNull(),
  source: text("source").notNull(),      // 'bricklink_sync' | 'order' | 'order_restore'
  sourceRef: text("source_ref"),         // order id / order number
  field: text("field").notNull(),        // 'quantity' | 'unitPrice' | 'remarks' | ...
  oldValue: text("old_value"),
  newValue: text("new_value"),
}, (table) => ({
  orgIdIdx:         index("inv_history_org_idx").on(table.orgId),
  inventoryIdIdx:   index("inv_history_inv_idx").on(table.inventoryId),
  changedAtIdx:     index("inv_history_at_idx").on(table.changedAt),
  orgInventoryIdx:  index("inv_history_org_inv_idx").on(table.orgId, table.inventoryId),   // "show item history for org"
  orgChangedAtIdx:  index("inv_history_org_at_idx").on(table.orgId, table.changedAt),      // "date-range history for org"
}));

export type InventoryHistoryRow = typeof inventoryHistory.$inferSelect;
export type InsertInventoryHistory = typeof inventoryHistory.$inferInsert;

// Logs each time a seller applies a price (accepted, overridden, or custom)
export const pomPriceDecisions = pgTable("pom_price_decisions", {
  id: serial("id").primaryKey(),
  orgId: varchar("org_id", { length: 255 }).notNull(),
  itemNo: text("item_no").notNull(),
  colorId: integer("color_id"),
  newOrUsed: text("new_or_used").notNull().default('N'),
  suggestedPrice: decimal("suggested_price", { precision: 10, scale: 4 }),
  actualPrice: decimal("actual_price", { precision: 10, scale: 4 }).notNull(),
  priceDelta: decimal("price_delta", { precision: 10, scale: 4 }), // actual - suggested
  marketSnapshot: jsonb("market_snapshot"), // soldAvg, soldMax, stockMin snapshot at decision time
  decisionAt: timestamp("decision_at").defaultNow().notNull(),
}, (table) => ({
  orgIdx: index("pom_price_decisions_org_idx").on(table.orgId),
  orgItemIdx: index("pom_price_decisions_org_item_idx").on(table.orgId, table.itemNo, table.colorId),
}));

// ── Cross-Platform Qty Sync Retry Queue ────────────────────────────────────────
// When a cross-platform inventory update fails (BL or BO is down/unreachable),
// the failure is enqueued here. The scheduler retries these on each cycle.
// - BL retries: use original quantityDelta (BL never received it, so delta is still valid)
// - BO retries: re-read current local quantity at retry time (absolute set = always correct)
export const crossPlatformSyncQueue = pgTable("cross_platform_sync_queue", {
  id: serial("id").primaryKey(),
  orgId: varchar("org_id").notNull(),
  blInventoryId: integer("bl_inventory_id").notNull(), // BL inventory lot ID
  targetPlatform: text("target_platform").notNull(),   // 'BrickLink' | 'BrickOwl'
  sourcePlatform: text("source_platform").notNull(),   // platform that originated the sale
  sourceOrderId: text("source_order_id"),              // for tracing
  quantityDelta: integer("quantity_delta").notNull(),  // original delta (negative = reduce)
  status: text("status").notNull().default("pending"), // 'pending' | 'done' | 'abandoned'
  retryCount: integer("retry_count").notNull().default(0),
  lastAttemptAt: timestamp("last_attempt_at"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  orgStatusIdx: index("cpsq_org_status_idx").on(table.orgId, table.status),
  orgInvIdx: index("cpsq_org_inv_idx").on(table.orgId, table.blInventoryId, table.targetPlatform),
}));

export type CrossPlatformSyncQueueRow = typeof crossPlatformSyncQueue.$inferSelect;
export type InsertCrossPlatformSyncQueue = typeof crossPlatformSyncQueue.$inferInsert;

// ── User Images ────────────────────────────────────────────────────────────────
// Central image library per org. All user-owned images live here.
// scope='user'    → user took/owns these; may be pushed to any channel.
// scope='catalog' → sourced from a catalog (BL/BO); must NOT be used on other channels.
export const userImages = pgTable("user_images", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull(),
  storageKey: text("storage_key").notNull(),              // object-storage object name
  scope: varchar("scope").notNull().default("user"),      // 'user' | 'catalog'
  sourceChannel: varchar("source_channel").notNull().default("local"), // 'local' | 'ebay' | ...
  sourceUrl: text("source_url"),                          // original URL when imported
  altText: text("alt_text"),
  widthPx: integer("width_px"),
  heightPx: integer("height_px"),
  fileSizeKb: integer("file_size_kb"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("user_images_org_idx").on(t.orgId)]);

export type UserImage = typeof userImages.$inferSelect;
export type InsertUserImage = typeof userImages.$inferInsert;

// Per-lot image assignments (lot-level override — highest priority).
export const lotImages = pgTable("lot_images", {
  id: serial("id").primaryKey(),
  orgId: varchar("org_id").notNull(),
  blInventoryId: integer("bl_inventory_id").notNull(),
  imageId: varchar("image_id").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("lot_images_lot_idx").on(t.orgId, t.blInventoryId),
  index("lot_images_img_idx").on(t.imageId),
]);

export type LotImage = typeof lotImages.$inferSelect;

// Per item-type image defaults (fallback when no lot-level images).
export const itemTypeImages = pgTable("item_type_images", {
  id: serial("id").primaryKey(),
  orgId: varchar("org_id").notNull(),
  itemNo: varchar("item_no").notNull(),
  itemType: varchar("item_type").notNull(),
  imageId: varchar("image_id").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("item_type_images_item_idx").on(t.orgId, t.itemNo, t.itemType)]);

export type ItemTypeImage = typeof itemTypeImages.$inferSelect;

// XML backup storage — persisted in DB so production deploys don't lose files.
export const xmlBackups = pgTable("xml_backups", {
  id: serial("id").primaryKey(),
  orgId: varchar("org_id").notNull(),
  filename: varchar("filename").notNull(),
  content: text("content").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("xml_backups_org_idx").on(t.orgId),
]);

export type XmlBackup = typeof xmlBackups.$inferSelect;

// ─── Marketing Outreach Log ───────────────────────────────────────────────────
export const marketingOutreach = pgTable("marketing_outreach", {
  id: serial("id").primaryKey(),
  orgId: varchar("org_id").notNull(),
  customerUsername: varchar("customer_username").notNull(),
  customerEmail: varchar("customer_email"),
  signal: varchar("signal").notNull(),   // 'win-back' | 'lapsing' | 'new-follow-up' | 'vip' | 'manual'
  channel: varchar("channel").notNull(), // 'email' | 'bl-message' | 'phone' | 'in-person' | 'other'
  notes: text("notes"),
  loggedAt: timestamp("logged_at").defaultNow().notNull(),
  attributedOrderId: varchar("attributed_order_id"),
  attributedRevenue: decimal("attributed_revenue", { precision: 10, scale: 2 }),
}, (t) => [
  index("marketing_outreach_org_idx").on(t.orgId),
  index("marketing_outreach_customer_idx").on(t.orgId, t.customerUsername),
]);

export const insertMarketingOutreachSchema = createInsertSchema(marketingOutreach).omit({
  id: true,
  loggedAt: true,
  attributedOrderId: true,
  attributedRevenue: true,
});
export type InsertMarketingOutreach = z.infer<typeof insertMarketingOutreachSchema>;
export type MarketingOutreach = typeof marketingOutreach.$inferSelect;
