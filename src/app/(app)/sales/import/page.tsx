import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { PageHeader, Section } from "@/components/page";
import { SalesImportForm } from "./import-form";

export default async function SalesImportPage() {
  await requirePage("sales.manage");
  return (
    <>
      <PageHeader
        title="Import and export"
        description="Bring leads, accounts or contacts in from a spreadsheet, or take them out. Every row is checked first and nothing is saved until you press Import."
      />
      <Section title="Export" description="The records you are allowed to see, as a CSV with the same columns the import reads (plus owner and status). Cells that a spreadsheet could run as a formula are made harmless.">
        <div className="flex flex-wrap gap-3 text-sm">
          {["leads", "accounts", "contacts"].map((k) => (
            <a key={k} className="underline" href={`/api/sales/export/${k}`}>
              Export {k}
            </a>
          ))}
          <span className="text-xs text-muted-foreground">Every export is recorded.</span>
        </div>
      </Section>
      <Section
        title="Import"
        description="A sales person owns what they import; a manager's leads follow the owner method set under Sales Settings. A row that looks like something already held is left out unless you choose to import it. Marketing consent is recorded only when the file says Yes or No and says where that came from."
      >
        <SalesImportForm />
      </Section>
      <p className="text-xs text-muted-foreground">
        Contacts are attached to an account by its name, so import accounts first. <Link className="underline" href="/sales/leads">Back to leads</Link>
      </p>
    </>
  );
}
