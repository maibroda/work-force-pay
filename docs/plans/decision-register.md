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
| 9 | Synthetic demo data | Approved, with safeguards (fictional only; clearly distinguished from real records; isolated from production payroll and statutory calculations; a controlled reset). | A, then P | Propose the safeguards' design first (a database flag needs a migration), then build as its own PR. | `host-configuration-and-demo-data.md` |

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

## 6. Founder decisions recorded 2026-11-19

The founder confirmed the following decisions on 2026-11-19. This section supersedes any earlier "waiting for founder" status above where the same item is addressed. **These approvals authorise the stated design or preparation only; they do not authorise merging any pull request. Every implementation remains subject to its own PR, CI/review and the founder's explicit approval to merge.**

### 6.1 Older audit rows (plan PR #232)

| Question | Decision | Status / boundary |
| --- | --- | --- |
| O1 — timing | Run the clean-up later, as a go-live checklist item, and only if the inventory finds affected historical rows. | A |
| O2 — `reason` column | Include `reason` in the redaction scope. | A |
| O3 — CODEOWNERS | Add the audit-seal files to CODEOWNERS before modifying them. | A |
| O4 — who may run it | Platform administrator only, following the founder's written authorisation; not exposed as a company-admin screen action. | A |
| O5 — retain old text | Do not retain a separate copy of the old free text. Normal database backup governance still applies; do not create a special plaintext archive. | A |

**Real-company-data status remains unverified.** Do not assume that no real company or employee data exists. Before go-live, inventory every database/environment the application has used and establish the provenance of records. The cleanup is conditional on that inventory and must be run only against the identified affected dataset, with its own recorded execution and post-cleanup audit-seal verification.

### 6.2 Failed-probation reconsideration / lawyer items

- **Reconsideration extension commencement:** settled. Count the approved extension from the date the employee is formally informed of the reconsideration. Record the notification date and calculate the revised review date from it.
- **Reconsideration statement wording:** retain the current plain-language wording only provisionally. It is not legally approved; obtain the lawyer's review before adopting it as the standard production communication.
- **Nine-month ceiling:** retain as a provisional technical ceiling only. It is not a confirmed statutory maximum or legal entitlement. Obtain the lawyer's written confirmation against applicable law, contract terms and any collective agreement before enabling the feature for production.
- No legal conclusion is inferred from the software configuration. These lawyer-dependent items remain **E** until written advice is received.

### 6.3 H4 — demo-data safeguards

**Approved on 2026-11-19.** Proceed with the H4 design and implementation in its own pull request. The approved safeguards include:

1. An explicit `isDemo` organization flag and a visible demo-company indicator.
2. Exclusion of demo organizations from platform-level production aggregates.
3. Server-side blocks on production bank-file generation and statutory-remittance generation for demo organizations.
4. A demo-only, tenant-scoped reset; it must never truncate or affect non-demo organizations.
5. Production and non-local seed protections, retaining the existing seed guard.

The demo flag must be enforced server-side on relevant APIs and services, not only in the UI. This approval authorises implementation and tests; it does **not** authorise running a reset against production data or merging the implementation PR.

### 6.4 Retention R1–R9

**Remain on hold.** No retention implementation, policy-period changes or production retention run is authorised. The lawyer's review remains a prerequisite.

### 6.5 Hosting decision

**Vercel is selected as the application-hosting direction.** Proceed with Vercel deployment preparation and a provider-specific configuration plan. The intended architecture is:

- Vercel for the Next.js application.
- Managed PostgreSQL, with documented backup and restore arrangements.
- External persistent object storage for CVs and employee documents, with encryption applied before storage as designed.
- A shared rate-limiting service and corresponding edge/proxy limits; in-process counters alone are not sufficient across multiple instances.
- The document-encryption key held only in the provider's production secret configuration; never committed, logged or disclosed in chat.

The Vercel selection does not imply that PostgreSQL, object storage or the shared rate-limiting provider has been selected. Verify data-processing terms, database and backup regions, access controls, recovery and applicable Nigerian data-protection/cross-border-transfer requirements before production employee data is loaded. Do not deploy real employee/payroll data until this review and the security configuration are complete.

### 6.6 Merge control

The founder explicitly reiterated on 2026-11-19: **do not merge any pull request without the founder's explicit approval.** A decision-register update, design approval, implementation approval, passing CI or a PR approval from another reviewer is not permission to merge. Wait for an explicit instruction identifying the PR to merge.

