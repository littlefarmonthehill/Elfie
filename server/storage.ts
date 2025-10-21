import {
  users,
  type User,
  type UpsertUser,
} from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";

// Interface for storage operations
export interface IStorage {
  // User operations - Email/Password Authentication
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: UpsertUser): Promise<User>;
  upsertUser(user: UpsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  updateUserApproval(id: string, isApproved: boolean): Promise<User | undefined>;
  updateUserPassword(id: string, hashedPassword: string): Promise<void>;
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
}

export const storage = new DatabaseStorage();
