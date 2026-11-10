# Learning and development, step 1: training needs and a training calendar

Written 2026-11-10. **A proposal only: nothing is built and no migration is written until the founder answers the questions in section 6 and says "go".** It is the first item of "Learning & development, then welfare and recognition, then career and succession" in `docs/plans/founder-decisions-2026-11-05.md` ("training needs and a calendar, because training records already exist"). It is deliberately small: the later parts of the review's L&D function (skills-gap analysis, effectiveness evaluation, learning paths, budgets) are listed in section 5 and are not in this step. I have assumed no rule about what training a company must give; the company sets its own requirements, as it does today.

## 1. What exists today (checked in the code on 2026-11-10)

- **Certificate records** (`EmployeeTraining`): an employee's course, provider, certificate number, issue and expiry dates, status, recorded by HR on the employee's profile.
- **Required courses** (`TrainingRequirement`, set by the company in Settings): a course name, whether it is required of everyone or one employee category, and a **grace period** for a new joiner. **Compliance is worked out** (`src/lib/training-compliance.ts`, `src/server/services/training.ts`): for each employee and requirement, Valid, Expiring soon, Expired, Missing or "due (new joiner)", matching the **course name** of a held certificate.
- **Screens and alerts:** HR > Learning & development > Training compliance (who is missing or expired), the training reports, and a line in the HR daily digest ("Required training expired or missing", "Certificates expiring soon").
- **From the appraisal:** a recommendation of "Further training" is recorded and starts nothing (correct: a score must not trigger a process on its own).
- **Not there:** any way to **plan** training: a list of what each person needs, a **calendar** of sessions with seats, **enrolment** and **attendance**, or any link from attending a session to the certificate record. A missing certificate is seen, but nothing helps HR do something about it. The employee has no page about their own training.

## 2. What step 1 adds

1. **Programmes and sessions (the calendar).** A **programme** is a course the company runs or buys (name, provider, how long its certificate stays valid, in months, if it expires). A **session** is a dated occurrence of a programme (date and time, venue, trainer, seats). HR sees a **calendar** of sessions by month with seats taken, and can cancel or complete a session.
2. **Training needs.** A **need** says "this employee needs this course": the employee, the course, why (**a compliance gap** found by the existing check, **an appraisal recommendation**, **a manager's or the employee's request**, **other**), a priority, and a due-by date. The page lists **needs not yet in a session**, and the compliance gaps that do not yet have one, so HR can see at a glance what is waiting. A recommendation on an approved appraisal gets an **"Add to training needs"** button (never automatic).
3. **Enrolment and attendance.** HR enrols people in a session (up to its seats, no waiting list in this step), and after it records each person **Attended or Did not attend** (with a reason if not). A person is never enrolled twice in a session.
4. **Attendance feeds the certificate record.** Marking someone **Attended** on a session whose programme has a course name **creates their certificate record** (course, provider, the session date as the issue date, the expiry from the programme's validity), so the **existing compliance check turns Missing or Expired into Valid on its own**. HR can add the certificate number afterwards, as today. A programme whose certificate does not expire creates a record with no expiry. A need linked to that course is marked **Met**.
5. **The employee sees their own training** (**My training**, under My HR): upcoming sessions they are enrolled in, and the courses they have attended, read-only. Nothing about other people.

## 3. The rules in plain terms (with a worked example)

- **Who does what:** HR (`hr.manage`) creates programmes and sessions, enrols people and records attendance. Anyone who can read HR records (`hr.view`) sees the calendar and the needs. **The employee sees only their own.** No new permission is needed (training is not sensitive in the way a plan or a document can be).
- **Seats are a hard limit**, checked on the server; a cancelled session keeps its enrolments but they can no longer be marked attended.
- **Attendance is recorded by HR, never by the employee**, and marking someone Attended is what creates the certificate record; **correcting a mistake** (marking Attended by error) removes only the certificate record that attendance created, and records who did it, so a real certificate HR typed in separately is never touched.
- **Nothing is automatic about people:** a need is added by a person, an enrolment is made by a person, and the compliance gaps are only **listed** as likely needs.
- **Worked example:** the company requires "First aid" of every guard (valid 24 months, grace 30 days). The compliance page shows 12 guards Missing. HR creates the programme "First aid" (certificate valid 24 months), schedules a session on 20 November with 15 seats, and enrols the 12 from the needs list. After the session HR marks 11 Attended and one Did not attend (on leave). The 11 now hold a certificate dated 20 November expiring 20 November two years later, so the compliance page shows them Valid; the twelfth stays Missing and stays on the needs list for the next session.

## 4. Files, migration, permissions and tests (once approved)

- **Migration (additive, reversible, round-tripped on a copy of the seeded database):** four tables, `TrainingProgramme`, `TrainingSession`, `TrainingEnrolment`, `TrainingNeed`, and a few enums (session status, attendance, need source and status). No existing table changes meaning; `EmployeeTraining` gains one nullable column pointing to the enrolment that created it (so a correction removes only that record).
- **Pure functions first** (`src/lib/training-plan.ts`): seats left, the certificate expiry from a session date and a validity in months, which compliance gaps lack a planned session, the status moves of a session and a need. **Unit tests first.**
- **Extend, do not duplicate:** the compliance rules stay where they are; the new code only **creates the same certificate records HR creates by hand today**, through the same function, so the existing check and the digest keep working unchanged.
- **Services and screens:** HR > Learning & development > **Training calendar** and **Training needs**; **My training** under My HR; the "Add to training needs" button on an approved appraisal; each page declared in `entry-modules.ts` and in the navigation.
- **Tests (integration, written first):** a session cannot be over-filled; an employee cannot be enrolled twice; attending creates exactly one certificate record with the right expiry and turns a Missing requirement Valid; marking attended by mistake and correcting it removes only that record; a cancelled session cannot be completed; a need becomes Met when its course is attended; an appraisal recommendation never creates a need on its own; the employee sees only their own sessions and history; another company sees nothing and cannot enrol its people; roles without `hr.manage` are refused on every action; the audit log carries ids and field names only.
- **Personal-data rules (learned from earlier steps):** attendance and needs are personal data about the employee, so they go into **the employee's copy of their data** and **erasure removes the free text** (a missed-attendance reason, a need's note), with tests, in the same change. The certificate records are already covered.
- **Documents:** release notes, the data dictionary (regenerated), an explain-back note (the link between attendance and the certificate record, with a worked example).

## 5. What is not in this step

**Costs, budgets and training spend** (money would need its own rules), **skills-gap analysis**, **effectiveness evaluation** after a course, **learning paths**, a **waiting list**, **trainer and venue management**, **external bookings**, **notifications** about a session (email or SMS), managers requesting training for their team, and any change to how compliance is worked out.

## 6. Questions for the founder (my recommendation in bold)

1. **Does marking someone Attended create their certificate record?** **Yes**, with the programme's validity; HR can add the certificate number later. (The alternative is that HR keeps recording certificates by hand after every session.)
2. **Who adds training needs?** **HR only in this step**, from the compliance gaps, an appraisal recommendation, or on someone's request. Managers requesting for their team can follow once you have seen how HR uses the list.
3. **Costs:** **left out of this step.** If you want a cost per programme or per seat, it needs your rules (naira, who approves spend) and its own step.
4. **Seats:** a hard limit with **no waiting list**. Is a waiting list needed now?
5. **A required course vs an optional one:** the programme is linked to a course name; if it matches a required course, attending satisfies it. **Optional courses work the same way and simply do not appear as compliance gaps.** Right?
6. **Training that is not delivered by the company** (an employee brings a certificate from elsewhere): **stays as today**, recorded by HR on the profile; it can also close a need.
7. **Notifications** to people enrolled in a session: **not in this step.** The employee sees their upcoming sessions when they sign in.
8. **The employee's page:** **upcoming sessions and attended courses only**, read-only. Should it also show what they are required to hold (their own compliance)? **I suggest yes, in a later step.**

## 7. Suggested order of work once you say "go"

One pull request with one migration: (1) the pure rules and their unit tests, (2) the schema and migration, (3) the service and integration tests (sessions, enrolment, attendance and the certificate link), (4) the needs list and the appraisal button, (5) the screens and My training, (6) the data-copy and erasure coverage, (7) docs, the explain-back note and the full suite, (8) browser checks with HR, the employee and another company, and a report.
