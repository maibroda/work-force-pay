# Plan: audit failed logins and wrong two-factor codes (and close a two-factor guessing hole)

**Status: approved by the founder ("A and B, my recommendations") and built on branch `failed-login-audit`; the answers taken were 1 yes (A first), 2 application log only, 3 same allowance (5 total, 15 minutes), 4 IP limits left until the host is chosen.** Part A changes how sign-in works, and `CLAUDE.md` says a change to authentication, and a likely security weakness, must be reported to you before I fix anything. This is the third item on your priority list.

**Rule it serves:** rule 5 ("Security events are logged: logins, failures, approvals, exports, role changes, bank-detail changes, settings changes"; "MFA required for approve, export, settings and administrator roles"). It also touches rule 6 (never write secrets into logs) and rule 15 (honesty).

## 1. A security finding, reported before anything is fixed

**Severity: HIGH, but only for an account whose password is already known to the attacker.** With the password, the second factor does not protect the account.

**What I found, and confirmed by running it against the test database (not against any real account):**
- After the password step the app issues a sign-in challenge that lasts **5 minutes and can be used again and again**. The second step then accepts any number of wrong codes: nothing counts them, nothing locks the account, nothing is logged.
- I made **50 wrong codes in 0.3 seconds** (account without backup codes) and afterwards: failed attempts 0, not locked, **0 audit rows**.
- The one lock that exists (5 wrong passwords in a row, 15 minutes) can be avoided: **a correct password resets the counter to zero**, so wrong-password attempts can be interleaved with correct ones without ever reaching 5. I confirmed: 4 wrong passwords, then the right one, and the counter was back at 0.
- A code is 6 digits and the app accepts the current one and the one before and after, so 3 of every million guesses are right at any moment. At the speed I measured (about 156 guesses a second, one at a time, for an account without backup codes) roughly 47,000 guesses fit inside one 5-minute challenge, which is about a 1-in-7 chance per challenge, and a new challenge needs only the password again, which is not limited. More than one request at a time would be faster; backup codes make each wrong guess slower. **I did not run an attack, so these odds are an estimate from that speed; the missing control is not an estimate, I saw it.**
- There is **no limit by IP address anywhere** (I found none). Guessing passwords across many accounts is not throttled either; the per-account lock is the only brake.

**Who is exposed:** everyone with two-factor on, which is compulsory for all bureau staff. Rule 5's "MFA required for approve, export, settings and administrator roles" is only as strong as this step.

## 2. What is audited today

| Event | Today |
| --- | --- |
| Successful sign-in (`LOGIN`), sign-out, backup code used, account locked (5th wrong password), password changed or reset, two-factor turned on or off, two-factor reset by an admin | **Logged** |
| A wrong password (attempts 1 to 4) | **Not logged**; only a counter on the user row |
| A wrong password on a locked or inactive account | **Not logged** |
| A wrong password for an email that has no account | **Not logged** (and cannot go in the audit log as it stands: every row must belong to an organization) |
| **A wrong two-factor code** | **Not logged, not counted, not limited** (section 1) |
| A password-reset email requested | **Not logged** |
| A password-reset link that is invalid, expired or already used | **Not logged** |
| A wrong current password when changing a password | **Not logged**, not limited |
| A wrong code when trying to turn two-factor off | **Not logged**, not limited |

## 3. The design

### Part A: close the two-factor guessing hole (a change to authentication: needs your "go")
- A **wrong two-factor code counts on the same counter as a wrong password**. Five wrong in total lock the account for 15 minutes, with the same plain message the app already uses, and the challenge stops working.
- For an account with two-factor on, **a correct password no longer clears the counter**. The counter is cleared only when the whole sign-in succeeds (password and code). This is what stops the interleaving trick.
- The error shown for a wrong code stays "Incorrect code." until the lock, so it does not tell an attacker how close they are.
- Nothing else about sign-in changes: same hashing, same session, same two-factor library.

### Part B: record every failure (no database change)
Failures for an account that exists are written to the audit log of **that account's organization**, so the organization's own administrators and auditors see them in their audit log. Each entry records what happened, the step, the reason, the IP address and the browser, and **never the password, the code, a reset token or the sign-in challenge**.

| Action | When |
| --- | --- |
| `LOGIN_FAILED` | A wrong password, with a reason: wrong password, account locked, account inactive |
| `TOTP_FAILED` | A wrong two-factor code at sign-in |
| `ACCOUNT_LOCKED` | (exists) also now records whether the lock came from passwords or codes |
| `PASSWORD_RESET_REQUESTED` | A reset email asked for (for an existing account) |
| `PASSWORD_RESET_FAILED` | A reset link that is invalid, expired or used |
| `PASSWORD_CHANGE_FAILED` | Wrong current password |
| `TOTP_DISABLE_FAILED` | Wrong code when turning two-factor off |

- **Noise control:** while an account is locked, repeated attempts are logged at most once every 5 minutes, so an attacker cannot fill the audit log.
- **Screen:** the audit page gets a "Security events" filter so these are easy to find.
- **Attempts on emails that have no account** cannot go in the audit log without a new table. Recommended for now: they go to the structured application log with the IP address and a **keyed hash** of the email (never the email itself, because people type passwords into the email box). This keeps the change free of a migration. If you want them in the database and the audit viewer, that is a new append-only table and a migration, which I would plan separately for your approval (question 2).

**Not changed:** the uniform "invalid email or password, or locked" reply (an attacker still cannot tell whether an account exists), password hashing, sessions, the two-factor library, the audit log's own protection.

## 4. Order of work (tests first)

1. **Tests that fail on today's code:** 5 wrong codes lock the account; wrong passwords interleaved with correct ones still reach the lock when two-factor is on; every event in the table above is written, with the right account, organization, step, reason and IP; a wrong code after the lock is refused even if the code is right; a sign-in with the right password and right code still works and clears the counter.
2. **Tests that must keep passing:** the existing login, lockout, two-factor and password tests; the uniform error message; a successful sign-in after the lock expires.
3. **Secrets never logged:** a test types a recognisable password, code and reset token and checks that none of them appears in any audit row or application log line.
4. **Isolation:** failures for a user in one organization never appear in another organization's audit log.
5. **Noise control:** 50 attempts during a lock produce a bounded number of entries.
6. Implement, then the full suite, lint and type check; release notes, rule 5 status in `rules-conformity.md`.

## 5. What this does to existing behaviour

- **A person with two-factor who mistypes their code five times (across the whole sign-in) is now locked for 15 minutes.** Today they can try forever. I think that is right; five total is the same allowance passwords already have.
- **A person can lock a colleague's account by trying their password.** That is already true for passwords and becomes true for codes. It is the usual trade-off; the lock lasts 15 minutes and an administrator can reset it. IP-based limits would help and are not in this plan.
- No pay figure, no migration, no dependency.

## 6. What I need from you

1. **Go for Part A and Part B together?** They touch the same functions. Part A is the urgent one; I would put it first in the same pull request.
2. **Attempts on emails with no account:** application log only (recommended, no migration), or a new append-only table so they are in the database and the audit viewer (migration, planned separately)?
3. **The same allowance for codes as for passwords** (5 in total, 15-minute lock)?
4. **Limit by IP address** is not in this plan: it needs a decision on where WorkforcePay is hosted (trusting the proxy's address header safely depends on that). Leave it until the host is chosen?
5. **Still open:** the golden dataset (CSV), the independent reviewer's GitHub username (CODEOWNERS), your hand check of a tie, the adviser on the NHF relief and the settlement rounding choices, the ITF/NSITF base, FORMULA components, whether the engine keeps refusing part-kobo input, and the tamper-evident audit log (rule 5: the audit log is append-only at the database but not yet tamper-evident, and the application's database login can lift that protection).

## 7. Risks and what I will not do

- A change to sign-in can lock honest people out. The tests cover the right code succeeding, the lock expiring, and the existing messages.
- I will not log or store a password, a code, a token or a challenge, and I will not store an unknown email in readable form.
- I will not change password hashing, sessions or the two-factor library, and I will not add a CAPTCHA or a new third-party service.
- The tamper-evident audit log and IP throttling are separate pieces of work.
