# Explain-back note: governance step 3b-2, the retention run

For the founder. Plain language, payroll vocabulary. Plan: `hr-governance-step3b2-plan.md`. **This is the first change that removes the words of records on a schedule, it is irreversible once confirmed, and it adds a migration and changes who approves what: please read all of it.**

## Built on my recommended answers: you said "go" but did not answer the plan's seven questions

Everything below follows the plan's **recommended** answers. If any is wrong, tell me and I change it before anything is used:

1. **One run per kind of record** (not one run for everything).
2. **An unverified rule runs only if the Company Administrator writes down why they accept it** (20+ characters, recorded and flagged on the run). A rule the lawyer has verified runs on a plain note.
3. **HR proposes, the Company Administrator confirms, never the same person.** If the Company Administrator is the only person who could confirm, they may confirm their own proposal with a written reason (20+ characters), flagged.
4. **A rule can no longer say "delete" for any kind of record except raw survey answers**, because only those can be deleted. (This changes the schedule screen: saving such a rule is refused.)
5. **A person with a case or a data request still open is left out, not blocked:** the run goes ahead for everyone else and says how many it left out.
6. **A run cannot be confirmed in the same minute it is proposed.**
7. **Welfare cases are counted from the day they were closed**, so a run can clear the words of a case of someone who still works here (your default: six years after the case closes).

## What the code does, step by step

1. **Propose** (HR; for welfare cases or succession HR also needs that function's own right, which the Company Administrator does not have). The rule must say **anonymise**. The run fixes **what it covers**: the people (or records) past their period under the company's own rule, **minus** anyone a legal hold covers and anyone with a data request (or, for the kinds counted from leaving, a case) still open. Both people see **counts only**.
2. **Confirm** (Company Administrator only, a different person, no sooner than a minute later, with a note of 10+ characters). It refuses if the **rule changed** since the proposal (a changed rule is unverified again; propose again), if the **rule is unverified** and the note is under 20 characters, or if the confirmer proposed it while someone else could confirm.
3. **Confirming checks everything again**: a legal hold, an open case or data request, or an erasure since the proposal takes that item out, and the run says how many it left out.
4. **It then clears the words in one transaction** and records what it did. The words that go are **exactly the ones the erasure of a former employee removes** for that kind of record (I moved those field lists into one place, and erasure now uses them too, so the two cannot disagree). The shape stays: that the record existed, its kind, dates and outcome.
5. **The ledger** records each person or case it cleared, so a second run does not redo them and the "what is due" counts drop.
6. **Audit** carries the run id, the kind, counts, the flags and the rule's period, **never a name, a note or a word**. The run row keeps the confirmer's note (it is a business note, not about a person; the screen tells people not to name anyone).

## A worked example

Tunde's Security Co. keeps disciplinary records six years after someone leaves. Obi (HR) sees "Disciplinary records: 3 people past the period" and proposes a run. Ada has a legal hold, Bola has a grievance still open: the proposal covers **1 person** and says "left out: 1 held, 1 with something open". The rule is unverified, so Adaeze (Company Administrator) must write why she accepts it. A minute later she writes "The lawyer is away until next month and we accept the six years as proposed", and confirms. Chidi's disciplinary descriptions, remarks and notes become "[removed]" or empty; the fact that he had a query on a date, and how it ended, stays. The run shows "1 cleared", flagged "rule was unverified, accepted in writing". The counts for that kind drop by one.

## What could go wrong, and which test proves it does not

| Risk | Test (`tests/integration/retention-run.test.ts`, `tests/unit/retention-run.test.ts`) |
| --- | --- |
| A run clears the wrong thing (someone still employed, within the period, another kind, another company) | the nine "clears the words and keeps the shape" tests (one per kind), "leaves the other kinds alone", "never touches another company's records" |
| The shape is lost | the same tests: the row counts are unchanged after the run |
| HR runs it alone, or the proposer signs off their own run | "is for the Company Administrator alone", "refuses the person who proposed it ...", "lets the only person ..." |
| An unverified rule runs without a reason | "refuses an unverified rule unless ...", the unit verdict tests |
| A rule changed after the proposal still runs | "refuses a run whose rule changed ..." |
| A hold, an open case, an open data request or an erasure is ignored | "leaves out someone a legal hold now covers", "... who now has a case or a data request open ...", "a company-wide hold", the proposal tests |
| It runs twice or in the same minute | "cannot be confirmed twice", "cannot be done in the same minute", the ledger tests |
| A word or a name reaches the audit log | "audits the proposal, the confirmation and the rejection by ids, counts and flags, never a note or a word" |
| Another company confirms or rejects | "cannot be confirmed by another company's administrator" |
| The erasure of a former employee changed by my refactor | the 105 existing tests that exercise erasure still pass unchanged |
| A rule asks for a deletion nothing can do | the unit and integration tests for "delete" |

## What I did not do, and what to know

- **It cannot be undone.** Only the shape survives. **Back up the database before the first run** (the screen says so too). I have not tested a restore.
- **A record added for someone after their kind was cleared** is not covered by that person's ledger entry, so a run will not clear it (only the whole-person erasure will). I did not build a re-clear.
- **Probation:** a run clears the decision notes, the workflow's words and only the "Probation failed / extended / confirmed" lines of the contract's notes; other contract notes stay (the whole-person erasure clears all of them).
- **Not built:** runs for the employee file (it keeps its own request and approval), raw survey answers and applicants (their own HR-policy runs), the audit log and access logs (only ever reviewed), a hard delete of anything.
- **Browser check (demo app, synthetic data):** the Company Administrator was refused when trying to propose a welfare run (no welfare right); HR proposed it and saw only "Turn down", no Confirm; the Company Administrator's short note was refused ("This rule is unverified ..."); a written acceptance of 20+ characters confirmed it, the page showed "1 cleared, 0 left out; rule was unverified, accepted in writing", the database showed the case's words as "[removed]" and the audit entries held counts and flags only. I removed my synthetic case and run afterwards (the two audit entries stay: the audit log is append-only). **Not browser-checked:** a run for the other eight kinds, the hold/open-case skips and the single-holder path (all covered by the integration tests).
- **For the lawyer:** the periods are still your proposals, not legal advice. The verification gate is what keeps an unverified period from running without someone writing down why.
