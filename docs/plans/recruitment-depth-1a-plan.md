# Recruitment depth, phase 1a: a plan for the founder's approval

Written 2026-11-16. **A proposal only: no code, schema or screen has been changed, and nothing is built until the founder approves the scope and answers the business rules in section 5.** It follows the gap analysis (`hrms-gap-analysis.md`, section 3A and section 5, phase 1) and the register's "recruitment depth is next" (`decision-register.md`, item 1). **It is the internal half of phase 1 (1a). The public candidate portal (1b) is not in it.**

## 1. What exists today (read in the code on 2026-11-16)

- **A requisition** (`JobRequisition`): number, title, role, department, hiring manager (an employee), headcount, justification, budget, one approval step, hold and close.
- **A candidate** (`Candidate`) belongs to **exactly one requisition** (`requisitionId` is required). Stages APPLIED, SCREENING, INTERVIEW, ASSESSMENT, OFFER, HIRED, REJECTED, WITHDRAWN. A duplicate (same phone or email) is refused **only inside the same requisition**. A CV is a **text reference string** (`resumeReference`). Name, phone and email are stored as plain columns and **reading a candidate is not read-logged**.
- **An interview** (`Interview`): a round, a time, **one interviewer stored as a name (text, not a link to an employee)**, one **1 to 5 score**, one recommendation (strong hire, hire, no hire, strong no hire) and free-text feedback. **Only someone holding `hr.manage` can record the feedback** (`recordInterviewFeedback`), so a hiring manager or supervisor cannot enter their own assessment. **A finding (verified in the code, not changed):** `getCandidate` is open to **everyone who holds `hr.view`** (which includes finance, the auditor and the administrators, not only HR), and returns the interviews with their **free-text feedback**, the checks and the offers. Candidate and interview reads are **not read-logged**, and the read log has no kind for them.
- **Vetting checks, offers (with approval, acceptance, expiry) and hiring** (one transaction creating the employee, contract, pay rate and onboarding) are built and tested. **They are not changed by this plan.**
- **Nothing in the system shows candidates side by side**, and nothing publishes a vacancy.

## 2. The slices, each its own pull request, in my recommended order

| Slice | What it adds | Database (additive, reversible) | Depends on |
| --- | --- | --- | --- |
| **A. Panels, scorecards and comparison** | an interview panel of two to five **employees** (one chair); each panel member records **their own scorecard** (a score per criterion, a comment, a recommendation); a **comparison page** that puts candidates for one requisition side by side with the basis of every figure; **never ranks or filters anyone out** | panel member, scorecard criterion (per requisition), scorecard score; nullable links, **the existing score and recommendation columns stay as they are** | the rules in section 5, items 1 to 5 |
| **B. Internal publication** | an approved requisition can be **published inside the company** with an application deadline; employees see open vacancies and may apply (an internal candidate, source INTERNAL, seen only by HR and the panel) | two columns on the requisition, one on the candidate | slice A not needed; rules 6 and 7 |
| **C. Screening criteria and explained shortlist** | per requisition, **criteria** (must have, preferred); the reviewer records, per candidate and criterion, **met, not met or unclear with the evidence**; the page shows "n of m criteria met" **with each answer visible; it never ranks, filters or rejects**; a shortlist is a **human decision with a recorded reason** | criterion, candidate screening answer | rule 9 |
| **D. Candidate documents (CVs)** | staff upload a CV or document for a candidate, stored in the **existing encrypted document store** | candidate document | **a chosen host and `DOCUMENT_ENCRYPTION_KEY`**, and the **applicant retention rule must delete the files** (see section 4) |
| **E. Talent pool** | the same person across requisitions, a warning (not a block) on a cross-requisition duplicate | a person record separate from an application: **the largest change** | **applicant consent wording and retention from the lawyer**; best built with the public portal (1b) |

**Recommended order: A, then B, then C, then D, and E with 1b.** A and B need no host and no public surface; D waits for the host; E is held until the lawyer has seen the consent wording.

## 3. Slice A in detail (what I would build first)

1. **Panel.** An interview gets **panel members who are employees with a login** (a hiring manager, a supervisor, an HR person). A panel member sees **only the candidates and interviews they sit on**, never the whole pipeline.
2. **Scorecard.** HR (or the chair) sets the **criteria for the requisition** (for example: relevant experience, communication, reliability). Each panel member scores each criterion **1 to 5** (the scale the interview score already uses) with a comment, and gives one recommendation (the existing four values). The member can edit their scorecard **until the interview is closed**.
3. **Blind scoring (your decision, section 5 item 3).** Until every member has submitted or the chair closes the interview, **no member sees another member's scorecard**, so no one is influenced by a colleague.
4. **Comparison.** For one requisition, HR and the hiring manager see **per candidate**: each member's scores and recommendation, the **spread** (lowest, highest, average) and the **number of members who scored**, with **the basis of each figure one click away**. **No ranking, no "best candidate", no automatic rejection.** The page says so.
5. **Selection.** The hiring recommendation is recorded by the **chair**; **selection is approved by a second person** (not the chair) before an offer can be created. **This is a new step in front of the existing offer, and the existing offer approval stays.**
6. **Audit and privacy.** Every step is audited **by ids and the outcome, never a comment**. Candidate details and scorecards are **read-logged** with the same read log used for other sensitive records (a new kind of record for it), **and who may read interview feedback is narrowed to HR and the panel** (today it is everyone with `hr.view`; **narrowing it changes what finance, the auditor and the administrators can see, so it needs your decision**, section 5 item 8). A scorecard's comments are **cleared when an unsuccessful applicant is anonymised** (extends the existing applicant retention).
7. **Tests first:** the panel sees only its own candidates; a non-member is refused; blind scoring holds until the rule lifts it; no one can score twice or after closure; the chair rule; the second-person selection; tenant isolation; the audit holds no comment; the comparison never reorders or hides a candidate; the existing recruitment tests unchanged.

## 4. Dependencies and risks

- **Access control is a critical module.** A panel member is a new kind of reader of candidate data. I would add a narrow, explicit right and **test that a panel member cannot reach any other candidate or HR page**. This needs your "go" and an explain-back note.
- **Bias and fairness.** Scores are advisory, shown with their basis, and never filter anyone. The risk that a person over-relies on an average remains; the page shows the spread and the count to discourage it. **Not a legal review:** whether recording scores per criterion creates obligations (for example answering an unsuccessful applicant's data request about their scores) is for the lawyer.
- **Applicant data.** Candidate comments and scorecards are free text about a person who is not an employee. **They go into the existing applicant anonymisation** (same retention period, still a founder default and not legal advice).
- **Slice D** puts files under the applicant retention rule: **the anonymiser must delete the files, not only the text**, which touches retention code. **Retention is on HOLD** (register item 3), so slice D needs you to lift the hold for that one change, or D waits.
- **Nothing here touches pay, statutory settings, the audit log's design or the offer and hire logic.**

## 5. Business rules I need from you before slice A (I have written my recommendation next to each; none is assumed)

1. **Panel size and who may sit on it.** *Recommended:* two to five employees, one chair, never the candidate's own line manager if the candidate is internal.
2. **Scale and criteria.** *Recommended:* the existing **1 to 5**; **three to six criteria per requisition**, chosen by HR with the hiring manager; **no weighting** in the first version.
3. **Blind scoring.** *Recommended:* **yes**, until all members have submitted or the chair closes the interview.
4. **Who records the hiring recommendation.** *Recommended:* the **chair**.
5. **Who approves selection.** *Recommended:* a **second person** who is not the chair: the hiring manager's manager, or HR. *Your choice* of which.
6. **Internal applications (slice B).** *Recommended:* any employee may apply to a published vacancy; the **applicant's own manager is not told by the system**; the deadline is mandatory.
7. **Who sees an internal applicant.** *Recommended:* **HR and the panel only**.
8. **Who may read interview feedback and scorecards.** *Recommended:* **HR and the panel members only** (not finance, the auditor or the administrators), with every read logged. *This changes what those roles can see today, so it is your decision.*
9. **Screening (slice C).** *Recommended:* criteria are **advice**; **a score never rejects**; shortlisting is a **named person's decision with a reason**.

## 6. What I did not do and cannot yet say

- **I have not walked the existing recruitment screens in a browser for this plan**; the "what exists" section follows the schema, the service functions and the tests.
- **Effort and number of pull requests** are estimates: slice A is likely one migration (about four tables) and two to three pull requests.
- **I have not checked** what the existing candidate and requisition pages look like on a phone.

## 7. What I recommend you do

1. **Answer section 5, items 1 to 5 and item 8**, or say "approve section 5 as recommended".
2. **Say "go" for slice A**, including the new narrow access right.
3. **Leave slice D, slice E and the public portal for later**, as they wait on the host, the lawyer and the retention hold.
