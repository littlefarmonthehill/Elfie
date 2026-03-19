// Email/Password Authentication
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";
import bcrypt from "bcryptjs";
import { z } from "zod";
import crypto from "crypto";
import { pool, db } from "./db";
import type { User } from "@shared/schema";
import { plans } from "@shared/schema";
import { eq } from "drizzle-orm";

// ─── Session type augmentation for impersonation ─────────────────────────────
declare module 'express-session' {
  interface SessionData {
    impersonatingOrgId?: string;
    impersonatingOrgName?: string;
  }
}

// ─── Org Helpers ─────────────────────────────────────────────────────────────
export function getOrgId(req: any): string | null {
  if (req.session?.impersonatingOrgId) return req.session.impersonatingOrgId;
  return (req.user as any)?.orgId ?? null;
}

export const isOrgOwner: RequestHandler = (req, res, next) => {
  const user = req.user as any;
  if (!user?.orgId) return res.status(403).json({ message: "No organization" });
  if (user.orgRole !== 'owner') return res.status(403).json({ message: "Owner access required" });
  next();
};

function toSlug(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 28);
}

const SALT_ROUNDS = 10;
const APPROVED_ADMINS = ["bhnorby@gmail.com", "caleblauritsen@gmail.com"];

// Sanitize user object to remove sensitive fields
function sanitizeUser(user: User | null | undefined): Omit<User, 'password'> | undefined {
  if (!user) return undefined;
  const { password, ...sanitizedUser } = user;
  return sanitizedUser;
}

// Server-side validation schemas
const emailPasswordSchema = z.object({
  email: z.string().email().min(1).transform(val => val.toLowerCase()),
  password: z.string().min(8),
});

const signupSchema = emailPasswordSchema.extend({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  joinOrgId: z.string().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: sessionTtl,
    },
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  // Configure passport-local strategy
  passport.use(
    new LocalStrategy(
      { usernameField: "email" },
      async (email, password, done) => {
        try {
          // Normalize email to lowercase
          const normalizedEmail = email.toLowerCase();
          const user = await storage.getUserByEmail(normalizedEmail);
          if (!user) {
            return done(null, false, { message: "Invalid email or password" });
          }

          if (!user.password) {
            return done(null, false, { message: "Invalid email or password" });
          }

          const isValidPassword = await bcrypt.compare(password, user.password);
          if (!isValidPassword) {
            return done(null, false, { message: "Invalid email or password" });
          }

          return done(null, sanitizeUser(user));
        } catch (error) {
          return done(error);
        }
      }
    )
  );

  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, sanitizeUser(user));
    } catch (error) {
      done(error);
    }
  });

  // Signup route
  app.post("/api/signup", async (req, res) => {
    try {
      // Validate input
      const validatedData = signupSchema.parse(req.body);
      const { email, password, firstName, lastName, joinOrgId } = validatedData;

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "Email already registered" });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

      // Auto-approve admins (Blake and Caleb get admin role and auto-approval)
      const isAdmin = APPROVED_ADMINS.includes(email);
      const role = isAdmin ? "admin" : "customer";
      const superAdmin = isAdmin;

      let orgId: string;
      let orgRole: string | null = 'owner';
      let userApproved = isAdmin;

      if (isAdmin) {
        orgId = 'org_planetbrick';
      } else if (joinOrgId) {
        if (joinOrgId === 'platform' || joinOrgId === '__platform__') {
          return res.status(400).json({ message: "Cannot join this organization" });
        }
        const targetOrg = await storage.getOrganization(joinOrgId);
        if (!targetOrg || !targetOrg.isActive) {
          return res.status(400).json({ message: "Organization not found" });
        }
        orgId = joinOrgId;
        orgRole = null;
        userApproved = false;
      } else {
        // New business — owner is auto-approved (no admin exists to approve them)
        const baseSlug = toSlug(firstName || email.split('@')[0] || 'store');
        const suffix = Math.floor(1000 + Math.random() * 9000);
        const slug = `${baseSlug}${suffix}`;
        const orgName = firstName ? `${firstName}'s Store` : `${email.split('@')[0]}'s Store`;
        const signupDate = new Date();
        signupDate.setHours(0, 0, 0, 0); // normalize to start of day

        // Assign new org to the default plan (if set) or fall back to the 'trial' plan.
        // Always honour trialDurationDays so every org gets a "try before you buy" window.
        const [defaultPlan] = await db.select().from(plans).where(eq(plans.isDefault, true)).limit(1);
        let newOrg;
        if (defaultPlan) {
          const trialDays = defaultPlan.trialDurationDays ?? 0;
          const trialEndsAt = trialDays > 0 ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000) : null;
          newOrg = await storage.createOrganization({
            name: orgName, slug,
            plan: defaultPlan.name,
            planId: defaultPlan.id,
            subscriptionStatus: trialEndsAt ? 'trial' : 'active',
            trialEndsAt,
            billingStartDate: signupDate,
          });
        } else {
          // No default plan configured — fall back to the legacy 'trial' planKey with 14-day window
          const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
          newOrg = await storage.createOrganization({ name: orgName, slug, plan: 'trial', trialEndsAt, billingStartDate: signupDate });
        }
        orgId = newOrg.id;
        userApproved = true;
      }

      // Create user
      const user = await storage.createUser({
        email,
        password: hashedPassword,
        firstName,
        lastName,
        isApproved: userApproved,
        role,
        orgId,
        orgRole,
        superAdmin,
      });

      // Regenerate session to prevent session fixation
      req.session.regenerate((err) => {
        if (err) {
          return res.status(500).json({ message: "Failed to create session" });
        }
        
        // Log in the user
        req.login(sanitizeUser(user) as any, (loginErr) => {
          if (loginErr) {
            return res.status(500).json({ message: "Failed to log in after signup" });
          }
          res.json(sanitizeUser(user));
        });
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid input", 
          errors: error.errors 
        });
      }
      console.error("Signup error:", error);
      res.status(500).json({ message: "Failed to create account" });
    }
  });

  const emailCheckAttempts = new Map<string, { count: number; resetAt: number }>();
  app.post("/api/check-email", async (req, res) => {
    try {
      const ip = req.ip || "unknown";
      const now = Date.now();
      const entry = emailCheckAttempts.get(ip);
      if (entry && now < entry.resetAt) {
        if (entry.count >= 10) {
          return res.status(429).json({ message: "Too many requests. Try again later." });
        }
        entry.count++;
      } else {
        emailCheckAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
      }

      const { email } = req.body;
      if (!email || typeof email !== "string") {
        return res.status(400).json({ message: "Email is required" });
      }
      const normalizedEmail = email.toLowerCase().trim();
      const user = await storage.getUserByEmail(normalizedEmail);
      res.json({ exists: !!user });
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  });

  // Login route
  app.post("/api/login", (req, res, next) => {
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) {
        return res.status(500).json({ message: "Authentication error" });
      }
      if (!user) {
        return res.status(401).json({ message: info?.message || "Invalid credentials" });
      }

      // Regenerate session to prevent session fixation
      req.session.regenerate((regenerateErr) => {
        if (regenerateErr) {
          return res.status(500).json({ message: "Failed to create session" });
        }
        
        req.login(user, (loginErr) => {
          if (loginErr) {
            return res.status(500).json({ message: "Failed to log in" });
          }
          res.json(user);
        });
      });
    })(req, res, next);
  });

  // Logout route
  app.post("/api/logout", (req, res) => {
    req.logout(() => {
      req.session.destroy((err) => {
        if (err) {
          console.error("Session destroy error:", err);
        }
        res.clearCookie('connect.sid');
        res.json({ message: "Logged out successfully" });
      });
    });
  });

  // Change password (authenticated user changes their own password)
  app.post("/api/auth/change-password", async (req, res) => {
    if (!req.isAuthenticated?.() || !req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "currentPassword and newPassword are required" });
    }
    if (typeof newPassword !== "string" || newPassword.length < 8) {
      return res.status(400).json({ message: "New password must be at least 8 characters" });
    }
    try {
      const userId = (req.user as any).id;
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      if (!user.password) {
        return res.status(400).json({ message: "This account uses social login and does not have a password" });
      }
      const valid = await bcrypt.compare(currentPassword, user.password);
      if (!valid) return res.status(400).json({ message: "Current password is incorrect" });
      const hashed = await bcrypt.hash(newPassword, 12);
      await storage.updateUserPassword(userId, hashed);
      res.json({ success: true });
    } catch (err) {
      console.error("Change password error:", err);
      res.status(500).json({ message: "Failed to change password" });
    }
  });

  // Forgot password — generates a reset token and returns the reset URL
  app.post("/api/forgot-password", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email || typeof email !== "string") {
        return res.status(400).json({ message: "Email is required" });
      }
      const normalizedEmail = email.toLowerCase().trim();
      const user = await storage.getUserByEmail(normalizedEmail);
      // Always respond with 200 to avoid leaking whether an email exists
      if (!user) {
        return res.json({ resetUrl: null, message: "If that email is registered, a reset link has been generated." });
      }
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await pool.query(
        `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
        [user.id, token, expiresAt]
      );
      const baseUrl = process.env.REPLIT_DOMAINS
        ? `https://${process.env.REPLIT_DOMAINS.split(",")[0].trim()}`
        : `http://localhost:${process.env.PORT || 5000}`;
      const resetUrl = `${baseUrl}/reset-password?token=${token}`;
      console.log(`[Auth] Password reset requested for ${normalizedEmail} — token expires ${expiresAt.toISOString()}`);
      return res.json({ resetUrl });
    } catch (error) {
      console.error("Forgot password error:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  // Reset password — validates token and sets new password
  app.post("/api/reset-password", async (req, res) => {
    try {
      const { token, newPassword } = req.body;
      if (!token || typeof token !== "string") {
        return res.status(400).json({ message: "Reset token is required" });
      }
      if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }
      const result = await pool.query(
        `SELECT * FROM password_reset_tokens WHERE token = $1 AND used = false AND expires_at > NOW()`,
        [token]
      );
      if (result.rowCount === 0) {
        return res.status(400).json({ message: "Reset link is invalid or has expired. Please request a new one." });
      }
      const resetRecord = result.rows[0];
      const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
      await storage.updateUserPassword(resetRecord.user_id, hashedPassword);
      await pool.query(`UPDATE password_reset_tokens SET used = true WHERE token = $1`, [token]);
      return res.json({ message: "Password updated successfully" });
    } catch (error) {
      console.error("Reset password error:", error);
      res.status(500).json({ message: "Server error" });
    }
  });

  // Change password route
  app.post("/api/change-password", isAuthenticated, async (req, res) => {
    try {
      // Validate input
      const validatedData = changePasswordSchema.parse(req.body);
      const { currentPassword, newPassword } = validatedData;
      
      const user = req.user as any;

      // Get user from DB
      const dbUser = await storage.getUser(user.id);
      if (!dbUser || !dbUser.password) {
        return res.status(400).json({ message: "Invalid request" });
      }

      // Verify current password
      const isValidPassword = await bcrypt.compare(currentPassword, dbUser.password);
      if (!isValidPassword) {
        return res.status(400).json({ message: "Current password is incorrect" });
      }

      // Hash new password
      const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

      // Update password
      await storage.updateUserPassword(user.id, hashedPassword);

      res.json({ message: "Password changed successfully" });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Invalid input", 
          errors: error.errors 
        });
      }
      console.error("Change password error:", error);
      res.status(500).json({ message: "Failed to change password" });
    }
  });
}

// Authentication middleware - checks if user is logged in
export const isAuthenticated: RequestHandler = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: "Unauthorized" });
};

// superAdmin middleware - checks if user is a platform superAdmin
export const isSuperAdmin: RequestHandler = async (req, res, next) => {
  if (!req.isAuthenticated()) {
    console.log('[isSuperAdmin] DENIED - not authenticated, path:', (req as any).path);
    return res.status(403).json({ message: "Super admin access required" });
  }
  const sessionUser = req.user as any;
  console.log('[isSuperAdmin] user:', sessionUser?.id, 'superAdmin:', sessionUser?.superAdmin, 'path:', (req as any).path);
  // Fast path: session already has superAdmin flag
  if (sessionUser?.superAdmin === true) {
    return next();
  }
  // Fallback: re-fetch from DB in case session is stale
  try {
    const userId = sessionUser?.id;
    if (userId) {
      const dbUser = await storage.getUser(userId);
      console.log('[isSuperAdmin] DB fallback - dbUser.superAdmin:', dbUser?.superAdmin, 'userId:', userId);
      if (dbUser?.superAdmin) {
        return next();
      }
    }
  } catch (err) {
    console.error('[isSuperAdmin] DB lookup error:', err);
  }
  console.log('[isSuperAdmin] DENIED - superAdmin not set for user:', sessionUser?.id);
  return res.status(403).json({ message: "Super admin access required" });
};

// Approval middleware - user must be authenticated and approved
export const isApproved: RequestHandler = async (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const user = req.user as any;
  if (!user.isApproved) {
    return res.status(403).json({ message: "Access not approved" });
  }

  next();
};
