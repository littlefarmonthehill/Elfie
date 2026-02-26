import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, timestamp, boolean, index, jsonb } from "drizzle-orm/pg-core";
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
});

export const insertUserSchema = createInsertSchema(users).omit({
  createdAt: true,
  updatedAt: true,
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// BrickLink Categories
export const blCategories = pgTable("bl_categories", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  priorityTier: text("priority_tier").default('standard').notNull(), // 'top' | 'standard' | 'commodity'
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
  itemName: text("item_name"),
  itemType: text("item_type").notNull(),
  colorId: integer("color_id"),
  colorName: text("color_name"),
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
  categoryId: integer("category_id"),
  dateCreated: timestamp("date_created"),
  saleRate: integer("sale_rate"),
  tierPrice1: decimal("tier_price_1", { precision: 10, scale: 2 }),
  tierPrice2: decimal("tier_price_2", { precision: 10, scale: 2 }),
  tierPrice3: decimal("tier_price_3", { precision: 10, scale: 2 }),
  tierQuantity1: integer("tier_quantity_1"),
  tierQuantity2: integer("tier_quantity_2"),
  tierQuantity3: integer("tier_quantity_3"),
  myWeight: decimal("my_weight", { precision: 10, scale: 4 }),
  // Rebrickable image URLs (LDraw renders)
  imageUrl: text("image_url"),
  thumbnailUrl: text("thumbnail_url"),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Composite index for shop queries with itemType filter
  itemTypeCategoryQtyIdx: index("bl_inv_item_type_cat_qty_idx").on(table.itemType, table.categoryId, table.quantity),
  // Index for shop queries without itemType filter
  categoryQtyIdx: index("bl_inv_cat_qty_idx").on(table.categoryId, table.quantity),
  // Index for quantity-based filtering (general queries)
  quantityIdx: index("bl_inv_qty_idx").on(table.quantity),
  // Index for item lookup
  itemNoIdx: index("bl_inv_item_no_idx").on(table.itemNo),
}));

export const insertBlInventorySchema = createInsertSchema(blInventory).omit({
  syncedAt: true,
  updatedAt: true,
});

export type InsertBlInventory = z.infer<typeof insertBlInventorySchema>;
export type BlInventory = typeof blInventory.$inferSelect;

// Set-Part Relationships (from Rebrickable)
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
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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
  colorId: integer("color_id"), // BrickLink color ID (from options/description)
  condition: text("condition"), // New/Used (from options/description)
  fulfilled: boolean("fulfilled").default(false).notNull(), // Track fulfillment status
  fulfilledAt: timestamp("fulfilled_at"),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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
});

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
});

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
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertShipmentSchema = createInsertSchema(shipments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertShipment = z.infer<typeof insertShipmentSchema>;
export type Shipment = typeof shipments.$inferSelect;

// Relations
export const blInventoryRelations = relations(blInventory, ({ one }) => ({
  category: one(blCategories, {
    fields: [blInventory.categoryId],
    references: [blCategories.id],
  }),
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
  aiEnabled: boolean("ai_enabled").default(true).notNull(),
  // OpenAI Configuration (used for both chat and embeddings)
  openaiApiKey: text("openai_api_key"),
  selectedModel: text("selected_model").default('gpt-4o-mini'),
  systemPrompt: text("system_prompt"),
  bricklinkConsumerKey: text("bricklink_consumer_key"),
  bricklinkConsumerSecret: text("bricklink_consumer_secret"),
  bricklinkTokenValue: text("bricklink_token_value"),
  bricklinkTokenSecret: text("bricklink_token_secret"),
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
  // Automation & Scheduling
  inventorySyncEnabled: boolean("inventory_sync_enabled").default(false).notNull(),
  inventorySyncTime: text("inventory_sync_time").default('02:00'), // Time of day (HH:MM format)
  priceOMaticEnabled: boolean("price_o_matic_enabled").default(false).notNull(),
  ordersSyncEnabled: boolean("orders_sync_enabled").default(false).notNull(),
  ordersSyncFrequency: integer("orders_sync_frequency").default(15).notNull(), // minutes
  forumSyncEnabled: boolean("forum_sync_enabled").default(true).notNull(),
  forumSyncFrequency: integer("forum_sync_frequency").default(60).notNull(), // minutes
  // Rebrickable Configuration
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
  pomBatchSize: integer("pom_batch_size").default(1500).notNull(),               // Items per sync run
  pomApiCallLimit: integer("pom_api_call_limit").default(4500).notNull(),        // Daily API call ceiling
  pomCostFloorPct: integer("pom_cost_floor_pct").default(0).notNull(),           // Min % margin above my_cost (0 = off)
  pomMinPrice: decimal("pom_min_price", { precision: 10, scale: 4 }).default('0.02').notNull(), // Absolute min price per item
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertAppSettingsSchema = createInsertSchema(appSettings).omit({
  id: true,
  updatedAt: true,
});

export type InsertAppSettings = z.infer<typeof insertAppSettingsSchema>;
export type AppSettings = typeof appSettings.$inferSelect;

// Conversation History for E.L.F.I.E. learning
export const conversations = pgTable("conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: text("session_id").notNull(),
  role: text("role").notNull(), // 'user' or 'assistant'
  content: text("content").notNull(),
  context: text("context"), // dashboard context
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
});

export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Conversation = typeof conversations.$inferSelect;

// BrickLink API Call Tracking
export const blApiCalls = pgTable("bl_api_calls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  endpoint: text("endpoint").notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  success: boolean("success").default(true).notNull(),
});

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
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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
});

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
  stockQuantity: integer("stock_quantity"),
  stockTotalLots: integer("stock_total_lots"),
  
  // Price Guide - Sold (historical)
  soldAvgPrice: decimal("sold_avg_price", { precision: 10, scale: 2 }),
  soldMinPrice: decimal("sold_min_price", { precision: 10, scale: 2 }),
  soldMaxPrice: decimal("sold_max_price", { precision: 10, scale: 2 }),
  soldQuantity: integer("sold_quantity"),
  soldTotalLots: integer("sold_total_lots"),
  
  // Price-O-Matic Suggested Price (with premium)
  suggestedPrice: decimal("suggested_price", { precision: 10, scale: 2 }),
  premiumPercentage: integer("premium_percentage").default(15), // Default 15% premium
  
  // Cache management
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
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
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  statusIdx: index("embedding_jobs_status_idx").on(table.status),
  createdAtIdx: index("embedding_jobs_created_idx").on(table.createdAt),
}));

export const insertEmbeddingJobSchema = createInsertSchema(embeddingJobs).omit({
  id: true,
  createdAt: true,
});

export type InsertEmbeddingJob = z.infer<typeof insertEmbeddingJobSchema>;
export type EmbeddingJob = typeof embeddingJobs.$inferSelect;

// Warehouse Management - Aisles
export const whAisles = pgTable("wh_aisles", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull().unique(), // e.g., "Aisle 1", "A", etc.
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertInventoryLocationSchema = createInsertSchema(inventoryLocations).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertInventoryLocation = z.infer<typeof insertInventoryLocationSchema>;
export type InventoryLocation = typeof inventoryLocations.$inferSelect;

// Relations for warehouse management
export const whAislesRelations = relations(whAisles, ({ many }) => ({
  shelves: many(whShelves),
}));

export const whShelvesRelations = relations(whShelves, ({ one, many }) => ({
  aisle: one(whAisles, {
    fields: [whShelves.aisleId],
    references: [whAisles.id],
  }),
  bins: many(whBins),
}));

export const whBinsRelations = relations(whBins, ({ one, many }) => ({
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
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  threadIdx: index("bl_forum_thread_idx").on(table.threadId),
  postedAtIdx: index("bl_forum_posted_idx").on(table.postedAt),
  usernameIdx: index("bl_forum_username_idx").on(table.username),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertOrderAdjustmentSchema = createInsertSchema(orderAdjustments).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertOrderAdjustment = z.infer<typeof insertOrderAdjustmentSchema>;
export type OrderAdjustment = typeof orderAdjustments.$inferSelect;

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
