# Lab 3 — AI Use and Reflection

**LLM/agent used:** Claude Sonnet 5's medium effort setting (Tool: claude.ai) & DeepSeek V4.1 Flash (Tool: FreeBuff)

## Selected key prompts (6–10)

| # | Prompt (summarised) | What I did with the result |
|---|---|---|
| 1 | อธิบายและบอกรายละเอียดขั้นตอนการทำ Lab | อ่านทำความเข้าใจภาพรวมพร้อมกับเปิดไฟล์ Lab ดูควบคู่ไปด้วย |
| 2 | สร้าง `specification.md`, `ui-spec.md`, `api-spec.md`, `tests.md` มาให้อย่างละเอียด พร้อมนำไปใช้งานจริง มีความถูกต้อง รอบคอบ | นำแต่ละไฟล์มาตรวจสอบเนื้อหาอีกรอบเพื่อเช็คความครบถ้วนและถูกต้องก่อนนำไปใช้เป็น Engineering Contract ของ Sprint |
| 3 | สร้าง prompt เพื่อสั่ง coding agent (DeepSeek V4.1 Flash ใน VS Code) เริ่ม implement branch `feature/lab3-auth-and-authorization` โดยแนบไฟล์ spec ทั้ง 4 ไฟล์เข้าไปด้วย | ใช้ prompt นี้สั่ง agent ตัวที่สอง แล้วนำผลลัพธ์กลับมาให้ Claude ตรวจสอบก่อน commit ทุกครั้ง |
| 4 | ให้ Agent ถามคำถามยืนยันก่อนเริ่ม implement เเละขอให้ช่วยตัดสินใจพร้อมเหตุผล | ใช้คำตอบที่ได้ไปเขียน prompt ยืนยันกลับให้ agent ทำงานต่อ และนำการตัดสินใจไป sync กลับเข้า `specification.md`/`api-spec.md` ให้เอกสารตรงกับ implementation จริง |
| 5 | ตรวจสอบรายงานผลจากแต่ละ branch (auth, requester-regression, staff-ticketing, admin-users) เทียบกับ deliverables checklist ที่วางไว้ พร้อมให้บอกจุดที่ deviation จาก spec เดิม | ใช้ผลตรวจนี้ตัดสินใจว่าจุดไหนอนุมัติได้ทันที จุดไหนต้อง sync กลับเข้าไฟล์ spec ก่อนไปทำ branch ถัดไป |
| 6 | ให้ตรวจสอบว่า `GET /api/tickets/:ticketNumber` ไม่ได้เผลอดึง Internal Notes ติดไปด้วยในระดับ Prisma query แม้ UI จะยังไม่แสดงผลก็ตาม| เมื่อ agent สร้าง verify หลักฐานมาก็ตรวจสอบอีกรอบจากตรงนี้เพื่อความมั่นใจ|
| 7 | ตรวจสอบผลลัพธ์ QA ที่เจอ 2 จุดไม่เขียว พร้อมสั่งให้แก้เฉพาะจุด ไม่แตะ layout แอป | ใช้ diff ที่ agent เเสดงมาตรวจว่าเป็นการแก้ test bug จริง ไม่ได้เเค่ปรับแอปให้ผ่าน test ผิดๆ |
| 8 | ตรวจสอบรายงาน release evidence ของ branch สุดท้าย (`feature/lab3-07`) ที่รัน full regression บน merged tree, ยืนยัน migration chain จาก database เปล่า, และทำ traceability audit ของ `tests.md` | พบว่า agent เจอ error ของผมเอง เลยแก้ไขให้ถูกต้อง เเล้วก็นำไป sync กลับเข้า `api-spec.md`/`tests.md` อีกทีนึง|

## My Reflection

**Claude:** ผมให้สร้าง `specification.md` / `ui-spec.md` / `api-spec.md` / `tests.md` เเล้วเวลาที่สั่งให้ agent ทำก็จะให้ claude ตรวจสอบผลลัพธ์อีกรอบ ซึ่ง claude ก็สามารถตรวจได้ดีเนื่องจากมีเอกสารทั้ง 4 ไฟล์นี้อ้างอิงได้อย่างชีดเจน

**Coding agent (DeepSeek V4.1 Flash):**  มีปัญหา ที่ agent implement โค้ดเสร็จแล้วแต่ไม่ได้อัปเดต `docs/lab-03/tests.md` ให้ตรงกับผลจริงใน branch นั้นๆ ซึ่งต้องไปตรวจสอบอีกรอบพร้อมทั้งอัพเดตให้ตรงกับผลลัพธ์ก่อน ซึ่งสิ่งที่ควรทำเลย คือ ต้อง prompt ตั้งเเต่แรกให้ชัดเจนว่าต้องอัพเดตเอกสารหลังจากเขียนโค้ดเสร็จ ไม่ใช่ต้องมาเเยกทำทีหลังเอง