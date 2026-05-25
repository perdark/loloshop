# LoloShop — Open Questions

Questions to answer before/during build. Group by urgency.

---

## 🔴 P0 — Block schema/auth (answer first)

### 1. Pricing model
- Fixed price per sash? Or tiered (1 sash vs 100 sashes wholesaler bulk)? / yes every sash have a diffrent price
- Robe price separate from sash? / yes 
- Different price per color/material? / yes 
- Wholesaler get discount or same price as retail? / yes but all prices in what's app

### 2. Cost tracking
- Who enters cost per order — admin manual, or auto from material table? / admin manual 
- Cost components: fabric + printing + embroidery + delivery — track separately or one number? / one number
- Cost in IQD only? / yes 

### 3. Wholesaler commission
- Do wholesalers earn % per student order? Or flat monthly? / that's not in our work we don't care about this we just sell
- If %, stored where — `wholesalers.commission_rate` or per-order column? 
- Affects `orders` table: need `commission_amount` column?

### 4. Order status flow
Confirm states:
- `pending_approval` → wholesaler approves student 
- `designing` → student working on design
- `design_complete` → student confirmed
- `staff_review` → staff checking
- `printing` → in production
- `ready` → done, awaiting pickup/delivery
- `delivered` → done
- `cancelled`

Missing any? Auto-transitions or manual? / confirmed , auto

### 5. Delivery
- Pickup only? Delivery to wholesaler then wholesaler distributes? Direct to student? / Pickup 
- Address field needed on student or order? 
- Delivery cost separate or in price? 

---

## 🟠 P1 — Block features (answer before phase 3+)

### 6. Phone verification
- OTP via WhatsApp Business API? SMS? None (trust)? / zentramsg or google play sign in 
- Without OTP = anyone can register with fake phone, spam wholesaler approval queue.

### 7. Password reset
- No email in system. Reset flow = ? / put an email 
  - Option A: WhatsApp admin manually
  - Option B: SMS OTP
  - Option C: Security question

### 8. Notifications
- When student joins via referral → notify wholesaler how? WhatsApp? In-app only? / In app only 
- When wholesaler approves → notify student how? / in app 
- Deadline approaching → notify wholesaler? / yes 
- Order status changes → notify student? / yes 

### 9. University list
- Dropdown of fixed universities + departments? Or free text? / free text 
- If dropdown: who manages list — admin in settings page?
- Affects analytics (top universities) + design (logo auto-load). 

### 10. Robe feature scope
- PLAN.md mentions robes but no design flow. 
- Robe = buy-only product (pick size + color)? / yes only product
- Or robe also customizable (name embroidered)?

### 11. Sizes
- Sash = one-size? / no
- Robe = S/M/L/XL/XXL? Custom measurements?
- Size chart page needed? / yes 

### 12. Image moderation
- Student uploads random image from Pinterest. Inappropriate content risk. / no it is ok becuase every student will have a third name and phone number and email so he won't do this 
- Admin approves all uploads before print? Auto-flag with AI? Trust + staff manual review? / no 

---

## 🟡 P2 — Block polish/launch

### 13. Refund / cancel policy
- Student changes mind after design confirmed — allowed? / no but admin can set an exception for some student he choice if there is a students contant him to edit 
- After printing started — allowed? / no
- Cash refund flow — admin manual? / yes 

### 14. Inventory
- Track stock per color/size? Or fully made-to-order? / do not make inventory or stock , everyhting will be shown it will be available for students 
- If stock: low-stock alerts for admin?

### 15. Print export
- Staff needs print-ready file: PDF / PNG high-DPI with bleed marks + CMYK? / make a pdf to test and PNG hight dpi
- Or just preview is enough and physical pattern made manually? / yes 
- Resolution requirement (300 DPI?)? / yes 

### 16. Font licensing
- Arabic calligraphy fonts (الثلث، الديواني، الكوفي) — using free fonts (Amiri, Cairo) or paid? / free 
- Risk of using cracked commercial fonts on commercial product. 

### 17. Storage backend
- Uploaded files (logos, student images, fonts) — store where? 
  - Local VPS disk (cheap, backup pain, single point failure) / yes local 
  - S3-compatible (Backblaze B2, Hetzner, Cloudflare R2 — cheap + reliable)
- Backup strategy?

### 18. Audit log
- Track who approved who, deadline extensions, status changes — separate `audit_log` table? / yes 
- Needed for trust between admin + wholesalers. 

### 19. Multi-language admin UI
- CLAUDE.md says Arabic only for student/wholesaler. 
- Admin/staff UI Arabic? English? Both toggle? / ar only for now 

### 20. Domain + SSL
- Domain name decided? / no 
- Email for SSL cert (Let's Encrypt)? / no for now 

---

## 🟢 P3 — Nice to have, decide later

### 21. Design templates
- Pre-made templates per university (logo + dept already placed)? / yes
- Saves lazy students time. 

### 22. PWA
- Install on phone like app — students/wholesalers like. / yes 
- Cheap with Next.js, big UX win.

### 23. Soft delete
- Never hard delete orders/students. `deleted_at` column? / decide this after 

### 24. Rate limit
- `/api/join/:code` rate limit per IP — prevent leaked link flood. / yes 

### 25. Referral code format
- Short slug `baghdad-cs-2026` or random `x7k9m2`?  / short slug 
- Slug = human readable, predictable. Random = secure. / human readable like baghdad-cs-2026 

---

## ⚪ Contradictions in current docs (fix immediately)

### A. Three.js vs flat 2D
- `CLAUDE.md` stack section: "Three.js (sash 3D preview)"
- `CLAUDE.md` Key Decisions: "No 3D — sash shown as flat left/right panels"
- `PLAN.md` Task 4.1: "Don't: Use Three.js or any 3D — flat 2D mockup is the goal"
- **Decision: flat 2D. Remove Three.js from stack.**

### B. Fabric.js
- `PROGRESS.md` decisions: "Canvas editor: Fabric.js"
- `PLAN.md` Task 4.2: "Fabric.js or vanilla canvas"
- **Decision: pick one. Fabric.js recommended (drag/resize built in).**

---

## Answers (fill as you decide)

| # | Question | Answer |
|---|----------|--------|
| 1 | Pricing model | |
| 2 | Cost tracking | |
| 3 | Commission | |
| 4 | Order states | |
| 5 | Delivery | |
| 6 | Phone verify | |
| 7 | Password reset | |
| 8 | Notifications | |
| 9 | University list | |
| 10 | Robe scope | |
| 11 | Sizes | |
| 12 | Image moderation | |
| 13 | Refund | |
| 14 | Inventory | |
| 15 | Print export | |
| 16 | Fonts | |
| 17 | Storage | |
| 18 | Audit log | |
| 19 | Admin lang | |
| 20 | Domain | |
| 21 | Templates | |
| 22 | PWA | |
| 23 | Soft delete | |
| 24 | Rate limit | |
| 25 | Referral format | |
