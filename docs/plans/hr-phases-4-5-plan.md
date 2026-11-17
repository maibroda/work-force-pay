# HR phases 4 and 5: a plan for the founder's approval

Written 2026-11-17, following the gap analysis (`hrms-gap-analysis.md`, section 3C, 3E and section 5, phases 4 and 5). **A proposal only: no code, schema or screen has been changed, and nothing is built until the founder answers the business rules in section 6 and says "go".** Phase 4 is learning (training cost and expenditure; a handbook and procedures area). Phase 5 is HR operations (a general HR enquiry tracker). The recruitment work (phase 1) is finished except the slices that wait on the host and the lawyer.

## 1. What exists today (read in the schema and the services on 2026-11-17)

- **Training:** programmes (name, provider, validity, a flag for effectiveness evaluation), sessions (date, venue, trainer, seats, status), enrolments, needs, requests with approval, evaluations, certification expiry. **No money anywhere on training:** no fee, no cost line, no budget. A company's **cost centre budgets** exist (a monthly amount per cost centre, used by the accounts), but they are unrelated to training.
- **Money rules (CLAUDE.md, still binding):** money columns are `Decimal(16,2)`; every calculation is in **whole kobo through `src/lib/money-exact.ts`**, round half up, **once**, no floats; **this app records, it never holds or moves money**.
- **Policies:** a company policy with **versions** (effective dates, body text, a document reference because the app has **no object storage yet**), an audience by employee category, and **acknowledgement tracking** with a grace period and reminders. Employees read them on **My policies**.
- **Enquiries:** `ClientQuery` and its messages are the **bureau's Service Desk for client companies** (a client raises a question, the bureau replies). **Employee relations cases** (grievance, misconduct, harassment, whistleblowing, welfare) are kept separate and confidential. **Data access requests** and letters exist. **There is no general "employee asks HR a question" tracker.**

## 2. The slices, each its own pull request, in my recommended order

| Slice | What it adds | Database (additive, reversible) | Depends on |
| --- | --- | --- | --- |
| **4A. Training cost and expenditure** | HR records **cost lines** against a session (fee, travel, materials, venue, other) in exact money; **spend by programme, by month and by department**; an **annual training budget** and spend against it; an average **cost per attendee**; **never a person's own cost** on a screen | a cost-line table, a budget table | the rules T1 to T6 |
| **4B. Handbook and procedures** | the existing policy area also holds a **handbook** and **standard operating procedures** (SOPs): effective-dated versions, audience by category, searchable by title, an optional **review-due date** with a reminder; **acknowledgement only where HR asks for it** | two columns on the policy (a kind, an "acknowledgement required" flag) and one date | the rules K1 to K4; files wait on the host |
| **5A. HR enquiry tracker** | an employee **raises a question to HR**, HR replies in a thread, it is **answered and closed**; a **first-response target** and an overdue line in the HR digest; **a question that is really a grievance, harassment or whistleblowing is routed to a case, never answered here** | two tables (an enquiry and its messages) | the rules E1 to E6 |

**4A, then 4B, then 5A** follows your priority order (learning before HR operations). None needs the host. **Not planned here:** a public portal, AI assistance, any ledger posting or payment.

## 3. How I would avoid building a second copy of something

- **4B reuses the policy area** (versions, effective dates, audience, acknowledgement, My policies) instead of a new "knowledge base". The alternative (a separate model) would copy all of that.
- **5A copies the shape of the client Service Desk** (a thread of messages, a first-response time) but is **its own pair of tables**: the client Service Desk is about a client company and the bureau, 5A is about an employee and HR. I would **not** change the client Service Desk code.
- **4A does not touch the accounts.** The cost lines are **HR records of what a session cost**, with an optional text reference to the invoice. They create **no journal and no payment**, and are not linked to the company's payables.

## 4. Slice 4A in detail

1. **Cost lines.** For a session HR records one or more lines: a **kind** (fee, travel, materials, venue, other), an **amount in naira** (exact, to the kobo), a **description** and an optional **invoice reference** (text). Lines can be added, and **corrected by a new line (a reversal) rather than edited**, so the history is kept. A **cancelled session** keeps its lines (a cancellation fee is a cost).
2. **Spend.** Total per **programme**, per **month of the session**, and per **department**: a session's cost is **shared equally per attendee** among the **departments of those who attended** (one calculation, half up to the kobo, remainder to the first). **Cost per attendee** is the total divided by those who attended, shown as an average.
3. **Budget.** An **annual training budget** for the company (and, if you want, per department). The page shows **spend against budget** and a plain "over budget" warning; **nothing is blocked** (it is a record, not a control), unless you say otherwise (T3).
4. **Who sees it.** HR records. Finance and the auditor read the totals. **No screen shows what one named person's training cost**; only totals and averages (a cost for one person is derivable from a one-attendee session, so **a session with fewer than three attendees shows no per-attendee figure**).
5. **Tests first** (money, tenant isolation, audit by ids and amounts, the reversal rule, the department share and its rounding with a worked example in the explain-back note).

## 5. Slices 4B and 5A in brief

**4B.** The policy gets a **kind** (policy, handbook, SOP) and an **"acknowledgement required"** flag (on for a policy, **off** for a handbook or SOP unless HR switches it on). **Existing policies keep behaving exactly as they do.** An optional **review-due date** puts the item in the HR digest when it is overdue. Employees read all three kinds on one page. **No file upload** until a host and the encryption key exist: a document is text, or a reference.

**5A.** An employee raises an enquiry (a category, a subject, a message). HR replies; the employee can reply once more or close it. Status: open, answered, closed. **No automatic reply, no chatbot.** The first reply time is recorded; a company setting gives the **first-response target** and the HR digest lists overdue enquiries. The raising screen says plainly that **a grievance, harassment, whistleblowing or a welfare concern must go through Employee relations, not here**. HR can **move an enquiry into a case** (it opens a case through the existing case process; it does not copy the conversation).

## 6. Business rules I need from you (my recommendation next to each; none is assumed)

**Training cost**
- **T1.** What counts as a cost: *Recommended:* **fee, travel, materials, venue, other**; **no staff time or wages** (that is pay, which this must never touch).
- **T2.** Who records: *Recommended:* **HR (the right to manage HR records)**; a cost line above a **threshold you set** needs a **second person** (the same second-person rule used elsewhere); *you choose the threshold or say none.*
- **T3.** The budget: *Recommended:* **one annual company budget, with an optional budget per department**; **over budget is a warning, never a block.**
- **T4.** Sharing a session's cost across departments: *Recommended:* **equally per attendee** (as in section 4). *Alternative:* all to the department that requested it.
- **T5.** Who reads the totals: *Recommended:* **HR, finance and the auditor**; **never one person's cost**; **no per-attendee figure under three attendees**.
- **T6.** Currency: *Recommended:* **naira only.**

**Handbook and procedures**
- **K1.** Kinds: *Recommended:* **policy, handbook, SOP.**
- **K2.** Acknowledgement: *Recommended:* **required for a policy, not for a handbook or SOP**, switchable per item.
- **K3.** Review date: *Recommended:* **optional**, with a reminder when overdue; you may prefer **mandatory for an SOP, every 12 months.**
- **K4.** Who writes them: *Recommended:* **the HR administrator** (as policies today).

**HR enquiries**
- **E1.** Categories: *Recommended:* **payslip or pay question (a question, never a change), leave, a letter request, a policy question, benefits, other.**
- **E2.** The sensitive route: *Recommended:* the warning on the screen, plus **HR may move an enquiry into a case**.
- **E3.** Who reads an enquiry: *Recommended:* **the employee and the HR administrator only** (not managers, finance, the auditor or the administrators), **every read by HR logged**, because it is free text about a person. *Alternative:* anyone with HR view access.
- **E4.** First-response target: *Recommended:* **3 working days**, a company setting.
- **E5.** Keeping enquiries: *Recommended:* the **same default period as other HR records** (a founder default, not legal advice), cleared by anonymisation of a former employee; **for the lawyer.**
- **E6.** Does an employee see other people's enquiries: *Recommended:* **never.**

## 7. Risks and what I did not do

- **Training cost is the first money in the HR area.** It must follow the exact-money rule, which is why 4A is tests-first with worked examples, and why it posts nothing.
- **Enquiries are free text about people.** Hence E3 and the sensitive route; **retention periods are for the lawyer.**
- **4B changes the policy model** (two columns). Existing policies must behave exactly as before; a test pins that.
- **I have not walked the existing training or policy screens in a browser for this plan**; "what exists" follows the schema and the service functions. **I have not measured** the effort: each slice is likely one migration and two to three pull requests.
- **The reminders and the HR digest** would gain lines (overdue enquiry, overdue review): small, but they touch an existing screen.

## 8. What I recommend you do

1. **Answer section 6** (or say "approve section 6 as recommended").
2. **Say "go" for slice 4A first** (it is the one with money, so it deserves the most care), then 4B, then 5A.
3. **Say which of T2's threshold, K3's review rule and E3's readers you want changed**; those three are the ones I am least sure about.
