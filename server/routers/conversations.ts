import { Router } from 'express';
import { eq, and, ne, desc, asc, gt, lte, or } from 'drizzle-orm';
import { db } from '../db';
import { conversations, conversationThreads, supportTickets, organizations } from '@shared/schema';
import { isAuthenticated, isSuperAdmin } from '../auth';
import { asyncRoute, reqOrgId } from '../lib/routeHelpers';
import { getPlatformSettings } from '../routes';
import { count } from 'drizzle-orm';

const router = Router();

// POST /api/support/escalate
router.post('/support/escalate', isAuthenticated, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) return res.status(404).json({ message: "Organization not found" });
  const overrides = (org.featureOverrides ?? {}) as Record<string, boolean>;
  if (overrides.elfieLiveSupport === false) {
    return res.status(403).json({ message: "Live support is not available on your current plan" });
  }
  const { sessionId, subject } = req.body;
  if (!sessionId) return res.status(400).json({ message: "sessionId required" });
  const existing = await db.select().from(supportTickets)
    .where(and(eq(supportTickets.orgId, orgId), eq(supportTickets.sessionId, sessionId), ne(supportTickets.status, 'resolved')))
    .limit(1);
  if (existing.length > 0) return res.json(existing[0]);
  const [ticket] = await db.insert(supportTickets).values({
    orgId,
    sessionId,
    subject: subject || 'Live support request',
    status: 'escalated',
  }).returning();
  await db.insert(conversations).values({
    sessionId,
    role: 'system',
    content: 'This conversation has been escalated to live support. A team member will join shortly.',
    orgId,
  });
  res.json(ticket);
}));

// GET /api/support/session
router.get('/support/session', isAuthenticated, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const sessionId = req.query.sessionId as string;
  if (!sessionId) return res.status(400).json({ message: "sessionId required" });
  const [ticket] = await db.select().from(supportTickets)
    .where(and(eq(supportTickets.orgId, orgId), eq(supportTickets.sessionId, sessionId), ne(supportTickets.status, 'resolved')))
    .orderBy(desc(supportTickets.createdAt))
    .limit(1);
  const selectFields = {
    id: conversations.id,
    role: conversations.role,
    content: conversations.content,
    context: conversations.context,
    createdAt: conversations.createdAt,
  };
  let msgs: any[];
  if (ticket) {
    const recentBefore = await db.select(selectFields).from(conversations)
      .where(and(
        eq(conversations.orgId, orgId),
        eq(conversations.sessionId, sessionId),
        lte(conversations.createdAt, ticket.createdAt),
      ))
      .orderBy(desc(conversations.createdAt))
      .limit(20);
    const afterEscalation = await db.select(selectFields).from(conversations)
      .where(and(
        eq(conversations.orgId, orgId),
        eq(conversations.sessionId, sessionId),
        gt(conversations.createdAt, ticket.createdAt),
      ))
      .orderBy(asc(conversations.createdAt));
    msgs = [...recentBefore.reverse(), ...afterEscalation];
  } else {
    msgs = await db.select(selectFields).from(conversations)
      .where(and(eq(conversations.orgId, orgId), eq(conversations.sessionId, sessionId)))
      .orderBy(desc(conversations.createdAt))
      .limit(30);
    msgs = msgs.reverse();
  }
  const unseenSupport = ticket ? await db.select({ count: count() }).from(conversations)
    .where(and(
      eq(conversations.orgId, orgId),
      eq(conversations.sessionId, sessionId),
      eq(conversations.role, 'support'),
    )) : [{ count: 0 }];
  res.json({
    messages: msgs,
    ticket: ticket || null,
    hasUnseenSupport: (unseenSupport[0]?.count || 0) > 0,
  });
}));

// GET /api/conversations/threads
router.get('/conversations/threads', isAuthenticated, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const threads = await db.select().from(conversationThreads)
    .where(eq(conversationThreads.orgId, orgId))
    .orderBy(desc(conversationThreads.updatedAt))
    .limit(50);
  res.json(threads);
}));

// POST /api/conversations/threads
router.post('/conversations/threads', isAuthenticated, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ message: "sessionId required" });
  const [existing] = await db.select().from(conversationThreads)
    .where(and(eq(conversationThreads.sessionId, sessionId), eq(conversationThreads.orgId, orgId)))
    .limit(1);
  if (existing) return res.json(existing);
  const [thread] = await db.insert(conversationThreads).values({
    sessionId,
    orgId,
    title: 'New conversation',
  }).returning();
  res.json(thread);
}));

// PATCH /api/conversations/threads/:sessionId/title
router.patch('/conversations/threads/:sessionId/title', isAuthenticated, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { sessionId } = req.params;
  const { title } = req.body;
  if (!title) return res.status(400).json({ message: "title required" });
  await db.update(conversationThreads)
    .set({ title, updatedAt: new Date() })
    .where(and(eq(conversationThreads.sessionId, sessionId), eq(conversationThreads.orgId, orgId)));
  res.json({ ok: true });
}));

// DELETE /api/conversations/threads/:sessionId
router.delete('/conversations/threads/:sessionId', isAuthenticated, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { sessionId } = req.params;
  await db.delete(conversations)
    .where(and(eq(conversations.sessionId, sessionId), eq(conversations.orgId, orgId)));
  await db.delete(conversationThreads)
    .where(and(eq(conversationThreads.sessionId, sessionId), eq(conversationThreads.orgId, orgId)));
  res.json({ ok: true });
}));

// POST /api/conversations/threads/:sessionId/generate-title
router.post('/conversations/threads/:sessionId/generate-title', isAuthenticated, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { sessionId } = req.params;
  const firstMessages = await db.select({ content: conversations.content, role: conversations.role })
    .from(conversations)
    .where(and(eq(conversations.sessionId, sessionId), eq(conversations.orgId, orgId), eq(conversations.role, 'user')))
    .orderBy(asc(conversations.createdAt))
    .limit(2);
  if (firstMessages.length === 0) return res.json({ title: 'New conversation' });
  const snippet = firstMessages.map(m => m.content).join(' ').slice(0, 200);
  try {
    const openai = (await import('openai')).default;
    const platSettings = await getPlatformSettings();
    const apiKey = platSettings?.openaiApiKey;
    if (apiKey) {
      const client = new openai({ apiKey });
      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Generate a very short title (3-6 words) for this conversation. No quotes. No punctuation at end.' },
          { role: 'user', content: snippet },
        ],
        max_tokens: 20,
        temperature: 0.5,
      });
      const title = completion.choices[0]?.message?.content?.trim() || snippet.slice(0, 40);
      await db.update(conversationThreads)
        .set({ title, updatedAt: new Date() })
        .where(and(eq(conversationThreads.sessionId, sessionId), eq(conversationThreads.orgId, orgId)));
      return res.json({ title });
    }
  } catch {}
  const fallbackTitle = snippet.slice(0, 40) + (snippet.length > 40 ? '...' : '');
  await db.update(conversationThreads)
    .set({ title: fallbackTitle, updatedAt: new Date() })
    .where(and(eq(conversationThreads.sessionId, sessionId), eq(conversationThreads.orgId, orgId)));
  res.json({ title: fallbackTitle });
}));

// GET /api/support/ticket-status
router.get('/support/ticket-status', isAuthenticated, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const sessionId = req.query.sessionId as string;
  if (!sessionId) return res.status(400).json({ message: "sessionId required" });
  const tickets = await db.select().from(supportTickets)
    .where(and(eq(supportTickets.orgId, orgId), eq(supportTickets.sessionId, sessionId), ne(supportTickets.status, 'resolved')))
    .orderBy(desc(supportTickets.createdAt))
    .limit(1);
  res.json(tickets[0] || null);
}));

// GET /api/support/messages
router.get('/support/messages', isAuthenticated, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const sessionId = req.query.sessionId as string;
  const since = req.query.since as string;
  if (!sessionId) return res.status(400).json({ message: "sessionId required" });
  let query = db.select().from(conversations)
    .where(and(
      eq(conversations.orgId, orgId),
      eq(conversations.sessionId, sessionId),
      or(eq(conversations.role, 'support'), eq(conversations.role, 'system')),
    ))
    .orderBy(asc(conversations.createdAt));
  if (since) {
    const sinceDate = new Date(parseInt(since));
    query = db.select().from(conversations)
      .where(and(
        eq(conversations.orgId, orgId),
        eq(conversations.sessionId, sessionId),
        or(eq(conversations.role, 'support'), eq(conversations.role, 'system')),
        gt(conversations.createdAt, sinceDate),
      ))
      .orderBy(asc(conversations.createdAt));
  }
  const msgs = await query;
  res.json(msgs);
}));

export default router;
