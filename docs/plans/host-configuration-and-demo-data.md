# Host configuration and demo data: status and proposals

Written 2026-11-14, for the founder's consolidated direction of that date.

## 1. The document encryption key (`DOCUMENT_ENCRYPTION_KEY`)

**Status: cannot be configured yet.** No host or hosting provider has been chosen (the release notes say nothing is deployed). I also must never see, generate-and-display, commit or log the key. **What I have prepared is the procedure and the verification checklist; the founder or the person who administers the host performs the configuration.**

### Procedure (for the person who administers the host)

1. **Generate** a random **32-byte** key, **base64-encoded** (the format the application reads: AES-256-GCM, `src/lib/document-crypto.ts`), **on a trusted machine, never in a chat, ticket or repository**, using the operating system's secure random generator.
2. **Store it only in the host's secret or environment-variable store** (the provider's secrets manager), set for the production environment only. It must not appear in `.env` files that are committed, in build logs, error messages or the audit log.
3. **Keep one separate, offline backup** in a different secure place (for example a sealed envelope or a second secrets vault with different administrators). **Losing the key makes every stored document unreadable; the database backup alone cannot recover it.**
4. **Restrict who can read the secret** (the smallest number of administrators) and record who they are.
5. **Plan rotation:** the application encrypts each file with the key in force; a rotation procedure is a separate piece of work and is not built. Until then, treat the key as long-lived.

### Verification checklist (to report once configured)

- **Without the key the application refuses document uploads and downloads** ("Document storage is not configured"; documented in the employee-documents explain-back note); with it set they work. Confirm both on the host: I have not verified this on a host.
- Upload a **synthetic** document, download it, and confirm it is identical; confirm the stored bytes are not readable in the database.
- Restore a database backup **and** the key backup into a scratch environment and confirm the document opens (the restore check script, `npm run db:restore-check`, covers the database part).
- Confirm the key does not appear in logs, the audit log or any exported file.

## 2. The survey code page rate limit

**Today:** 30 attempts a minute for one survey from one address, kept in the memory of one server process (`surveyCodeLimiter`). The limit is a fixed constant, not configurable, and it is **not shared across servers**.

**Why it is safe even at that setting:** a code is **12 random characters from a 32-character alphabet (60 bits, about 1.15 x 10^18 combinations)**. At 30 guesses a minute from one address, guessing is not feasible; the limit exists to stop a program hammering the page and to bound database work, not because guessing could succeed.

**Proposed (to be built as its own pull request):**

| Setting | Default | Bounds | Purpose |
| --- | --- | --- | --- |
| `SURVEY_CODE_LIMIT_PER_MINUTE` | **30** | 5 to 120 | attempts per address per survey per minute |
| `SURVEY_CODE_LIMIT_PER_SURVEY_PER_MINUTE` | **600** | 60 to 6,000 | a ceiling for one survey across all addresses, so many addresses cannot overload the page |

- Values outside the bounds, or not numbers, **fall back to the default** and never disable the limit.
- A **shared kiosk** (many people at one device) stays within 30 a minute.
- **At the host proxy** the same ceilings should be set again (the in-app limit is per server): for example 60 requests a minute per address on the code page. The exact proxy depends on the host chosen.

**Testing results** will be reported with the pull request (the limit trips at the setting, a refused call is not counted, the global ceiling trips across addresses, invalid environment values fall back safely).

## 3. Synthetic demo data

**What exists:** a deterministic demo seed (`npm run db:seed`) creating a **fictional company, "Demo Security Services Ltd"**, with fictional employees, a second fictional company for tenant-isolation checks and a fictional bureau client; the seed uses made-up names and numbers and a published demo password. **`npm run db:seed` truncates every table before loading**, so it is a full reset.

**Gaps against the founder's conditions:**

| Condition | Today | Proposed safeguard |
| --- | --- | --- |
| Entirely fictional records | **Yes** (synthetic names and numbers; no real data) | Keep; add a test that fails if the seed ever contains a value that looks like a real account number or national identifier. |
| **Clearly distinguished** from real operational records | **Not marked in the database** | An `isDemo` flag on the organization (a small additive, reversible migration), set by the seed, shown as a **visible "Demo company" banner** on every page, and excluded from any platform-level aggregate. |
| **Isolated** from production payroll and statutory calculations | By company (every query is tenant-scoped) | The flag also **blocks** a demo company from producing a production bank file or a statutory remittance, so a demo number can never be paid or filed. |
| **Controlled reset or cleanup** | `db:seed` truncates **everything**, which would destroy a real database if run against it | **Refuse to run when `NODE_ENV` is production or the database is not local** unless an explicit confirmation is given; and a **scoped reset** that deletes only `isDemo` companies, leaving real ones untouched. |

**Also:** my own synthetic check data (cases, holds, runs, sanctions) sits in the local demo database from earlier browser checks; a reseed removes it. I will not reseed the founder's database without asking.

**Plan:** present this design for approval (it needs a migration), then build it as its own pull request.

### Status, 2026-11-19: the design was approved and built (with two answers)

The founder approved the whole design on 2026-11-19 and chose two things where the design met the code: **(1) a demo company is BLOCKED from the bank file and the remittance** (not stamped), and **(2) the scoped reset is dropped**, demo data living in its own database.

| Safeguard | Status |
| --- | --- |
| `isDemo` flag on the company, set only by the seed (one small reversible migration) | **Built** |
| A visible "Demo company" banner on every page | **Built**, checked in the browser |
| A demo company cannot make a bank payment file, mark a batch paid, generate a statutory remittance or mark one remitted | **Built**, refusal checked through the real download route |
| The seed refuses production and any database not on this machine unless the database name is typed | **Already existed** (`src/lib/seed-guard.ts`) |
| A test that the seed looks fictional | **Built**, with a stated limit: a random ten-digit account number cannot be proved not to be somebody's real number; the bank-file block is what stops it being paid |
| A scoped reset that deletes only demo companies | **Dropped.** Tried on a copy of the seeded database: about 50 database protections (posted journals, invoices, tax records, bank payment-file records, billing rules, CRM history) stop rows being deleted, and switching them all off needs full database administrator rights. Demo data lives in its own database, wiped and re-seeded with the guarded seed. The code was removed. |

Not excluded from "any platform-level aggregate": no platform-level aggregate across companies exists in the application that I found; the flag is there for one if it is ever built. Explain-back note: `demo-data-safeguards-explain-back.md`.
