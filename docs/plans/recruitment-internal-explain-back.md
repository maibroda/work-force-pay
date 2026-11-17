# Recruitment slice B: internal vacancies (explain-back note)

Written 2026-11-17 for the founder's choice of 2026-11-17 ("Slice B: internal vacancies") under the plan's section 5, rules 6 and 7, approved as recommended on 2026-11-16 (`recruitment-depth-1a-plan.md`). **No money, pay or statutory setting is touched; no new permission; no public surface** (employees only, signed in). One additive migration. **Please read "Where I departed from, or chose within, the plan" and "Decisions for you".**

## What the code does, step by step

1. **Publishing.** HR (anyone who can manage HR records) publishes an **approved** requisition inside the company with a **mandatory deadline** (a date, not in the past) and a **summary written for employees** (20 to 600 characters). They can extend the deadline or take the vacancy down; applications already made stay.
2. **What an employee sees.** Only: the title, the role, the department, the type of contract, the target start, the deadline and the summary. **Never** the justification, the budget, the hiring manager or who raised the requisition. A vacancy is listed only while it is **published, approved and not past its deadline** (the deadline day itself is still open), and only within the employee's own company.
3. **Applying.** Any employee with a login linked to an employee record, **still employed**, may apply **once** to an open vacancy; **the hiring manager of that vacancy may not**. It creates an **internal candidate** (source INTERNAL) with their name and an optional note (500 characters). **The system tells nobody**: no message, no notification, no page of the applicant's manager shows it.
4. **What the applicant sees.** Their own applications: the vacancy, the day and the stage. **Nothing HR recorded about them** (screening answers, scorecards, shortlist decisions).
5. **Who sees an internal applicant (rule 7).** **HR (the right to assess candidates) and the interview panel only.** The administrators, finance and the auditor do **not** see them in the candidates list, on the requisition or on their page (a direct visit is a "not found"). **One exception:** once an **offer exists** for them, anyone with HR access can see them, so that the offer can be approved. Funnel **counts** include them; their names and details do not appear.
6. **Hiring is blocked for an internal applicant.** The existing hire **creates a new employee**, so it would give a current employee a **second employee record**. It is refused with a plain message. **The move itself (a promotion or transfer) is not built here** (see "Decisions for you").
7. **Interview panels (the slice A rule).** For an internal applicant, **the applicant and the applicant's line manager may not sit on the panel.**

## Where each rule comes from

The founder's approval of 2026-11-16 of the plan's section 5: rule 6 (any employee may apply; the applicant's own manager is not told by the system; the deadline is mandatory) and rule 7 (HR and the panel only see an internal applicant); and the slice A rule that a line manager may not sit on their own internal candidate's panel.

## Worked example

HR publishes the "Site Supervisor" requisition until 15 December with the summary "Supervise a team of guards at the new Ikeja site…". The requisition's private justification ("replace a leaver quietly") and its budget are **not shown**. An employee, Ada, applies with the note "I would like a move from my current team". **Her manager is not told and sees nothing.** The Company Administrator opens the requisition: **"Candidates (0)"**; the candidates list does not show Ada; opening her page by its address gives "not found". HR sees her as CAN-000008, marked as an internal applicant with a link to her employee record. When HR later raises an offer for Ada, the approver can see her to approve it. **Clicking hire is refused**: she is already an employee.

## What could go wrong, and what I did not do

- **The approver exception widens who sees an internal applicant at the offer stage.** It is needed so that an offer can be approved; the alternative is that the approver cannot see whom they approve. Say if you prefer a different rule (for example the approver sees only a number and a role).
- **HR sees internal applicants like any other, including the optional note.** The note is free text about a person: it is **already cleared by the existing applicant anonymiser** (the candidate's notes) when an unsuccessful applicant is anonymised. Retention runs are on HOLD; this is the existing applicant anonymisation, not a change to it.
- **Existing audit rows of a requisition carry its justification text.** This is how requisition raise and approve have always been logged; I did not change it. It is not related to this slice, but anyone who reads the audit log (the administrators and the auditor) can read a requisition's private justification there. Worth a decision on its own.
- **An employee cannot withdraw an application** (HR moves the candidate to "withdrawn"). Not built: the plan did not ask for it.
- **Not built:** a candidate's own data request does not include their internal applications (a question for the lawyer, as for scorecards and screening); no message to the applicant when their stage changes.

## Where I departed from, or chose within, the plan

1. **A short summary for employees.** The plan said "two columns on the requisition"; I added a **third (the summary)** so that employees never see the justification. This is a departure.
2. **A deadline day is still open on the deadline day.**
3. **The hiring manager may not apply to their own vacancy** (not in the plan; a conflict that seemed clear).
4. **An approver can see an internal applicant once an offer exists** (point 5 above).
5. **Hiring is blocked** for an internal applicant (point 6): the plan did not say what hiring an internal applicant means.

## Decisions for you

1. **What should "selected" mean for an internal applicant?** It cannot be the existing hire. Options: (a) a **promotion or transfer** recorded with the existing movement and promotion processes, started from the candidate page; (b) HR closes the requisition and records the move by hand. **I recommend (a), built as its own piece, once you have said how the pay, contract and effective date should follow.** That touches contracts and pay, so I would stop and ask before building it.
2. **Whether the approver exception is right** (point 5), and **whether the requisition's private justification should stay readable in the audit log.**

## Tests that prove it (written first; the new service did not exist)

`tests/integration/recruitment-internal.test.ts` (13): publishing (approved only, the deadline mandatory and not in the past, a summary, HR only, extend, take down, tenant isolation, audit holds the deadline and never the summary); what an employee sees (exactly the permitted fields; only open, approved, in-date, own-company vacancies, including the deadline day); applying (once, an internal candidate with the right fields; refused for a closed vacancy, an unlinked login, a person who has left, the hiring manager; the audit entry holds ids only); the applicant's own view; who sees an internal applicant (HR yes; the administrators, finance and the auditor no, in the list, the requisition and the page; yes once an offer exists); the panel rule; the hire refused. **No existing test changed.** **Browser check (local demo company, synthetic data, removed afterwards):** HR published a vacancy through the screen; an employee saw only the permitted fields (the private justification and budget did not appear), applied with a note and saw "You have applied"; the Company Administrator saw "Candidates (0)", no entry in the list, and a "not found" on the applicant's page; the audit log did not hold the note.
