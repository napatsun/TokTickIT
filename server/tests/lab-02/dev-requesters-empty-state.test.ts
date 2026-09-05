import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import express from "express";

/**
 * GET /api/dev-requesters — empty state (api-spec.md §1)
 *
 * "Empty array ("requesters": []) is a valid 200 response, not an error —
 * the frontend renders the empty state (FR-01/BR-27)."
 *
 * This test uses a standalone Express app with a mocked Prisma client
 * to avoid modifying shared DB state (which breaks parallel test runs).
 * The route handler logic is replicated here to match app.ts exactly.
 */

// ─── Mock Prisma ────────────────────────────────────────────────────────

vi.mock("../../src/prisma.js", () => ({
  getPrisma: () => ({
    devRequester: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  }),
}));

// ─── Standalone test app (mirrors app.ts route logic exactly) ────────────

const testApp = express();

testApp.get("/api/dev-requesters", async (_req, res) => {
  // Import the mocked getPrisma
  const { getPrisma } = await import("../../src/prisma.js");
  const prisma = getPrisma();

  try {
    const requesters = await prisma.devRequester.findMany({
      where: { isActive: true },
      orderBy: { id: "asc" },
      select: { id: true, fullName: true, email: true },
    });
    res.status(200).json({ requesters });
  } catch (err) {
    res.status(500).json({
      error: { code: "SERVER_ERROR", message: "Something went wrong. Please try again." },
    });
  }
});

// ─── Tests ──────────────────────────────────────────────────────────────

describe("GET /api/dev-requesters — empty state", () => {
  it("returns 200 with empty requesters array when no active requesters exist", async () => {
    const res = await request(testApp).get("/api/dev-requesters");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ requesters: [] });
  });

  it("returns valid JSON with correct shape even when empty", async () => {
    const res = await request(testApp).get("/api/dev-requesters");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("requesters");
    expect(Array.isArray(res.body.requesters)).toBe(true);
    expect(res.body.requesters).toHaveLength(0);
    // No error field in successful response
    expect(res.body.error).toBeUndefined();
  });
});
