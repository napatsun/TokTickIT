# TokTickIT — IT Service Desk

TokTickIT คือระบบ IT service desk สำหรับจัดการ request 4 ประเภท: Account and Access, Hardware, Software, และ Network — พัฒนาครบ 4 Labs: โครงสร้างพื้นฐาน + ticketing ของ Requester (Lab 1–2), authentication/authorization + หน้าจอ IT Staff/Administrator (Lab 3), และ Actions Taken + ticket workflow + role dashboards (Lab 4)

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript + Vite + Bootstrap (SCSS theme) |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL + Prisma ORM |
| Testing | Vitest (frontend), Vitest + Supertest (backend), Playwright (E2E) |

## Project Structure

```
toktickit/
├── client/                          # React + Vite frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── layout/              #   AppShell (identity, role nav, logout), ShellSkeleton
│   │   │   ├── my-tickets/          #   FilterControls, TicketTable
│   │   │   ├── ticket-detail/       #   AttachmentSection, RemoveAttachmentConfirm,
│   │   │   │                        #   ContentThread (shared panel body),
│   │   │   │                        #   PublicCommentsPanel, InternalNotesPanel,
│   │   │   │                        #   StatusChangeConfirm, ActionsTakenPanel,
│   │   │   │                        #   TicketWorkflowControls
│   │   │   ├── RouteGuard.tsx       #   RequireAuth (mustChangePassword) + RequireRole
│   │   │   └── shared/              #   Badge, Button, Field, Pagination, SearchInput,
│   │                                #   AttachmentPicker, Dialog, ConfirmDialog
│   │   ├── contexts/                # AuthContext (session-backed identity)
│   │   ├── hooks/                   # useAuth hook
│   │   ├── lib/                     # apiClient (cookies + CSRF, global fetch wrapper)
│   │   ├── pages/                   #   Login, ChangePassword, MyTickets, CreateTicket,
│   │   │                            #   TicketDetail, StaffQueue, StaffTicketDetail,
│   │   │                            #   AdminUsers, StaffDashboard, RequesterDashboard
│   │   └── styles/                  # theme.scss (Zen Green design tokens)
│   ├── tests/
│   │   ├── lab-01/                  # unit tests โครงสร้างพื้นฐาน
│   │   ├── lab-02/                  # unit tests ticketing ฝั่ง Requester
│   │   ├── lab-03/                  # unit tests Login, ChangePassword, apiClient, AppShell,
│   │   │                            #   StaffTicketQueue, StaffTicketDetail, UserManagement
│   │   └── lab-04/                  # unit tests ActionsTaken, TicketWorkflow, StaffDashboard
│   └── package.json
├── server/                          # Express + TypeScript backend
│   ├── prisma/
│   │   ├── schema.prisma            # 9 models, 4 enums (เพิ่ม ActionTaken, TicketStatusHistory ใน Lab 4)
│   │   ├── seed.ts                  # seed users (roles), tickets, comments, notes, categories, systems
│   │   └── migrations/              # 7 migrations (ล่าสุด: add_action_taken_and_ticket_workflow_fields)
│   ├── src/
│   │   ├── lib/                     # ownership.ts (BR-41 access control), password.ts,
│   │   │                            #   content.ts, statusTransitions.ts (transition matrix),
│   │   │                            #   actionTaken.ts, ticketWorkflow.ts, dashboard.ts
│   │   ├── middleware/              # auth.ts (session/CSRF/role guard), requester-context.ts, upload.ts
│   │   ├── routes/                  # auth.ts, staff-tickets.ts, admin-users.ts,
│   │   │                            #   actions-taken.ts, ticket-workflow.ts, dashboard.ts
│   │   ├── services/               # ticket-number.ts, attachmentStorage.ts
│   │   ├── app.ts                   # Express routes (Requester + IT Staff + Admin + Lab 4 endpoints)
│   │   ├── index.ts                 # Server entry point
│   │   └── prisma.ts               # Prisma client singleton
│   ├── tests/
│   │   ├── helpers/                 # session.ts (cookie-jar login + CSRF for tests)
│   │   ├── lab-01/ … lab-03/        # regression suites (Lab 1–3)
│   │   └── lab-04/                  # actions-taken, ticket-workflow, staff/requester dashboard,
│   │                                #   migration (additive-only assertion)
│   └── package.json
├── docs/
│   ├── lab-01/ … lab-03/            # spec / api-spec / ui-spec / tests / ai-use / reviewer ของแต่ละ lab
│   └── lab-04/                      # specification.md, api-spec.md, ui-spec.md (§8 accessibility
│                                    #   checklist), tests.md (§8 KL-01), ai-use.md, reviewer.md
├── e2e/
│   ├── lab-03/                      # Playwright: authentication, requester + staff flow,
│   │                                #   user administration, responsive + screenshots
│   ├── lab-04/                      # Playwright: actions-taken flow, dashboards, ticket
│   │                                #   resolution, screenshot evidence (artifacts/lab-04/)
│   └── walkthrough/                 # Scripted Labs 1–3 regression walkthrough (รันแยก ไม่อยู่ใน suite)
├── artifacts/                       # Screenshot evidence (lab-03, lab-04) เก็บไว้เพื่อการส่งงาน
├── playwright.config.ts             # Repo-root E2E config (starts API + Vite, serial workers)
├── playwright.walkthrough.config.ts # Config สำหรับรัน regression walkthrough แบบ one-off
├── playwright.global-setup.ts       # prisma migrate reset + seed ก่อนทุกการรัน E2E
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
npm run prisma:migrate
```

migration จะสร้างตารางทั้งหมด (Category, RelatedSystem, User, Ticket, Attachment, PublicComment, InternalNote, **ActionTaken**, **TicketStatusHistory**) และ seed ข้อมูล:
- 4 categories: Account and Access, Hardware, Software, Network
- 6 related systems: Email, Campus Wi-Fi, VPN, Corporate Laptop, Printer, Grade Submission App
- Requester accounts 4 active + 1 inactive, IT Staff 3 active + 1 inactive, Administrator 1 active (ดูหัวข้อ Seed Credentials)
- Tickets กระจายตาม status / IT priority / owner (รวม ticket ที่ยังไม่ถูก assign และ ticket ที่มี Actions Taken entry ไว้ใช้สาธิต workflow ฝั่ง Lab 4)
- Public Comments / Internal Notes ตัวอย่าง (ไม่มีข้อมูลอ่อนไหว) — ผูกกับ ticket ที่ seed ไว้แบบ id คงที่ เพื่อให้ seed ซ้ำได้ (idempotent)

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
| Administrator | System Administrator | `admin@toktickit.example.com` | `Admin123!` | `false` (บัญชี operator ใช้ทดสอบได้ทันที) |
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
- `Robert Wilson` และ `Ethan Brooks` เป็นบัญชี inactive — ใช้ทดสอบว่า login ถูกปฏิเสธแบบ generic

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

## Demonstration Script (แนะนำสำหรับสาธิตระบบ)

ทำตามลำดับนี้เพื่อโชว์ครบทุก role และฟีเจอร์ที่สร้างใน Labs 1–4 (login ครั้งแรกของบัญชี seed จะถูกบังคับเปลี่ยนรหัสผ่านก่อน — BR-02):

1. **Requester** (`jennifer.anderson@example.com`) — เข้า My Tickets → Create Ticket ยื่น ticket ใหม่ → เปิด ticket ที่เพิ่งสร้าง โพสต์ comment → กลับไปดู **Dashboard** (เมนู Dashboard) จะเห็น metric cards และ ticket ใหม่ใน recent list
2. **IT Staff** (`alice.chen@toktickit.example.com`) — เปิด **Ticket Queue** เลือก ticket ที่ยังไม่มีเจ้าของ → กด **Claim** → ในแท็บ **Actions Taken** กด "+ Add Actions Taken" บันทึกงานที่ทำพร้อมผลลัพธ์ → ใช้ **status control** เปลี่ยนสถานะ New → Open → In Progress (Resolvable ต้องมี action ที่มี result ก่อน — BR-09) → เปิด **Dashboard** จะเห็น ticket ที่ทำงานล่าสุด
3. **Administrator** (`admin@toktickit.example.com`) — เข้า **User Management** (หน้า role home) → Create User สร้างบัญชีใหม่ → ค้นหาด้วย email → กด Edit แก้ชื่อ → ทดสอบ guard rules (self-deactivation / last active administrator ถูกบล็อก)

## Running Tests

**Backend tests (Vitest + Supertest):**
```bash
cd server
npm run test
```

**Frontend tests (Vitest + Testing Library):**
```bash
cd client
npm run test
```

**Type checker (ทั้งสองฝั่ง):**
```bash
cd server && npx tsc --noEmit
cd client && npx tsc --noEmit
```

**End-to-end tests (Playwright):**
```bash
# ครั้งแรก: ติดตั้ง dependency ของ root (ใช้เฉพาะ e2e)
npm install

npm run test:e2e
```

Playwright จะ **reset database ด้วย `prisma migrate reset --force --skip-seed` แล้ว seed ใหม่ทุกครั้ง** (playwright.global-setup.ts) จากนั้น start API (3000) + Vite (5173) ให้อัตโนมัติ — ต้องมี PostgreSQL รันอยู่ก่อน การรันแต่ละครั้งจึงเริ่มจากสถานะ seed บริสุทธิ์เสมอ

**Scripted regression walkthrough (Labs 1–3, รันแยกนอก suite):**
```bash
npx playwright test --config=playwright.walkthrough.config.ts
```

> **หมายเหตุความผันผวนของ server suite (KL-01):** server tests ทั้งหมดใช้ database เดียวกันร่วมกัน (ไม่มี per-suite isolation) — อาจเกิด failure แบบ intermittent เมื่อรันไฟล์ต่อกัน นโยบายคือ **re-run หนึ่งครั้งก่อนสืบสวน** รายละเอียดและแผนแก้ไขอยู่ใน `docs/lab-04/tests.md` §8 (KL-01)

### Test Coverage Summary

ตัวเลขด้านล่างมาจากการรันจริงบน branch `feature/lab4-07-final-hardening-regression`:

| Level | Files | Tests |
|-------|-------|-------|
| Backend (Vitest + Supertest) | 26 | 631 |
| Frontend (Vitest + Testing Library) | 19 | 389 (รวม 34 jest-axe scans, 0 violations) |
| End-to-end (Playwright) | 8 files | 47 (E2E-01…06 + RESP-01…05 + screenshot evidence) |
| Regression walkthrough (แยกนอก suite) | 1 | 5 (1 flow ต่อ role + keyboard + responsive) |
| **Grand Total** | **54** | **1072** |

`tsc --noEmit` ผ่านทั้ง server และ client และยืนยัน migration chain จาก database เปล่าด้วย `npx prisma migrate reset` ตามด้วย seed โดยไม่ต้องแก้ไขอะไรด้วยมือ

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
| GET | `/api/staff/owners` | รายชื่อ IT Staff/Administrator ที่ active (สำหรับ dropdown Reassign) |
| GET | `/api/staff/tickets` | Ticket Queue ของ IT Staff (search/filter/sort/paginate) |
| GET | `/api/staff/tickets/:id` | Ticket Detail (ฝั่ง IT Staff, เห็นทุก ticket ตาม shared queue) |
| POST | `/api/staff/tickets/:id/claim` | Claim ticket ที่ยังไม่มีเจ้าของ (409 ถ้ามีเจ้าของแล้ว) |
| POST | `/api/staff/tickets/:id/assign` | Reassign ticket ให้ IT Staff/Administrator ที่ active |
| PATCH | `/api/staff/tickets/:id/priority` | ตั้ง IT Priority (LOW/MEDIUM/HIGH/URGENT) — ไม่แตะ Requested Priority |
| PATCH | `/api/staff/tickets/:id/status` | เปลี่ยน status ตาม transition matrix (409 ถ้า transition ไม่อนุญาต) |
| GET/POST | `/api/staff/tickets/:id/comments` | Public Comments (ฝั่ง IT Staff/Administrator, ทุก ticket) |
| GET/POST | `/api/staff/tickets/:id/notes` | Internal Notes (IT Staff/Administrator เท่านั้น — Requester 403) |
| GET/POST | `/api/admin/users` | จัดการ users: list/search/filter และ create (Administrator เท่านั้น) |
| PATCH | `/api/admin/users/:id` | แก้ name/email/role/active (409 ป้องกัน self-deactivation / last admin) |
| POST | `/api/admin/users/:id/reset-password` | ตั้ง initial password ใหม่ + บังคับ `mustChangePassword = true` |
| POST | `/api/tickets/:ticketId/actions` | **สร้าง Actions Taken entry** (IT Staff/Administrator; idempotent per Idempotency-Key) |
| GET | `/api/tickets/:ticketId/actions` | รายการ Actions Taken เรียงเก่า → ใหม่ (Requester เห็นเฉพาะ ticket ตัวเอง) |
| PATCH | `/api/tickets/:ticketId/actions/:actionId` | แก้ไข / void entry ภายใน 15 นาที (BR-11 edit/void audit) |
| PATCH | `/api/tickets/:ticketId/status` | **เปลี่ยนสถานะด้วย optimistic locking** (`expectedVersion`; 409 STALE_VERSION) + เขียน `TicketStatusHistory` |
| POST | `/api/tickets/:ticketId/requester-confirmation` | Requester ยืนยัน "ดูเหมือนจะ resolved" (BR-08, advisory) |
| GET | `/api/dashboard/staff` | Dashboard ฝั่ง IT Staff/Administrator: counts + 24h deltas + recent tickets (BR-13 คำนวณสด ไม่ใช้ cache) |
| GET | `/api/dashboard/requester` | Dashboard ฝั่ง Requester: counts + recent tickets ของตัวเอง |

## หมายเหตุเพิ่มเติม

- ห้าม commit ไฟล์ `.env` เด็ดขาด — ใช้ `.env.example` เป็น template แทน
- ระบบใช้ **session cookie** (HTTP-only, `SameSite=Lax`, `Secure` ใน production) ร่วมกับ CSRF double-submit token — client ไม่เก็บ token ใด ๆ เอง
- ค่า `SESSION_SECRET` ตั้งได้ใน `server/.env` ถ้าไม่ตั้งจะใช้ค่า dev default (ห้ามใช้ default นี้ใน production)
- **ทุก endpoint ของ Requester** (`/api/tickets*`, `/api/attachments*`) กำหนดตัวตนจาก session เท่านั้น และบังคับ `role = REQUESTER` — ค่า `requesterId` ที่ส่งมาใน body จะถูก**เพิกเฉย** (BR-03, AC-03)
- การพัฒนางานทุกครั้งต้องทำบน feature branch แล้ว merge เข้า staging branch ก่อน
- ดูรายละเอียดเพิ่มเติมของ spec, test plan, AI usage reflection, และ peer review ได้ที่โฟลเดอร์ `docs/` — accessibility checklist พร้อมหลักฐานอยู่ที่ `docs/lab-04/ui-spec.md` §8 และ known limitation ของ server test harness อยู่ที่ `docs/lab-04/tests.md` §8 (KL-01)
- **Follow-up (นอกขอบเขต):** ควรเพิ่ม rate limiting ให้ `/api/auth/login` เพื่อกัน brute-force และเปลี่ยน in-memory session store เป็น persistent store ก่อนขึ้น production; ฝั่ง test harness ควรทำ per-file database isolation ตามแผนแก้ไขใน KL-01
