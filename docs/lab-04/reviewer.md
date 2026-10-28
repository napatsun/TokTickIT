# Lab 4 — Peer Review Record

## People

| Role | Name | Student ID | GitHub |
|---|---|---|---|
| Author | NAPATR KASEMWEERASAN | 67070501014 | [@napatsun](https://github.com/napatsun) |
| Peer reviewer 1 | KRITTAPHAT PANYASOMPHAN | 67070501052 | [@krittaphato3](https://github.com/krittaphato3) |
| Peer reviewer 2 | ALONGKORN KAEWPROM | 67070501050 | [@Alongkron1234](https://github.com/Alongkron1234) |

---

## Part 1 — Pull Requests I Authored (Reviewed by My Partners)

### PR #57 — `feature/lab4-01-spec-docs-setup`
🔗 https://github.com/napatsun/TokTickIT/pull/57

**Reviewer 2:** เขียน spec ออกมาได้ยอดเยี่ยมมากครับ

**Me:** ถ้าผ่านเเล้ว merge ให้กระผมได้เลยครับ

**สถานะ:** Approved by Reviewer 2 — Merged into `lab4-staging`

---

### PR #58 — `feature/lab4-02-db-migration-actions`
🔗 https://github.com/napatsun/TokTickIT/pull/58

**Reviewer 2:** ตรวจโค้ดรียบร้อยครับ
ActionTaken, TicketStatusHistory และ 4 ฟิลด์ใหม่เรียบร้อยดี มี Rollback Plan ชัดเจน
ส่วน Seed เป็น Idempotent ครอบคลุม edge cases และ Test Suite ผ่านๆๆ

**Me:** ขอบคุณสำหรับคอมเมนต์ครับ merge ให้ได้เลย

**สถานะ:** Approved by Reviewer 2 — Merged into `lab4-staging`

---

### PR #59 — `feature/lab4-03-actions-taken-api`
🔗 https://github.com/napatsun/TokTickIT/pull/59

**Reviewer 2:** ตรวจโค้ดเรียบร้อยแล้วนะครับคุณซัน POST/GET/PATCH /actions ทำงานถูกต้องดีครับ ดึง performedById จาก Session และมี Conditional Validation ครบถ้วน รองรับ Idempotency-Key ใน FR-15และแยกสิทธิ์ Role ป้องกัน Requester ได้ดีฮะ ผ่าน

**Reviewer 1:** ครบถ้วนดีครับ มีการ ทำการ Implement ที่ดี ในส่วนของ API แต่อยากจะขอให้ลองส่ง test มาให้ดูหน่อยนะครับว่าสำเร็จทุกขั้นตอนแล้วรึเปล่า

**Me:** ผล test ของ branch นี้:

Test Files 1 passed (1)
Tests 53 passed (53)

ผล test รวมนับเป็น evidence ว่าทั้ง branch ผ่าน:

Test Files 23 passed (23)
Tests 587 passed (587)

ผ่านหมดตามนี้ครับ

**Reviewer 1:** ผ่านครับ ครบถ้วนดี เก่งมากครับ

**Me:** ขอบคุณสำหรับคอมเมนต์ของทั้งสองคนนะครับ

**สถานะ:** Approved by Reviewer 1 — Merged into `lab4-staging`

---

### PR #60 — `feature/lab4-04-actions-taken-ui`
🔗 https://github.com/napatsun/TokTickIT/pull/60

**Reviewer 1:** มีการ implement spec และตาม issue อย่างครบถ้วน ไม่มีข้อติครับ

**Reviewer 2:** ระบบการให้สิทธิ์ที่ implement ทำออกมาได้ดีเลยครับ โดยรวมโอเคคับ ผ่าน

**Me:** ขอบคุณทั้งสองความเห็นครับ

**สถานะ:** Approved by Reviewer 2 — Merged into `lab4-staging`

---

### PR #61 — `feature/lab4-05-ticket-workflow-resolution`
🔗 https://github.com/napatsun/TokTickIT/pull/61

**Reviewer 2:** ทำ Ticket Workflow คุมทั้ง Matrix การเปลี่ยนสถานะตาม Role, บังคับใส่ Actions Taken ก่อน Resolve ต่างๆทำออกมาได้ดีมากครับ

**Reviewer 1:** Implement ครบถ้วนนะครับ ตาม Specification ที่ได้มีการทำไว้ ในส่วนของ workflow ก็ถูกหลักการและไม่ยุ่งเหยิง เก่งมากครับ ผ่านนๆๆๆๆ

**Me:** ขอบคุณสำหรับคอมเมนต์ของคุณบอลเเละคุณโอ

**สถานะ:** Approved by Reviewer 1 — Merged into `lab4-staging`

---

### PR #62 — `feature/lab4-06-role-dashboards`
🔗 https://github.com/napatsun/TokTickIT/pull/62

**Reviewer 2:** ตรง split status ลืม .trim() หรือเปล่าครับ ถ้า client ยิงมาแบบมี whitespace คั่นหลังจุลภาค เดี๋ยวหลุด validation นะ 

**Me:** ทำการเติม .trim() เรียบร้อยครับ ขอบคุณที่ตรวจเช็คให้อย่างละเอียดครับ ยังไงรบกวนตรวจสอบให้อีกทีครับ

**Reviewer 2:** จากที่เช็คแล้วเห็นว่ามีการเติม .trim() แก้ไขเรียบร้อยครับ ผ่าน

**สถานะ:** Approved by Reviewer 2 — Merged into `lab4-staging`

---

### PR #63 — `feature/lab4-07-final-hardening-regression`
🔗 https://github.com/napatsun/TokTickIT/pull/63

**Reviewer 2:** 

**Me:** 

**สถานะ:** Approved by Reviewer 2 — Merged into `lab4-staging`

---

## Part 2 — Pull Requests I Reviewed for My Partners

---

### For ALONGKORN KAEWPROM — 67070501050 — [@Alongkron1234](https://github.com/Alongkron1234)


---

### For KRITTAPHAT PANYASOMPHAN — 67070501052 — [@krittaphato3](https://github.com/krittaphato3)

---

