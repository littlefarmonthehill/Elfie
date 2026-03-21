/**
 * Agent Team Scheduler — runs each specialized background agent on its own cadence.
 * All agents are independent; failures are non-fatal.
 *
 * Cadences (approximate, staggered to avoid API bursts):
 *   catalog    — every 6 hours (offset +2min) — runs first so domain agents can use signals
 *   inventory  — every 6 hours (offset +5min)
 *   pricing    — every 6 hours (offset +8min)
 *   market     — every 8 hours (offset +11min)
 *   orders     — every 8 hours (offset +14min)
 *   customer   — every 12 hours (offset +17min)
 */

import { db } from "../db";
import { organizations } from "@shared/schema";
import { ne, isNull, or } from "drizzle-orm";
import {
  runCatalogAgent, runInventoryAgent, runPricingAgent, runMarketAgent, runOrdersAgent, runCustomerAgent,
} from "./agent-team";

const HOUR = 60 * 60 * 1000;

async function getActiveOrgIds(): Promise<string[]> {
  try {
    const rows = await db.select({ id: organizations.id })
      .from(organizations)
      .where(or(isNull(organizations.id), ne(organizations.id, 'platform')));
    return rows.map(r => r.id).filter(id => id && id !== 'platform');
  } catch { return []; }
}

async function runAgentForAllOrgs(agentName: string, fn: (orgId: string) => Promise<number>) {
  const orgIds = await getActiveOrgIds();
  for (const orgId of orgIds) {
    try {
      const count = await fn(orgId);
      if (count > 0) console.log(`[AgentTeam] ${agentName} → ${count} signals for ${orgId}`);
    } catch (err: any) {
      console.error(`[AgentTeam] ${agentName} failed for ${orgId} (non-fatal):`, err.message);
    }
  }
}

export function startAgentTeamSchedulers() {
  const CATALOG_INTERVAL   = 6 * HOUR;
  const INVENTORY_INTERVAL = 6 * HOUR;
  const PRICING_INTERVAL   = 6 * HOUR;
  const MARKET_INTERVAL    = 8 * HOUR;
  const ORDERS_INTERVAL    = 8 * HOUR;
  const CUSTOMER_INTERVAL  = 12 * HOUR;

  // Catalog runs first so domain agents can use catalog signals as enrichment context

  setTimeout(() => {
    runAgentForAllOrgs('Catalog', runCatalogAgent);
    setInterval(() => runAgentForAllOrgs('Catalog', runCatalogAgent), CATALOG_INTERVAL);
  }, 2 * 60 * 1000); // 2 min after startup

  setTimeout(() => {
    runAgentForAllOrgs('Inventory', runInventoryAgent);
    setInterval(() => runAgentForAllOrgs('Inventory', runInventoryAgent), INVENTORY_INTERVAL);
  }, 5 * 60 * 1000); // 5 min after startup

  setTimeout(() => {
    runAgentForAllOrgs('Pricing', runPricingAgent);
    setInterval(() => runAgentForAllOrgs('Pricing', runPricingAgent), PRICING_INTERVAL);
  }, 8 * 60 * 1000); // 8 min after startup

  setTimeout(() => {
    runAgentForAllOrgs('Market', runMarketAgent);
    setInterval(() => runAgentForAllOrgs('Market', runMarketAgent), MARKET_INTERVAL);
  }, 11 * 60 * 1000); // 11 min after startup

  setTimeout(() => {
    runAgentForAllOrgs('Orders', runOrdersAgent);
    setInterval(() => runAgentForAllOrgs('Orders', runOrdersAgent), ORDERS_INTERVAL);
  }, 14 * 60 * 1000); // 14 min after startup

  setTimeout(() => {
    runAgentForAllOrgs('Customer', runCustomerAgent);
    setInterval(() => runAgentForAllOrgs('Customer', runCustomerAgent), CUSTOMER_INTERVAL);
  }, 17 * 60 * 1000); // 17 min after startup

  console.log('[AgentTeam] All 6 agents scheduled (catalog + 5 domain agents)');
}
