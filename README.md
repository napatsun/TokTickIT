# TokTickIT — IT Service Desk (Lab 1: Full-Stack Hello World Starter)

TokTickIT คือระบบ IT service desk สำหรับจัดการ request 4 ประเภท: Account and Access, Hardware, Software, และ Network

Lab 1 นี้เป็น vertical slice เล็กๆ ที่พิสูจน์ว่า tech stack ทั้งระบบทำงานร่วมกันได้จริง:

**React UI → Express REST API → Prisma ORM → PostgreSQL**

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
├── client/                      # React + Vite frontend
│   ├── src/
│   │   ├── api.ts               # ฟังก์ชันเรียก backend API
│   │   ├── App.tsx              # Main component + Check System button
│   │   └── main.tsx
│   ├── tests/
│   │   └── lab-01/
│   │       └── App.test.tsx
│   ├── index.html
│   ├── vite.config.ts
│   ├── .env.example
│   └── package.json
├── server/                      # Express + TypeScript backend
│   ├── prisma/
│   │   ├── schema.prisma        # Category model
│   │   └── seed.ts              # seed 4 categories
│   ├── src/
│   │   ├── app.ts               # Express app + routes
│   │   ├── index.ts             # server entry point
│   │   └── prisma.ts            # Prisma client instance
│   ├── tests/
│   │   └── lab-01/
│   │       ├── health.test.ts
│   │       └── categories.test.ts
│   ├── vitest.config.ts
│   ├── .env.example
│   └── package.json
├── docs/
│   └── lab-01/
│       ├── ai_use.md            # AI usage & reflection
│       ├── reviewer.md          # peer review record
│       └── tests.md             # test documentation
├── .gitignore
└── README.md
```

## Prerequisites (สิ่งที่ต้องมีก่อนเริ่ม)

- Node.js เวอร์ชัน 18 ขึ้นไป
- npm
- PostgreSQL ที่รันอยู่บนเครื่อง (local หรือผ่าน Docker ก็ได้)

## Setup Instructions (วิธีติดตั้งและรัน)

### 1. Clone repository

```bash
git clone <repository-url>
cd toktickit
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

แก้ไข `server/.env` ให้ตรงกับ username/password ของ PostgreSQL ที่มี:

```
DATABASE_URL="postgresql://<username>:<password>@localhost:5432/toktickit?schema=public"
```

**Client (ถ้าจำเป็น):**
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

migration จะสร้างตาราง `Category` และ seed ข้อมูล 4 categories ให้อัตโนมัติ (Account and Access, Hardware, Software, Network)

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

เปิด browser ไปที่ `http://localhost:5173` แล้วกดปุ่ม **[Check System]** เพื่อดู backend status และ category list

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

## API Endpoints

| Method | Endpoint | คำอธิบาย |
|---|---|---|
| GET | `/api/health` | คืนสถานะของ backend (status = ok) |
| GET | `/api/categories` | คืนรายการ 4 categories จาก PostgreSQL |

## หมายเหตุเพิ่มเติม

- ห้าม commit ไฟล์ `.env` เด็ดขาด — ใช้ `.env.example` เป็น template แทน
- การพัฒนางานทุกครั้งต้องทำบน feature branch แล้ว merge เข้า `lab1-staging` ก่อน จากนั้นค่อย merge เข้า `main`
- ดูรายละเอียดเพิ่มเติมของ test, AI usage reflection, และ peer review ได้ที่โฟลเดอร์ `docs/lab-01/`