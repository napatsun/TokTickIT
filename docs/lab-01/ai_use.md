# Lab 1 — AI Use and Reflection  

**LLM/agent used:** Claude Sonnet5

## Selected key prompts (6–10)
| # | Prompt (summarised) | What I did with the result |
|---|---------------------|----------------------------|
| 1 | ให้เเสดงขั้นตอนการทำต่างๆใน lab นี้ พร้อมทั้งให้ลิสต์สิ่งที่ต้องทำในเเต่ละ issue ออกมา เเละลิสต์สิ่งที่ต้องส่งงานออกมา | เช็คผลลัพธ์ต่างๆจาก ai เทียบกับใบเเลปอีก 1 ทีเพื่อความชัวร์ เเละเริ่มลงมือทำในเเต่ละขั้นตอน |
| 2 | ต้องการคำสั่ง Git สำหรับแตก branch ใหม่ชื่อ feature/1-project-foundation | นำคำสั่ง git checkout -b feature/1-project-foundation ไปรันใน Terminal ตอนเริ่มทำ Issue1 |
| 3 | ถามว่า test ที่ fail (expected 200 got 501) ถือว่า Issue 1 ไม่ผ่านมั้ย | AI อธิบายว่า test เป็นเกณฑ์ของ Issue2 ไม่ใช่ Issue1 เลยเข้าใจว่าทำถูกและไม่ไปแก้โค้ดผิดจุด |
| 4 | ตรวจสอบโค้ด App.tsx ที่เขียนว่าครบตามเกณฑ์ Issue 2 (loading/success/error state) มั้ย | พบว่า comment ในโค้ดเข้าใจผิดว่า error handling เป็นงานของ Issue 4 จึงแก้ scope ให้ตรงและ implement error state ให้เสร็จใน Issue 2  |
| 5 | test ฝั่ง frontend มัน fail เเละมันขึ้น error ว่า Found multiple elements with the text: /online/i | ตรวจโค้ด App.tsx พบว่ามี JSX block ซ้ำซ้อนกัน 2 อัน เลยลบอันนึงออกไป |
| 6 | ถามว่า CORS แค่ใส่โค้ดใน app.ts ก็พอเเล้วใช่มั้ย | ได้คำตอบว่า CORS ทำงานจริงจาก manual test ที่ทำไปแล้ว (ปุ่ม Check System ที่เรียกbackend ข้าม origin ได้สำเร็จ) ซึ่งทำให้รู้ว่าไม่ต้องไปเขียนโค้ดเพิ่ม |

## Reflection
Two or three sentences: what made your prompts better, and one place you had to
correct or reject what the agent produced.

Ans: ต้องให้ Ai เข้าใจก่อนว่าเราต้องการให้ ai ช่วยเรื่องอะไร เวลา prompt ต้อง prompt ละเอียดๆหน่อยอธิบายให้มันเข้าใจตรงกับเรา พร้อมทั้งส่งรายละเอียดที่คิดว่าควรให้ ai ดู จะได้ให้ได้ผลลัพธ์ตรงกับที่เราต้องการมากที่สุด 
    ในการใช้ Ai ครั้งนีี้จากการตรวจสอบดูเเล้วพบว่ายังไม่มีขั้นตอนไหนที่ให้ข้อมูลผิดมา
