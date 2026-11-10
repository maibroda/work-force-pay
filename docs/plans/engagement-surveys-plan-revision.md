# Engagement surveys: revision after the founder's decisions of 2026-11-10

Written 2026-11-10. This **revises** `docs/plans/engagement-surveys-plan.md` (#180) with the founder's decisions (`docs/plans/founder-decisions-2026-11-10-hr.md`). **Still a proposal: nothing is built and no migration is written until the founder confirms the one choice in section 3 and says "go".** Everything in the original plan that is not changed here stands.

## 1. What the founder decided

- **Five** completed responses before any aggregated result is shown, and **a group of fewer than ten is not shown on its own** (suppressed, or combined into a larger group). **A group under ten may still take part.**
- **HR sees participation counts only.** Individual responses are confidential.
- **24 months** for raw responses; then the identifiable raw responses are deleted; **aggregated results are kept in anonymised form** (indefinitely, subject to re-identification safeguards).
- **Hybrid participation from the first release:** the portal for employees with a login, a **QR code**, a **shared company device** (a designated tablet or computer), and an **assisted session** by an authorised HR representative. **Every employee receives a unique survey access code or equivalent eligibility token.** Duplicate submissions are prevented; an assisted session must not let a supervisor influence an answer; administrators must not be able to identify individual answers through reporting.

## 2. What changes in the plan

1. **The minimum audience of ten is dropped as a rule for taking part.** A survey may be run for a group of any size. What changes is **display**: a group's results are shown only when the group has at least ten **invited** employees **and** at least five completed responses; otherwise that group is **combined into the next larger group** (its department, then the company) or hidden. The next-smallest hiding rule from the original plan stays, so a hidden group cannot be worked out by subtraction.
2. **Access codes.** When a survey opens, every invited employee gets **one unique access code** (random, at least 10 characters, stored only as a hash). An employee with a login does not need the code: the portal knows who they are. An employee without a login uses their code at **one of three entry points**: a **QR code** on a poster or sheet at the site (it opens the survey page on their own phone, where they type their code), a **shared company device** in kiosk mode (the page resets after each person), or an **assisted session**.
3. **The assisted session** is run only by a person holding a new permission, **`survey.assist`** (an authorised HR representative, never a supervisor or the person's manager). The HR representative opens a kiosk session on a device and **hands the device to the employee, who types their code and answers alone**; the representative does not see the answers. The session records only that a session happened (survey, day, device label), never who attended.
4. **The code and the answer are separated at the moment of use.** In one step the system (a) checks the code is valid, unused and for this survey, (b) marks the code used, and (c) stores the answer with **no code, no person, no time and a random identifier**. After that nothing links the code (and so the person) to the answer. HR sees only **how many codes were used**, never which.
5. **Who may see which codes.** Codes are generated and shown **once**, in a printable sheet per site or department for the HR representative to hand to each person (the sheet lists name and code, and is the only place the mapping exists; the system does not store it in a readable form). A code can be **reissued** (the old one is cancelled) if lost. Reissuing is audited by survey and employee id, never by code.
6. **Retention.** Raw answers are deleted **24 months after the survey closes**. Before deletion the system stores the **anonymised aggregate** for each question (the distribution and average, overall and for each group that was shown), which is kept. The deletion is recorded in the audit log (survey id and counts).
7. **Participation counts** are shown overall and per group under the same display rule as results (a group under ten is folded into the next larger group).

## 3. The one choice that needs the founder's confirmation

The register describes responses as **"confidential"** and says **"identifiable raw responses"** are deleted after 24 months. The original plan, and this revision, store answers with **no link to the person at all** (there is nothing identifiable to delete: the raw answers themselves are deleted at 24 months). **That is stricter than "confidential but identifiable".** The reason is the guards: on a small site, an identifiable answer is a risk to the person even when HR cannot browse it. **Recommendation: keep answers unlinked.** The cost is that a person cannot later be shown their own answer, and no analysis by person is possible (which the register does not ask for). If you want identifiable-but-confidential answers instead, say so and the design changes (answers keyed to the person, readable by no screen, deleted at 24 months).

## 4. Migration, permissions and tests (once approved)

- **Migration (additive, reversible, round-tripped):** the five tables of the original plan (`Survey`, `SurveyQuestion`, `SurveyParticipation`, `SurveyResponse`, `SurveyAnswer`) plus `SurveyAccessCode` (survey, employee, code hash, status), `SurveyKioskSession` (survey, day, device label) and `SurveyAggregate` (the kept anonymised result), and one enum (survey status).
- **Permissions:** `survey.manage` (the HR administrator, or the Delegated HR Officer once that role exists), `survey.assist` (an authorised HR representative). Reading results uses `hr.view`.
- **Tests first:** a code is single-use and cannot be reused after use or for another survey; an answer has no code, person or time and a random id; no service returns which codes or which employees took part; the display rule folds a group under ten and applies the next-smallest hiding; a group under ten may take part but is never shown alone; an assisted session never records who attended; a supervisor cannot run one; reissuing cancels the old code; the 24-month deletion removes raw answers, keeps the aggregate and is audited; a survey is refused results while open or under five answers; tenant isolation; audit by ids and counts only.

## 5. Not in this revision

Printing is a browser print of the code sheet; no email or SMS is sent (no notifications in this step); no paper-form keying (the assisted session replaces it); no per-person results; no scheduling of repeat surveys.
