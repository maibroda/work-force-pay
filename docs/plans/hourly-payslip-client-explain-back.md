# Explain-back note: the client's name on the payslip

On the founder's confirmed decision of 2026-11-21 (client name on the payslip: yes) and his brief: display the applicable client name, support more than one client, **preserve the historical assignment on payslips already made**, and **never expose a client's contract rates, charge-out rates or other commercial information.** **A display and storage change only: no pay figure, rule or setting changes.** This is not a payroll-rule or tax matter, so it has no legal-review dependency of its own.

## What it does, step by step

1. **A "Client" detail on the payslip** (screen and PDF), next to the category. With one client it reads "Client: ABC Bank"; with more than one, "Clients: ABC Bank; Beta Foods" (each once, in the order they first appear). **Monthly staff**: the client(s) come from the work locations the payroll already stores (the head office is not a client). **Staff paid by the hour**: from the hours lines and the extra pay lines (leave, sick and holiday pay), which are for specific sites. A payslip with no client (a head-office person) has no client row and is unchanged.
2. **The Site column of the hours table now reads "Client - Site"** (for example "ABC Bank - Gate 1"), so a person who worked for two clients in the month sees which hours were for which client. Extra pay lines name their client the same way. The PDF gives the column a little more room.
3. **Names as they were when the payroll was calculated.** Each stored hours line and extra pay line now keeps the client's name and the site's name from the day the payroll was calculated (new columns). **Renaming a client or a site later does not change a payslip already made.** A line from an older payroll, made before the names were kept, shows the **current** names (stated here plainly; those payslips cannot be reconstructed).
4. **Only the name.** The payslip carries the client's name and the site's name, nothing the client is charged: no contract rate, agreed rate, billing or management share. A test pins that none of these words or figures is in what the payslip carries.
5. **Who sees it:** the same people as before (the person, and payroll roles): the data is read through the existing payslip service, so the employee still sees only their own payslip and another company sees none.
6. **No walkthrough screenshot yet:** the dev server was not usable on this machine; the layout is proved by the PDF text tests.

## Where each rule comes from

Your brief of 2026-11-21 (the client name; multiple clients; historical assignments preserved; no commercial information).

## Worked example (invented)

A guard works 10 hours at "Global Insurance - Tower" and 10 hours at "Industrial Client Plc - Plant" in March. The payslip shows "Clients: Global Insurance; Industrial Client Plc" and two hours rows labelled with each client and site. In April "Global Insurance" is renamed; the March payslip still says "Global Insurance". A payroll calculated before this change shows the current name.

## What could go wrong

- A very long client and site name is shortened with "..." in the PDF's Site column (the full list of clients is in the Client detail, itself shortened if very long).
- Older payslips show current names, not the names of their day.

## Which tests prove it

`tests/unit/payslip-pdf.test.ts` (6 new): one client; several clients; extra pay lines; monthly staff from locations (head office excluded); no client; no commercial information. `tests/integration/hourly-payslip-client.test.ts` (2): hours and extra pay lines store the client and site names, the payslip shows both clients and carries no contract rate; a rename after the payroll does not change the payslip, and a line with no stored name shows the current names. One older test (`hourly-payslip.test.ts`) now expects the Site column to read "Client - Site".

## Migration and rollback

`20270108090000_payslip_client_names`: four nullable columns (client and site name on the stored hours line and on the extra pay line). `down.sql` drops them (the kept names are lost: an old payslip then shows current names); round-tripped on a throwaway database.
