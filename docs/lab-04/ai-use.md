# Lab 4 — AI Use and Reflection

**LLM/agent used:** Claude Sonnet 5's medium effort setting (Tool: claude.ai) & DeepSeek V4.1 Flash (Tool: FreeBuff)

## Selected key prompts (6–10)

| # | Prompt (summarised) | What I did with the result |
|---|---|---|
| 1 | แนบไฟล์โจทย์ Lab 4 (PDF) ให้ Claude อ่าน แล้วขอให้อธิบายขั้นตอนการทำ Lab แบบกระชับเป็นลำดับ | ได้ภาพรวมงานทั้งหมด (Spec DD → DB → Test DD → Issues → API → UI → Regression → เอกสารส่ง) ใช้เป็นแผนงานหลักของ sprint |
| 2 | ขอให้สร้าง `specification.md`, `tests.md`, `ui-spec.md`, `api-spec.md` แบบละเอียดพร้อมใช้งาน อิงจากเนื้อหาโจทย์ | ได้เอกสารครบ 4 ไฟล์ เเต่เมื่อลองตรวจสอบพบว่ายังผิดอยู่ เลยต้องแก้หลายๆจุดที่ผิดให้ตรงกับ codebase จริง |
| 3 | Prompt สำหรับ `lab4-03` (Actions Taken API) ระบุ error code, idempotency, authorization, tests และห้าม commit | Agent ถามกลับ 3 ข้อ: `fieldErrors` vs `details`, shared queue ของ IT Staff, และ idempotency window ผมเลือกตามเอกสารเดิม และพบว่าผมเขียนผิดเอง(สั่ง 60 วินาที ทั้งที่ spec กำหนด 5 วินาที) จึงแก้คำสั่งให้ยึดเอกสารเป็นหลัก |
| 4 | ให้ agent ใน session ใหม่ยืนยันด้วยหลักฐานจากไฟล์จริงว่า idempotency window = 5 วินาที และ field `requesterId` มีอยู่จริงใน schema | ได้ quote โค้ดและชื่อ test (API-14/14b) ยืนยันถูกต้อง จึงอนุมัติ commit ได้ ใช้วิธีนี้ซ้ำเพื่อไม่เชื่อ summary ของ agent โดยไม่ตรวจ |
| 5 | Prompt สำหรับ `lab4-05` (status transition matrix, resolution gate, optimistic concurrency, requester confirmation) และตอบคำถาม agent เรื่อง legacy endpoint, ปุ่ม "looks resolved" และ optimistic UI | เลือกให้ legacy endpoint ใช้ logic ใหม่และบังคับ `version` (กันการ bypass BR-09/BR-12) และเลือกตาม `ui-spec.md` ที่เขียนไว้ว่า badge ไม่ optimistic |
| 6 | Prompt สำหรับ `lab4-06` (Dashboards) และตอบคำถาม agent เรื่อง deltas, drill-down, ปุ่ม Create Ticket ของ staff, landing page | เลือกคำนวณ deltas สดจาก `TicketStatusHistory` (ไม่สร้าง snapshot table/job), ขยาย list endpoint แบบ additive เพื่อให้ drill-down filter ถูกต้อง, ตัดปุ่ม Create Ticket ฝั่ง staff ออก และคง landing page เดิม ต่อมาแก้ FilterControls regression และ assertion ผิดของ E2E ที่ agent รายงานมา |
| 7 | เปิด session ใหม่ให้ agent ทำ independent audit ก่อน commit (re-run test เอง, ตรวจ DoD, อ่าน diff ทุกไฟล์) โดยห้ามแก้ก่อนรายงาน | พบปัญหาของเอกสารที่รอบก่อนมองข้าม: `api-spec`/`ui-spec` ยังใช้ enum camelCase, `assignee=me` ตกค้าง, และ `tests.md` ระบุ Pass กับไฟล์ test ที่ไม่มีจริง จึงสั่งแก้ทั้งหมด (และเพิ่ม perf smoke test จริง) ก่อน commit |

## My Reflection

AI ทำให้งานเขียนโค้ดเร็วขึ้นมากๆ เเต่ก็ยังคงจะต้องตรวจสอบโค้ดเเละระบบต่างๆที่ agent สร้างมา ตรวจผลทุก branch รวมถึงเวลามี agent ส่งคำถามมาก็ต้องตัดสินใจเองให้ตรงกับสิ่งที่เราจะทำจริงๆไม่ใช่เชื่อตามที่ agent นั่งเดาขึ้นมาทั้งหมด เเละการสร้าง spec ให้ agent ได้ทำตาม ถ้าเราตรวจสอบให้ดี เเละมีความครอบคลุมชัดเจนทั้งหมด ก็จะทำให้ agent ทำผลลัพธ์ออกมาได้ดีตรงกับที่เราต้องการ