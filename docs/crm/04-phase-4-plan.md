# CRM Phase 4 plan: activities, tasks, timeline and communication

**Status: built on branch `feature/crm-phase-4` after the founder's "go" (2026-10-30); the assumptions below are mine and are listed for you to confirm.** It sends email on a user's behalf and blocks marketing without consent, so the consent test is the one that matters most.

## What the pack asks for (Phase 4) and what I built
1. **One timeline** on the lead, account, contact and deal pages, newest first, filterable by type: calls, meetings, site surveys, WhatsApp, emails, notes, stage changes, quote events, handover events and consent changes. (Case events wait for Phase 7: there are no cases yet.)
2. **Quick-log:** log a call (outcome: reached, no answer, call back, wrong number), a meeting, a site survey (site type, entry points, existing guards, risk notes, photo **links**), a WhatsApp, a note, or create a task.
3. **Tasks:** due date and time, owner, an optional reminder time. **My tasks** groups them **Overdue, Today, This week, Later** (Africa/Lagos time, weeks Monday to Sunday). Completing a task on a deal, or logging an activity on it, **updates the deal's last activity** (which is what flags a deal as rotting).
4. **Communication without a third party first:** a **call** button (`tel:`) and a **WhatsApp** button (`wa.me` with a prefilled message you can edit before it opens). **Using either logs an activity first.** **Email** goes through the app's existing email channel and is logged to the timeline. **Every outbound WhatsApp or email is recorded as "service" or "marketing", and marketing is refused unless the person's latest marketing consent is "granted"** (checked on the server, before anything is sent or the link is opened).
5. **Daily digest:** for each user, the tasks overdue and due today, and the deals that are rotting (no activity for longer than the stage allows, 14 days if the stage says nothing). **In the app** (the Tasks page) and **by email** from a scheduled job (`/api/cron/sales-digest`, which, like the other jobs, is off until `CRON_SECRET` is set); one email per user per day. Cases near SLA breach wait for Phase 7.

## Assumptions I made (please confirm or correct)
1. **No file storage** (decision D8): site-survey photos are **links** (up to 10), not uploads.
2. **A call is not a "message"**, so it needs no consent; only WhatsApp and email carry the service/marketing label and the consent block. A call link logs the call with the outcome left open ("call started") until the person records how it went.
3. **Activities are not deleted.** A mistaken one is **voided with a reason** and stays in the timeline, struck through. Its content cannot be changed (the database refuses).
4. **Who sees what:** a person sees the timeline of any record they can see (their own, or all for a manager). Tasks: you see your own; a manager sees everyone's and may assign a task to someone else.
5. **A reminder time** is shown on the task and brings it into the digest that morning; there is no push notification (no third party).
6. **Email only goes to the address on the contact or lead**; inbound email capture is out of scope, as the pack says. A marketing email carries no unsubscribe link yet (the opt-out is one step in the app, and the consent block is immediate): an unsubscribe link needs a public page and is a suggestion for Phase 9.
7. **Audit entries carry ids, the kind and the purpose, never the message, note or person.** The text is kept on the activity itself (so it can be erased with the person without touching the audit log).

## What it adds
Tables `CrmActivity`, `CrmTask`, `CrmDigestRun` (one row per user per day, so the digest is never sent twice); a database guard that refuses to delete an activity or change its content; permissions are the existing `sales.view` and `sales.manage`. Migration `20261107090000_sales_activities`, reversible.

## Tests first
Timeline order and filters; permissions (own records vs all, other organizations); the **consent block on a marketing send** (unknown, withdrawn, granted; service always allowed) for WhatsApp and email, and nothing sent or logged when blocked; auto-logging by the call and WhatsApp links; the deal's last activity updating on a logged activity and on a completed task; task grouping at the Lagos day boundary; voiding; digest content and "one per user per day"; audit without content.
