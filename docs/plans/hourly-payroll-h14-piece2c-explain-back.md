# Explain-back note: hourly pay, H14 piece 2, step 2c (the screens for paid sick leave)

Step 2c of piece 2 (paid sickness) of `hourly-payroll-h14-build-plan.md`, on the founder's "CONTINUE" of 2026-11-21. **No migration and no pay changes**: it only puts screens on the services of step 2a (record and approve a spell, #258) so people can actually use them. The pay for sick days is step 2b (#259). Files: `src/server/services/sick-leave.ts` (four small additions), `src/app/actions/leave.ts` (six actions), the two existing leave screens (`/me/leave` and `/leave`).

## Where it is, and why there are no new pages

**The screens are sections of the two leave pages that already exist**, not new pages: "My leave" for the person, "Leave management" for HR. That keeps the navigation, page permissions and company module switches exactly as they are (no new route to protect or to pin in a test). The sections appear **only when paid sick leave is set up** (paid sick days above 0 in the leave policy).

## What a person sees (My leave, only if paid by the hour and paid sick leave is set up)

1. **Their days:** "3 of 5 paid sick days left in your leave year (1 Jan to 31 Dec): 2 approved, 0 waiting", or when the service period is not complete, the date it falls due.
2. **Record my sickness:** the first and last day and **the medical certificate, chosen from their own medical documents** (the kind and the date it was added, never its contents). If they have none, the screen says to add it under **My documents** first, with a link there.
3. **Their spells:** the dates, the working days, the status, who decided and any reason, and **Cancel** while a spell they recorded is waiting.

## What HR sees (Leave management, only HR: `leave.manage`)

1. **Record a spell:** HR chooses **the certificate, which says whose it is** (the list shows the employee number and name, the kind and the date), then the first and last day.
2. **Every spell** (the latest 100), newest first: employee, dates, working days, status, who recorded it and who decided, with **Approve / Reject (a reason is required) / Cancel** on a waiting spell. **Approve and Reject are hidden, with "Needs another approver", for the spell's recorder and for the person it is about** (the service refuses them too: the screen only avoids a failed click).
3. If paid sick leave is not set up, the section says so and points to the Leave policy.

## Who sees what (nothing here widens access)

HR sees every spell of the company; a person sees only their own; **a supervisor sees none** (the section is not shown and the list is empty for them). The certificate list is the company's medical documents for HR and a person's own otherwise, **archived and non-medical documents left out**, up to 300 for HR. Everything is scoped to the caller's company. The server enforces all of it; hiding a button is not the control.

## What could go wrong, and what is NOT covered

- **I have not looked at the screens in a browser.** They are covered by the service tests, lint and the type check, not by a page test (the project has none for these pages). Please look at both before relying on them.
- **The certificate list for HR is long in a large company** (up to the newest 300, labelled with number and name). A search box would be a later improvement.
- **Cancelling an approved spell is not offered** (step 2a): a wrongly approved spell needs a decision from you.
- **The screens do not show what a spell will be paid**: the pay comes from step 2b, once the payroll is calculated.

## Tests that prove it

`tests/integration/sick-spell-screens.test.ts` (5): HR sees the company's medical documents with whose they are, a person only their own, a supervisor none, another company none, archived and non-medical ones left out; HR records a spell by choosing the certificate (the employee comes from it), a person cannot, another company's certificate is not found; "My leave" shows nothing while paid sick leave is not set up, for a person paid monthly and for an account with no employee, and for a person paid by the hour shows the days, their own spells and their own certificates; the HR list names the employee on every spell, newest first. The decisions themselves are tested in step 2a (`sick-spell.test.ts`).
