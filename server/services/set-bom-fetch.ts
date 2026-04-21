// On-demand Set BOM fetcher.
//
// Replaces the old CSV-streaming pipeline (syncRebrickableSetParts /
// syncRebrickableSetMinifigs) with per-set Rebrickable API calls.
//
// For each owned set we call exactly two endpoints:
//   GET /api/v3/lego/sets/{set_num}/parts/?page_size=1000   (paginated)
//   GET /api/v3/lego/sets/{set_num}/minifigs/?page_size=1000
// Both return everything we need in one shot — part_num, color id+name+rgb,
// quantity, name, and img_url — so the composition view doesn't need to
// stitch through rb_colors or bl_catalog joins to render.
//
// Each set's BOM lands in `set_part_relationships` keyed on (set_num,
// part_num, color_id). Re-fetches are idempotent: we DELETE the set's prior
// rows then re-insert.

import axios from "axios";
import { db } from "../db";
import { sql, eq, and } from "drizzle-orm";
import {
  setPartRelationships,
  blInventory,
  partIdMappings,
} from "@shared/schema";

const API_BASE = "https://rebrickable.com/api/v3";
const KEY = process.env.REBRICKABLE_API_KEY;

interface RbColor { id: number; name: string; rgb: string; is_trans: boolean }
interface RbPartRow {
  part: { part_num: string; name: string; part_img_url?: string | null };
  color: RbColor;
  quantity: number;
  is_spare?: boolean;
  set_num: string; // for minifig parts: returns the fig number
}
interface RbMinifigInventoryRow {
  set_num: string;       // fig-XXXXXX
  set_name: string;      // minifig name
  set_img_url?: string | null;
  quantity: number;
}

async function getJson<T = any>(url: string): Promise<T> {
  const res = await axios.get<T>(url, { params: { key: KEY }, timeout: 20000 });
  return res.data;
}

async function fetchAllPages<T>(firstUrl: string, key: keyof any): Promise<T[]> {
  let url: string | null = firstUrl;
  const out: T[] = [];
  while (url) {
    const json: any = await getJson(url);
    out.push(...((json[key as string] ?? []) as T[]));
    url = json.next || null;
  }
  return out;
}

// In-flight de-dup so two concurrent dialog opens for the same set don't
// hammer the API twice.
const inflight = new Map<string, Promise<{ partsCount: number; minifigsCount: number }>>();

export async function fetchAndCacheSetBom(setNum: string): Promise<{
  partsCount: number;
  minifigsCount: number;
}> {
  if (!KEY) throw new Error("REBRICKABLE_API_KEY not set");
  const existing = inflight.get(setNum);
  if (existing) return existing;

  const work = (async () => {
    console.log(`[SetBom] Fetching ${setNum} from Rebrickable…`);

    // Parts: returns one row per (part, color), already grouped, with name + img + color metadata
    const partsUrl = `${API_BASE}/lego/sets/${encodeURIComponent(setNum)}/parts/?page_size=1000&inc_color_details=1`;
    const partRows = await fetchAllPages<RbPartRow>(partsUrl, 'results');

    // Minifigs: lists fig-numbers + counts. We do NOT recursively fetch fig parts
    // because the Set Completion view tracks ownership at the minifig level.
    const figUrl = `${API_BASE}/lego/sets/${encodeURIComponent(setNum)}/minifigs/?page_size=1000`;
    const figRows = await fetchAllPages<RbMinifigInventoryRow>(figUrl, 'results');

    // Replace prior cache for this set
    await db.delete(setPartRelationships).where(eq(setPartRelationships.setNum, setNum));

    // Insert parts (skip spares — they're not needed for completion)
    const partInserts = partRows
      .filter(r => !r.is_spare)
      .map(r => ({
        setNum,
        setName: null as string | null,
        partNum: r.part.part_num,
        colorId: r.color?.id ?? null,
        quantity: Number(r.quantity) || 0,
      }));

    const figInserts = figRows.map(r => ({
      setNum,
      setName: null as string | null,
      partNum: r.set_num,           // "fig-XXXXXX"
      colorId: null as number | null,
      quantity: Number(r.quantity) || 1,
    }));

    const all = [...partInserts, ...figInserts];
    if (all.length > 0) {
      const BATCH = 500;
      for (let i = 0; i < all.length; i += BATCH) {
        await db.insert(setPartRelationships).values(all.slice(i, i + BATCH));
      }
    }

    console.log(`[SetBom] ✓ ${setNum}: ${partInserts.length} parts, ${figInserts.length} minifigs`);
    return { partsCount: partInserts.length, minifigsCount: figInserts.length };
  })();

  inflight.set(setNum, work);
  try {
    return await work;
  } finally {
    inflight.delete(setNum);
  }
}

// Best-effort BL ID resolver for the minifigs in a single set. Bounded to a
// handful of API calls. Self-skips already-mapped figs so re-runs are cheap.
export async function resolveSetMinifigBlIds(setNum: string): Promise<{ saved: number }> {
  if (!KEY) return { saved: 0 };
  const rows = await db.execute<{ figNum: string }>(sql`
    SELECT DISTINCT spr.part_num AS "figNum"
    FROM set_part_relationships spr
    WHERE spr.set_num = ${setNum}
      AND spr.part_num LIKE 'fig-%'
      AND spr.part_num NOT IN (
        SELECT rebrickable_id FROM part_id_mappings WHERE rebrickable_id LIKE 'fig-%'
      )
  `);
  const figs: Array<{ figNum: string }> = (rows as any).rows ?? rows ?? [];
  if (figs.length === 0) return { saved: 0 };

  let saved = 0;
  for (const { figNum } of figs) {
    try {
      const json: any = await getJson(`${API_BASE}/lego/minifigs/${encodeURIComponent(figNum)}/`);
      const blIds: string[] = json?.external_ids?.BrickLink?.ext_ids ?? [];
      if (blIds.length === 0) {
        await db.insert(partIdMappings).values({ rebrickableId: figNum }).onConflictDoNothing();
      } else {
        for (const blId of blIds) {
          await db.insert(partIdMappings).values({ blId, rebrickableId: figNum }).onConflictDoNothing();
        }
        saved++;
      }
    } catch (err: any) {
      if (err?.response?.status === 404) {
        await db.insert(partIdMappings).values({ rebrickableId: figNum }).onConflictDoNothing();
      } else {
        console.warn(`[SetBom] Minifig BL lookup failed for ${figNum}:`, err.message);
      }
    }
    await new Promise(r => setTimeout(r, 1200));
  }
  return { saved };
}

// ─── Warm cache: walk owned sets and fetch any without a cached BOM ─────────
let warmRunning = false;
export function getSetBomWarmingRunning() { return warmRunning; }

export interface WarmResult {
  ownedSets: number;
  alreadyCached: number;
  fetched: number;
  failed: Array<{ setNum: string; error: string }>;
}

export async function warmOwnedSetBoms(orgId: number): Promise<WarmResult> {
  if (warmRunning) throw new Error('Set BOM warming already running');
  warmRunning = true;
  try {
    // Distinct set numbers the user holds in inventory
    const owned = await db.execute<{ setNum: string }>(sql`
      SELECT DISTINCT item_no AS "setNum"
      FROM bl_inventory
      WHERE org_id = ${orgId}
        AND item_type = 'SET'
        AND item_no IS NOT NULL
        AND COALESCE(is_stock_room, false) = false
    `);
    const ownedRows: Array<{ setNum: string }> = (owned as any).rows ?? owned ?? [];

    // Which already have a cached BOM
    const cached = await db.execute<{ setNum: string }>(sql`
      SELECT DISTINCT set_num AS "setNum" FROM set_part_relationships
    `);
    const cachedSet = new Set<string>(((cached as any).rows ?? cached ?? []).map((r: any) => r.setNum));

    // Try common Rebrickable suffix variations: "10221" → "10221-1"
    const toFetch = ownedRows
      .map(r => r.setNum)
      .filter(s => {
        if (cachedSet.has(s)) return false;
        // Also skip if any "<setNum>-N" variant is cached
        for (const c of cachedSet) {
          if (c === s || c.startsWith(`${s}-`)) return false;
        }
        return true;
      });

    console.log(`[SetBomWarm] ${ownedRows.length} owned sets, ${cachedSet.size} cached, ${toFetch.length} to fetch.`);

    const failed: WarmResult['failed'] = [];
    let fetched = 0;
    for (const setNum of toFetch) {
      // Most BL set numbers omit the Rebrickable "-1" suffix. Try both.
      const candidates = setNum.includes('-') ? [setNum] : [`${setNum}-1`, setNum];
      let ok = false;
      for (const cand of candidates) {
        try {
          await fetchAndCacheSetBom(cand);
          await resolveSetMinifigBlIds(cand);
          fetched++;
          ok = true;
          break;
        } catch (err: any) {
          if (err?.response?.status === 404) continue;
          failed.push({ setNum: cand, error: err?.message?.slice(0, 200) || 'fetch failed' });
          ok = true; // don't retry the next candidate on non-404 errors
          break;
        }
      }
      if (!ok) failed.push({ setNum, error: 'not found in Rebrickable (404 on all candidates)' });
      // Be polite to the API — short pause between sets
      await new Promise(r => setTimeout(r, 400));
    }

    return { ownedSets: ownedRows.length, alreadyCached: cachedSet.size, fetched, failed };
  } finally {
    warmRunning = false;
  }
}
