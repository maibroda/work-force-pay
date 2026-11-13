# Explain-back note: governance step 3a, the retention schedule and legal holds

For the founder. Plain language, payroll vocabulary. Plan: `hr-governance-plan.md`, section 2.4 (retention). **This adds a migration (two new tables, additive) and a new permission, and it changes what three existing deletions do while a hold is in place: please read it.**

## What I built, and what I deliberately did not

Your note on the plan says the periods need legal advice and the defaults must be loaded **unverified**. So this first slice (3a) is the **safe, non-destructive** part:

1. **The schedule as data.** One rule per kind of record (fifteen): how long, counted from what, and what happens (delete, anonymise, review, keep). Your proposed defaults are loaded the first time the page is opened, **all marked unverified**. The Company Administrator records "the legal adviser saw this on this day" per rule; **changing a rule clears that verification**.
2. **Legal holds.** Suspend deletion for one person, one kind of record, or the whole company, with a reason and a review day. **Any HR administrator may place one** (waiting for the Company Administrator could let a deletion run first); **only the Company Administrator may release it**, with a reason.
3. **The three deletions that exist now check for a hold first**: erasing a former employee, anonymising old unsuccessful applicants, purging old raw survey answers.
4. **A "what is due" view** with counts only (no names).

**Not built (this is step 3b, after the lawyer has seen the defaults):** any new way to delete or anonymise (appraisals, probation, feedback, PIPs, disciplinary, training, skills, welfare cases, succession); automatic expiry notices; an audited retention run. **Nothing in 3a deletes anything new.** The schedule for those categories is a record and a reminder, and the screen says "Not measured yet".

## One thing to understand clearly: the schedule does not drive the deletions yet

The three deletions that exist keep using their **HR-policy settings** (employee file: years; applicants: months; survey answers: months). The schedule page **shows that setting next to the rule** ("applied by the system today") so the two cannot disagree silently, but editing a rule on the schedule does **not** change what is deleted today. I chose this because making the schedule drive deletion is a change to what gets destroyed, and the periods are not yet legally verified. Joining the two is 3b, on your word.

## What the code does, step by step

1. **First visit:** if the company has no rules, the fifteen defaults are written (unverified). They are never overwritten.
2. **Changing a rule** (Company Administrator only): checks the rule makes sense (delete or anonymise needs at least one month; keep has no period; whole months up to 100 years), saves it, clears the verification, audits the category and the **names of the fields changed**, never the note.
3. **Recording verification** (Company Administrator only): the adviser's name as given and the day (not in the future). Audit carries the category and day only.
4. **Placing a hold:** needs HR rights, a reason of 10+ characters, a review day after today, and (for a person) an employee **of this company**. Audit carries the hold id, scope, ids and review day, **never the reason**.
5. **Releasing a hold:** Company Administrator only, with a reason, once. Another company's administrator gets "not found".
6. **Erasing a former employee** now has one more blocker: "A legal hold is in place", checked when the request is made **and again when it is approved** (a hold placed in between stops it). It says a hold exists, **not why**. A hold on any record kind about people, or on the company, covers the whole person, because erasure removes everything about them at once.
7. **Anonymising applicants / purging survey answers:** a live hold on that kind of record (or the company) makes the run do nothing and say so.
8. **A person's hold reason is cleared if they are later erased** (the fact that a hold existed stays).

## Who can see what

The rules are visible to everyone who can read HR records (HR, auditor, Company Administrator and, through the read-everything set, finance). **The reason for a hold and the person it covers are legal matters**: only the roles that can see misconduct records see them. Finance sees that a hold exists and its kind, not why or about whom. Tested.

## A worked example

Tunde's Security Co. keeps former employees for six years. Ada left nine years ago and is due for erasure. Obi (HR) learns Ada may bring a tribunal claim and places a hold on her, review day 31 January. Zainab (HR) tries to request erasure: refused, "A legal hold is in place". On 31 January the hold shows "Review now". The claim is withdrawn; Adaeze (Company Administrator) releases the hold with a reason. Now Zainab can request erasure, and a different person still has to approve it, exactly as before.

## What could go wrong, and which test proves it does not

| Risk | Test (`tests/integration/retention-schedule.test.ts`, `tests/unit/retention-schedule.test.ts`) |
| --- | --- |
| A deletion runs under a hold | the four "stops ..." tests (erasure asked and approved, applicants, survey answers, company-wide) |
| A hold on someone else, or on another kind of record, blocks wrongly | "is not stopped by a hold on someone else, or on a category that is not about people" |
| Another company's hold or administrator interferes | the tenant-isolation tests for holds, release and the schedule |
| The HR administrator edits the schedule or releases a hold | the permission tests (only `retention.manage`) |
| A changed rule still shows as verified by the lawyer | "a change clears the verification" |
| A reason or note leaks into the audit log | the audit tests (hold reason, release reason, rule note, verification note) |
| Finance reads a legal reason | "shows the reason ... only to the roles that may see misconduct records" |
| An erased person's hold reason survives | "scrubs the words of a hold about a person" |

## Open questions for you and the lawyer (not decided by me)

- Whether a hold reason is part of a person's right to their own data (subject access) or is legally privileged. **I did not include it in the employee's copy of their data**; this needs the lawyer.
- Whether to join the schedule to the deletions (3b), and who approves the periods.
- Whether holds should appear in the HR digest when their review day arrives (not built).
