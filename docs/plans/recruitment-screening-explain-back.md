# Recruitment slice C: screening criteria and an explained shortlist (explain-back note)

Written 2026-11-17 for the founder's choice of 2026-11-17 ("Slice C: screening") under the plan's section 5, which you approved as recommended on 2026-11-16 (`recruitment-depth-1a-plan.md`, rule 9). **No money, pay, statutory setting or bank file is touched. No new permission, no new reader of candidate data, no public surface.** One additive migration.

## What the code does, step by step

1. **Criteria.** HR (the right to assess candidates, `recruitment.assess`, the HR administrator alone) sets **one to ten criteria** for a requisition, each a **must-have** or **preferred**, all different. They can be changed until the first answer is recorded.
2. **Answers.** For each candidate HR records, **for every criterion**, one of **met**, **not met** or **unclear**. A **met or not met needs the evidence** (at least five characters); an unclear needs none. Recording again replaces the earlier answers; the person who recorded is kept. Only a candidate still in the pipeline can be screened.
3. **Shortlist.** HR records a **named decision** (shortlist or do not shortlist) with a **reason of at least ten characters**. If the requisition has criteria, **all must be answered first**. A later decision replaces the earlier one. It needs no criteria if the requisition has none.
4. **Overview.** A page lists **every candidate of the requisition in the order of their candidate numbers**, with each answer and its evidence, a count (met, not met, unclear, and **how many must-haves were not met**) and the shortlist decision. **Nothing is ordered, filtered or hidden by the answers**, and a candidate not yet screened is shown as "not yet screened".
5. **Nothing moves a candidate.** **No answer, count or shortlist decision changes a candidate's stage, blocks a move or rejects anyone.** A person moves each candidate, exactly as before.
6. **Privacy.** The evidence and the reasons are free text about a person who may not be an employee. They are read by **HR alone**, **every read is logged** (the same "interview feedback and scorecards" kind as slice A, shown by the requisition's or candidate's number), the **audit log carries ids and counts only**, and when an unsuccessful applicant is **anonymised the evidence and the shortlist reason are cleared** (the answers and the decision stay).

## Where each rule comes from

The founder's approval of 2026-11-16 of section 5 of the plan, rule 9: "criteria are advice; a score never rejects; shortlisting is a named person's decision with a reason", and the gap analysis's "never automatically reject".

## Worked example

A requisition for a site guard has two criteria: *Valid security licence* (must-have) and *Speaks Yoruba* (preferred). HR records for Ada: licence **not met**, evidence "no licence card was shown"; Yoruba **unclear**. The overview shows Ada with "0 met, 1 not met, 1 unclear of 2; 1 must-have not met". HR decides **do not shortlist**, reason "licence not shown on the papers". **Ada stays first in the list** (candidate numbers decide the order) and **can still be moved to the interview stage by a person**: the screening did not stop it (checked in the browser and by a test). Bayo, not yet screened, is listed too.

## What could go wrong, and what I did not do

- **A "must-have not met" count could be read as a verdict.** The page says in plain words that it is advice and that a person moves each candidate; it is shown as a count, never as a filter. The risk that a person over-relies on it remains.
- **Only HR screens.** Hiring managers do not see or record screening answers (that would be a new reader of free text about applicants). Say if a hiring manager should.
- **Not built:** screening answers in the candidate's own data request (a question for the lawyer, as for scorecards); a delegated HR officer function; any scoring or weighting of criteria; any change to the public portal (none exists).
- **The anonymiser was extended** (the evidence and the shortlist reason), as for slice A. **Retention runs are on HOLD; this is the separate applicant anonymisation that already existed.** Same question as for slice A: please confirm it is within the hold.
- **Not browser-checked:** that the administrators, finance and the auditor are refused the screening pages (covered by the tests and by CI's smoke test, which opens every page as every role).

## Tests that prove it (written first; the new service did not exist)

`tests/integration/recruitment-screening.test.ts` (16): the right is held by the HR administrator alone; criteria (one to ten, named, each must-have or preferred, different, HR only, locked after the first answer, tenant isolation); answers (every criterion once, an outcome from the three, the evidence for met and not met, replaced on re-recording, recorder kept, HR only, needs criteria, open candidate, own company); shortlist (a reason, the answers first, HR only, replaced, allowed with no criteria, **never moves or blocks a candidate**); overview (candidate-number order however they answered, each answer and evidence, counts, no rank, nobody hidden, HR only, logged, own company); the audit log holds no evidence or reason; the anonymiser clears them and keeps the answers and the decision. **No existing test changed.** **Browser check (local demo company, synthetic data, removed afterwards):** HR set the criteria and recorded the answers and a shortlist decision through the screens, then moved the not-shortlisted, failed-must-have candidate to the interview stage; the overview showed both candidates in number order; the audit log held no evidence text.
