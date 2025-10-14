import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { vector } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// BrickLink Categories
export const blCategories = pgTable("bl_categories", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
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
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertBlInventorySchema = createInsertSchema(blInventory).omit({
  syncedAt: true,
  updatedAt: true,
});

export type InsertBlInventory = z.infer<typeof insertBlInventorySchema>;
export type BlInventory = typeof blInventory.$inferSelect;

// ShipStation Orders
export const orders = pgTable("orders", {
  id: varchar("id").primaryKey(),
  orderNumber: text("order_number").notNull(),
  orderKey: text("order_key"),
  marketplace: text("marketplace"), // Selling platform (BrickLink, eBay, Amazon, etc.)
  orderDate: timestamp("order_date").notNull(),
  orderStatus: text("order_status").notNull(),
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

// Relations
export const ordersRelations = relations(orders, ({ many }) => ({
  items: many(orderDetails),
}));

export const orderDetailsRelations = relations(orderDetails, ({ one }) => ({
  order: one(orders, {
    fields: [orderDetails.orderId],
    references: [orders.id],
  }),
}));

// App Settings
export const appSettings = pgTable("app_settings", {
  id: varchar("id").primaryKey().default('default'),
  aiEnabled: boolean("ai_enabled").default(true).notNull(),
  openrouterApiKey: text("openrouter_api_key"),
  openaiApiKey: text("openai_api_key"),
  selectedModel: text("selected_model").default('openai/gpt-4o-mini'),
  systemPrompt: text("system_prompt"),
  bricklinkConsumerKey: text("bricklink_consumer_key"),
  bricklinkConsumerSecret: text("bricklink_consumer_secret"),
  bricklinkTokenValue: text("bricklink_token_value"),
  bricklinkTokenSecret: text("bricklink_token_secret"),
  // Automation & Scheduling
  inventorySyncEnabled: boolean("inventory_sync_enabled").default(false).notNull(),
  inventorySyncTime: text("inventory_sync_time").default('02:00'), // Time of day (HH:MM format)
  priceOMaticEnabled: boolean("price_o_matic_enabled").default(false).notNull(),
  ordersSyncEnabled: boolean("orders_sync_enabled").default(false).notNull(),
  ordersSyncFrequency: integer("orders_sync_frequency").default(15).notNull(), // minutes
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

// Price-o-Matic Cache - Stores merged BrickLink item details and price guide data
export const priceGuideCache = pgTable("price_guide_cache", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  itemNo: text("item_no").notNull(),
  itemType: text("item_type").notNull(),
  colorId: integer("color_id"),
  
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

// Warehouse Management - Aisles
export const whAisles = pgTable("wh_aisles", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull().unique(), // e.g., "Aisle 1", "A", etc.
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertWhAisleSchema = createInsertSchema(whAisles).omit({
  id: true,
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
  id: true,
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
  id: true,
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
  id: true,
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
