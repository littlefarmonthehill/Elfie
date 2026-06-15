import { db } from '../db';
import { platformSettings, PLATFORM_ORG_ID } from '@shared/schema';
import { eq } from 'drizzle-orm';

/**
 * Fetch platform-level settings (single row, id='platform').
 * Creates the row on first access if it doesn't exist.
 */
export async function getPlatformSettings() {
  const [existing] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.id, 'platform'))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(platformSettings)
    .values({ id: 'platform' })
    .onConflictDoUpdate({ target: platformSettings.id, set: { updatedAt: new Date() } })
    .returning();
  return created;
}

/**
 * Get the platform-wide OpenAI API key from the dedicated platform settings row.
 * This is the single source of truth for all OpenAI usage across every org.
 */
export async function getPlatformOpenAIKey(): Promise<string | null> {
  const settings = await getPlatformSettings();
  return settings?.openaiApiKey || null;
}

export async function getPlatformBrickLinkCredentials(): Promise<{
  consumerKey: string;
  consumerSecret: string;
  tokenValue: string;
  tokenSecret: string;
} | null> {
  const [ps] = await db.select().from(platformSettings).where(eq(platformSettings.id, PLATFORM_ORG_ID)).limit(1);
  if (!ps?.blConsumerKey || !ps?.blConsumerSecret || !ps?.blTokenValue || !ps?.blTokenSecret) {
    return null;
  }
  return {
    consumerKey: ps.blConsumerKey,
    consumerSecret: ps.blConsumerSecret,
    tokenValue: ps.blTokenValue,
    tokenSecret: ps.blTokenSecret,
  };
}
