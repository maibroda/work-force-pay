# Bank code lists

Each paying bank publishes its own list of codes for the banks its customers can pay. **The same code can mean a different bank on different lists** (77 of the 109 codes that appear on both lists below), so a list is only ever used for the bank it came from. See `docs/plans/paying-bank-files.md`.

| File | Paying bank | Source | Rows |
| --- | --- | --- | --- |
| `access-bank.csv` | Access Bank | "BankCode - ACCESS BANK.pdf" supplied by the founder, 11 pages | 471 |
| `first-bank.csv` | First Bank | "BankCode - FIRST BANK.pdf" supplied by the founder, 15 pages | 651 |

They are a literal extraction of the PDFs (name beside code, matched by position on the page), not corrected. Known problems, to be confirmed with each bank before the lists are used for payment: Access `039_` is "NIBSS TEST BANK" (never payable); Access `A43` and `D92` each belong to two different banks; Access lists "BLOOMS MFB" twice; four First Bank codes have only two digits (95, 62, 99, 61). The PDFs carry no date, so how current they are is not known.
