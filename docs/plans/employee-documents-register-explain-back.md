# Explain-back note: the central document register, missing documents and the employee's own view (part C)

Branch `employee-documents-register` (builds on #161). One migration, `20261128090000_document_requirements` (one new table). This changes **who can see which documents, how "missing" is decided, and how an employee reaches their own files**, so it needs your review. Built on your go and your answers of 2026-11-07 (a required document counts only when Approved; no requirements are set up for you; the employee sees their approved documents including medical and expired ones, labelled).

## The rules, step by step

1. **The register lists every electronic document of the company** for anyone with `document.view`. **Identification and medical documents are left out of the search itself** for anyone without `document.sensitive` (for example the auditor), so the counts and the pages are right and nothing is merely hidden on screen.
2. **Expired is worked out, not stored.** An approved document whose expiry date has passed shows as Expired; one expiring today is still valid.
3. **The approval queue is the Submitted and Under-review documents, oldest first.** The buttons on a row are the same ones as on the profile and the server checks the same rules: the uploader or submitter can never take, approve or reject it, and only the person who took it can decide it.
4. **A requirement is a document type needed of everyone, or of one employee category.** Only a person with `document.configure` can add or switch one off; it can never be deleted; both changes are audited (ids and the on/off value only).
5. **"Missing" is decided per employee and per required type.** The employee is chased if they are **Active or On leave** and the requirement applies to them (everyone, or their category). Looking at all their documents of that type, the best one decides: **an Approved, unexpired one = on file**; otherwise **Under review or Submitted = awaiting approval**; **Pending = uploaded, not submitted**; **Rejected**; **an approved but expired one = Expired**; nothing = **Missing**. Archived documents and old reference-only records count as nothing.
6. **A required identification or medical type is not shown** to someone without sensitive access (whether a person has such a file is itself sensitive).
7. **An employee opens their own files through the same signed, five-minute links.** The server lets them open a document only if it is **theirs and Approved** (an expired one is still approved); for anyone else's, or one that is pending, rejected or archived, the answer is "not found". The audit row says it was the employee's own use.

## A worked example

You require the **Employment contract** of everyone. There are 106 active employees. Abdullahi Bello's contract is Submitted, Babatunde Ojo's is Pending, and Kunle Uzor has none. The **Missing documents** view shows 0 of 106 on file; Bello reads "Awaiting approval", Ojo "Uploaded, not submitted", Uzor "Missing". The company administrator takes Bello's contract for review and approves it on the **Awaiting approval** view: Bello leaves the missing list and the summary reads 1 of 106 on file. When Uzor's licence is due to expire on 1 December the **Expiring** view (next 30 days) lists it; once that date passes it shows as Expired. Chioma Ogunleye, signed in as an employee, sees her two approved documents (an offer letter and a medical report) under **My documents** and downloads one; nothing else.

## What could go wrong, and what proves it does not

| Risk | Test |
| --- | --- |
| An auditor or other reader sees an identification or medical document, or whether someone has one | `documents-register.test.ts`: the search, queue, expiry list and missing list leave sensitive types out for a reader without sensitive access |
| A document still in the workflow is counted as on file | the unit and integration tests of the same name: submitted, under review, pending and rejected all show as not on file; approving clears the row |
| An expired or archived document counts as on file, or a leaver or a switched-off requirement is chased | the integration tests for expired, archived, resigned and switched-off cases |
| One company sees or changes another's requirements or documents | cross-company tests: foreign types, categories and requirements are "not found"; the lists are empty |
| An employee reaches a document that is not theirs, not approved, archived, or another company's | the own-documents tests: every such case is "not found" |
| An employee-only path opens documents to people who should not have them | a person with no employee record and no document permission is refused outright; an employee cannot open the central register (checked in the running app: redirected to "forbidden") |
| The migration loses data | round trip on a copy of the seeded database (documents and types unchanged, no requirements seeded) |

## What I did not do or test

- **Checked in a browser against the test database** with four users: HR (register, missing and expiring views, adding a requirement), the company administrator (took a submitted contract for review and approved it; three audit rows), an employee (saw only their own two approved documents and downloaded one, audited as their own), and the auditor over HTTP (the two medical documents were absent). A second pass with 57 documents checked the search by number and name, the category, status, upload-date and expiry-date filters, the 30, 60 and 90 day expiry windows (1, 2 and 3 documents for expiries 13, 43 and 79 days away), and paging (50 per page, 2 pages); and the register, expiring view and My documents at phone width (375 px: no sideways scrolling of the page). An employee also previewed a real PDF of their own in the browser (decrypted and shown inline; the view was audited as their own). **Not seen:** the Documents tab of a profile at phone width was not part of this part, and no real scanned or phone-photo documents were tried (all test files are synthetic).
- **The missing list is not paged or filtered by department or client yet** (it lists every employee who lacks a document, up to 5,000 rows). A filter is a sensible next step if your requirement lists are long.
- **No notifications** go out about expiring documents; the views are what you open. No export of the lists.
- **Requirements by department, client or job role are not built**: only everyone or an employee category.
- **No virus scanning**, and the encryption key must be set in the host environment (see the part A note).
