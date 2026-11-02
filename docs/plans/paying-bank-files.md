# Plan: payment files for the bank the client pays from (Access Bank, First Bank, and more)

**Status: a plan for the founder's "go". Nothing in it has been built.** It changes the bank payment file (a critical module, `CLAUDE.md` rule 11), adds tables (a migration, rule 7) and decides where money is sent, so it waits for your "go".

**Rules it serves:** rule 13 (Nigerian bank file formats), rule 5 (bank details, exports and approvals), rule 15 (honesty: this plan says what is not known).

## 1. What you sent, and what I found

You sent: `BankCode - ACCESS BANK.pdf` (11 pages), `BankCode - FIRST BANK.pdf` (15 pages) and `Proposed Template(6) - FIRST BANK.xlsx`. **No Access Bank upload template was attached**; only its code list. I extracted both lists exactly (name beside code, matched by position on the page, 471 and 651 rows) and saved them as `docs/bank-codes/access-bank.csv` and `first-bank.csv`.

**The First Bank upload template** is one sheet, headers only, no sample row and no cell formats: `DebitAccountNo | CreditAccountNo | CreditBankCode | BeneficiaryName | Narration | Amount`.

**Finding 1, the important one: a bank's codes are only valid on that bank's own list.** Of the 109 codes that appear on both lists, **77 mean a different bank on each**. Examples: `716` is Afekhafe Microfinance Bank on Access's list and Al-Barakah Microfinance Bank on First Bank's; `751` is Alvana MFB on one and FAST MFB on the other. Of the 23 banks in our current list, **20 have the same code on both lists** (044 Access, 058 GTBank, 057 Zenith, 033 UBA, 011 First Bank and so on); **Stanbic IBTC differs: `039` on Access's list, `221` on First Bank's** (our current list has `221`); Access (Diamond) `063` is only on Access's list; Heritage Bank `030` is on neither. Wallets and microfinance banks use unrelated schemes (Kuda is `A98` on Access's list and `770` on First Bank's; Access codes can contain letters, First Bank's run to 4 digits). So one shared code list, as the app has today, would send some salaries to the **wrong institution** the day the paying bank changes.

**Finding 2, problems in the lists themselves** (to confirm with each bank before payment):

| List | Problem | What the plan does |
| --- | --- | --- |
| Access | `039_` is **"NIBSS TEST BANK"** | Never payable: such entries are marked blocked |
| Access | `A43` belongs to both Blooms MFB and Corestep MFB; `D92` to both Jessefield MFB and Jubilee Life Mortgage Bank; "BLOOMS MFB" is listed twice | A code that points to two banks is **blocked** until the bank says which |
| First Bank | Four codes have only 2 digits (95 BOLDMFB, 62 COOPFUND MFB, 99 MINT MFB, 61 MODEL MFB), probably with a leading zero lost | Blocked until confirmed; I will not add a zero by guessing |
| Both | The PDFs carry no date | The import records the file and its fingerprint; you tell me how current they are |
| Both | Heritage Bank (`030`) in our current list is on neither list; Access (Diamond) `063` is only on Access's | They are not payable through these profiles; flagged |

## 2. What exists today

One bank code list per organization (`BankCode`: name, code, aliases), a generic file layout (`Name, Account Number, Bank Code, Amount, Payment Description`), the employee's free-text bank name matched to an entry, and problems listed instead of guessed (`payment-file.ts`). The organization's own bank accounts already exist (`BankAccount`: bank name and account number), which can serve as the **debit account** the First Bank template asks for in every row.

## 3. The design: a paying bank is data, so more banks need no code

1. **Paying bank profile** (per organization, so each client pays from its own bank): a name, the bank-code list it uses, a **file layout**, and the organization's **debit account** at that bank (a `BankAccount`, validated as 10 digits). Adding a third bank (GTBank, Zenith, UBA) means a profile, its code list and its layout; **no code change**.
2. **Code lists per paying bank, versioned.** Each paying bank has its own list. Importing a list (CSV) shows a preview with duplicates, test entries and short codes, then saves it as a **new version** with the file name, the SHA-256 of the file and the date. Older versions stay. The existing organization list becomes the "Generic (CBN codes)" profile, so nothing existing changes (the migration moves existing rows under it and is reversible).
3. **Layout as data.** An ordered list of columns, each a header and a source (debit account, beneficiary account, bank code, beneficiary name, narration, amount, or a fixed value), plus the file type (Excel or CSV), the sheet name, whether account numbers are text, the amount format, and the narration length limit. **First Bank's layout is the six headers above.** Access Bank's cannot be written until I have its template.
4. **At export you choose the paying bank** (the client's default is preselected). Each employee's bank name is matched **only against that paying bank's list**; no match, a blocked entry, or two possible banks is listed as a problem for that person and the file is not produced unless they are deliberately left out (as today).
5. **The batch records** the paying bank, the code-list version, the layout and the file's fingerprint, so a file can always be traced to the list it was made from; the audit log gets an entry. A change to a list never changes a file already made.
6. **Controls unchanged:** the same export permission and two-factor, a locked payroll only, bank details still masked, no money moved by the app.

## 4. Tests first

- A name resolves to the code on the **chosen** paying bank's list, never another's: Stanbic gives `039` for Access and `221` for First Bank; Kuda gives `A98` and `770`.
- A blocked entry (test bank, a code shared by two banks, a short code) is never put in a file, with the reason shown.
- First Bank's file has exactly the six headers in order, one row per person, the debit account on every row, amounts exact to the kobo, account numbers kept as text with leading zeros.
- A second paying bank can be added with data only, with a different layout and list, and produces a different file for the same payroll.
- Importing a list: a duplicate code, a test entry and a 2-digit code are caught in the preview; the version, file name and fingerprint are saved; an old file still shows the version it used.
- Isolation between organizations, permissions, and the audit entry. The existing payment-file tests keep passing.

## 5. What I need from you

1. **The Access Bank upload template.** Without it I can load Access's codes but cannot produce an Access file.
2. **First Bank's format details** the template does not show: is `Amount` plain (for example `150000.50`, no thousands separator), is there a narration length limit or banned characters, must account numbers be text, is one debit account per file the rule, and is there a limit on rows per file?
3. **Which bank each client pays from:** one paying bank per payroll, or can one payroll be paid from more than one bank (split by employee)? And a client with accounts at both banks?
4. **Who chooses the paying bank**: the bureau officer at export (preselected from the client's setting), or fixed per client?
5. **The blocked entries**: please confirm with each bank the owner of Access `A43` and `D92`, and the true codes for First Bank's four short ones; until then they stay blocked.
6. **How current are the two lists**, and which bank is next (GTBank, Zenith, UBA)?
7. **Existing data:** the generic CBN list stays as a profile for clients who just want the generic file.

## 6. Risks and what I will not do

- **A wrong code sends salary to the wrong bank.** Hence per-bank lists, blocked ambiguous entries, and listing a problem instead of guessing. The bank's own upload screen may also validate the name against the account; keep that step.
- I will not fix the lists' errors myself (no added zeros, no choosing between two owners of a code), enter any account number, or send a file to a bank. The file is for a person to upload.
- Extraction from a PDF can in principle miss a row; I matched every name to a code by position and the counts agree (471 and 651, no row without a partner apart from page footers). Spot-check a few banks you use.
