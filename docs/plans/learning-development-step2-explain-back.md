# Explain-back note: manager training requests, my required training and training evaluation (learning and development, step 2)

Branch `ld-step2`. One migration, `20261205090000_training_requests_and_evaluation` (additive: two enums, two tables, one HR policy column). This touches **personal data** (what a participant and a manager say about a course, and a request's reasons) and **access control** (who may request, decide and read results), and it sits next to the training compliance data, so please read it. Built on your "go" of 2026-11-10 to the plan `docs/plans/learning-development-step2-plan.md` (#177). **You did not answer the plan's ten questions, so I used my recommended answers; they are listed under "Assumptions".** **No money is involved. Nothing in this step changes pay, status, a certificate, an appraisal or how compliance is worked out.**

## The rules, step by step

1. **A request** is a manager's ask for a course for **one of their own direct reports**; HR may ask for anyone; **nobody for themselves**. For anyone a manager may not ask about, the answer is only "Employee not found". It needs a named course (3 to 120 characters) and a reason (at least 10). An employee who has left cannot be asked for, and one person cannot have two open requests, or a request and an open need, for the same course (matched the way compliance matches course names, so "FIRST   aid" is "First aid").
2. **Deciding.** Someone with `hr.manage` who is **not the person who asked** accepts or declines; a decline needs a reason (at least 5). A decided request cannot be decided again. **The person who asked can withdraw it while undecided**, with a reason; HR can withdraw any.
3. **Accepting adds one training need and nothing else**: source "request", status open, a fixed note "Requested by a manager" (never the manager's own words). It enrols no one, books no seat and creates no certificate; a test counts enrolments and certificates before and after. If the person already has an open need for the course, accepting is refused and the request stays undecided.
4. **The employee is not told of a request.** A need is HR's planning list (as in step 1), so there is nothing for the employee to see. A request that is declined, withdrawn or still being considered is not in their copy of their data either.
5. **My required training** reads the same \`assess\` rule the HR compliance screen reads (same requirements, same grace period, same alert window), for the signed-in employee's own record only. A test checks it gives the same answer as the HR screen for the same person. A new joiner in the grace period sees "Due by" the day the grace period ends.
6. **The participant's evaluation.** Only the person who attended can answer, once, about that course: a whole number 1 to 5 and an optional comment of up to 300 characters. It is optional and changes nothing.
7. **The manager's evaluation.** A manager (or HR) answers once, about a person who **attended**, **60 days after the session** (the company's setting; 0 means the manager is never asked and the answer is refused). A manager can evaluate only their own direct report (anyone else: not found); nobody evaluates their own training.
8. **What HR sees.** Per programme: how many participants answered and the average, **only from five answers**; below five the count, the average and the comments are all hidden (shown as "fewer than 5"). The participant's comments, once shown, are **unnamed and in alphabetical order** so they cannot be tied to the order people answered in. The managers' evaluations are by name and HR reads them.
9. **What the employee reads.** The manager's evaluation of their own training (as they read feedback). **Never** a participant's answer, and never anyone else's evaluation. A test checks the exact fields returned.
10. **Personal data and audit.** The employee's own answers, the manager's evaluations of them and accepted requests are in the copy of their data. On erasure the comments, the request's reason and any decision or withdrawal note are removed; the ratings, kinds and statuses stay, and the audit log stays. **Audit entries carry ids and the kind only**, never a comment, a reason or a note. Every new query selects only the fields it returns (the lesson of the My career fix).
11. **HR digest:** attended courses past the 60 days with no manager evaluation are listed ("Training evaluations the manager has not given"); nothing is listed when the company sets 0 days.

## A worked example

Sade (a supervisor) asks for "First aid" for Gbenga, a guard whose certificate expires in five weeks, with two sentences of why. Ngozi (HR) accepts it: Gbenga now has an open training need for First aid, and nothing else about him changed (he is not enrolled and has no seat). Gbenga's **My training** page already showed "First aid: expiring soon, valid until 14 Dec" because it reads the same rule HR reads. Ngozi enrols him on the 20 November session and marks him Attended; his certificate is created as in step 1. He is invited to say how it went and gives a 5 (nobody but he knows he did, and HR sees nothing until five people have answered). **Sixty days later** Sade is asked whether it was applied on the job and answers 4 with a line of comment; Gbenga can read it on **My training**, and HR can read it by name. The programme's results show, once 11 participants have answered, a count of 11, an average of 4.2 and 11 unnamed comments. With only 3 answers, HR would see "fewer than 5" and no comments.

## What could go wrong, and what proves it does not

| Risk | Test |
| --- | --- |
| A manager asks for someone who does not report to them, or for themselves | \`training-evaluation.test.ts\`: "Employee not found" / "yourself" |
| The person who asked also decides | the decide tests: refused for accept and decline |
| Accepting enrols someone, books a seat or creates a certificate | the accept test: enrolments and certificates counted before and after: identical; exactly one need |
| The employee learns of a declined or undecided request | the visibility test and the data-copy test: not shown anywhere to the employee |
| "My required training" disagrees with the HR compliance screen | the required-training test compares both for the same person |
| A participant is picked out by a small group or by the order of comments | the results tests: under five answers no count, no average, no comments, no names; from five, unnamed and sorted |
| A manager evaluates someone who is not their report, too early, twice, or for a course not attended | the manager tests: refused each way; 0 days switches it off |
| The employee reads a participant's answer or someone else's evaluation | the "what the employee reads" test: exact fields, no other person's text |
| An evaluation changes pay, status, a certificate or an appraisal | the "changes nothing" test: identical before and after |
| A comment or reason leaks to the audit log, survives erasure, or erasure touches someone else | the audit and erasure tests: no secret in the audit log; words removed, shape and audit kept, others untouched |
| Another company reads or changes anything | the tenant isolation test |
| The migration loses data | round trip (up, down, up) on a copy of the seeded database: counts unchanged, schema identical |

## Assumptions (my recommended answers to the plan's questions; change any of them)

1. Scope: requests, my required training and evaluation, with skills, paths and costs later. 2. **A manager may request for direct reports; HR decides.** 3. **The employee may not yet request their own training.** 4. **The participant's answer is confidential, not anonymous**: stored against their enrolment so each person answers once, never shown to HR by name, shown only from five answers. 5. **The employee reads the manager's evaluation.** 6. **60 days** after the session, as a company setting (0 = never). 7. **Five** is the minimum before results are shown. 8. **The required-training view shows the grace period** of a new joiner. 9. **An evaluation never feeds an appraisal.** 10. Skills-gap analysis and learning paths come next, then costs once you give the rules.

Smaller choices you did not ask for: **this step adds two enums, not one** (a request needs its own status, so the plan's "one enum" is two); **a participant is asked for 120 days after the course**; **HR (anyone with `hr.manage`) may also give a manager's evaluation** for anyone but themselves; **the HR "Evaluation results" page also shows the auditor** (read-only, like other HR records), who sees the same hidden-below-five results.

## What I did not do or test

- A lawyer should review the wording an employee sees and how long evaluations are kept.
- **Not built:** skills-gap analysis, learning paths, costs and budgets, a waiting list, trainer and venue management, external bookings, notifications, the employee requesting their own training.
- Browser checks are reported in the task report (what was seen on screen and what was not).
