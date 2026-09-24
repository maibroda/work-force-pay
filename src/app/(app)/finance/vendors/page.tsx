import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listVendors } from "@/server/services/payables";
import { enumOptions } from "@/server/options";
import { FormPanel, PageHeader, Section, Empty } from "@/components/page";
import { SmartForm } from "@/components/smart-form";
import { ActionButton } from "@/components/action-button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { createVendorAction, setVendorActiveAction } from "@/app/actions/payables";

const CATEGORIES = [
  "UNIFORM_KITS",
  "EQUIPMENT",
  "UTILITIES",
  "PROFESSIONAL_SERVICES",
  "RENT",
  "MAINTENANCE",
  "OTHER",
];

export default async function VendorsPage() {
  const ctx = await requirePage("gl.view");
  const vendors = await listVendors(ctx);
  const manage = can(ctx.role, "payment.manage");
  return (
    <>
      <PageHeader
        title="Vendors"
        description="Suppliers you owe money to — uniforms/kits, equipment, utilities, professional services, rent, maintenance. Record their bills under Billing & Payables."
      />
      <Section title="Vendors" flush>
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Category</TH>
              <TH>Contact</TH>
              <TH>Bank</TH>
              <TH className="text-right">Invoices</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {vendors.map((v) => (
              <TR key={v.id}>
                <TD>{v.name}</TD>
                <TD>
                  <Badge tone="blue">{v.category.replace(/_/g, " ")}</Badge>
                </TD>
                <TD className="text-xs">
                  {v.contactPerson ?? "—"}
                  {v.phone ? ` · ${v.phone}` : ""}
                </TD>
                <TD className="text-xs">{v.bankName ? `${v.bankName} — ${v.accountNumber ?? ""}` : "—"}</TD>
                <TD className="text-right">{v._count.invoices}</TD>
                <TD>
                  <StatusBadge status={v.active ? "ACTIVE" : "INACTIVE"} />
                </TD>
                <TD>
                  {manage && (
                    <ActionButton
                      action={setVendorActiveAction.bind(null, v.id, !v.active)}
                      confirm={v.active ? "Deactivate this vendor?" : "Reactivate this vendor?"}
                      variant="outline"
                    >
                      {v.active ? "Deactivate" : "Reactivate"}
                    </ActionButton>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!vendors.length && <Empty>No vendors yet.</Empty>}
      </Section>
      {manage && (
        <FormPanel title="Add vendor">
          <SmartForm
            columns={3}
            submitLabel="Create vendor"
            action={createVendorAction}
            fields={[
              { name: "name", label: "Vendor name", required: true, span: 2 },
              {
                name: "category",
                label: "Category",
                type: "select",
                required: true,
                options: enumOptions(CATEGORIES),
                defaultValue: "OTHER",
              },
              { name: "contactPerson", label: "Contact person" },
              { name: "phone", label: "Phone" },
              { name: "email", label: "Email", type: "email" },
              { name: "address", label: "Address", span: 2 },
              { name: "taxId", label: "Tax ID (TIN)" },
              { name: "bankName", label: "Bank name" },
              { name: "accountNumber", label: "Account number" },
              { name: "accountName", label: "Account name" },
            ]}
          />
        </FormPanel>
      )}
    </>
  );
}
