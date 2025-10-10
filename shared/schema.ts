import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, timestamp, boolean } from "drizzle-orm/pg-core";
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
  quantity: integer("quantity").notNull(),
  newOrUsed: text("new_or_used").notNull(),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }),
  myCost: decimal("my_cost", { precision: 10, scale: 4 }),
  bindId: integer("bind_id"),
  description: text("description"),
  remarks: text("remarks"),
  bulk: integer("bulk"),
  isRetain: boolean("is_retain").default(false),
  isStockRoom: boolean("is_stock_room").default(false),
  categoryId: integer("category_id"),
  dateCreated: timestamp("date_created"),
  tierPrice1: decimal("tier_price_1", { precision: 10, scale: 2 }),
  tierPrice2: decimal("tier_price_2", { precision: 10, scale: 2 }),
  tierPrice3: decimal("tier_price_3", { precision: 10, scale: 2 }),
  tierQuantity1: integer("tier_quantity_1"),
  tierQuantity2: integer("tier_quantity_2"),
  tierQuantity3: integer("tier_quantity_3"),
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
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertOrderDetailSchema = createInsertSchema(orderDetails).omit({
  id: true,
  syncedAt: true,
  updatedAt: true,
});

export type InsertOrderDetail = z.infer<typeof insertOrderDetailSchema>;
export type OrderDetail = typeof orderDetails.$inferSelect;

// App Settings
export const appSettings = pgTable("app_settings", {
  id: varchar("id").primaryKey().default('default'),
  aiEnabled: boolean("ai_enabled").default(true).notNull(),
  openrouterApiKey: text("openrouter_api_key"),
  selectedModel: text("selected_model").default('openai/gpt-4o-mini'),
  bricklinkConsumerKey: text("bricklink_consumer_key"),
  bricklinkConsumerSecret: text("bricklink_consumer_secret"),
  bricklinkTokenValue: text("bricklink_token_value"),
  bricklinkTokenSecret: text("bricklink_token_secret"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertAppSettingsSchema = createInsertSchema(appSettings).omit({
  id: true,
  updatedAt: true,
});

export type InsertAppSettings = z.infer<typeof insertAppSettingsSchema>;
export type AppSettings = typeof appSettings.$inferSelect;

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
