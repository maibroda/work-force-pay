# Retention run: the seven decisions in one table

For the founder's approval. **No further retention change will be made until you approve these.** The retention run (`#197`) was built on my recommended answers because you said "go" without answering; this table lets you confirm or change each one. **Nothing is deployed anywhere yet, so no record has been cleared by the live code.** The lawyer's review of the periods remains a prerequisite for finalising any period.

A run clears the **words** of one kind of record and keeps the **shape** (that it existed, its kind, dates and outcome). **It cannot be undone**, so back up the database before the first run.

| # | Decision | What is built now (my recommended answer) | Business implications | Impact on existing records and later runs | My recommendation now |
| --- | --- | --- | --- | --- | --- |
| 1 | **Granularity**: one run per kind of record, or one run for everything due | **One run per kind** | The lawyer can approve kinds one at a time; HR does a few more steps. A single all-in run would clear nine kinds on one confirmation. | Each run touches only its kind. A second run for the same kind finds only what is newly due (the ledger). | Keep. |
| 2 | **Unverified rule**: may a run go ahead on an unverified period if the Company Administrator writes down why (20+ characters, flagged)? | **Yes, with the written acceptance** | **This conflicts with your rule that the lawyer's review is a prerequisite.** As built, a Company Administrator could clear the words under a period the lawyer has not seen. Refusing outright makes the module unusable until the lawyer has seen each period. | Existing rules are all **unverified** today (defaults). A change to a rule clears its verification. | **Change to "never run an unverified rule" in production**, and allow the written acceptance only in a demo or test company. This needs your approval because it changes code you have asked me not to touch. |
| 3 | **Who proposes and confirms** | **HR proposes; the Company Administrator confirms; never the same person.** The only holder may confirm their own proposal with a written reason (flagged). | Two people see every clearing. A small company with one administrator is not stuck. | None on existing records. | Keep. |
| 4 | **A rule can say "delete" only for raw survey answers** | **Built:** saving a delete rule for any other kind is refused | A rule can never promise more than the system does. | Existing default rules already comply. | Keep. |
| 5 | **A person with an open case or data request** | **Left out of the run, not blocking it**; the run reports how many | The run proceeds for everyone else; the left-out person waits for a later run. Their words stay past the period until then. | They are picked up by the next run once the case or request is closed. | Keep. |
| 6 | **Cooling-off before confirming** | **One minute** after the proposal | A short pause for both people to read the counts. | None. | Consider **24 hours for the first run of each kind**, since a run is irreversible. Your call. |
| 7 | **Welfare cases counted from the day they were closed** | **Yes, so a run can clear the words of a case of someone who still works here** (default: six years after closing) | The most sensitive records are not kept longer than the period. The cost is losing the history of an old case for a current employee (for a later pattern, or a claim). | Applies to every closed welfare case past the period. | **Lawyer to confirm** the period and whether a limitation period for claims should keep these longer. |

## Other things that follow from the built behaviour

- **A record added for someone after their kind was cleared** is not covered by that person's ledger entry, so a run will not clear it again; only erasing the whole former employee removes it. If you want a re-clear, it is a separate small change.
- **Probation:** a run clears the decision notes, the workflow's words and only the "Probation failed / extended / confirmed" lines of a contract's notes.
- **The employee file** keeps its own request-and-approval erasure; **raw survey answers and unsuccessful applicants** keep their own HR-policy runs; **the audit log and access logs are never deleted** by the application.
- **Legal holds** always win, at proposal and again at confirmation.

## What I need from you

For each of the seven rows: **approve**, **change** (say to what), or **hold**. Especially row 2 (stop unverified runs in production) and row 6 (a longer first cooling-off).
