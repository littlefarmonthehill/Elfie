import type { Request, Response, NextFunction } from 'express';

/**
 * Global Express error handler. Mount this LAST in server/index.ts (after all
 * routes) so it catches errors forwarded by asyncRoute() via next(err).
 *
 * Replaces the ~316 identical try/catch blocks that were inline in routes.ts:
 *   } catch (error) {
 *     console.error('Error doing X:', error);
 *     res.status(500).json({ error: 'Failed to do X' });
 *   }
 */
export function apiErrorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  const status = err.status ?? err.statusCode ?? 500;
  const message = err.message ?? 'Internal server error';

  if (status >= 500) {
    console.error('[API Error]', err);
  }

  if (!res.headersSent) {
    res.status(status).json({ error: message });
  }
}
