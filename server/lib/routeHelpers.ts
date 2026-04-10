import type { Request, Response, NextFunction } from 'express';

/**
 * Wraps an async route handler so errors are forwarded to Express's error
 * pipeline instead of requiring a try/catch in every handler.
 *
 * Before:
 *   app.get('/api/foo', async (req, res) => {
 *     try { ... } catch (e) { res.status(500).json(...); }
 *   });
 *
 * After:
 *   app.get('/api/foo', asyncRoute(async (req, res) => { ... }));
 */
export function asyncRoute(
  fn: (req: any, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Get the requesting user's orgId — respects super-admin impersonation.
 * Mirrors the same logic that was inlined in routes.ts.
 */
export function reqOrgId(req: any): string {
  if (req.session?.impersonatingOrgId) return req.session.impersonatingOrgId;
  return (req.user as any)?.orgId ?? 'org_planetbrick';
}
