# Electronic employee documents: plan and migrations

Written 2026-11-07. **A plan only: nothing is built and no migration is written until the founder says "go" on the migration in section 4.** It answers the founder's request of 2026-11-07 (employee profile back arrow, and a full electronic document management system). The back arrow is already built (PR 1). The founder's decisions of 2026-11-07 are recorded in section 1.

## 1. Decisions already made (founder, 2026-11-07)

- **Storage:** the files are kept **in the PostgreSQL database, encrypted before saving** (no new service; one backup covers them; private by construction).
- **Sensitive documents** (identification and medical): a **new `document.sensitive` permission**, held by the HR administrator, company administrator and super administrator only.
- **Self-service:** an employee sees **their own approved documents, read-only**, medical included, and nothing of anyone else's.
- **Order:** four pull requests, back arrow first (done); then the document store; then the workflow and the onboarding and exit links; then the central register.

## 2. What exists today (checked in the code on 2026-11-07)

- **`EmployeeDocument`** is a register of *references only*: a type from a fixed list of ten (national ID, passport, driver's licence, guard licence, firearms licence, medical certificate, police clearance, employment contract, academic certificate, other), a number, issue and expiry dates, a free-text "file reference", notes and who recorded it. **No file is stored anywhere**, and there is no upload code (server actions are capped at 5 MB).
- It is used by the Documents tab on the profile (`hr.view` to read, `hr.manage` to add or remove), the data-access export, the retention scrub, the HR digest (documents expiring within 30 days), a report, and the HR overview count.
- **Onboarding and exit tasks** are only pending, done or not applicable, and have no link to documents. Checklist templates are editable data (Settings).
- Supabase is **not** used (the app is Next.js, Prisma and PostgreSQL), so there is no existing storage or storage authentication to reuse.

## 3. Design

**Document types are data.** The seven categories (employment, identification, educational and professional, compliance, medical, statutory, exit) are fixed; the **types inside them are rows** an authorised administrator can add, rename or switch off without code: name, category, whether it needs approval, whether it has an expiry date, whether it is sensitive (identification and medical on by default). The listed standard types (offer letter, appointment letter, employment contract, confirmation letter, promotion letter, transfer letter, resignation and termination letters, national ID, passport, driver's licence, other ID, academic, professional and training certificates, licences, guarantor forms, reference checks, background verification, signed policies, medical examination report, medical fitness certificate, tax, pension and other statutory records, clearance forms, exit interview, handover) are seeded for each company.

**Files and versions.** Each upload creates a **version** (never an overwrite). The file's bytes sit in their own table, **encrypted with AES-256-GCM** (the key is an environment secret, never in the repository), so a query for a list of documents can never load file bytes. The first version is version 1; a replacement is the next version; the latest is the active one; earlier ones stay inspectable with who replaced them and when.

**Upload.** A dedicated upload route (not a server action): PDF, DOC, DOCX, JPG, JPEG, PNG; a size limit (10 MB per file, a setting); the extension **and the file's first bytes** are checked on the server (a renamed program is refused); filenames are cleaned; several files at once; progress shown in the browser. **No virus scanning** is included (see section 6).

**Viewing and downloading.** A short-lived signed link (valid 5 minutes, tied to the signed-in user and the version) is issued only after the permission check; the file is served with no-cache headers; PDFs and images preview in the browser, Word files download. **Every issue of a link and every download is audited.**

**Permissions** (new): `document.view` (the register and non-sensitive files), `document.manage` (upload, replace, submit, archive), `document.approve` (approve or reject, never one's own upload), `document.sensitive` (open identification and medical files), `document.configure` (document types). The HR administrator holds all; the company and super administrators hold all; the auditor holds `document.view` only; finance and the other roles hold none. Employees reach their own approved documents through their self-service page. **Tenant isolation and role checks are tested for every action**, and every upload, view, download, replace, submission, decision and archive is written to the audit log by ids and field names, never file content.

**Workflow (PR 3).** Pending (no file yet) to Submitted (a file is uploaded and submitted) to Under Review (a reviewer takes it) to Approved or Rejected (a reason is required, and the reviewer and date are recorded). **Expired** is worked out from the expiry date (an approved document past its expiry shows Expired); **Archived** is a deliberate step. The approver must be someone other than the person who uploaded or submitted. A type that does not need approval completes as "no approval required", labelled so. Nothing is approved merely by being uploaded.

**Onboarding and exit (PR 3).** A checklist step can name a document type; the task then follows the real document: none = Pending; uploaded = Submitted; with a reviewer = Under Review; approved = Completed (recorded as done by the approval); rejected = Pending again with the reason. Steps with no document are completed by HR by hand as today, with the same audit trail. Exit documents attach to the exit process in the same way.

**Central register (PR 4).** One page for HR: search by name or number; filter by category, status, upload date and expiry date; missing-document tracking (required types per employee category, shown against each person); expiring documents; the approval queue; and a link from every row to the employee's profile.

**Existing records are kept.** Today's reference-only rows are not rewritten or deleted. They appear in the new register labelled **"reference only (before document management)"** with no invented approval; a file can be attached to one, which turns it into a normal document.

**Privacy (Nigeria Data Protection Act 2023).** Access is limited by role and logged; sensitive categories need their own permission; files are encrypted at rest and never publicly reachable; the existing retention and erasure scrub is extended to remove the stored file bytes when a person's record is erased; the existing breach register applies; and the data-access export will list a person's documents. **The company's lawyer should review retention periods for each document type.**

## 4. Migrations (the founder's "go" is needed for each)

**A: the document store (PR 2).** Additive, reversible, tested on a copy of the seeded database.
- New enums: document category (7) and document status (7).
- New table **document type** (company, category, code, name, needs approval, has expiry, sensitive, active, order, standard flag), unique by company and code.
- New table **document version** (document, version number, file name, type, size, SHA-256 checksum, uploaded by and when, replaced by and when).
- New table **document file** (one per version: the encrypted bytes, the initialisation vector, the authentication tag, a key id), kept apart so listing documents never loads bytes.
- **Additive columns on the existing `EmployeeDocument`:** type, status, description, the active version, submitted by and when, reviewed by and when, the rejection reason, archived by and when, last updated. **All nullable or defaulted; no existing row changes.**
- **Down script:** drops the new tables, columns and enums. **Once files have been uploaded, running it destroys them**, so a backup must be taken first (it says so at the top).

**B: workflow and links (PR 3).** Link columns: a document type on checklist template items, and a document on onboarding and exit tasks. Additive.

**C: required documents (PR 4).** A small table of required types per employee category (for missing-document tracking). Additive.

## 5. Tests (written first, each PR)

Upload validation (type, size, renamed file, empty file, many files); the encrypted bytes are not the original bytes and decrypt exactly; versions are kept on replace; a signed link works once for the right user, expires, and is refused for another user, another company or a tampered signature; sensitive types are refused without `document.sensitive`; the approver cannot be the uploader; rejection needs a reason; the status machine; onboarding and exit tasks follow the document; self-service shows only the caller's own approved documents; every action is audited by ids and field names; cross-company isolation on every query; the retention scrub removes file bytes. The golden payroll datasets are unaffected (nothing here touches pay).

## 6. Limitations and things the founder must provide

- **The encryption key.** The app needs a 32-byte secret (`DOCUMENT_ENCRYPTION_KEY`). **It must be backed up separately from the database: a database backup without the key cannot be read, and a lost key means the files are lost.** Where it is kept is the founder's decision; I never put it in the repository.
- **No virus scanning** is included. I recommend adding a scanner (for example ClamAV) before production use, and keeping the type and size checks.
- **Size:** files held in the database suit roughly 10 MB each; a very large archive of scans would later warrant object storage, which the design allows (the storage sits behind one small module).
- **Assumptions** I will proceed on unless the founder objects: every standard type needs approval by default (an administrator can switch it off per type); the auditor can see the register and non-sensitive files but not sensitive ones; deleting a document is not offered (archive instead), as the request says unauthorised deletion must be prevented.

## 7. Questions for the founder

1. **Go** on migration A (section 4)?
2. **The encryption key:** will you keep a separate backup of it, and where should the app read it from (an environment variable on the host, as other secrets are)?
3. **File size:** is 10 MB per file right?
4. **Defaults:** do you accept the assumptions in section 6 (approval needed by default; auditor sees non-sensitive only)?
