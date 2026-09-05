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
│   │   │   ├── layout/              #   AppShell (header, nav, requester badge)
│   │   │   ├── my-tickets/          #   FilterControls, TicketTable
│   │   │   ├── ticket-detail/       #   AttachmentSection, RemoveAttachmentConfirm
│   │   │   └── shared/              #   Badge, Button, Field, Pagination, SearchInput, AttachmentPicker
│   │   ├── contexts/                # RequesterContext (localStorage-backed)
│   │   ├── hooks/                   # useRequester hook
│   │   ├── lib/                     # apiClient (global fetch wrapper)
│   │   ├── pages/                   # SelectRequester, MyTickets, CreateTicket, TicketDetail
│   │   └── styles/                  # theme.scss (Zen Green)
│   ├── tests/
│   │   ├── lab-01/                  # 3 tests
│   │   └── lab-02/                  # 247 tests
│   └── package.json
├── server/                          # Express + TypeScript backend
│   ├── prisma/
│   │   ├── schema.prisma            # 6 models, 3 enums
│   │   ├── seed.ts                  # seed categories, systems, requesters
│   │   └── migrations/              # 3 migrations
│   ├── src/
│   │   ├── lib/                     # ownership.ts (BR-41 access control)
│   │   ├── middleware/              # requester-context.ts, upload.ts (Multer)
│   │   ├── services/               # ticket-number.ts, attachmentStorage.ts
│   │   ├── app.ts                   # Express routes (10+ endpoints)
│   │   ├── index.ts                 # Server entry point
│   │   └── prisma.ts               # Prisma client singleton
│   ├── tests/
│   │   ├── lab-01/                  # 8 tests
│   │   └── lab-02/                  # 165 tests
│   └── package.json
├── docs/
│   ├── lab-01/                      # ai_use.md, reviewer.md, tests.md
│   └── lab-02/                      # specification.md, api-spec.md, ui-spec.md, ai-use.md, reviewer.md, tests.md
├── e2e/                             # End-to-end test stubs
├── evidence/                        # Screenshots for submission
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

migration จะสร้างตารางทั้งหมด (Category, DevRequester, RelatedSystem, Ticket, Attachment) และ seed ข้อมูล:
- 4 categories: Account and Access, Hardware, Software, Network
- 6 related systems: Email, Campus Wi-Fi, VPN, Corporate Laptop, Printer, Grade Submission App
- 5 dev requesters: Jennifer Anderson, Sarah Johnson, Michael Brown, David Lee, Robert Wilson (inactive)

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

### Test Coverage Summary

| Level | Files | Tests |
|-------|-------|-------|
| Backend Unit | 2 | 19 |
| Backend API/Integration | 13 | 146 |
| Frontend UI Component | 15 | 238 |
| Frontend Integration | 2 | 6 |
| **Grand Total** | **32** | **409** |

## API Endpoints

| Method | Endpoint | คำอธิบาย |
|---|---|---|
| GET | `/api/health` | คืนสถานะของ backend |
| GET | `/api/categories` | คืนรายการ categories |
| GET | `/api/related-systems` | คืนรายการ related systems |
| GET | `/api/dev-requesters` | คืนรายการ requesters สำหรับ selector |
| POST | `/api/tickets` | สร้าง ticket ใหม่ (multipart/form-data) |
| GET | `/api/tickets` | คืนรายการ tickets (paginated, searchable, filterable) |
| GET | `/api/tickets/:ticketNumber` | คืน ticket detail พร้อม attachments |
| POST | `/api/tickets/:ticketNumber/attachments` | เพิ่ม attachments เข้า ticket |
| GET | `/api/attachments/:id` | คืน attachment metadata |
| GET | `/api/attachments/:id/download` | ดาวน์โหลด attachment |
| DELETE | `/api/attachments/:id` | ลบ attachment (soft-remove) |

## หมายเหตุเพิ่มเติม

- ห้าม commit ไฟล์ `.env` เด็ดขาด — ใช้ `.env.example` เป็น template แทน
- Lab 2 ใช้ `X-Dev-Requester-Id` header สำหรับ auth (stand-in สำหรับ real auth ใน Lab 3)
- การพัฒนางานทุกครั้งต้องทำบน feature branch แล้ว merge เข้า staging branch ก่อน
- ดูรายละเอียดเพิ่มเติมของ spec, test plan, AI usage reflection, และ peer review ได้ที่โฟลเดอร์ `docs/`
