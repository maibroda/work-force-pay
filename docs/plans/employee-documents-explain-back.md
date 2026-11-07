# Explain-back note: electronic employee documents, part A (the document store)

Branch `employee-documents`. One migration, `20261126090000_employee_documents` (two enums, three tables, six additive columns). This touches **access control, the audit log and stored personal records**, so it needs your review. Built on your decisions of 2026-11-07 (`docs/plans/employee-documents.md`): files encrypted in the database, a new document-sensitive permission, a 10 MB limit, the key in a host environment variable.

## The rules, step by step

1. **A file is only ever stored through the server's own checks.** Whoever uploads must hold `document.manage` (and `document.sensitive` for identification or medical types). The server checks the file again whatever the browser said: not empty, at most 10 MB, an allowed extension (PDF, DOC, DOCX, JPG, JPEG, PNG), and **the file's own first bytes must match that extension**, so a program renamed as a PDF is refused.
2. **The file is encrypted before it is saved** (AES-256-GCM, a fresh random nonce each time, bound to its own version so a stored file cannot be swapped for another). The bytes live in their own table, so a list of documents never loads them. A SHA-256 checksum is kept and checked every time the file is read back.
3. **A replacement is a new version.** The earlier version is marked with who replaced it and when, and stays. Nothing is deleted: "archive" takes a document out of the register but keeps it and every version.
4. **A file is opened only through a signed link.** After the permission check, the server signs a claim (one version, one user, one company, view or download, expiring in five minutes). The file route checks the signature, that the signed-in user is the one it was issued to, the permission **again**, decrypts, checks the checksum, and records the access. Never cached.
5. **Sensitive documents are invisible without `document.sensitive`.** Identification and medical documents (and the older reference records of those kinds) are not listed, not counted in the HR report, and "not found" if asked for by address: the system does not even confirm they exist.
6. **Every action is audited by ids**: upload, replacement, link issued, view, download, archive, and each change to a document type. The entries hold ids and field names, never a file name or description, so a person can be erased without touching the audit log.
7. **When a person is erased** (the existing retention scrub), their stored file bytes are deleted and the file names are replaced.

## A worked example

HR uploads an employee's national identification scan (type "National identification", sensitive). The server confirms HR holds `document.manage` and `document.sensitive`, that the employee belongs to this company, that the bytes begin like a PNG, and encrypts the file: what is stored is unreadable without the key. The auditor, who holds only `document.view`, opens that employee's Documents tab: the register shows the offer letter but **not** the identification scan, and asking for its link by id answers "Document not found". HR clicks View on the scan: the server signs a five-minute link for HR only, and records "link issued" and later "view". HR then uploads a clearer scan as a replacement: version 2 is now active, version 1 is marked "replaced by HR, on that date" and can still be opened.

## What could go wrong, and what proves it does not

| Risk | Test |
| --- | --- |
| A program renamed as a PDF is stored | `documents.test.ts` (unit and integration): wrong first bytes, wrong extension, empty, oversize; and over HTTP, the real route refuses them |
| A stored file is readable without the key, or swapped | unit: the stored bytes are not the file, a wrong key, a changed byte, and a file moved to another version are all refused; integration: an altered stored file is refused on read |
| A link works for the wrong person or too long | unit and integration: expiry at five minutes, a changed claim, another user, another company, and a permission taken away after issuing |
| Someone without sensitive access sees identification or medical files | integration: register, version list, link issue, the old reference table, the HR report; end to end over HTTP as the auditor |
| An earlier version is lost on replacement | integration: version 1 is kept, marked replaced, and still opens |
| A document is deleted | no delete exists; archiving keeps the row, versions and bytes |
| Another company's files are reached | integration: every function refuses another company's ids as "not found" |
| An action leaves no trace, or the trace holds personal data | integration: each action's audit row exists; the file name and description never appear in it |
| The migration loses data | round trip on a copy of the seeded database, with an existing document row proved to survive up and down |

## What I did not do or test

- **Not built yet:** the approval workflow (submit, review, approve, reject with a reason, the status changes), the onboarding and exit links, the central HR register with missing and expiring tracking, and the employee's own read-only view (the next pull requests). The status "Pending" is set on upload (or "Approved" for a type that does not need approval); nothing moves it yet except archiving.
- **No virus scanning.** The type, size and first-bytes checks stop renamed programs but not a malicious but valid document. I recommend a scanner (for example ClamAV) before production use.
- **The key.** The app refuses uploads and downloads until `DOCUMENT_ENCRYPTION_KEY` is set. It must be backed up separately from the database; a lost key means lost files. Key rotation is not built (each file records a key id for when it is).
- **Browsers:** checked in a browser against the test database as the HR administrator (drag and drop, choose files, a refused file beside good ones, the register, an image preview, replace with the version list, archive). A PDF preview was not seen on a real PDF (my test files have a PDF's first bytes but no real PDF inside, so the browser's viewer refused them, as expected). Word files, and phone-sized screens beyond the layout, were not checked.
- **One check was flaky:** an upload of a file of exactly 10 MB failed twice right after the dev server restarted (the route was still compiling) and then passed three times in a row. I did not pin down the cause.
- **A defect found and fixed during the work:** the old reference-only table on the tab listed every document row, including the new electronic ones, which would have shown a sensitive file's name to the auditor. It now shows only the old reference records, and the same sensitivity rule applies to it.
- **A limit found and fixed:** Next.js caps a request body passing through the middleware at 10 MB, so even a single 10 MB file failed. It is raised to 12 MB in `next.config.ts`, and the screen uploads one file per request.
- **Finance and the other roles lose the document register** (the old list was readable through general HR access). This follows your decision on sensitive documents; the auditor keeps view access to non-sensitive documents.
