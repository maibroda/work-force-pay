# Explain-back note: governance step 4, closing the probation bypass

For the founder. Plain language. **This changes an approval rule (who can make a probationer permanent). There is no migration and no new permission.**

## What "step 4" is

The governance plan had three steps and all are built, so there was no step 4 written down. I asked which open item you meant and you chose this one: **the probation bypass** I reported on 2026-11-13 and had not fixed.

## The gap

Making someone permanent after probation should be a **decision**: a record of who decided, when and why, made by someone with the approval right (`hr.approve`), and, where a company has switched the probation workflow on, by the recommendation, the HR review and an independent decider. But **renewing a contract** (the "Renew, extend or convert" form on a contract) needed only `hr.manage`. So an HR administrator could renew an undecided probationary contract as **permanent** and skip all of it: no decision record, no approval, no appraisal rules. When the probation workflow was **on** this was already refused; when it was **off** (the default) it was not.

## What the code does now, step by step

1. When someone renews a contract, the system looks at the contract's probation outcome.
2. **If the probation is still undecided (waiting, or extended and not finally decided), the renewal is refused**, with or without the workflow. The message tells the person to confirm, extend or fail the probation first (or, with the workflow on, to use the probation review, as before).
3. The legitimate routes are unchanged: **deciding the probation** (confirm, extend or fail) still works, records who decided and why, and when a probationary contract is confirmed it **creates the permanent contract itself**. After a decision, a normal renewal works as before.
4. **The screen** no longer offers the renewal form on a contract whose probation is undecided: it says the probation is waiting for a decision and that the form appears once it is decided.
5. Nothing is audited differently: a refused renewal changes nothing and writes nothing.

## A worked example

Tunde's Security Co. has Ada on a three-month probationary contract that ends tomorrow. Obi (HR administrator) opens her contract and tries "Renew" as PERMANENT. Before: it worked, and Ada became permanent with no decision on record. Now: "This probation is still waiting for a decision. Confirm, extend or fail it first." Adaeze (who holds the approval right) confirms the probation on the same page, with her note; the system records the decision and creates Ada's permanent contract. If Ada's contract was a fixed-term one that carried a probation, after the decision a renewal works as normal.

## What could go wrong, and which test proves it does not

| Risk | Test |
| --- | --- |
| A probationer is made permanent by renewal, workflow off | `probation-workflow.test.ts`: "with the workflow off too, an undecided probation cannot be renewed ..." (also by the Company Administrator; no permanent contract, no decision, no renewal audit entry) |
| The default settings behave differently | `hr-lifecycle.test.ts`: the same refusal with the company's default settings |
| An extended probation slips through | "... a probation that was extended is still undecided ..." |
| The right route stops working | "tells the person to decide the probation first, and the decision itself still works ..." and "once the probation is decided, a renewal ... is allowed as before" |
| The workflow-on rule changed | the existing workflow-on test is unchanged and passes |

## What I changed in an existing test, and what I did not do

- **One existing test was changed, on purpose:** in `probation-workflow.test.ts`, "with the workflow off, renewal works as it always did" asserted exactly the gap you asked me to close. It is replaced by the four tests above. Every other assertion is kept.
- **A probationary contract can no longer be renewed to extend it while its probation is undecided.** If a company used renewal to "extend probation", it now uses the Extend decision, which records the reason.
- **Not changed (a finding for you):** a probation recorded as **failed** can still be followed by a renewal of that contract (a human override with no second look). I did not close it because you asked about undecided probations; say if you want it closed too.
- **Browser check (demo app, signed in as the Company Administrator, who holds the same renewal right as the HR administrator):** the contract page of an undecided probation (EC-000004) shows the warning, no renewal form and the decision controls; an ordinary fixed-term contract (EC-000003) still shows the renewal form; no console errors. **Not browser-checked:** actually pressing a renewal on a refused contract (the form is hidden there; the refusal is covered by the integration tests), and the HR administrator's view.
