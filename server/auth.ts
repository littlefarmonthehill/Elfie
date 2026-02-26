// Email/Password Authentication
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";
import bcrypt from "bcrypt";
import { z } from "zod";
import type { User } from "@shared/schema";

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
    createTableIfMissing: false,
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
      const { email, password, firstName, lastName } = validatedData;

      // Check if user already exists
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "Email already registered" });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

      // Auto-approve admins (Blake and Caleb get admin role and auto-approval)
      const isApproved = APPROVED_ADMINS.includes(email);
      const role = isApproved ? "admin" : "customer";

      // Create user
      const user = await storage.createUser({
        email,
        password: hashedPassword,
        firstName,
        lastName,
        isApproved,
        role,
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
