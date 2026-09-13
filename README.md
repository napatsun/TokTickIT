# TokTickIT — IT Service Desk

TokTickIT คือระบบ IT service desk สำหรับจัดการ request 4 ประเภท: Account and Access, Hardware, Software, และ Network

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript + Vite + Bootstrap |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL + Prisma ORM |
| Testing | Vitest (frontend), Vitest + Supertest (backend) |

## Project Structure

```
toktickit/
├── client/                          # React + Vite frontend
│   ├── src/
│   │   ├── components/              # Reusable UI components
│   │   │   ├── layout/              #   AppShell (identity, role nav, logout), ShellSkeleton
│   │   │   ├── my-tickets/          #   FilterControls, TicketTable
│   │   │   ├── ticket-detail/       #   AttachmentSection, RemoveAttachmentConfirm,
│   │   │   │                        #   PublicCommentsPanel, ResolveMarkConfirm
│   │   │   ├── RouteGuard.tsx       #   RequireAuth (mustChangePassword) + RequireRole
│   │   │   └── shared/              #   Badge, Button, Field, Pagination, SearchInput, AttachmentPicker
│   │   ├── contexts/                # AuthContext (session-backed identity)
│   │   ├── hooks/                   # useAuth hook
│   │   ├── lib/                     # apiClient (cookies + CSRF, global fetch wrapper)
│   │   ├── pages/                   # Login, ChangePassword, MyTickets, CreateTicket,
│   │   │                            #   TicketDetail, StaffQueue*, AdminUsers* (*stubs)
│   │   └── styles/                  # theme.scss (Zen Green)
│   ├── tests/
│   │   ├── lab-01/                  # 4 tests
│   │   ├── lab-02/                  # 184 tests (incl. Ticket Detail comments/resolve UI)
│   │   └── lab-03/                  # 36 tests (Login, ChangePassword, apiClient, AppShell)
│   └── package.json
├── server/                          # Express + TypeScript backend
│   ├── prisma/
│   │   ├── schema.prisma            # 6 models, 4 enums (DevRequester dropped in Lab 3)
│   │   ├── seed.ts                  # seed users (roles), tickets, comments, categories, systems
│   │   └── migrations/              # 5 migrations (incl. Lab 3 auth + requester regression)
│   ├── src/
│   │   ├── lib/                     # ownership.ts (BR-41 access control), password.ts
│   │   ├── middleware/              # auth.ts (session/CSRF/role guard), requester-context.ts, upload.ts
│   │   ├── routes/                  # auth.ts (login/logout/me/change-password)
│   │   ├── services/               # ticket-number.ts, attachmentStorage.ts
│   │   ├── app.ts                   # Express routes (10+ endpoints)
│   │   ├── index.ts                 # Server entry point
│   │   └── prisma.ts               # Prisma client singleton
│   ├── tests/
│   │   ├── helpers/                 # session.ts (cookie-jar login + CSRF for tests)
│   │   ├── lab-01/                  # 8 tests
│   │   ├── lab-02/                  # 150 tests (regression suite, now session-authenticated)
│   │   └── lab-03/                  # 98 tests (auth, authorization, comments, resolve-mark, migration)
│   └── package.json
├── docs/
│   ├── lab-01/                      # ai_use.md, reviewer.md, tests.md
│   ├── lab-02/                      # specification.md, api-spec.md, ui-spec.md, ai-use.md, reviewer.md, tests.md
│   └── lab-03/                      # specification.md, api-spec.md, ui-spec.md, tests.md, ai-use.md, reviewer.md
├── e2e/
│   ├── lab-02/requester-ticket-flow.spec.ts
│   └── lab-03/
│       ├── authentication.spec.ts     # Playwright: login, forced password change, role nav
│       └── staff-ticket-flow.spec.ts  # Playwright: Requester comment + appears-resolved flow
├── evidence/                        # Test/audit output kept for submission
├── playwright.config.ts             # Repo-root E2E config (starts API + Vite)
├── playwright.global-setup.ts       # Re-seeds the DB before an E2E run
├── package.json                     # Root tooling for the E2E suite only
└── README.md
```

## Prerequisites

- Node.js เวอร์ชัน 18 ขึ้นไป
- npm
- PostgreSQL ที่รันอยู่บนเครื่อง (local หรือผ่าน Docker)

## Setup Instructions

### 1. Clone repository

```bash
git clone <repository-url>
cd TokTickIT
```

### 2. เตรียม PostgreSQL

ตรวจสอบว่า PostgreSQL รันอยู่ แล้วสร้าง database:

```bash
createdb toktickit
```

(ถ้าใช้ Docker ให้ start container Postgres ด้วย `docker-compose up -d` หรือคำสั่งที่ตั้งไว้)

### 3. ตั้งค่า Environment Variables

**Server:**
```bash
cd server
cp .env.example .env
```

แก้ไข `server/.env` ให้ตรงกับ username/password ของ PostgreSQL:

```
DATABASE_URL="postgresql://<username>:<password>@localhost:5432/toktickit?schema=public"
PORT=3000
```

**Client:**
```bash
cd client
cp .env.example .env
```

```
VITE_API_URL="http://localhost:3000"
```

### 4. ติดตั้ง Dependencies

**Backend:**
```bash
cd server
npm install
```

**Frontend:**
```bash
cd client
npm install
```

### 5. รัน Prisma Migration + Seed

```bash
cd server
npx prisma migrate dev
```

migration จะสร้างตารางทั้งหมด (Category, RelatedSystem, User, Ticket, Attachment, PublicComment) และ seed ข้อมูล:
- 4 categories: Account and Access, Hardware, Software, Network
- 6 related systems: Email, Campus Wi-Fi, VPN, Corporate Laptop, Printer, Grade Submission App
- Requester accounts 4 active + 1 inactive, IT Staff 3 active + 1 inactive, Administrator 1 active (ดูหัวข้อ Seed Credentials)
- Tickets กระจายตาม status / IT priority / owner (รวม ticket ที่ยังไม่ถูก assign)
- Public Comments ตัวอย่าง (ไม่มีข้อมูลอ่อนไหว) — ผูกกับ ticket ที่ seed ไว้แบบ id คงที่ เพื่อให้ seed ซ้ำได้ (idempotent)

รัน seed ซ้ำได้ (idempotent) — จะไม่สร้างข้อมูลซ้ำ แต่จะ reset รหัสผ่านของบัญชี seed กลับเป็นค่า default:

```bash
cd server
npm run prisma:seed
```

### Seed Credentials (local dev only)

> **LOCAL DEVELOPMENT ONLY — ห้ามใช้กับ production และห้ามใช้เป็นรหัสผ่านจริง**
> รหัสผ่านเหล่านี้ถูก hash ด้วย bcrypt (ไม่เก็บ plaintext) และถูก commit ได้เพราะเป็นค่า dev ที่ตั้งใจให้ทุกคนรู้

บัญชีทั้งหมดถูก seed ด้วย `mustChangePassword` ตามตารางนี้:

| Role | Name | Email | Password | mustChangePassword |
|---|---|---|---|---|
| Administrator | System Administrator | `admin@toktickit.example.com` | `Admin123!` | `false` (bัญชี operator ใช้ทดสอบได้ทันที) |
| Requester | Jennifer Anderson | `jennifer.anderson@example.com` | `Password123!` | `true` |
| Requester | Sarah Johnson | `sarah.johnson@example.com` | `Password123!` | `true` |
| Requester | Michael Brown | `michael.brown@example.com` | `Password123!` | `true` |
| Requester | David Lee | `david.lee@example.com` | `Password123!` | `true` |
| Requester (inactive) | Robert Wilson | `robert.wilson@example.com` | `Password123!` | `true` |
| IT Staff | Alice Chen | `alice.chen@toktickit.example.com` | `Password123!` | `true` |
| IT Staff | Ben Carter | `ben.carter@toktickit.example.com` | `Password123!` | `true` |
| IT Staff | Priya Nair | `priya.nair@toktickit.example.com` | `Password123!` | `true` |
| IT Staff (inactive) | Ethan Brooks | `ethan.brooks@toktickit.example.com` | `Password123!` | `true` |

- บัญชีที่มี `mustChangePassword = true` จะถูกบังคับให้เปลี่ยนรหัสผ่านก่อนเข้าหน้าอื่น ๆ (BR-02)
- `Robert Wilson` และ `Ethan Brooks` เป็นบัญชี inactive — ใช้ทดสอบว่า login ถูกปฏิเสธแบบ generic (BR-09)

### 6. Start Backend Server

```bash
cd server
npm run dev
```

Backend จะรันที่: `http://localhost:3000`

### 7. Start Frontend

เปิด terminal ใหม่:

```bash
cd client
npm run dev
```

Frontend จะรันที่: `http://localhost:5173`

## Running Tests

**Backend tests (Vitest + Supertest):**
```bash
cd server
npm run test
```

**Frontend tests (Vitest):**
```bash
cd client
npm run test
```

**End-to-end tests (Playwright):**
```bash
# ครั้งแรก: ติดตั้ง dependency ของ root (ใช้เฉพาะ e2e)
npm install

npm run test:e2e
```
Playwright จะ seed database ใหม่แล้ว start API (3000) + Vite (5173) ให้อัตโนมัติ ต้องมี PostgreSQL รันอยู่ก่อน

### Test Coverage Summary

ตัวเลขด้านล่างมาจากการรันจริงบนเครื่อง dev (`npm test` ทั้ง server/client และ `npm run test:e2e`):

| Level | Files | Tests |
|-------|-------|-------|
| Backend (Vitest + Supertest) | 18 | 256 (248 passed, 8 skipped placeholders สำหรับ branch ถัดไป) |
| Frontend (Vitest + Testing Library) | 13 | 224 |
| End-to-end (Playwright) | 2 | 8 |
| **Grand Total** | **33** | **488** |

## API Endpoints

| Method | Endpoint | คำอธิบาย |
|---|---|---|
| POST | `/api/auth/login` | Login ด้วย email + password, set session cookie (`sid`) + CSRF cookie |
| POST | `/api/auth/logout` | ออกจากระบบ, ทำลาย session (ต้องมี CSRF token) |
| GET | `/api/auth/me` | คืนข้อมูลผู้ใช้ปัจจุบัน (ไม่รวม `passwordHash`) |
| POST | `/api/auth/change-password` | ตั้งรหัสผ่านใหม่ + ล้าง `mustChangePassword` |
| GET | `/api/health` | คืนสถานะของ backend |
| GET | `/api/categories` | คืนรายการ categories |
| GET | `/api/related-systems` | คืนรายการ related systems |
| POST | `/api/tickets` | สร้าง ticket ใหม่ (multipart/form-data) |
| GET | `/api/tickets` | คืนรายการ tickets (paginated, searchable, filterable) |
| GET | `/api/tickets/:ticketNumber` | คืน ticket detail พร้อม attachments |
| POST | `/api/tickets/:ticketNumber/comments` | เพิ่ม Public Comment (Requester, เฉพาะ ticket ของตัวเอง) |
| GET | `/api/tickets/:ticketNumber/comments` | รายการ Public Comments เรียงเก่า → ใหม่ |
| POST | `/api/tickets/:ticketNumber/resolve-mark` | แจ้ง "Problem Appears Resolved" โดยไม่เปลี่ยน `status` |
| POST | `/api/tickets/:ticketNumber/attachments` | เพิ่ม attachments เข้า ticket |
| GET | `/api/attachments/:id` | คืน attachment metadata |
| GET | `/api/attachments/:id/download` | ดาวน์โหลด attachment |
| DELETE | `/api/attachments/:id` | ลบ attachment (soft-remove) |

## หมายเหตุเพิ่มเติม

- ห้าม commit ไฟล์ `.env` เด็ดขาด — ใช้ `.env.example` เป็น template แทน
- Lab 3 ใช้ **session cookie** (HTTP-only, `SameSite=Lax`, `Secure` ใน production) ร่วมกับ CSRF double-submit token — client ไม่เก็บ token ใด ๆ เอง
- ค่า `SESSION_SECRET` ตั้งได้ใน `server/.env` ถ้าไม่ตั้งจะใช้ค่า dev default (ห้ามใช้ default นี้ใน production)
- **ทุก endpoint ของ Requester** (`/api/tickets*`, `/api/attachments*`) กำหนดตัวตนจาก session เท่านั้น และบังคับ `role = REQUESTER` — ค่า `requesterId` ที่ส่งมาใน body จะถูก**เพิกเฉย** (BR-03, AC-03)
- โหมด bridge เดิม (`X-Dev-Requester-Id` header + ตาราง `DevRequester` + `GET /api/dev-requesters`) ถูก**ลบออกทั้งหมด**แล้วใน branch นี้ ตาม MIG-02/§7.2 step 5
- การพัฒนางานทุกครั้งต้องทำบน feature branch แล้ว merge เข้า staging branch ก่อน
- ดูรายละเอียดเพิ่มเติมของ spec, test plan, AI usage reflection, และ peer review ได้ที่โฟลเดอร์ `docs/`
- **Follow-up (นอกขอบเขต Lab 3):** ควรเพิ่ม rate limiting ให้ `/api/auth/login` เพื่อกัน brute-force (api-spec.md §6) และเปลี่ยน in-memory session store เป็น persistent store ก่อนขึ้น production
