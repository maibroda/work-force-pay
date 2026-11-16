# Survey anonymity: review of the built implementation against the approved rule

Written 2026-11-14. **The founder approved genuine anonymity:** individual responses must not be identifiable by HR, managers or other users through the application; reporting is aggregated; no result is shown below five; and identity must not leak through comments, metadata or small groups. This reviews what is built (engagement surveys, #180/#182/#183) against that rule. **The main controls already hold; a few residual risks are listed with proposed hardening.**

## 1. What is built, checked in the code

| Property | Evidence | Holds? |
| --- | --- | --- |
| A response carries **no person, user or time** | `SurveyResponse` has only an id, the survey and an optional role and department; `SurveyAnswer` only the value, an optional comment and a hide flag | **Yes** |
| **Who took part** is not linked to what they answered | participation lives only on `SurveyAccessCode` (employee, code hash, status, the **day** used); a response has no code, no time and no link back | **Yes** |
| **Nothing below five** is shown | `MIN_RESPONSES` (5): below it a question shows no count, no average and no comments | **Yes** |
| **Small groups** are protected | a group is shown only with **at least ten invited and five answers**; smaller groups are merged into "other", shown only if large enough; **complementary suppression** hides the next-smallest group when exactly one is hidden, so a hidden group cannot be found by subtraction | **Yes** |
| **Comments** do not identify | comments appear **only from five answers, unattributed, in alphabetical order** (not submission order), with no group; HR can **hide** a comment and the reason is kept; after retention the anonymised result is kept **without comments** | **Yes** (see risk 1) |
| **No page lists who took part** | no screen or query selects the participation rows for display | **Yes** |
| **Audit** carries no identity | submissions and results are audited by survey and counts only | **Yes** (the existing tests assert it) |
| The employee's own copy of their data | lists only that they took part and the day (their own participation), never what they answered | **Yes** |

## 2. Residual risks, and proposed hardening (not yet built)

1. **A comment can identify its author by its content** (for example naming a site, a rota or an incident only one person was involved in). The application cannot judge content. **Mitigations that exist:** the HR hide tool and the five-answer minimum. **Proposed:** a clear line above the comment box telling respondents not to include names or details that identify them or others; and a note on the results page that HR should hide comments that do. *(Text only, no migration.)*
2. **A database administrator (not an application user) could infer a respondent in a very small role-and-department cell**, because the access code row and the response both carry the same role or department. **This is outside "through the application"**, but it can be removed: store a response's role and department **only when that group is large enough to be shown on its own** (ten invited), otherwise store none, so the "other" row loses nothing. *(A change to how a response is stored; no migration; needs your approval because it changes stored data semantics.)*
3. **The day a code was used** is kept per person (their own participation). Responses carry no time, so the day cannot be matched to a response. **Proposed:** keep as is, and say so on the employee-facing wording. *(No change.)*
4. **Kiosk sessions** record the day and the device label and the HR person who started it, never a respondent. *(No change.)*
5. **Shared-device kiosk use** could let a person watch another type; this is a physical risk, mitigated by one-time codes and the reminder to use a private moment. *(No change.)*

## 3. What I will do (authorised: "ensure the implementation does not inadvertently expose identities")

1. **Add privacy regression tests** that pin each property in section 1 that is not already pinned (a response has no person or time, comments are unattributed and below five hidden, small and complementary groups, the audit and the employee export carry no answers), written as a single "no re-identification" suite.
2. **Add the guidance text** (risk 1).
3. **Propose, not build, risk 2** until you approve it.

Anything the tests find is reported before it is fixed.
