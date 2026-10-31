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

**Reviewer 2:** ตรวจดูเรียบร้อยแล้วครับ โดยรวมโอเคเลย ครบทั้ง UI, test, screenshot 3ขนาด ดีมากครับ

**สถานะ:** Approved by Reviewer 2 — Merged into `lab4-staging`

### PR #65 — `Fix/lab4 dashboard gap fix`
🔗 https://github.com/napatsun/TokTickIT/pull/65

**Reviewer 2:** โดยรวมสำหรับ Issue นี้เรียบร้อยครบถ้วนดีครับ ผ่านฮะ

**สถานะ:** Approved by Reviewer 2 — Merged into `lab4-staging`

---

### PR #67 — `Fix/lab4 09 change password layout fix`
🔗 https://github.com/napatsun/TokTickIT/pull/67

**Reviewer 1:** Good catch ครับ ที่เห็นในส่วยของ layout ที่ผิด จากที่ดูในส่วนของ commit ก็แก้ไขได้ดีครับ ไม่มีข้อติอะไร เก่งมากครับ

**สถานะ:** Approved by Reviewer 1 — Merged into `lab4-staging`

---

### PR #69 — `Fix/lab4 10 focus and a11y polish`
🔗 https://github.com/napatsun/TokTickIT/pull/69

**Reviewer 2:** ผ่านครบถ้วนดีมากๆครับ

**สถานะ:** Approved by Reviewer 2 — Merged into `lab4-staging`

---

### PR #71 — `Fix/lab4 10 focus and a11y polish`
🔗 https://github.com/napatsun/TokTickIT/pull/71

**Reviewer 1:** เรียบร้อยครบถ้วนทั้งหมดเเล้ว เก่งมากครับ good catch กับ fix ต่างๆที่นำมาปรับแก้ approve ครับ

**สถานะ:** Approved by Reviewer 1 — Merged into `lab4-staging`

---

## Part 2 — Pull Requests I Reviewed for My Partners

---

### For ALONGKORN KAEWPROM — 67070501050 — [@Alongkron1234](https://github.com/Alongkron1234)

**1. PR #64** — https://github.com/Alongkron1234/toktickit/pull/64

- **My comment:** ภาพรวมทำได้ดีมากและครอบคลุมตาม Spec ของ Lab 4 อย่างครบถ้วน ผ่านครับ
เเต่มีให้พิจารณาเพิ่มเติมคือไฟล์ ActionsTakenSection.tsx เริ่มเยอะเเล้วนะ ถ้าอนาคตต้องเพิ่มฟีเจอร์อาจลองแยกส่วน Form ออกมาเป็น component ย่อยจะได้จัดการง่ายขึ้นครับ 👳🏾‍♂️

- **Partner's response:** โขอบคุณสำหรับความเห็นครับ ตอนนี้ในไฟล์เรารวมไว้ 4อย่างคือ ดึงข้อมูล, ฟอร์มเพิ่ม/แก้, ขั้นตอน Complete/Cancel, และรายการ Action ที่แสดงผล เลยคิดว่าถ้าแยกก็น่าจะดีเหมือนกันๆ อาจจะแยกเป็น component ใน issue หน้าที่ต้องมีการแก้ไขไฟล์นี้อยุ่แล้วนะครับ


---

### For KRITTAPHAT PANYASOMPHAN — 67070501052 — [@krittaphato3](https://github.com/krittaphato3)

**1. PR #63** — https://github.com/krittaphato3/TokTickIT/pull/63

- **My comment:** งานดีครับ เเต่มีจุดเล็กๆที่อยากถามเพิ่มเติมเพื่อความชัวร์ครับ

1.ใน ResolveTicketDialog.tsx ตอนที่เกิด 409 และ user กด Reload นอกจากจะอัปเดต version แล้ว มีการจัดการ state ของ resolutionSummary ให้สะอาดหรือยัง (จาก PR ดูเหมือนจะเก็บไว้ซึ่งดีมาก แต่อยากแน่ใจว่าไม่มีการ leak ของ state เก่า)
2.ตรงส่วนที่ Requester พยายามเปลี่ยนสถานะแล้วได้ 403 FORBIDDEN มีการแสดง error message ที่ฝั่ง UI ให้ user รู้ได้มั้ยครับว่าทำไมถึงทำไม่ได้

- **Partner's response:** ตตั้งใจตั้งแบบเก็บ state ไว้ครับ เพื่อให้ User ไม่ต้องพิมพ์ข้อความสรุปการแก้ปัญหาใหม่ทั้งหมดหากโดน Conflict จาก Version เก่า และ
มีจัดการไว้ครับ เมื่อ Catch ได้ HTTP status 403 ตัวระบบจะเรียก Toast notification / Error alert เพื่อขึ้นข้อความเตือน User เช่น "คุณไม่มีสิทธิ์ในการเปลี่ยนสถานะรายการนี้" ให้ทราบทันทีครับ

- **My comment:** เข้าใจเเล้วครับ ผ่านครับ

---


