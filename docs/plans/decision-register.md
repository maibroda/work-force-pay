# Project decision register

Opened 2026-11-14 from the founder's consolidated direction of that date. **This register separates four things that were being mixed: decisions the founder has approved, business rules that are settled, items that need a proposal before approval, and technical actions that may proceed now.** A business-rule approval is never permission to skip implementation review or deployment controls: every code change below goes through its own pull request and CI, and **nothing is merged without the founder's explicit "merge #N"**.

Status key: **A** approved and authorised to proceed, **R** rule settled (no code yet), **P** proposal written, awaiting approval, **E** waiting on an external dependency, **H** held.

## 1. Decisions and what they authorise

| # | Item | Decision (2026-11-14) | Status | What is authorised now | Where |
| --- | --- | --- | --- | --- | --- |
| 1 | HRMS gap analysis | Review and correct the classifications first; **recruitment depth is the next priority after review**; preserve all existing functionality; no structural work until the scope is approved; **do not commit the report yet** | P | Present the final report for review (done, uncommitted). Nothing built. | `hrms-gap-analysis.md` |
| 2 | Failed-probation renewal | **Rule approved in principle:** an employee who fails probation may still be considered for renewal, with controls (below). **Never automatic.** | R, then P | **Document the configurable parameters and the approval workflow, and confirm them before any code.** | `failed-probation-renewal-proposal.md` |
| 3 | Retention changes | **Hold.** No further change to retention functionality. | H | Present the seven open decisions in one table (done). | `retention-run-decisions.md` |
| 4 | Lawyer's review of the retention periods | A prerequisite. **Do not finalise or implement the periods until it is received.** | E | Nothing. | (external) |
| 5 | Survey anonymity | **Genuine anonymity.** Individual responses must not be identifiable by HR, managers or other users through the application; aggregated reporting; minimum five before results show; no leak through comments, metadata or small groups. | A | Review the implementation against these properties and add privacy regression tests; propose any hardening. | `survey-anonymity-review.md` |
| 6 | Training evaluation (the merged plan of PR #187) | **All ten recommendations approved.** | A | **Implement** (one PR, one small migration, tests first). | `training-evaluation-stages-plan.md` |
| 7 | Host settings: document encryption key | Configure securely through the hosting provider's secret settings; never commit, log or show the key. | E | Prepare the procedure and verification checklist. **No host has been chosen, so it cannot be configured yet; I will never see the key.** | `host-configuration-and-demo-data.md` |
| 8 | Host settings: survey code rate limit | Implement an appropriate configurable limit; report threshold, abuse protection and test results. | A | Implement as its own PR. | `host-configuration-and-demo-data.md` |
| 9 | Synthetic demo data | Approved, with safeguards (fictional only; clearly distinguished from real records; isolated from production payroll and statutory calculations; a controlled reset). | A, then P | Propose the safeguards' design first (a database flag needs a migration), then build as its own PR. **Design approved and built 2026-11-19** (flag, banner, bank-file and remittance block, seed test; the scoped reset was dropped, demo data lives in its own database): `demo-data-safeguards-explain-back.md`. | `host-configuration-and-demo-data.md` |
| 10 | Hourly-based payroll (weekday, weekend and public holiday hourly rates) | **Requested 2026-11-19.** Assessment, architecture, database design and sixteen decisions written; **answered 2026-11-19: H1 (combination, most specific first), H2 (actual hours per calendar day), H3 (holiday rate wins), H4 (overtime a separate premium, not built), H6 (monthly)**; **H5, H9, H10, H16 answered 2026-11-19 as recommended (approved breaks deducted; supervisor approves, never the capturer; a missing clock-out is not payable; corrections by a new entry, original kept)**; H7, H8, H12 to H15 and H17 still open; nothing built, no rate or rule assumed. | P | **Phase 1 merged (#238)** (pure hours functions and tests, no migration; not wired into pay). **H11 answered 2026-11-19: the work location's state decides the holiday. Phase 2 built 2026-11-19** (branch `hourly-payroll-phase2`, one additive migration: a per-company switch OFF by default, effective-dated hourly rates approved by a second person, how a person is paid from a date, holidays limited to states; not wired into pay; `hourly-payroll-phase2-explain-back.md`). **H17 raised: should a contract's paid-days basis consider only national holidays?** **Phase 3 built 2026-11-19** (branch `hourly-payroll-phase3`, one additive migration: time entries, supervisor approval never the capturer, a missing clock-out never paid, approved breaks deducted, corrections by a new entry; not wired into pay; `hourly-payroll-phase3-explain-back.md`). **H18 raised: breaks are recorded as clock times, not minutes.** **Phase 3 merged (#240). Phase 5 built 2026-11-19** (branch `hourly-payroll-phase5`, no migration: four hourly reports, indicative cost, not wired into pay; budget against actual NOT built, no budget exists; `hourly-payroll-phase5-explain-back.md`). Later phases wait for the remaining answers. (pure hours functions and tests, no migration) can start. | `hourly-payroll-assessment.md` |

## 2. Business rules now settled

1. **A failed probation may be reconsidered, never automatically.** Renewal needs: a documented justification from the supervisor; HR review and approval by the designated authority; the extension period and a revised review date; measurable performance-improvement expectations; formal communication to the employee; a complete audit trail. (Parameters and workflow: item 2 above.)
2. **Surveys are genuinely anonymous:** no individual response is identifiable through the application by anyone; aggregated results only, from five answers; comments, metadata and small groups must not reveal who answered.
3. **Training evaluation** has three stages, an effectiveness evaluation at 120 days (configurable by company, 0 = never), only for programmes HR flags, results per programme only and never by name, five answers minimum, evidence from before-and-after skill assessments shown read-only, the employee sees the manager's assessment, and nothing feeds pay, appraisal, promotion or skills.
4. **No HR policy becomes functionality on an assumption.** A business rule is approved in writing before it is built.

## 3. What is waiting for the founder

| Item | What I need |
| --- | --- |
| Gap analysis | Corrections to the classifications, and confirmation that **recruitment depth** is next, with answers to section 7 of the report. |
| Failed-probation renewal | Approval or changes to the proposed parameters and workflow. |
| Retention | Approval of the seven answers (one table), after considering the **conflict flagged in the table between question 2 and your rule that the lawyer's review is a prerequisite**. |
| Survey hardening | Approval of the optional hardening in the review (the main controls already hold). |
| Demo data | Approval of the proposed safeguards design. |

## 4. Suggested order of execution (the founder's)

1. Governance and configuration: this register, the survey rate limit, the survey anonymity review, the demo-data safeguards design.
2. Training evaluation (approved, tests first).
3. Gap analysis review, then recruitment depth.
4. Failed-probation renewal, after its parameters are approved.
5. Retention, after the seven decisions and the legal review.

## 5. Separate pull requests

Each approved piece of code is its own pull request and is reported with its link: (a) the survey rate limit, (b) training evaluation, (c) survey anonymity tests, (d) demo-data safeguards. Documents that are proposals or the gap analysis are not committed until the founder has reviewed them.
