# Lab 2 — Peer Review Record

## People

| Role | Name | Student ID | GitHub |
|---|---|---|---|
| Author | NAPATR KASEMWEERASAN | 67070501014 | [@napatsun](https://github.com/napatsun) |
| Peer reviewer 1 | KRITTAPHAT PANYASOMPHAN | 67070501052 | [@krittaphato3](https://github.com/krittaphato3) |
| Peer reviewer 2 | ALONGKORN KAEWPROM | 67070501050 | [@Alongkron1234](https://github.com/Alongkron1234) |

---

## Part 1 — Pull Requests I Authored (Reviewed by My Partners)

### PR #21 — `lab2/01-spec-and-docs`
🔗 https://github.com/napatsun/TokTickIT/pull/21

**Reviewer 1:** จากที่ดู อยากให้ลองตรวจสอบความเรียบร้อยของ docs ในแต่ละส่วน อย่างเช่น ai-use ที่มีบอกเพียงแค่ว่าใช้ model ไหน ในขณะที่ตาม requirement มีการบอกชัดเจนให้พูดถึงเครื่องมือที่ใช้ เช่น Claude Code หรือ Anti Gravity และ Thinking ระดับไหน ยังไงรบกวนตรวจสอบด้วยนะครับ @napatsun

**Me:** ตอนนี้ได้แก้ไขไฟล์ ai_use.md เรียบร้อยครับ รบกวนตรวจสอบให้อีกรอบด้วยครับ

---

### PR #22 — `lab2/02-db-schema-and-seed`
🔗 https://github.com/napatsun/TokTickIT/pull/22

**Reviewer 1:** ครบและเรียบร้อยดีมาก สามารถดำเนินการไปยัง Issue ต่อไปได้เลยย

**Reviewer 2:** โดยรวมแล้วผ่านครบถ้วนดีมากครับ

**Me:** โอเคครับ

---

### PR #23 — `lab2/03-shared-vi-foundation`
🔗 https://github.com/napatsun/TokTickIT/pull/23

**Reviewer 1:** ทำไมเมื่อดูผล test จากไฟล์ tsc-vitest-build-output.txt เห็นว่ามีข้อความ warning เต็มไปหมด เกิดปัญหาจากอะไร แก้ไขด้วย และพอแก้ไขเสร็จแล้ว ผลลัพธ์เป็นยังไงบ้างครับ

**Me:** เป็น upstream deprecation warning จาก Bootstrap 5.3 เอง (ใช้ syntax เก่าของ Sass ที่จะถูกลบใน Dart Sass 3.0) ไม่เกี่ยวกับโค้ดที่ผมเขียน ไม่กระทบการทำงานของเว็บครับ warning ทั้งหมดเป็นแค่ noise ใน terminal

**Reviewer 1:** โอเคครับ ผมเข้าใจแล้วครับ นอกจากส่วนนั้นก็ไม่มีอะไรที่ผมสงสัยละครับ

**Reviewer 2:** ผ่านครบถ้วนดีครับ

**Me:** @krittaphato3 @Alongkron1234 ขอบคุณสำหรับบอกเรื่องข้อความ warning และการรีวิวโค้ดครับ

---

### PR #24 — `lab2/04-dev-requester-context`
🔗 https://github.com/napatsun/TokTickIT/pull/24

**Reviewer 1:** ถ้า component remount (เช่น route change) จะเกิด memory leak และ event listener ซ้ำซ้อนรึเปล่าครับ

**Me:** เช็คแล้วว่า RequesterProvider วางครอบอยู่นอกใน App.tsx จริงๆ เวลาเปลี่ยนหน้า (route change) ตัว Provider เลยไม่ได้ถูก unmount แล้ว mount ใหม่ (เพราะมีแค่ component ลูกข้างในเท่านั้นที่สลับเปลี่ยนไป)

แต่เพื่อความชัวร์และปลอดภัยไว้ก่อน (Defensive Programming) เลยปรับโค้ดมาใช้ Ref Pattern (useRef) แทนการใส่ navigate ลงใน Dependency Array ของ useEffect โดยตรง วิธีนี้ช่วยการันตีได้ 100% ว่าตัว Effect จะรัน subscribe และ cleanup เพียงแค่ครั้งเดียวเท่านั้น ไม่ว่าค่า reference ของ navigate จะเปลี่ยนหรือไม่ก็ตาม

เพิ่ม 3 tests พิสูจน์: (1) listener ถูก remove จริงตอน unmount, (2) mount/unmount ซ้ำไม่มี listener ซ้อนกัน, (3) event ทำงานถูกต้อง (clear state + navigate) — commit

**Reviewer 1:** React expects value as string แต่ props รับ string | number อาจเกิด console warning ได้นะครับ ถ้าจำไม่ผิด รบกวนตรวจสอบ

**Me:** หลังจากที่ลอง test จริงทั้งก่อนและหลังแก้ (revert fix ชั่วคราวแล้วรัน test เทียบ) พบว่า React 18.3.1 ไม่ warning เรื่องนี้จริงๆ ในกรณีนี้ แต่ยังคง apply String(value) coercion ไว้เป็น defensive fix เพราะไม่มีต้นทุนอะไร (no-op กับ string) และป้องกันปัญหาถ้า React version ในอนาคตเพิ่ม check นี้ เพิ่ม regression test ไว้ถาวรเพื่อจับปัญหานี้ถ้าเกิดขึ้นจริงในอนาคต — commit

**Reviewer 1:** Approved

**Reviewer 2:** จากที่ดูแล้วโอเคผ่านครับ

**Me:** @krittaphato3 @Alongkron1234 ขอบคุณสำหรับคอมเมนต์ทั้งสองจุดและการรีวิวโค้ดครับ

---

### PR #25 — `lab2/05-create-ticket-full`
🔗 https://github.com/napatsun/TokTickIT/pull/25

**Reviewer 1:** ครบถ้วน เก่งจังเบยยย

**Reviewer 2:** ผ่านหมดเรียบร้อยดีครับ

**Me:** ขอบพระคุณครับ รบกวนกด merge ได้เลยครับ @Alongkron1234 @krittaphato3

---

### PR #26 — `lab2/06-my-tickets-full`
🔗 https://github.com/napatsun/TokTickIT/pull/26

**Reviewer 1:** ทุกอย่างเรียบร้อย ครบเกิน ไม่มีอะไรให้ติเลย เก่งมากก

**Me:** Thanks 🙏🏻 @krittaphato3

---

### PR #27 — `lab2/07-ticket-detail-and-attachments`
🔗 https://github.com/napatsun/TokTickIT/pull/27

**Reviewer 2:** หน้า UI ครบถ้วนดีมากครับ ผ่าน

**Me:** โอเคครับ ขอบคุณครับ

---

### PR #28 — `lab2/08-responsive-visual-e2e-tests`
🔗 https://github.com/napatsun/TokTickIT/pull/28

**Reviewer 1:** เรียบร้อยนะครับ

**Reviewer 2:** จากที่ดูมาทั้งหมดผ่านเรียบร้อยดีครับ

**Me:** ขอบคุณจากใจจริงครับ @Alongkron1234 @krittaphato3

---

### PR #29 — `lab2/09-docs-finalization`
🔗 https://github.com/napatsun/TokTickIT/pull/29

*(No comments recorded yet)*

---

### PR #30 — `lab2-staging`-->`main`
🔗 https://github.com/napatsun/TokTickIT/pull/30 

**Reviewer 2:** จากที่ดูหน้าตา UI ต่างๆครบถ้วนดีครับ แต่ผมรู้สึกว่าไฟล์ README.md ของคุณซันยังไม่ได้ update เป็นอันล่าสุดมั้ยครับ รบกวน update ด้วยนะครับ

**Me:** เดี๋ยวเเก้ซักครู่นะครับ

**Me:** เรียบร้อยครับ คุณอลงกรณ์ เเละคุณกฤตภาสสามารถมารีวิวให้ได้เลยครับ

**Reviewer 2:** จากที่ตรวจๆดูแล้วครับถ้วนตรงตาม criteria ดีมากครับ

**Reviewer 1:** ทุกอย่างเรียบร้อยดีครับ ผาน ผ่าน ผ้าน ผ๊านนนนน

---

## Part 2 — Pull Requests I Reviewed for My Partners

### For ALONGKORN KAEWPROM — 67070501050 — [@Alongkron1234](https://github.com/Alongkron1234)

**1. PR #21** — https://github.com/Alongkron1234/toktickit/pull/21
- **My comment:** โดยรวมโอเคแล้วนะ มีเรื่องอยากสอบถามเพิ่มเติมว่าคุณอลงกรณ์มีวิธีจัดการยังไงให้ Data ไม่สร้างซ้ำเพิ่มขึ้นมา
- **Partner's response:** วิธีจัดการของผมหลักๆ อยู่ในไฟล์ seed.ts เลยครับ ผมใช้คำสั่ง upsert แทน create โดยให้มันเช็คจาก Unique Key พวกอีเมล หรือเลขตั๋ว ถ้ารันครั้งแรกแล้วยังไม่มีข้อมูลมันจะสร้างข้อมูลใหม่ แต่ถ้ารันซ้ำครั้งถัดไปทั้งๆ ที่มีข้อมูลอยู่แล้วมันจะทำการ update ข้อมูลเดิมแทน จะไม่สร้างซ้ำครับ ซึ่งจะแก้ปัญหาที่คุณซันถามมาข้างต้นได้

**2. PR #23** — https://github.com/Alongkron1234/toktickit/pull/23
- **My comment:** โดยรวมดูเรียบร้อย ไม่มีอะไรผิดพลาด และครบถ้วนตาม issue นี้ Approve!

**3. PR #24** — https://github.com/Alongkron1234/toktickit/pull/24
- **My comment:** ไม่มีปัญหา ครบถ้วน ผ่านได้เลย

**4. PR #26** — https://github.com/Alongkron1234/toktickit/pull/26
- **My comment:** เรียบร้อยดี ไม่มีปัญหา ไป issue ต่อไปได้
- **Partner's response:** ขอบคุณครับ

**5. PR #28** — https://github.com/Alongkron1234/toktickit/pull/28
- **My comment:** โดยรวมเรียบร้อย ไม่มีปัญหาอะไร ไปต่อที่ issue ต่อไปได้
- **Partner's response:** ทุกๆ ท่านกระผมได้พบเจอว่าหน้า UI MyTicket ของ mobile ต้องเป็นบล็อคๆ ไม่ใช่แบบที่กระผมทำ ตอนนี้ผมได้ทำการแก้ไขเรียบร้อยแล้วครับ รบกวนทุกๆ ท่านตรวจเช็คความเรียบร้อยอีกหนึ่งทีนะครับ @atiwit @napatsun @krittaphato3
- **My comment:** ขออภัยที่ไม่ได้ตรวจเช็คในส่วนของ UI อย่างละเอียด พอแก้ไขแล้วตัวโค้ดก็ไม่มีปัญหาเหมือนเดิมครับ ผ่านครับ
- **Partner's response:** รบกวน merge ให้ผมด้วยนะครับคุณซันทะลุทะลวง
- **My comment:** Approve ไปต่อ issue ต่อไปได้เลย

**6. PR #31** — https://github.com/Alongkron1234/toktickit/pull/31
- **My comment:** ลองตรวจสอบหน้า UI ตรงตารางแสดงผลของแต่ละ row ของแต่ละ ticket อีกทีนะครับ มันแสดงผลไม่เต็มแถวยังเป็นแบบต้องเลื่อนดู
- **Partner's response:** จริงด้วยครับ เดี๋ยวผมจะแก้ไขให้นะครับ

---

### For KRITTAPHAT PANYASOMPHAN — 67070501052 — [@krittaphato3](https://github.com/krittaphato3)

**1. PR #23** — https://github.com/krittaphato3/TokTickIT/pull/23
- **My comment:** รันผ่าน ครบถ้วน ถูกต้อง approve เดี๋ยว merge เลยนะ
- **Partner's response:** ขอบคุณสำหรับ Review ครับ

**2. PR #25** — https://github.com/krittaphato3/TokTickIT/pull/25
- **My comment:** โดยรวมโอเค ครบถ้วน ทีนี้ถ้าคุณกฤตภาสว่าง ส่งผล npm test มาให้ผมดูหน่อย เดี๋ยวผมมาดูนะ
- **Partner's response:** รูปผลการ test

**3. PR #28** — https://github.com/krittaphato3/TokTickIT/pull/28
- **My comment:** ครบถ้วนเรียบร้อย หน้า UI โอเค เยี่ยมมาก

**4. PR #32** — https://github.com/krittaphato3/TokTickIT/pull/32
- **My comment:** งานนี้ไวและก็เรียบร้อยดี ไป issue ต่อไปได้เลย
- **Partner's response:** ขอบคุณครับ @Alongkron1234 @napatsun