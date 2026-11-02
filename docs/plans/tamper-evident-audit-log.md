# Plan: a tamper-evident audit log

**Status: built on branch `paye-by-state` (with plan #81), with the recommendations taken: sealing job, `AUDIT_SEAL_KEY` from the environment, one chain per organization, existing rows sealed late, the redaction rule of 3.5, weekly head to everyone who can view the audit log, the screen for the same people. Differences from the plan: (1) after the first run the sealer only looks at rows from just before the last sealed one (15 minutes), because scanning the whole log every minute took 6.6 minutes to seal 100,000 entries; an older unsealed entry is therefore NOT sealed quietly, it shows as "stalled" until someone seals everything on purpose, which then shows it as back-dated; (2) a declared redaction carries a keyed proof, so an entry inserted by an attacker cannot excuse an edit; (3) four audit actions join the Security events filter.**

**Default decision now editable (branch `editable-defaults`):** who is told (failed check, weekly chain head) defaults to everyone who can view the audit log and can be widened with extra addresses or narrowed to named addresses on the Audit Integrity screen; it can never be nobody.

*Original status:* a plan for the founder's "go". Nothing in it had been built. It touches the audit module, needs a migration, a new secret and a scheduled job, so `CLAUDE.md` says it waits for your "go" (rules 5, 7, 10, 14).

**Rule it serves:** rule 5: "Audit log is append-only and tamper-evident; no application role can update or delete entries." Today the first half is done (a database trigger refuses any change or delete, tested) and the second is not: `docs/rules-conformity.md` records that the log has no hash chain or signature, so an altered or removed row would not be detectable. This is the next item after the three on your priority list.

## 1. What exists today (read from the schema, the migration and the code)

| Topic | Today |
| --- | --- |
| The table | `AuditLog`: organization, user, action, entity, entity id, old and new value, reason, metadata, time. Written by `logAudit` and, directly, by three other places (payroll reminders, reminders, data retention). |
| Append-only | Trigger `wfp_protect_audit_log` refuses UPDATE and DELETE. It lets them through when the session sets `wfp.allow_audit_redaction = 'on'`, which **any connection can set** for itself. `TRUNCATE` is not intercepted. |
| Who can lift it | In development the application's own database login runs the migrations, so it owns the table and can also disable the trigger (nothing is deployed, so I cannot say how production will be set up). A weakness in the application (for example an injection) or anyone with that login could rewrite history, and nothing would show it. |
| Tamper evidence | None. No hash, no signature, no outside copy. |
| Scheduled jobs | `/api/cron/*` routes guarded by `CRON_SECRET`, each recorded by `recordJob` so the launch checklist can see the scheduler is calling them. |
| Redaction | The field-encryption plan (step 6) must mask old and new values already in the log, using the redaction switch. Any tamper-evidence has to allow that deliberately and visibly. |

## 2. What "tamper-evident" can and cannot mean here

It is **detection, not prevention**. Prevention is the trigger and, later, separate database logins. Detection means that if a row is changed, removed, back-dated or forged by someone who does **not** also hold the sealing key, a check says so, with the row.

| Detected | Not detected |
| --- | --- |
| A sealed row edited or removed (even by someone with full database access but not the key) | Someone who has **both** the database and the sealing key: they can rebuild the whole chain. Mitigated by keeping the key off the database host and by outside copies of the chain head (section 3) |
| A row forged or back-dated into the middle of the log | A row altered or deleted in the short **window before it is sealed** (under about two minutes, section 3) |
| A gap or reorder in the sequence | Rows from before the rollout, if altered before they are sealed (they are sealed once, at rollout, and labelled so) |
| Cutting off the end of the log, **if** the head was copied outside the system | |

## 3. The design

### 3.1 A seal for every audit row, in a separate append-only table
- New table `AuditSeal`, one row per audit row: organization, the audit row's id, a sequence number **per organization**, the hash of the row's content, the hash of the previous seal, this seal's hash, when it was sealed, and whether it was sealed late (back-filled at rollout). It gets the same append-only trigger as the log. `AuditLog` itself is **not changed**, so nothing existing breaks.
- **Content hash:** SHA-256 over a fixed, sorted, canonical text of the row (id, organization, user, user name, action, entity, entity id, old value, new value, reason, metadata, time to the millisecond).
- **Chain hash:** HMAC-SHA-256, with a new secret key `AUDIT_SEAL_KEY`, over (previous chain hash, content hash, sequence number). The first seal of an organization starts from a fixed zero value.
- **Worked example (invented numbers):** entry 1 has content hash C1; its seal is H1 = HMAC(key, zero + C1 + 1). Entry 2 has C2; H2 = HMAC(key, H1 + C2 + 2). If someone changes entry 1's amount, a recomputed C1 no longer matches the stored one, and the check names entry 1. If they also rewrite the stored hashes to cover it, they must recompute H1, H2, H3 and so on, which needs the key.

### 3.2 A sealing job, not a hash at insert time
Sealing at the moment of each insert would make every audit write in an organization wait for the previous one to commit, and payroll writes audit rows inside long transactions, so it could slow payroll (rule 12). Instead:
- A scheduled job `/api/cron/audit-seal` (every minute, `CRON_SECRET`, recorded by `recordJob`) takes the rows that have no seal, oldest first, waits until they are about a minute old (so in-flight transactions have committed) and seals them in batches. Two sealers at once cannot both succeed: the sequence number per organization is unique.
- The audit write path is **not slowed and not changed**.
- The price is the short window in section 2, in which a row can be altered unseen.

### 3.3 The check
`verifyAuditChain(organization)` reads the log and the seals in batches and reports, with the entry concerned: **modified** (content no longer matches), **missing** (a seal with no row), **broken link**, **sequence gap**, **back-dated** (a row older than an entry already sealed by more than the settling time), and **sealing stalled** (rows unsealed for over 10 minutes: the job is not running). It runs daily (`/api/cron/audit-verify`) and on demand from a new "Audit integrity" screen for a person with the audit permission and two-factor. A failure writes an audit entry `AUDIT_INTEGRITY_FAILED` and emails the founder.

### 3.4 Copies outside the database
Once a week the job emails each organization's chain head (sequence number and hash) to the people you name, and the screen shows it. A hash cut off at the end of the log is then visible by comparing with an old email. This is what protects against someone who controls the whole system.

### 3.5 Redaction stays possible, and stays visible
A deliberate redaction (for example masking account numbers in old entries, field-encryption step 6) must, in the same transaction, write one audit entry `AUDIT_REDACTION` listing the rows and the **new content hash** of each. The check accepts a changed row only if a redaction entry declares exactly its current hash. An undeclared edit is still flagged. The chain hash uses the content hash **stored in the seal**, so the links still verify.

### 3.6 Rows already in the log
They are sealed in the first run, in order, marked "sealed late". The screen says "protected from <date>"; before that date the log is only as trustworthy as it was.

### 3.7 Launch checklist and migration
- Checklist gets two items: `AUDIT_SEAL_KEY` set (32+ characters, not a placeholder) and the seal job's heartbeat.
- **Migration:** one new table with indexes and the append-only trigger; no existing table or row changes. Reverse: drop the table and trigger (written and tested on a copy). The seed's full reset still works (`TRUNCATE ... CASCADE`; I will check it).

## 4. Tests first

1. A freshly written entry is sealed by the job; the check passes; running the sealer twice or at the same time gives no duplicate or gap.
2. Editing a row's value (with the redaction switch, as an attacker with the database login would) is detected and names the row; so is deleting a row, inserting a back-dated row, and changing a seal.
3. Rewriting a row **and** its seal without the key is still detected (wrong HMAC); with the key it would pass: stated in the test as the known limit.
4. A declared redaction is accepted; an undeclared one is not; a redaction declaring the wrong hash is not.
5. Isolation: one organization's tampering does not fail another's check; a user of one organization cannot verify or see another's chain.
6. Rows unsealed for over 10 minutes report "sealing stalled".
7. Performance: sealing 10,000 rows and checking 100,000 rows in batches finish in a measured, stated time, and an audit insert takes no longer than before.
8. The key never appears in an audit row, a log line or an error.
9. The existing append-only tests still pass.

## 5. What I need from you

1. **Sealing job (recommended) or a hash at insert time?** The job leaves a window of about two minutes; insert-time sealing has none but can slow payroll.
2. **A new secret `AUDIT_SEAL_KEY`**, kept outside the database host. Who holds it, and where will it live once the host is chosen?
3. **Who receives the weekly chain head by email**, and do you want a copy kept outside the system as well?
4. **One chain per organization** (recommended, so each client's log can be verified on its own) or one global chain?
5. **Rows already in the log are sealed at rollout** and marked as such: accepted?
6. **The redaction rule** in 3.5 (an `AUDIT_REDACTION` entry with the new hashes) is what the field-encryption rollout will have to follow: accepted?
7. **Who may open the "Audit integrity" screen and run the check?** My recommendation: the roles that can view the audit log today, with two-factor.
8. **Later, with the host:** separate database logins for migrations and for the running application, and a role check on the redaction switch, so the application's login cannot rewrite history at all. Not in this plan.
9. **Still open from before:** the five golden-key rule differences, the adviser's sign-off on the golden settings, the PAYE by state plan (#81) questions, the collaborator invite for `developeraideehem`, and branch protection on `main`.

## 6. Risks and what I will not do

- Detection only: someone with the database **and** the key can rebuild the chain. I will not claim more.
- The key is a new secret to look after; losing it makes old seals unverifiable. Key change is not designed here (a new key would start a new, labelled segment) and would need its own plan.
- I will not change `AuditLog`, any audit write, sign-in, the existing append-only trigger, or any pay figure, and I will not add a dependency (Node's built-in crypto is enough).
