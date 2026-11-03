# Bank code lists

Each paying bank publishes its own list of codes for the banks its customers can pay. **The same code can mean a different bank on different lists** (77 of the 109 codes that appear on both lists below), so a list is only ever used for the bank it came from. See `docs/plans/paying-bank-files.md`.

| File | Paying bank | Source | Rows |
| --- | --- | --- | --- |
| `access-bank.csv` | Access Bank | "BankCode - ACCESS BANK.pdf" supplied by the founder, 11 pages | 471 |
| `first-bank.csv` | First Bank | "BankCode - FIRST BANK.pdf" supplied by the founder, 15 pages | 651 |

They are a literal extraction of the PDFs (name beside code, matched by position on the page), not corrected. Known problems, to be confirmed with each bank before the lists are used for payment. The app **blocks these entries when a list is imported** and never puts them in a file: **Access (6 entries):** `039_` "NIBSS TEST BANK" (never payable); `A43` belongs to both Blooms MFB and Corestep MFB; `D92` to both Jessefield MFB and Jubilee Life Mortgage Bank; Blooms MFB is also listed under `E43`, so it has two codes. **First Bank (14 entries):** four codes have only two digits (95 BOLD MFB, 62 COOPFUND MFB, 99 MINT MFB, 61 MODEL MFB), probably with a lost leading zero (not guessed), and five names appear under two different codes each (Nexim: 405 and 024; FortisMobile: 308 and 840; M-KUDI: 313 and 837; ZenithMobile: 322 and 842; MoneyBox: 325 and 843). The PDFs carry no date, so how current they are is not known.
