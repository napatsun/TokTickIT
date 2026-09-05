# Lab 1 — Peer Review Record  (fill this in)

**Author:** <NAPATR KASEMWEERASAN> — <67070501014> — GitHub: @napatsun

**Peer reviewer1:** <KRITTAPHAT PANYASOMPHAN> — <67070501052> — GitHub: @krittaphato3

**Peer reviewer2:** <ALONGKORN KAEWPROM> — <67070501050> — GitHub: @Alongkron1234

## Pull Requests I authored (reviewed by my partner)
| PR | Branch | Reviewer verdict |
|----|--------|------------------|
|https://github.com/napatsun/TokTickIT/pull/21|lab2/01-spec-and-docs| Reviewer1: จากที่ดู อยากให้ลองตรวจสอบความเรียบร้อยของ docs ในแต่ละส่วน อย่างเช่น ai-use ที่มีบอกเพียงแค่ว่า ใช้ model ไหน ในขณะที่ ตาม requirement มีการบอกชัดเจนให้พูดถึง เครื่องมือที่ใช้ เช่น Claude Code หรือ Anti Gravity และ Thinking ระดับไหน ยังไงรบกวนตรวจสอบด้วยนะครับ @napatsun Me:ตอนนี้ได้เเก้ไขไฟล์ ai_use.md เรียบร้อยครับ รบกวนตรวจสอบให้อีกรอบด้วยครับ|
|https://github.com/napatsun/TokTickIT/pull/22|lab2/02-db-schema-and-seed|  Reviewer1: ครบและเรียบร้อยดีมาก สามารถดำเนินการไปยัง Issue ต่อไปได้เลยย Reviwer2: โดยรวมแล้วผ่านครบถ้วนดีมากครับ
Me:โอเคครับ|
|https://github.com/napatsun/TokTickIT/pull/23|lab2/03-shared-vi-foundation|Reviewer1:ทำไมเมื่อดูผลtest จากไฟล์ tsc-vitest-build-output.txt เห็นว่ามีข้อความ warning เต็มไปหมด เกิดปัญหาจากอะไร เเก้ไขด้วย และ พอแก้ไขเสร็จแล้ว ผลลัพธ์เป็นยังไงบ้างครับ Me:เป็น upstream deprecation warning จาก Bootstrap 5.3 เอง (ใช้ syntax เก่าของ Sass ที่จะถูกลบใน Dart Sass 3.0) ไม่เกี่ยวกับโค้ดที่ผมเขียน ไม่กระทบการทำงานของเว็บครับ warning ทั้งหมดเป็นแค่ noise ใน terminal Reviewer1: โอเคครับ ผมเข้าใจแล้วครับ, นอกจากส่วนนั้นก็ไม่มีอะไรที่ผมสงสัยละครับ Reviwer2:ผ่านครบถ้วนดีครับ Me:@krittaphato3 @Alongkron1234 ขอบคุณสำหรับบอกเรื่องข้อความ warning เเละการรีวิวโค้ดครับ|
|https://github.com/napatsun/TokTickIT/pull/24|lab2/04-dev-requester-context|Reviewer1: ถ้า component remount (เช่น route change) จะเกิด memory leak และ event listener ซ้ำซ้อนรึเปล่าครับ Me: เช็คแล้วว่า RequesterProvider วางครอบอยู่นอก ใน App.tsx จริงๆ เวลาเปลี่ยนหน้า (route change) ตัว Provider เลยไม่ได้ถูก unmount แล้ว mount ใหม่ (เพราะมีแค่ component ลูกข้างใน เท่านั้นที่สลับเปลี่ยนไป)

แต่เพื่อความชัวร์และปลอดภัยไว้ก่อน (Defensive Programming) เลยปรับโค้ดมาใช้ Ref Pattern (useRef) แทนการใส่ navigate ลงใน Dependency Array ของ useEffect โดยตรง วิธีนี้ช่วยการันตีได้ 100% ว่าตัว Effect จะรัน subscribe และ cleanup เพียงแค่ครั้งเดียวเท่านั้น ไม่ว่าค่า reference ของ navigate จะเปลี่ยนหรือไม่ก็ตาม

เพิ่ม 3 tests พิสูจน์: (1) listener ถูก remove จริงตอน unmount, (2) mount/
unmount ซ้ำไม่มี listener ซ้อนกัน, (3) event ทำงานถูกต้อง (clear state +
navigate) commit 
Reviwer1:React expects value as string แต่ props รับ string | number อาจเกิด console warning ได้นะครับ ถ้าจำไม่ผิด รบกวนตรวจสอบ Me: หลังจากที่ ลอง test จริงทั้งก่อนและหลังแก้ (revert fix ชั่วคราวแล้วรัน test เทียบ) พบว่า
React 18.3.1 ไม่ warning เรื่องนี้จริงๆ ในกรณีนี้ แต่ยังคง apply
String(value) coercion ไว้เป็น defensive fix เพราะไม่มีต้นทุนอะไร (no-op
กับ string) และป้องกันปัญหาถ้า React version ในอนาคตเพิ่ม check นี้ เพิ่ม
regression test ไว้ถาวรเพื่อจับปัญหานี้ถ้าเกิดขึ้นจริงในอนาคต commit Reviewer1: Approved  Reviewer2: จากที่ดูแล้วโอเคผ่านครับ Me: @krittaphato3 @Alongkron1234 ขอบคุณสำหรับคอมเมนต์ทั้งสองจุด เเละการรีวิวโค้ดครับ|


|https://github.com/napatsun/TokTickIT/pull/25|lab2/05-create-ticket-full|Reviewer1:ครบถ้วน เก่งจังเบยยย Reviwer2: ผ่านหมดเรียบร้อยดีครับ  Me:ขอบพระคุณครับ รบกวนกด merge ได้เลยครับ @Alongkron1234 @krittaphato3|
|https://github.com/napatsun/TokTickIT/pull/26|lab2/06-my-tickets-full|Reviewer1:ทุกอย่างเรียบร้อย ครบเกิน ไม่มีอะไรให้ติเลย เก่งมากก Me:Thanks🙏🏻 @krittaphato3|
|https://github.com/napatsun/TokTickIT/pull/27|lab2/07-ticket-detail-and-attachments|Reviwer2: หน้า UI ครบถ้วนดีมากครับ ผ่าน Me:โอเคครับ ขอบคุณครับ|
|https://github.com/napatsun/TokTickIT/pull/28|lab2/08-responsive-visual-e2e-tests|Reviewer1:เรียบร้อยนะครับ Reviwer2:จากที่ดูมาทั้งหมดผ่านเรียบร้อยดีครับ Me:ขอบคุณจากใจจริงครับ @Alongkron1234 @krittaphato3|
|https://github.com/napatsun/TokTickIT/pull/29|lab2/09-docs-finalization|Reviewer1: Reviwer2: Me:|


## Pull Requests I reviewed for my partner

#### ของ <ALONGKORN KAEWPROM> — <67070501050> — GitHub: @< Alongkron1234>

**PR**
1.https://github.com/Alongkron1234/toktickit/pull/21

My comment: โดยรวมโอเคเเล้วนะ มีเรื่องอยากสอบถามเพิ่มเติมว่า คุณอลงกรณ์มีวิธีจัดการยังไงให้ Data ไม่สร้างซ้ำเพิ่มขึ้นมา
Partner's response:วิธีจัดการของผมหลักๆอยู่ในไฟล์ seed.ts เลยครับ ผมใช้คำสั่ง upsert แทน create โดยให้มันเช็คจาก Unique Key พวกอีเมล หรือ เลขตั๋ว ถ้ารันครั้งแรกแล้วยังไม่มีข้อมูลมันะสร้างข้อมูลใหม่ แต่ถ้ารันซ้ำครั้งถัดไปทั้งๆที่มีข้อมูลอยู่แล้วมันจะทำการ update ข้อมูลเดิมแทน จะไม่สร้างซ้ำครับ ซึ่งจะแก้ปัญหาที่คุณซันถามมาข้างต้นได้

2.https://github.com/Alongkron1234/toktickit/pull/23

My comment: โดยรวมดูเรียบร้อย ไม่มีอะไรผิดพลาด เเละครบถ้วนตาม issue นี้ Approve!

3.https://github.com/Alongkron1234/toktickit/pull/24

My comment: ไม่มีปัญหา ครบถ้วน ผ่านได้เลย

4.https://github.com/Alongkron1234/toktickit/pull/26

My comment: เรียบร้อยดี ไม่มีปัญหา ไป issue ต่อไปได้
Partner's response: ขอบคุณครับ

5.https://github.com/Alongkron1234/toktickit/pull/28

My comment: โดยรวมเรียบร้อย ไม่มีปัญหาอะไร ไปต่อที่ issue ต่อไปได้
Partner's response: ทุกๆท่านกระผมได้พบเจอว่าหน้า UI MyTicket ของ mobile ต้องเป็น บล็อคๆ ไม่ใช่แบบที่กระผมทำ ตอนนี้ผมได้ทำการแก้ไขเรียบร้อยแล้วครับรบกวนทุกๆท่าน ตรวจเช็คความเรียบร้อยอีกหนึ่งทีนะครับ @atiwit @napatsun @krittaphato3
My comment:ขออภัยที่ไม่ได้ตรวจเช็คในส่วนของ UI อย่างละเอียด พอเเก้ไขเเล้วตัวโค้ดก็ไม่มีปัญหาเหมือนเดิมครับ ผ่านครับ
Partner's response: รบกวน merge ให้ผมด้วยนะครับคุณซันทะลุทะลวง
My comment: Approve ไปต่อ issue ต่อไปได้เลย

6.https://github.com/Alongkron1234/toktickit/pull/31

My comment: ลองตรวจสอบหน้า ui ตรงตารางเเสดงผลของเเต่ละ row ของเเต่ละ ticket อีกทีนะครับ
มันเเสดงผลไม่เต็มเเถวยังเป็นเเบบต้องเลื่อนดู
Partner's response: จริงด้วยครับ เดี๋ยวผมจะแก้ไขให้นะครับ

#### ของ <KRITTAPHAT PANYASOMPHAN> — <67070501052> — GitHub: @< krittaphato3>

**PR**

1.https://github.com/krittaphato3/TokTickIT/pull/23

My comment: รันผ่าน ครบถ้วน ถูกต้อง approve เดี๋ยว merge เลยนะ
Partner's response:ขอบตุณสำหรับ Review ครับ

2.https://github.com/krittaphato3/TokTickIT/pull/25

My comment:โดยรวมโอเค ครบถ้วน ทีนี้ถ้าคุณกฤตภาสว่าง ส่งผล npm test มาให้ผมดูหน่อย เดี๋ยวผมมาดูนะ
Partner's response: รูปผลการ test

3.https://github.com/krittaphato3/TokTickIT/pull/28

My comment:ครบถ้วนเรียบร้อย หน้า UI โอเค เยี่ยมมาก

4.https://github.com/krittaphato3/TokTickIT/pull/32

My comment:งานนี้ไวเเละก็เรียบร้อยดี ไป issue ต่อไปได้เลย
Partner's response:ขอบคุณครับ @Alongkron1234 @napatsun

