import express, { Request, Response } from "express";
import cors from "cors";
import { getPrisma } from "./prisma.js";

// The Express app is exported separately from app.listen() (see index.ts) so
// Supertest can import `app` without opening a port. Do not merge these files.
export const app = express();

app.use(cors());          // already wired: lets the Vite dev server call this API
app.use(express.json());

app.get("/api/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'TokTickIT API',
  });
});


app.get('/api/categories', async (req, res) => {
  try {
    const prisma = getPrisma();
    const categories = await prisma.category.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, name: true },
    });
    res.status(200).json(categories);
  } catch (err) {
    res.status(500).json({ error: 'Unable to fetch categories' });
  }
});

// ─── GET /api/dev-requesters ─────────────────────────────
// §1 API Contract: active Requesters for the Selection screen.
// No auth header required — this is the one endpoint reachable
// before a Requester is selected (api-spec §1).
// Returns only isActive=true rows (BR-02).
app.get('/api/dev-requesters', async (_req, res) => {
  try {
    const prisma = getPrisma();
    const requesters = await prisma.devRequester.findMany({
      where: { isActive: true },
      orderBy: { id: 'asc' },
      select: { id: true, fullName: true, email: true },
    });
    res.status(200).json({ requesters });
  } catch (err) {
    res.status(500).json({
      error: { code: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' },
    });
  }
});

export default app;
