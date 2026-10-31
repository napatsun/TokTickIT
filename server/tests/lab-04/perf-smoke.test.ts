import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { seed } from "../../prisma/seed.js";
import {
  createTestUser,
  loginAs,
  cleanupTestUsers,
  type SessionClient,
  type TestUser,
} from "../helpers/session.js";

const prisma = getPrisma();

/**
 * PERF-01 — dashboard endpoints respond under a load-free baseline
 * (tests.md §5, handout §6.2: performance smoke, not a load test).
 *
 * Measures the wall-clock time of `GET /api/dashboard/staff` and
 * `GET /api/dashboard/requester` against the shared seeded dataset and asserts
 * each answers `200` inside the documented 300 ms budget. The bound is
 * deliberately generous: the suite runs on shared hardware against a live
 * PostgreSQL instance, so this catches gross regressions (e.g. a full Ticket
 * collection leaking into the response path in violation of FR-13/BR-13), not
 * absolute latency. A warm-up request in `beforeAll` pays the one-off
 * Prisma-connection and route-compilation cost so the timed calls measure
 * steady-state behavior.
 *
 * Conventions match the other Lab 4 suites: real login sessions through
 * /api/auth/login (helpers/session.ts), the shared idempotent seed as the
 * baseline, and `prisma.$disconnect()` in `afterAll` (KL-01 harness).
 */

const PERF_BUDGET_MS = 300;

let staff: TestUser;
let requester: TestUser;
let staffClient: SessionClient;
let requesterClient: SessionClient;

beforeAll(async () => {
  await seed();

  staff = await createTestUser({ name: "Perf Smoke Staff", role: "IT_STAFF" });
  requester = await createTestUser({ name: "Perf Smoke Requester" });
  staffClient = await loginAs(app, staff.email);
  requesterClient = await loginAs(app, requester.email);

  // Warm-up: pay connection/route setup once so the timed calls below are steady-state.
  await staffClient.agent.get("/api/dashboard/staff").expect(200);
  await requesterClient.agent.get("/api/dashboard/requester").expect(200);
});

afterAll(async () => {
  await cleanupTestUsers([staff.id, requester.id]);
  await prisma.$disconnect();
});

describe("PERF-01 — dashboard response-time smoke (<300 ms, handout §6.2)", () => {
  it("GET /api/dashboard/staff answers 200 within the budget", async () => {
    const started = Date.now();
    const res = await staffClient.agent.get("/api/dashboard/staff");
    const elapsed = Date.now() - started;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(PERF_BUDGET_MS);
  });

  it("GET /api/dashboard/requester answers 200 within the budget", async () => {
    const started = Date.now();
    const res = await requesterClient.agent.get("/api/dashboard/requester");
    const elapsed = Date.now() - started;

    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(PERF_BUDGET_MS);
  });
});
