# CRM Phase 6 plan: automation rules and triggers

**Status: built on branch `feature/crm-phase-6` after the founder's "go" (2026-10-30). The choices below are mine, listed for you to confirm.** Nothing here sends a message or changes a deal until you switch a rule on: **every rule starts switched off**.

## What the pack asks for, and what I built
1. **Rules on a stage.** When a deal **enters** a stage (created into it, or moved into it), the rule's action runs at once or after a delay ("3 days after entering Proposal sent"). A rule may carry a **condition** (monthly value above N, source = tender, service, probability). Actions: **create a task** (for the owner or a named person, due in N hours), **notify** people (in the app and by email), **send an email** to the deal's primary contact (marked service or marketing; marketing is refused without consent), **change owner**, **set a field** (next step, probability, competitor), **open a follow-up deal in another pipeline**.
2. **Triggers that move a deal into a stage:** **quote accepted** (to Contract signing), **handover accepted** (to Won); and **no activity for N days** (notifies the owner and the sales managers, does not move the stage).
3. **Delayed rules re-check before acting.** A delayed run looks again when it is due: if the deal has left the stage, or the rule was switched off, it is **cancelled**. Leaving a stage also cancels that deal's waiting runs at once.
4. **A rule never fires twice for the same stage entry** (one run per rule, deal and entry, enforced by the database). A deal that leaves a stage and comes back is a new entry; a quiet spell is one entry until there is activity again.
5. **Test mode:** pick a rule and a deal and see what it **would** do, with no run recorded and nothing changed (tested by counting rows before and after). **Run log** (status, inputs, outputs, error, how long it took) for administrators on the Automation page.
6. **Starter rules, all off:** Qualified: "Book site survey" task due in 48 h; Proposal sent: "Follow up on proposal" 3 days later; Negotiation: notify the sales managers if the monthly value is above a threshold; Won: notify Operations and give the owner a "Complete the handover" task; Lost: "Re-approach" task after 90 days. I also added the three event triggers above, off.

## How runs are carried out
There is no separate queue in the app, so I used its existing scheduled-job pattern: each run is a row (`CrmAutomationRun`) with a due time; a scheduled job (`/api/cron/sales-automation`, off until `CRON_SECRET` is set) carries out what is due and looks for quiet deals. Runs that are due at once are also carried out straight after the deal moves, so the delay only matters to delayed rules. Actions run as "Automation: <rule name>", never as a person, and a failing rule never stops a deal from moving.

## Choices I made (please confirm or correct)
1. **The starter threshold for "Negotiation: notify the sales managers" is a placeholder (₦5,000,000 a month). Please give me your real figure.**
2. **There is no "owner's manager" in the app** (no reporting lines), so "managers" means the people who can see and change everyone's sales records (the company administrator). A task can go to the deal's owner or to a named person.
3. **Email only, no WhatsApp message from a rule** (a WhatsApp needs a person to press send). "Send templated message" is therefore an email with `{{contactFirstName}}`, `{{dealName}}`, `{{company}}`.
4. **When a handover is accepted, its start date and term are copied onto the deal**, so the Won stage's required fields are met and the trigger can move the deal to Won. If a gate still fails, the run shows **failed** with the reason; the stage gates are never bypassed.
5. **A rule is changed by switching it off and making a new one** (so its history stays true); nothing is deleted.
6. **Condition on the value is compared in kobo** (exact), never as a floating-point number.

## What I did not build, and why
- **"First invoice paid, mark the account an active client":** accepting a handover already marks the account a client, so this would change nothing; a finding, not built.
- **"Inbound form submission, new lead":** there is no public endpoint to receive one, and a public form needs spam protection and a security review of its own. Suggested as its own task.
- **"Generate document from a template":** the app has no document-template feature; a suggestion for later.

## What it adds
Tables `CrmAutomationRule`, `CrmAutomationRun`, `CrmNotification`; three enums. No existing table changes. Permissions: the Automation page needs `sales.configure`; notifications need `sales.view`. Migration `20261108090000_sales_automation`, reversible.

## Tests first
Conditions (including exact kobo comparison); templates; immediate and delayed actions; cancellation when the deal leaves the stage and when the rule is switched off; one run per entry and a new run on re-entry; each action; consent blocking for an email (skipped, nothing sent, nothing logged); gate failures shown as failed; test mode writes nothing; run logging with inputs, outputs and duration; the quiet-deal scan; organization isolation and permissions; audit without message text.
