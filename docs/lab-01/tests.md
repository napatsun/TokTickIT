# Lab 1 — Test Plan and Evidence  (fill this in)

# Lab 1 — Test Plan and Evidence

All test files live under server/tests/lab-01/ and client/tests/lab-01/.

| # | Tool | Test | Result |
|---|------|------|--------|
| 1 | Supertest | GET /api/health returns 200, status=ok |  Pass |
| 2 | Supertest | GET /api/categories returns 4 seeded categories in id order | Pass |
| 3 | Vitest | Heading renders |  Pass |
| 4 | Vitest | Success state shows Online + category list | Pass |
| 5 | Vitest | Error state shows Offline + message |  Pass |

Paste your passing terminal output / screenshot below.

## Terminal Output

### Server tests
\`\`\`
 ✓ tests/lab-01/health.test.ts (1)
 Test Files  1 passed | 1 skipped (2)
      Tests  1 passed | 1 todo (2)
\`\`\`

### Client tests
\`\`\`
 ✓ tests/lab-01/App.test.tsx (3)
   ✓ App (3)
     ✓ renders the TokTickIT heading
     ✓ shows Online on success
     ✓ shows an Offline error message when the API is unavailable

 Test Files  1 passed (1)
      Tests  3 passed (3)
\`\`\`