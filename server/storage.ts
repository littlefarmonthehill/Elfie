import {
  users,
  organizations,
  blInventory,
  orders,
  shipments,
  eodForms,
  appSettings,
  conversations,
  blApiCalls,
  syncMetadata,
  syncIssues,
  embeddingJobs,
  whAisles,
  whShelves,
  whBins,
  inventoryLocations,
  blForumPosts,
  orderAdjustments,
  brickanalyzerScans,
  appFeedback,
  orgIntegrations,
  orderDetails,
  inventoryEmbeddings,
  orderEmbeddings,
  type User,
  type UpsertUser,
  type Organization,
  type InsertOrganization,
} from "@shared/schema";
import { db } from "./db";
import { eq, inArray, sql, ilike, or } from "drizzle-orm";

// Interface for storage operations
export interface IStorage {
  // User operations - Email/Password Authentication
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: UpsertUser): Promise<User>;
  upsertUser(user: UpsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  updateUserApproval(id: string, isApproved: boolean): Promise<User | undefined>;
  updateUserRole(id: string, role: string): Promise<User | undefined>;
  updateUserPassword(id: string, hashedPassword: string): Promise<void>;
  updateUserSuperAdmin(id: string, superAdmin: boolean): Promise<User | undefined>;
  getSuperAdmins(): Promise<User[]>;
  searchUsersByEmail(query: string): Promise<User[]>;
  // Organization operations
  createOrganization(org: InsertOrganization): Promise<Organization>;
  getOrganization(id: string): Promise<Organization | undefined>;
  getOrganizationBySlug(slug: string): Promise<Organization | undefined>;
  getAllOrganizations(): Promise<Organization[]>;
  updateOrganization(id: string, data: Partial<InsertOrganization>): Promise<Organization | undefined>;
  deleteOrganization(id: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // User operations - REQUIRED for Replit Auth
  // Reference: blueprint:javascript_log_in_with_replit
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    // Robust upsert algorithm to handle:
    // 1. Existing users (by OIDC sub)
    // 2. Pre-approved users (by email)
    // 3. Email changes from IdP
    
    return await db.transaction(async (tx) => {
      // First, try to find by OIDC sub (id)
      const [userById] = await tx
        .select()
        .from(users)
        .where(eq(users.id, userData.id));

      if (userById) {
        // User exists by id - update profile fields only
        const [updated] = await tx
          .update(users)
          .set({
            email: userData.email,
            firstName: userData.firstName,
            lastName: userData.lastName,
            profileImageUrl: userData.profileImageUrl,
            updatedAt: new Date(),
            // Preserve isApproved and role
          })
          .where(eq(users.id, userData.id))
          .returning();
        return updated;
      }

      // Not found by id, try by email (handles pre-approved users)
      const [userByEmail] = await tx
        .select()
        .from(users)
        .where(eq(users.email, userData.email));

      if (userByEmail) {
        // Pre-approved user logging in for first time
        // Update id to OIDC sub and profile fields, preserve isApproved/role
        const [updated] = await tx
          .update(users)
          .set({
            id: userData.id, // Set to OIDC sub
            firstName: userData.firstName,
            lastName: userData.lastName,
            profileImageUrl: userData.profileImageUrl,
            updatedAt: new Date(),
            // Preserve isApproved and role from pre-approval
          })
          .where(eq(users.email, userData.email))
          .returning();
        return updated;
      }

      // New user - insert with default approval status
      const [newUser] = await tx
        .insert(users)
        .values(userData)
        .returning();
      return newUser;
    });
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  async updateUserApproval(id: string, isApproved: boolean): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ isApproved, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async updateUserRole(id: string, role: string): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .returning();
    return user;
  }

  async updateUserPassword(id: string, hashedPassword: string): Promise<void> {
    await db
      .update(users)
      .set({ password: hashedPassword, updatedAt: new Date() })
      .where(eq(users.id, id));
  }

  async updateUserSuperAdmin(id: string, superAdmin: boolean): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ superAdmin, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async getSuperAdmins(): Promise<User[]> {
    return await db.select().from(users).where(eq(users.superAdmin, true));
  }

  async searchUsersByEmail(query: string): Promise<User[]> {
    return await db
      .select()
      .from(users)
      .where(or(ilike(users.email, `%${query}%`), ilike(users.firstName, `%${query}%`), ilike(users.lastName, `%${query}%`)))
      .limit(10);
  }

  // Organization operations
  async createOrganization(org: InsertOrganization): Promise<Organization> {
    const [created] = await db.insert(organizations).values(org).returning();
    return created;
  }

  async getOrganization(id: string): Promise<Organization | undefined> {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, id));
    return org;
  }

  async getOrganizationBySlug(slug: string): Promise<Organization | undefined> {
    const [org] = await db.select().from(organizations).where(eq(organizations.slug, slug));
    return org;
  }

  async getAllOrganizations(): Promise<Organization[]> {
    return db.select().from(organizations).orderBy(organizations.createdAt);
  }

  async updateOrganization(id: string, data: Partial<InsertOrganization>): Promise<Organization | undefined> {
    const [org] = await db
      .update(organizations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(organizations.id, id))
      .returning();
    return org;
  }

  async deleteOrganization(id: string): Promise<void> {
    // Cascade delete all org-scoped data in correct dependency order

    // 1. Child tables that reference parent-org tables without DB cascade
    const orgOrderIds = db.select({ id: orders.id }).from(orders).where(eq(orders.orgId, id));
    const orgInventoryIds = db.select({ id: blInventory.id }).from(blInventory).where(eq(blInventory.orgId, id));

    await db.delete(orderEmbeddings).where(inArray(orderEmbeddings.orderId, orgOrderIds));
    await db.delete(inventoryEmbeddings).where(inArray(inventoryEmbeddings.inventoryId, orgInventoryIds));

    // 2. orderDetails (and picklistItems cascade from orderDetails)
    const orgOrderDetailIds = db.select({ id: orderDetails.id }).from(orderDetails)
      .innerJoin(orders, eq(orderDetails.orderId, orders.id))
      .where(eq(orders.orgId, id));
    await db.delete(orderDetails).where(inArray(orderDetails.id, orgOrderDetailIds));

    // 3. All directly org-scoped tables
    await db.delete(orderAdjustments).where(eq(orderAdjustments.orgId, id));
    await db.delete(shipments).where(eq(shipments.orgId, id));
    await db.delete(eodForms).where(eq(eodForms.orgId, id));
    await db.delete(blForumPosts).where(eq(blForumPosts.orgId, id));
    await db.delete(brickanalyzerScans).where(eq(brickanalyzerScans.orgId, id));
    await db.delete(appFeedback).where(eq(appFeedback.orgId, id));
    await db.delete(embeddingJobs).where(eq(embeddingJobs.orgId, id));
    await db.delete(syncIssues).where(eq(syncIssues.orgId, id));
    await db.delete(syncMetadata).where(eq(syncMetadata.orgId, id));
    await db.delete(blApiCalls).where(eq(blApiCalls.orgId, id));
    await db.delete(conversations).where(eq(conversations.orgId, id));
    await db.delete(orgIntegrations).where(eq(orgIntegrations.orgId, id));
    await db.delete(appSettings).where(eq(appSettings.orgId, id));

    // 4. Warehouse hierarchy (bins → shelves → aisles after inventoryLocations)
    await db.delete(inventoryLocations).where(eq(inventoryLocations.orgId, id));
    await db.delete(whBins).where(eq(whBins.orgId, id));
    await db.delete(whShelves).where(eq(whShelves.orgId, id));
    await db.delete(whAisles).where(eq(whAisles.orgId, id));

    // 5. Core inventory and orders
    await db.delete(blInventory).where(eq(blInventory.orgId, id));
    await db.delete(orders).where(eq(orders.orgId, id));

    // 6. Users in this org, then the org itself
    await db.delete(users).where(eq(users.orgId, id));
    await db.delete(organizations).where(eq(organizations.id, id));
  }
}

export const storage = new DatabaseStorage();
