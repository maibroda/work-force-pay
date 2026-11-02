# Going live: what has to be true before a real client's payroll runs here

The app keeps this list for you at **Bureau → Launch Checklist** and judges what it can see for itself. This page says how to get each item done.

## 1. Settings on the server

Set these where the app runs (see `.env.example`):

| Setting | What it must be |
|---|---|
| `AUTH_SECRET` | A fresh random string of 32 or more characters. Never the example value: anyone who knows it can sign in as anybody. |
| `CRON_SECRET` | A fresh random string of 16 or more characters. With none set, every scheduled job is switched off. |
| `AUDIT_SEAL_KEY` | A fresh random string of 32 or more characters, **kept off the database server** and backed up separately. It seals the audit log so that any later change to it can be detected; without it old seals cannot be checked, and anyone holding both it and the database could rebuild the chain. Never the example value. |
| `APP_URL` | The `https://` address clients will use. Invitations, reminders and password resets link to it. |
| `RESEND_API_KEY` | Your Resend key. Without it emails are only written to the server log. |
| `EMAIL_FROM` | An address on a domain **you have verified with Resend**, e.g. `ThreeRoots Payroll <payroll@yourdomain.ng>`. Resend's own test address delivers only to the Resend account owner, so clients would get nothing. |

Then press **Send me a test email** on the checklist: it sends you a message with a small PDF attached, which is what payslip email depends on.

## 2. A scheduler

The app does not schedule anything itself. Something outside has to call each job once a day with `Authorization: Bearer <CRON_SECRET>`. Each call leaves a heartbeat, which is how the checklist knows it is working. Times below are UTC (Lagos is UTC+1).

| Job | Endpoint | Suggested time |
|---|---|---|
| Payroll reminders (**required**) | `/api/cron/payroll-reminders` | 06:00 on weekdays |
| HR digest | `/api/cron/hr-digest` | 06:00 daily |
| Records retention | `/api/cron/data-retention` | 02:00 daily |
| Accrual reversals | `/api/cron/journal-reversals` | 01:00 daily |
| Recurring journals | `/api/cron/recurring-journals` | 01:30 daily |
| Audit log sealing | `/api/cron/audit-seal` | every minute (rows are sealed about a minute after they are written; a daily call also works but leaves a longer window in which a change goes unseen) |
| Audit log check | `/api/cron/audit-verify` | 03:00 daily |
| Audit chain heads emailed | `/api/cron/audit-heads` | 07:00 on Mondays. **Keep these emails**: they are the copy outside the system |

On Vercel, `vercel.json` (Vercel sends the secret itself when `CRON_SECRET` is set):

```json
{
  "crons": [
    { "path": "/api/cron/payroll-reminders", "schedule": "0 6 * * 1-5" },
    { "path": "/api/cron/hr-digest", "schedule": "0 6 * * *" },
    { "path": "/api/cron/data-retention", "schedule": "0 2 * * *" },
    { "path": "/api/cron/journal-reversals", "schedule": "0 1 * * *" },
    { "path": "/api/cron/recurring-journals", "schedule": "30 1 * * *" },
    { "path": "/api/cron/audit-seal", "schedule": "* * * * *" },
    { "path": "/api/cron/audit-verify", "schedule": "0 3 * * *" },
    { "path": "/api/cron/audit-heads", "schedule": "0 7 * * 1" }
  ]
}
```

The sealing job runs every minute; check that your Vercel plan allows a call that often (otherwise use a server's crontab for that one job).

On any server, with `crontab -e`:

```
0 6 * * 1-5 curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://YOUR-APP/api/cron/payroll-reminders
0 6 * * *   curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://YOUR-APP/api/cron/hr-digest
0 2 * * *   curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://YOUR-APP/api/cron/data-retention
0 1 * * *   curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://YOUR-APP/api/cron/journal-reversals
30 1 * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://YOUR-APP/api/cron/recurring-journals
* * * * *   curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://YOUR-APP/api/cron/audit-seal
0 3 * * *   curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://YOUR-APP/api/cron/audit-verify
0 7 * * 1   curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://YOUR-APP/api/cron/audit-heads
```

The checklist item turns green once the reminders job has run, and amber if it stops for more than four days or fails.

## 3. The starting rate tables

The PAYE bands, pension rates and employer contributions in the bureau's own tables were written from the Nigeria Tax Act 2025 schedule and the Pension Reform Act 2014. **They have not been certified.** A person from HR and a person from Finance, neither of them whoever proposed it, must check each table against the law and sign it before it counts.

1. **Bureau → Statutory Rule Library → Propose** each table in force (PAYE, pension, employer contributions), with the law it comes from.
2. HR and Finance each open the release, check the table against the Act and the tax authority's guidance, and **verify** with a note saying what they checked.
3. **Publish.** Clients that already hold the version are recorded as such; nothing changes for them.

Points the two verifiers should settle (also shown on the checklist):

- The PAYE bands: 0% to ₦800,000, then 15%, 18%, 21%, 23%, and 25% from ₦50 million.
- The "minimum wage exemption" (annual gross up to ₦840,000 pays no tax) is an older rule sitting beside the ₦800,000 zero band. Confirm it still applies. If it does not, remove it, because it excuses tax the bands would charge.
- Reliefs: pension, and rent relief of 20% of annual rent up to ₦500,000 are in the tables. Other deductions the Act may allow (NHIS contributions, life assurance premiums, interest on a home loan) are **not** modelled. Decide whether to add them.
- National Housing Fund relief (2.5% of basic) is off by default. Decide whether clients' staff contribute.
- Pension: employee 8%, employer 10%, on basic, housing and transport. Confirm no client has an agreement for more.
- Employer contributions: ITF 1% and NSITF 1% are the statutory items. The other percentages in the starting table (insurance, uniform kits, recruitment and training, leave reliever, outsourcing allowance) are costing assumptions for a security business. Remove them or set them to zero before verifying the table as a statutory one.

## 4. Bank codes

The bank list in the app (Payments → Bank codes) is a starting list. For each client, open the guide their bank publishes for uploading a payment file and check the bank's code and the file's columns (Name, Account Number, Bank Code, Amount, Payment Description). If a bank rejects the layout, a bank-specific layout is added. A bureau manager confirms it on the checklist, with a note saying which banks were checked.

## 5. A real payslip email

After the test email, email one real payslip from a locked payroll to an address you control, and open the PDF on a phone and a computer. Confirm on the checklist, noting who received it.

## 6. A backup you have restored

```
npm run db:backup
npm run db:restore-check -- backups/<the file>
```

The second command restores the dump into a scratch database and checks it. Confirm on the checklist with the file name and date. Repeat after any change of host.

## 7. Staff and clients

- Every member of staff turns on two-factor (My security). It becomes compulsory on the date shown on *Bureau → Clients* (14 days after the bureau was set up, and it can only be brought forward). Tell the team before then.
- Each client's signed data-processing terms (reference and date) are recorded on the client's page.
