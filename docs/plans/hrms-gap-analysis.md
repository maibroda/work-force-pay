# HRMS gap analysis for WorkforcePay

Written 2026-11-14 against `main` at `0ee7edd` (governance step 6 merged; step 7 is in PR #201, not yet merged). **This is the first deliverable the founder's HRMS master prompt asks for. It is an audit only: no code, schema or navigation was changed, and nothing below is implemented until the founder approves the scope.**

## 1. How this was checked, and what it does not prove

Evidence used: the navigation (`src/lib/nav.ts`), the data model (`prisma/schema.prisma`), the service functions and their tests, the release notes and plans in `docs/`, and the features built and browser-checked in earlier sessions. **Not proven:** that every screen is polished or complete in use. I did not walk every page in a browser for this report; where a statement rests on a code search alone it says "not found in code". A screen existing is not taken as proof of a workflow: statuses below follow the persisted data, the service rules and the tests.

Legend: **Built** = data model, business rules, permissions, audit and tests exist. **Partial** = some of it exists. **Missing** = not found.

## 2. The headline: the preliminary table in the brief is mostly wrong about this codebase

The brief's own gap table says it is "not a verified code-level audit". Verified against the code, **six of its ten rows are misclassified**: recruitment, assessment and hiring, engagement and retention are largely built already, and the true gaps are much narrower than "new module".

| # | HR process (from the infographic) | The brief's guess | Verified status | Evidence (where to look) |
| --- | --- | --- | --- | --- |
| 1 | Recruitment and sourcing | New module | **Built**, narrower gaps (section 3A) | `JobRequisition` (approval, hold, close), `Candidate` (stages APPLIED to HIRED, source, duplicate check inside a requisition), `src/server/services/recruitment.ts` |
| 2 | Job advertisements, employer branding | New module | **Partial**: job descriptions and KPIs exist; no vacancy publication or portal | `JobDescription`, `/hr/job-descriptions`; no public route under `src/app` |
| 3 | CV screening, shortlisting | New module | **Partial**: a SCREENING stage and a CV reference string; no CV file, no criteria, no scoring | `Candidate.resumeReference` (text) |
| 4 | Interview design | New module | **Partial**: rounds, one interviewer, one score, a recommendation, feedback; no panels, question banks or scorecards | `Interview` model |
| 5 | Assessment, hiring decisions | New module | **Built**: offers with approval, acceptance, vetting checks gate the hire, hire creates employee, contract, pay rate and onboarding in one transaction | `createOffer` to `hireCandidate`, `CandidateCheck` |
| 6 | Onboarding | Enhance | **Built**, small enhancements | `OnboardingTask`, checklists, documents register, guarantors and next of kin, kit issue, probation workflow |
| 7 | Training, knowledge | Enhance | **Built**, two gaps (cost, knowledge base) | needs, requests, calendar, sessions, enrolments, evaluation, certification expiry, skills |
| 8 | HR operations, policies | Enhance | **Built**, one gap (general HR enquiries) | policies with versions and acknowledgements, letters and templates, data requests, breaches, leave, relations and welfare cases |
| 9 | Performance, feedback | Enhance | **Built**, gaps in objectives and mid-year | appraisals (annual, probation, ad hoc), KPIs, feedback, improvement plans, promotions, recognition |
| 10 | Engagement, retention | New module | **Built**, narrower gaps (risk indicators, interventions) | anonymous surveys, recognition, exit records, attrition report |
| + | Career, succession (the brief's addition) | n/a | **Built**, one gap (internal opportunities) | career paths, skills and gaps, succession, promotions |

## 3. What exists, and what is genuinely missing, by area

### A. Recruitment (brief section 2)

**Built:** manpower requisition with a justification, budget, hiring manager and an approval or rejection with a reason, hold and close; candidate pipeline with stages and a source; a block on the same person twice **within one requisition**; interviews, feedback and recommendations; vetting checks (the hire is **blocked** while a check is pending or failed); offers (create, approve, send, record response, withdraw, expiry date); offer letters from templates; **hiring converts the accepted candidate into an employee, a contract, a pay rate and the onboarding checklist in one transaction**, refusing a person already on staff or flagged not eligible for rehire; every step audited; unsuccessful applicants' details are anonymised on a retention rule.

**Missing or partial:**
1. **An external application portal** (a candidate applies without a login) and publishing a vacancy internally or externally with an application deadline. No public application route exists.
2. **CV and document upload for candidates.** Only a text reference exists. (Employee documents have an encrypted file store; candidates do not use it.)
3. **Structured screening:** configurable criteria, explainable scores, a reviewed shortlist.
4. **Interview panels, structured questions and scorecards**, and **comparing candidates' scores side by side.** Today there is one interviewer and one score per interview round.
5. **A talent pool across requisitions** (the duplicate check is per requisition only).
6. **Configurable approval levels** for requisitions and offers: they have one approval step plus the fixed second-person rules, not a configurable chain.

### B. Onboarding and lifecycle (section 3)

**Built:** onboarding tracker and checklist templates, employee documents with types and verification, guarantors and next-of-kin, policy acknowledgement, kit and uniform issue, contract and probation dates, **the probation workflow** (recommendation, HR review, independent decision, feedback to the employee, one response), probation reminders and escalation, promotion proposals, movements, exits with clearance and the settlement. **One employee master record** is the single source of truth (hiring writes to it).
**Missing or partial:** candidates cannot submit pre-employment documents themselves (depends on the portal); no consolidated "onboarding completion" dashboard beyond the tracker.

### C. Learning and development (section 4)

**Built:** training needs, requests with approval, an annual calendar, programmes, sessions, enrolments and attendance, **effectiveness evaluation** (anonymous five-answer rule), a certification register with **expiry dates and reminders**, requirements by category, skills, levels and learning paths, history on the employee profile.
**Missing:** **training expenditure and cost reporting** (no cost fields were found on programmes or sessions); a **SOP and knowledge repository** separate from policies.

### D. Performance (section 5)

**Built:** appraisal cycles (**annual, probation and ad hoc**), criteria and ratings, **KPIs attached to job descriptions** and to appraisals, employee self-assessment and comments, review, approval and acknowledgement, **feedback entries**, **performance improvement plans**, promotions, recognition.
**Missing or partial:** **structured employee objectives** with weights and progress (appraisals carry a free-text goals field only); a **mid-year review kind**; performance **distribution analytics** by department.

### E. HR operations and employee relations (section 6)

**Built:** policies with versions and acknowledgement tracking, letters and templates (offer, confirmation, probation confirmation, warning, exit, experience, clearance), data access requests, data breaches, leave, **employee relations cases** (grievance, misconduct, harassment, whistleblowing, counselling, mediation) kept **separate** from documents and linked to the profile, **welfare cases**, sanctions with maker-checker, **second-person rules**, **read-logging** of the most sensitive records, delegated HR officer.
**Missing or partial:** a general **HR enquiry and service-request tracker** for employees (queries that are not grievances); a distinct **employee handbook and SOP** area.

### F. Engagement and retention (section 7)

**Built:** **anonymous engagement surveys** (no link to the person, a five-answer minimum), recognition, **exit records with reason and interview notes**, an **attrition report** (turnover rate, voluntary and involuntary, by reason, category, department and tenure, date range), and a **workforce overview** analytics page.
**Missing:** **retention-risk indicators** (none found; must be explainable and human-reviewed), **retention interventions and management action tracking**, **replacement-cost** reporting, a location filter on attrition.

### G. Career and succession (section 8)

**Built:** career paths, skills assessments and gap views, learning paths, **succession planning** (nominate, approve by a different person, readiness), promotions, an employee career page.
**Missing:** **internal job opportunities**; employee **career aspirations** were not found in code (the employee career page exists; its contents were not audited for this).

## 4. Cross-cutting requirements (brief sections 9 to 14)

| Requirement | Status | Notes |
| --- | --- | --- |
| One employee record | **Built** | hiring, onboarding, probation, training and cases all write to the same employee. |
| Role-based access, separation of duties, audit | **Built, strong** | maker-checker, second-person rules, delegated officer, read-logging, append-only audit; critical modules are explained in `docs/plans/*-explain-back.md`. |
| Configurable approval workflows | **Partial** | approvals exist per module; a **configurable chain** and **overdue-approval escalation** exist only for probation (alert and escalation days). |
| Notifications and reminders | **Partial** | an HR digest and payroll reminders exist; no general escalation engine. |
| Dashboard with date, department and location filters and export | **Partial** | Built: the `/hr` overview and the candidates page show a **recruitment funnel** (requisitions pending and open, candidates in the pipeline by stage, offers pending, hired), a **training compliance** view, the **attrition report** (date range, by department and tenure) and a workforce analytics page; the generic reports area has CSV export. **Missing:** recruitment **turnaround time** (time to fill), **department and location filters** on the recruitment and HR views, and CSV export on the HR views (none found in code). |
| AI assistance | **Missing, by design so far** | no AI service, SDK or call exists in the code. Adding one is a **new third-party dependency** that needs your approval and data-residency review (see section 6). |
| Nigerian data protection and records | **Partial, strong foundation** | data access requests, breach register, retention schedule with **legal holds** and audited, second-person retention runs, unsuccessful-applicant anonymisation. **No consent controls for HR data** were found (consent exists only in the sales module). |
| Statutory settings | **Built** | effective-dated, with "adviser verified" fields; nothing statutory should be hard-coded (unchanged). |

## 5. Proposed scope and sequence (nothing starts without approval)

The founder's priority order (recruitment, onboarding and probation, performance, L&D, HR operations, engagement, career, AI) still stands; the audit only **narrows each item to its real gap**:

| Phase | Real work | Database changes (indicative) | Depends on |
| --- | --- | --- | --- |
| 1 Recruitment depth | candidate portal and vacancy publication; CV file upload; screening criteria and explainable shortlist; interview panels, question banks and scorecards; candidate comparison; talent pool | vacancy publication fields, candidate documents, screening criteria and scores, panel members, interview questions and scores | the portal is a **public surface** (rate limits, consent, spam), the encrypted file store and its host key |
| 2 Onboarding and probation | candidate-submitted pre-employment documents; onboarding completion view | small | phase 1 |
| 3 Performance | structured objectives and progress; mid-year kind; distribution analytics | objectives table, one enum value | the founder's rules on weighting |
| 4 Learning | training cost and expenditure; knowledge base | cost fields, repository | none |
| 5 HR operations | HR enquiry tracker; handbook and SOP area | tickets table | none |
| 6 Engagement and retention | retention-risk indicators, interventions and action tracking, replacement cost | indicators, actions | **the founder's rules for what counts as a risk, and explainability** |
| 7 Career | internal opportunities, aspirations | small | none |
| 8 Cross-cutting | configurable approval chains and overdue escalation; recruitment turnaround time and filters and exports on the HR views; consent controls | approval chain tables | **the approval chains the founder wants** |
| 9 AI | only after the above, per use case | none (a service integration) | **a new third-party dependency: needs approval** |

## 6. Risks and backward compatibility

- **Public candidate portal:** the first unauthenticated write surface in the HR area. It needs rate limiting (also still open for the survey code page), spam control, a lawful-basis and consent wording for applicants, and the retention rule that already anonymises unsuccessful applicants.
- **File uploads** reuse the encrypted document store, which needs `DOCUMENT_ENCRYPTION_KEY` and a separate backup on the host (still open).
- **AI:** a third-party model service is a new dependency that sends personal data outside the platform. It must be approved, scoped to permitted data, human-reviewable, and never decide hiring, discipline, promotion or termination.
- **Existing behaviour:** every phase above is additive; none needs to change pay, statutory settings or the audit log. Changes to an existing rule (for example the approval chains) must keep the existing second-person rules and tests green.
- **Every new table needs** a reversible migration round-tripped on a seeded copy, tests first, tenant-isolation tests and an explain-back note, as for the governance work.

## 7. Business rules that must be approved before any build (no assumptions)

1. **Candidate portal:** who may apply, what data is collected, the consent wording, how long applications are kept (the unsuccessful-applicant period is currently a founder default, not legal advice).
2. **Screening criteria and scoring:** what counts as a criterion, whether a score may ever filter a candidate out (the brief says **never automatically reject**), and who may shortlist.
3. **Interview panels and scorecards:** panel sizes, scoring scales, who records the hiring recommendation, and who approves selection.
4. **Approval chains:** which chains are configurable, their default steps, and when an overdue approval escalates and to whom.
5. **Failed probation (already decided in principle):** the founder's preliminary view is that a failed probation **must not** automatically qualify for renewal, any exception needs documented justification and HR approval with an audit trail, and it should lead to performance management or exit. **Today an undecided probation cannot be renewed (step 4), but a failed one still can. I have not changed it and will not until the rule is approved.**
6. **Retention-risk indicators:** which signals are allowed, how they are explained, who sees them, and that they never decide anything.
7. **Retention (records):** the lawyer's review of the periods, and the answers to the seven questions on the retention run, which was built on my recommended answers.
8. **Objectives and mid-year reviews:** weighting, scale and who signs off.
9. **AI:** which use cases, which provider, and the data-residency position.

## 8. What I recommend you decide next

1. Confirm or correct the **corrected classification** in section 2.
2. Choose whether **phase 1 (recruitment depth)** is next, and answer the rules in section 7, items 1 to 3.
3. Confirm that nothing for failed-probation renewal, retention logic or AI is built until its rules are approved.
