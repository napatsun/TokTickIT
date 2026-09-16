# Lab 3 — Peer Review Record

## People

| Role | Name | Student ID | GitHub |
|---|---|---|---|
| Author | NAPATR KASEMWEERASAN | 67070501014 | [@napatsun](https://github.com/napatsun) |
| Peer reviewer 1 | KRITTAPHAT PANYASOMPHAN | 67070501052 | [@krittaphato3](https://github.com/krittaphato3) |
| Peer reviewer 2 | ALONGKORN KAEWPROM | 67070501050 | [@Alongkron1234](https://github.com/Alongkron1234) |

---

## Part 1 — Pull Requests I Authored (Reviewed by My Partners)

### PR #41 — `lab3/01-spec-contract-docs- #41`
🔗 https://github.com/napatsun/TokTickIT/pull/41

**Reviewer 1:** lab3/01-spec-contract-docs- #41

**Me:** ขอบคุณสำหรับคอมเมนต์ครับ

---

### PR #42 — `Feature/lab3-02-auth-and-authorization`
🔗 https://github.com/napatsun/TokTickIT/pull/42

**Reviewer 2:** จากที่ตรวจดูระบบ Auth ครบถ้วนเรียบร้อยดีครับ ผ่านน

**Me:** โอเคครับ คุณอลงกรณ์

---

### PR #43 — `Feature/lab3-03-requester-regression`
🔗 https://github.com/napatsun/TokTickIT/pull/43

**Reviewer 1:** Implement ตาม issue ดีมาก แต่ ผมเห็นว่า SEC-06 (ผู้แจ้งเรื่องต้องไม่สามารถเห็นบันทึกภายในหรือ Internal Notes) ถูกข้ามไปทำใน branch ของ Staff Ticketing ในระหว่างนี้ รบกวนช่วยตรวจสอบให้แน่ใจอีกครั้ง (double-check) ว่า endpoint GET /api/tickets/:ticketNumber (Ticket Detail) ไม่ได้เผลอดึง Internal Notes ติดไปด้วยใน Prisma query แม้ว่าทาง UI จะยังไม่ได้นำมาแสดงผลก็ตาม

**Reviewer 2:** โค้ดทุกอย่างโอเคดีมากครับ แต่ฝากไว้นิดนึงนะ ถ้าทำถึง IT Staff Detail อย่าลืมแยก Route ให้ IT Staff และ Admin สามารถอ่านและโพสต์ Public Comments บน Ticket นี้ได้ตาม BR-04 ด้วยนะครับ

**Me:** (ตอบกลับ Reviwer1) ผมไปลองเช็คดูเเล้วครับ ได้ตามนี้ครับ

InternalNote model ยังไม่มีอยู่จริงใน branch นี้เลย (schema.prisma:60
มีแค่คอมเมนต์ intentional-absence) grep ไม่เจอ model block
Query ของ GET /api/tickets/:ticketNumber allow-list เฉพาะ
requester/category/relatedSystem (ownership.ts:81-85) และ attachment
scalar fields 8 ตัว (app.ts:661-670) ไม่มี relation ไหนแตะข้อมูล
internal เลย ต่อให้เขียน include: { internalNotes: true } ก็ compile
ไม่ผ่านเพราะ schema ไม่มี field นี้
เพิ่ม regression test แล้ว (ticket-detail.api.test.ts:359-394) เช็คทั้ง
key ตรงๆ, recursive scan, และ raw JSON substring กันไว้ล่วงหน้าสำหรับ
ตอนที่ branch staff-ticketing เพิ่ม model จริง รัน 15/15 passed
แยก SEC-06 เป็น SEC-06a (guard นี้ Pass แล้ว) กับ SEC-06b (full cross-role
assertion ที่ต้องรอ InternalNote model ใน feature/lab3-04-staff-ticketing
ยัง Pending) ไว้ใน tests.md เพื่อไม่ให้เข้าใจผิดว่าเสร็จสมบูรณ์ทั้งหมด

**Me:** (ตอบกลับ Reviwer2) รับทราบครับ อยู่ใน scope ของ feature/lab3-04-staff-ticketingอยู่แล้ว
ตาม api-spec.md ครับ

**Me:** ถ้าเรียบร้อยเเล้ว merge ให้ได้เลยครับ

---

### PR #44 — `Feature/lab3-04-staff-ticketing`
🔗 https://github.com/napatsun/TokTickIT/pull/44


**Reviewer 1:** ทุกอย่างเรียบร้อยครับถ้วยดีนะครับ Implement ได้ถูกต้อง และก็มี artifacts ครบตามที่ สร้าง issue เอาไว้

**Me:** โอเคครับ ผมทำต่อเลยนะ

---

### PR #45 — `Feature/lab3-05-admin-users`
🔗 https://github.com/napatsun/TokTickIT/pull/45

**Reviewer 1:** PR นี้ครอบคลุม scope ของ Part 8 (Administrator User Management) ครบตามที่ Lab 3 กำหนด list/search/filter, create, edit, reset initial password, guard ทั้งสองข้อ (self-deactivation + last active admin), forbidden access สำหรับ non-Administrator, responsive UI และ safe error discipline

**Reviewer 2:** โดยรวมโค้ดดี ครอบคลุม spec ครบ guard self-deactivation + last-active-admin ใช้ SERIALIZABLE tx ป้องกัน race ได้ถูกต้อง, ไม่มี passwordHash หลุด, error message ไม่ leak ข้อมูล account

**Me:** ขอบคุณสำหรับคอมเมนต์ในการรีวิวครับ

---

### PR #46 — `Feature/lab3-06-UI-polish-and-a11y`
🔗 https://github.com/napatsun/TokTickIT/pull/46

**Reviewer 1:** ยอดเยี่ยมครับ ดู Implement UI ได้ตาม specs ดี และในส่วนอื่นๆก็ครบถ้วนดี แต่อาจจะมีในส่วนของไฟล์ StatusChangeConfirm.tsx ตรง const toLabel = STATUS_LABELS[to]; // เอา ?? to ออก
เวลาเพื่อนจะคอมเมนต์เตือนเรื่อง Safety ทันที: "ถ้า to ส่งค่าแปลกๆ มา toLabel จะกลายเป็น undefined ใน title นะ ควรใส่ fallback ไว้นะครับ ยังไงรบกวนแก้ก่อน และเดี๋ยว approve ให้นะครับ

**Me:** ตรวจสอบซักครู่นะครับ

**Me:** ได้ทำการเเก้ไขตามที่บอกเรียบร้อยครับ ขอบคุณสำหรับคอมเมนต์ครับ

**Reviewer 1:** เรียบร้อนครบถ้วนนะครับ

---

### PR #47 — `feature/lab3-07-e2e-and-release-evidence`
🔗 https://github.com/napatsun/TokTickIT/pull/47

**Reviewer 1:** เพื่อนซันๆ อย่าลืม reviewer.md นะ ทำใส่ไว้เลยจะได้ไม่ต้องมาสร้าง branch ใหม่เพิ่ม โอเคมั้ยครับ

**Reviewer 2:** มีเเค่ reviewer.md ที่ยังไม่เสร็จตามที่ @Alongkron1234 บอก นอกนั้นผ่านครับ

**Me:** เรียบร้อยครับ 


---

## Part 2 — Pull Requests I Reviewed for My Partners

### For ALONGKORN KAEWPROM — 67070501050 — [@Alongkron1234](https://github.com/Alongkron1234)

**1. PR #49** — https://github.com/Alongkron1234/toktickit/pull/49

- **My comment:** พบ 3 จุด ไม่มี catch block หรือการจัดการข้อผิดพลาด ถ้าหาก API ล้มเหลว ผู้ใช้จะไม่ได้รับข้อความแจ้งเตือน และสถานะการโหลดอาจค้างอยู่ ควรเพิ่ม try...catch และ state สำหรับแสดงข้อผิดพลาด เช่น priorityError, commentError, noteError เพื่อให้ผู้ใช้ทราบว่าเกิดอะไรขึ้นครับ ยังไงลองตรวจสอบอีกรอบนะครับ พร้อมทั้งลองตรวจดูจุดอื่นๆด้วยครับ (ไฟล์ client/src/components/StaffTicketDetail.tsx)

- **Partner's response:**  ตอนนี้ผมได้แก้ตามที่คุณบอกเรียบร้อยแล้วครับ
สิ่งที่ผมแก้ไป

เพิ่ม try...catch + error state ให้ handlePriorityChange, handlePostComment, handlePostNote ครบ (มี priorityError/commentError/noteError แสดงผลใน UI)
เพิ่ม handleUnauthorized ให้ fetchMembers, fetchComments, fetchNotes ครบทุกจุดที่ยิง API
เอา alert() ออกจาก handleDownload เปลี่ยนเป็น inline error UI แทน

- **My comment:** คิดว่าเรียบร้อยเเล้วครับ ไปต่อ feature ถัดไปได้เลย Approve

---

### For KRITTAPHAT PANYASOMPHAN — 67070501052 — [@krittaphato3](https://github.com/krittaphato3)

**1. PR #50** — https://github.com/krittaphato3/TokTickIT/pull/50

- **My comment:** รบกวนช่วยเช็ค test เพิ่มเติมนิดนึงครับ ว่าเคสที่เปลี่ยน owner + priority พร้อมกัน ,reopen โดยไม่มี reason และเรียก API ที่ไม่ได้รับอนุญาต ครอบคลุมยังครับ ยังไงบอกมาอีกทีนะครับ

- **Partner's response:** ได้ครับ เดี๋ยวลองเช็คให้นะครับ

- **Partner's response:** @napatsun เช็คครบแล้วครับ สรุปผลทั้ง 3 เคส (commit bed7649 ที่ push เพิ่มเข้า PR นี้):

1) เปลี่ยน owner + priority พร้อมกัน (combined ops pass)
เพิ่มเทสที่จำลอง "รอบทำงานเดียว" — claim (owner เปลี่ยน + IT Priority copy ตาม BR-13 ผ่าน itPriorityCopied: true) → แก้ IT Priority ต่อทันที → ปิดท้ายด้วย REOPENED พร้อม reason แล้ว assert ทั้งสาม write (owner, itPriority, status) persist ลง DB จริง พร้อมเทสเดิมที่แยกบทบาทสอง staff account ยืนยันว่า write ต่อเนื่องใน pass เดียวยังถูก gate ด้วย IT_STAFF ทุกจุด

2) reopen โดยไม่มี reason (BR-15)
เดิมเทสเฉพาะจาก RESOLVED — เพิ่มครบทุก source ที่ REOPENED ได้: RESOLVED, CLOSED, CANCELLED แต่ละเคส assert 400 details.field = reason พร้อมข้อความ A reason comment is required to reopen from <source>, เคส reason เป็น whitespace ล้วนก็ถูกปฏิเสธเหมือนกัน และ DB ไม่เปลี่ยน พร้อมเคส positive คู่กัน: ใส่ reason ถูกต้องแล้ว reopen สำเร็จจากทั้ง 3 source

3) เรียก API ที่ไม่ได้รับอนุญาต (§12/BR-20)
เดิมเทสกระจายเป็นจุด ๆ — รวมเป็น matrix เดียวใน staff-ticket-detail.api.test.ts ครอบคลุมทุก route ของ /api/staff/* (11 routes: list, owners, detail, comments GET/POST, notes GET/POST, owner, it-priority, status, attachment download):

REQUESTER → 403 ทุก route ยกเว้น internal-notes ที่เป็น masked 404 ตาม §1.5 และ body ไม่มี ticket number หลุด
ADMINISTRATOR → 403 บน write owner/it-priority/status (AD-02 view-only) และ DB ไม่เปลี่ยน — ส่วน comment/note ยังโพสต์ได้ 201 ตาม BR-04 (ทดสอบให้เห็นชัดว่าไม่ถูก block เกิน)
ไม่มี session → 401 ทุก route พร้อม assert ว่า body ไม่มี ticket number หลุดออกไป
ผลรัน: staff-ticket-detail.api.test.ts ผ่าน 65/65 เทส, ชุด lab-03 ทั้งหมด 153/153 ผ่าน อัปเดตแถวเอกสาร docs/lab-03/tests.md (T-OWN-01, T-STAT-01, T-STAT-02, T-AUTHZ-01) ให้ตรงกับ coverage ที่เพิ่มแล้วครับ

- **My comment:** เยี่ยมมากครับคุณโอโซน เรียบร้อยดีครับ

---