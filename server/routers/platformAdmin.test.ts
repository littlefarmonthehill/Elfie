import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import test from "node:test";
import express, { type Router } from "express";
import { eq, inArray, sql } from "drizzle-orm";
import {
  orderDetails,
  orderSplits,
  orders,
  shipstationDuplicateOrderArchives,
} from "@shared/schema";

const CLEANUP_PATH = "/platform-admin/cleanup-shipstation-duplicate-orders";

type Fixture = {
  prefix: string;
  duplicateId: string;
  canonicalId: string;
  detailOrderIds: string[];
  extraOrderIds: string[];
  splitIds: string[];
};

type ApiResponse = {
  status: number;
  body: any;
};

type Database = typeof import("../db").db;

let server: Server;
let baseUrl: string;
let database: Database;
let platformAdminRouter: Router;

function getTestDatabaseUrl(): string {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "TEST_DATABASE_URL is required for database integration tests; refusing to use DATABASE_URL.",
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
  if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol)) {
    throw new Error("TEST_DATABASE_URL must use the postgres or postgresql protocol.");
  }

  const databaseName = parsedUrl.pathname.split("/").filter(Boolean).at(-1) ?? "";
  if (!/(^|[-_])test([_-]|$)/i.test(databaseName)) {
    throw new Error(
      "TEST_DATABASE_URL must point to a database with 'test' as a distinct name segment.",
    );
  }

  return databaseUrl;
}

test.before(async () => {
  process.env.DATABASE_URL = getTestDatabaseUrl();
  const dbModule = await import("../db");
  await dbModule.runMigrations();
  database = dbModule.db;
  platformAdminRouter = (await import("./platformAdmin")).default;

  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = {
      id: "shipstation-archive-test-admin",
      email: "shipstation-archive-tests@example.invalid",
      superAdmin: true,
    };
    req.isAuthenticated = () => true;
    next();
  });
  app.use("/api", platformAdminRouter);
  app.use((error: any, _req: any, res: any, _next: any) => {
    res.status(500).json({ message: error?.message ?? "Unexpected test server error" });
  });

  server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}/api`;
});

test.after(async () => {
  if (server) {
    server.close();
    await once(server, "close");
  }
});

async function request(path: string, init: RequestInit = {}): Promise<ApiResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json();
  return { status: response.status, body };
}

async function createFixture(options: {
  split?: boolean;
  reusedNumber?: boolean;
} = {}): Promise<Fixture> {
  const prefix = `__shipstation_archive_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const duplicateId = `${prefix}_duplicate`;
  const canonicalId = `bl-${prefix}`;
  const orderNumber = `BL.${prefix}`;
  const canonicalOrderNumber = `BL-${prefix}`;
  const orderDate = new Date("2026-01-02T03:04:05.000Z");
  const orgId = `${prefix}_org`;
  const commonOrder = {
    marketplace: "BrickLink",
    orderDate,
    orderStatus: "PAID",
    shipTo: "Test recipient",
    orderTotal: "18.50",
    orgId,
    isTest: true,
    internalNotes: "ShipStation duplicate archive integration-test fixture",
  };

  await database.insert(orders).values([
    {
      ...commonOrder,
      id: duplicateId,
      orderNumber,
      orderKey: `${prefix}-source-order`,
    },
    {
      ...commonOrder,
      id: canonicalId,
      orderNumber: canonicalOrderNumber,
      orderKey: `${prefix}-source-order`,
    },
  ]);

  await database.insert(orderDetails).values({
    orderId: duplicateId,
    name: "Test line retained in archive",
    quantity: 2,
    unitPrice: "9.25",
    description: "Fixture detail",
  });

  const extraOrderIds: string[] = [];
  if (options.reusedNumber) {
    const reusedId = `${prefix}_reused_number`;
    await database.insert(orders).values({
      ...commonOrder,
      id: reusedId,
      orderNumber,
      orderKey: `${prefix}-reused-source-order`,
    });
    extraOrderIds.push(reusedId);
  }

  const splitIds: string[] = [];
  if (options.split) {
    const splitId = `${prefix}_split`;
    await database.insert(orderSplits).values({
      parentOrderId: duplicateId,
      splitOrderId: splitId,
      splitSuffix: "-1",
      reason: "Archive integration-test fixture",
    });
    splitIds.push(splitId);
  }

  return {
    prefix,
    duplicateId,
    canonicalId,
    detailOrderIds: [duplicateId],
    extraOrderIds,
    splitIds,
  };
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  const orderIds = [fixture.duplicateId, fixture.canonicalId, ...fixture.extraOrderIds];
  await database.execute(sql`
    DELETE FROM shipstation_duplicate_order_archives
    WHERE candidate_key LIKE ${`${fixture.duplicateId}:%`}
  `);
  if (fixture.splitIds.length > 0) {
    await database.delete(orderSplits).where(inArray(orderSplits.id, fixture.splitIds));
  }
  await database.delete(orderDetails).where(inArray(orderDetails.orderId, orderIds));
  await database.delete(orders).where(inArray(orders.id, orderIds));
}

async function getCandidate(fixture: Fixture): Promise<any> {
  const response = await request(CLEANUP_PATH, { method: "POST" });
  assert.equal(response.status, 200);
  const candidateKey = `${fixture.duplicateId}:${fixture.canonicalId}`;
  const candidate = response.body.candidates.find((item: any) => item.candidateKey === candidateKey);
  assert.ok(candidate, `Expected candidate ${candidateKey}`);
  return candidate;
}

test("rejects the legacy bulk confirm path without deleting orders or line items", async (t) => {
  const fixture = await createFixture();
  t.after(() => cleanupFixture(fixture));

  const response = await request(`${CLEANUP_PATH}?confirm=true`, { method: "POST" });
  assert.equal(response.status, 400);
  assert.match(response.body.message, /Bulk deletion is no longer permitted/);

  const orderRows = await database
    .select({ id: orders.id })
    .from(orders)
    .where(inArray(orders.id, [fixture.duplicateId, fixture.canonicalId]));
  const detailRows = await database
    .select({ id: orderDetails.id })
    .from(orderDetails)
    .where(eq(orderDetails.orderId, fixture.duplicateId));
  assert.deepEqual(orderRows.map((row) => row.id).sort(), [fixture.canonicalId, fixture.duplicateId].sort());
  assert.equal(detailRows.length, 1);
});

test("archives one verified candidate and retrieves immutable order and detail snapshots", async (t) => {
  const fixture = await createFixture();
  t.after(() => cleanupFixture(fixture));

  const candidate = await getCandidate(fixture);
  assert.equal(candidate.comparison.isSafe, true);
  const archiveResponse = await request(`${CLEANUP_PATH}/archive`, {
    method: "POST",
    body: JSON.stringify({
      candidateKey: candidate.candidateKey,
      expectedCandidateHash: candidate.candidateHash,
      reviewReason: "Verified against the original ShipStation evidence",
    }),
  });
  assert.equal(archiveResponse.status, 200);
  assert.equal(archiveResponse.body.candidateKey, candidate.candidateKey);

  const archiveRows = await database
    .select()
    .from(shipstationDuplicateOrderArchives)
    .where(eq(shipstationDuplicateOrderArchives.candidateKey, candidate.candidateKey));
  assert.equal(archiveRows.length, 1);
  assert.equal(archiveRows[0].duplicateOrderId, fixture.duplicateId);
  assert.equal(archiveRows[0].canonicalOrderId, fixture.canonicalId);
  assert.equal(archiveRows[0].reviewReason, "Verified against the original ShipStation evidence");

  await database
    .update(orders)
    .set({ internalNotes: "Changed after the review" })
    .where(eq(orders.id, fixture.duplicateId));
  await database
    .update(orderDetails)
    .set({ description: "Changed after the review" })
    .where(eq(orderDetails.orderId, fixture.duplicateId));

  const archivesResponse = await request(`${CLEANUP_PATH}/archives`);
  assert.equal(archivesResponse.status, 200);
  const archive = archivesResponse.body.archives.find(
    (item: any) => item.candidateKey === candidate.candidateKey,
  );
  assert.ok(archive);
  assert.equal(archive.duplicateSnapshot.id, fixture.duplicateId);
  assert.equal(archive.duplicateSnapshot.internal_notes, null);
  assert.equal(archive.duplicateDetailsSnapshot[0].description, "Fixture detail");
  assert.equal(archive.comparisonSnapshot.isSafe, true);

  const retainedOrder = await database
    .select({ id: orders.id, internalNotes: orders.internalNotes })
    .from(orders)
    .where(eq(orders.id, fixture.duplicateId));
  const retainedDetail = await database
    .select({ description: orderDetails.description })
    .from(orderDetails)
    .where(eq(orderDetails.orderId, fixture.duplicateId));
  assert.deepEqual(retainedOrder, [{ id: fixture.duplicateId, internalNotes: "Changed after the review" }]);
  assert.deepEqual(retainedDetail, [{ description: "Changed after the review" }]);
});

test("rejects an archive request with a stale candidate hash", async (t) => {
  const fixture = await createFixture();
  t.after(() => cleanupFixture(fixture));

  const candidate = await getCandidate(fixture);
  await database
    .update(orders)
    .set({ internalNotes: "Concurrent review changed the evidence" })
    .where(eq(orders.id, fixture.duplicateId));

  const response = await request(`${CLEANUP_PATH}/archive`, {
    method: "POST",
    body: JSON.stringify({
      candidateKey: candidate.candidateKey,
      expectedCandidateHash: candidate.candidateHash,
    }),
  });
  assert.equal(response.status, 409);
  assert.match(response.body.message, /candidate changed since it was reviewed/i);

  const archives = await database
    .select({ id: shipstationDuplicateOrderArchives.id })
    .from(shipstationDuplicateOrderArchives)
    .where(eq(shipstationDuplicateOrderArchives.candidateKey, candidate.candidateKey));
  assert.equal(archives.length, 0);
  const retainedOrders = await database
    .select({ id: orders.id })
    .from(orders)
    .where(inArray(orders.id, [fixture.duplicateId, fixture.canonicalId]));
  assert.equal(retainedOrders.length, 2);
});

test("refuses split and reused-number candidates without creating archives", async (t) => {
  const splitFixture = await createFixture({ split: true });
  const reusedFixture = await createFixture({ reusedNumber: true });
  t.after(async () => {
    await cleanupFixture(splitFixture);
    await cleanupFixture(reusedFixture);
  });

  for (const fixture of [splitFixture, reusedFixture]) {
    const candidate = await getCandidate(fixture);
    assert.equal(candidate.comparison.isSafe, false);

    const response = await request(`${CLEANUP_PATH}/archive`, {
      method: "POST",
      body: JSON.stringify({
        candidateKey: candidate.candidateKey,
        expectedCandidateHash: candidate.candidateHash,
      }),
    });
    assert.equal(response.status, 400);
    assert.match(response.body.message, /ambiguous/i);
    assert.equal(response.body.reasons.length, 1);
  }

  const archives = await database
    .select({ candidateKey: shipstationDuplicateOrderArchives.candidateKey })
    .from(shipstationDuplicateOrderArchives)
    .where(sql`candidate_key LIKE ${`${splitFixture.duplicateId}:%`} OR candidate_key LIKE ${`${reusedFixture.duplicateId}:%`}`);
  assert.equal(archives.length, 0);
});