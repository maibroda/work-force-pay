import { requirePage } from "@/lib/auth/session";
import { CATEGORY_LABELS, DOCUMENT_CATEGORIES } from "@/lib/documents";
import { listTypes } from "@/server/services/documents";
import { FormPanel, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { addDocumentTypeAction, updateDocumentTypeAction } from "@/app/actions/documents";

export default async function DocumentTypesPage() {
  const ctx = await requirePage("document.configure");
  const types = await listTypes(ctx, { all: true });
  return (
    <>
      <PageHeader
        title="Document types"
        description="The kinds of document kept for each employee, in seven fixed categories. Add your own types here without any change to the application. A type that needs approval stays pending until someone other than the uploader approves it. Identification and medical types are sensitive: only people with that access can open them. A type can be switched off but never deleted, so existing documents keep their type."
      />

      <FormPanel title="Add a document type">
        <SmartForm
          columns={3}
          submitLabel="Add type"
          action={addDocumentTypeAction}
          fields={[
            { name: "category", label: "Category", type: "select", required: true, options: DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })) },
            { name: "name", label: "Name of the document type", required: true, span: 2 },
            { name: "requiresApproval", label: "Needs approval before it counts", type: "checkbox", defaultValue: true },
            { name: "hasExpiry", label: "Has an expiry date", type: "checkbox" },
            { name: "sensitive", label: "Sensitive (only people with sensitive-document access can open it)", type: "checkbox", defaultValue: true },
          ]}
        />
      </FormPanel>

      {DOCUMENT_CATEGORIES.map((c) => {
        const rows = types.filter((t) => t.category === c);
        if (!rows.length) return null;
        return (
          <Section key={c} title={CATEGORY_LABELS[c]} flush>
            <Table>
              <THead>
                <TR>
                  <TH>Type</TH>
                  <TH>Needs approval</TH>
                  <TH>Expiry date</TH>
                  <TH>Sensitive</TH>
                  <TH>In use</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((t) => (
                  <TR key={t.id} className={t.active ? "" : "opacity-60"}>
                    <TD>
                      {t.name} {t.standard ? <Badge tone="gray">standard</Badge> : <Badge tone="blue">added</Badge>}
                    </TD>
                    <TD>
                      <ActionButton action={updateDocumentTypeAction.bind(null, t.id, { requiresApproval: !t.requiresApproval })} variant="outline">
                        {t.requiresApproval ? "Yes" : "No"}
                      </ActionButton>
                    </TD>
                    <TD>
                      <ActionButton action={updateDocumentTypeAction.bind(null, t.id, { hasExpiry: !t.hasExpiry })} variant="outline">
                        {t.hasExpiry ? "Yes" : "No"}
                      </ActionButton>
                    </TD>
                    <TD>
                      <ActionButton action={updateDocumentTypeAction.bind(null, t.id, { sensitive: !t.sensitive })} variant="outline">
                        {t.sensitive ? "Yes" : "No"}
                      </ActionButton>
                    </TD>
                    <TD>
                      <ActionButton action={updateDocumentTypeAction.bind(null, t.id, { active: !t.active })} variant="outline">
                        {t.active ? "Switch off" : "Switch on"}
                      </ActionButton>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Section>
        );
      })}
    </>
  );
}
