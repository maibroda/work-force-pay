import { requirePage } from "@/lib/auth/session";
import { CATEGORY_LABELS, DOCUMENT_CATEGORIES } from "@/lib/documents";
import { listTypes } from "@/server/services/documents";
import { listRequirements } from "@/server/services/document-register";
import { listCategories } from "@/server/services/employees";
import { FormPanel, PageHeader, Section } from "@/components/page";
import { ActionButton } from "@/components/action-button";
import { SmartForm } from "@/components/smart-form";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { addDocumentTypeAction, addRequirementAction, setRequirementActiveAction, updateDocumentTypeAction } from "@/app/actions/documents";

export default async function DocumentTypesPage() {
  const ctx = await requirePage("document.configure");
  const [types, requirements, categories] = await Promise.all([listTypes(ctx, { all: true }), listRequirements(ctx, { all: true }), listCategories(ctx)]);
  const activeTypes = types.filter((t) => t.active);
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

      <FormPanel title="Required documents">
        <p className="mb-3 text-sm text-muted-foreground">
          Choose the documents the company requires, of everyone or of one employee category. An employee counts as having a required document only once it is approved. Active employees and those on leave who lack one appear under Missing documents in the employee document register. Nothing is required until you add it here.
        </p>
        <SmartForm
          columns={3}
          submitLabel="Add requirement"
          action={addRequirementAction}
          fields={[
            { name: "typeId", label: "Document type", type: "select", required: true, options: activeTypes.map((t) => ({ value: t.id, label: `${t.name} (${CATEGORY_LABELS[t.category as (typeof DOCUMENT_CATEGORIES)[number]]})` })) },
            { name: "categoryId", label: "Required of (leave blank for everyone)", type: "select", options: categories.map((c) => ({ value: c.id, label: c.name })) },
          ]}
        />
        {requirements.length > 0 && (
          <Table>
            <THead>
              <TR>
                <TH>Document</TH>
                <TH>Required of</TH>
                <TH>Status</TH>
                <TH>Change</TH>
              </TR>
            </THead>
            <TBody>
              {requirements.map((r) => (
                <TR key={r.id} className={r.active ? "" : "opacity-60"}>
                  <TD>{r.type.name}</TD>
                  <TD>{r.category ? r.category.name : "Everyone"}</TD>
                  <TD>{r.active ? <Badge tone="green">Required</Badge> : <Badge tone="gray">Switched off</Badge>}</TD>
                  <TD>
                    <ActionButton action={setRequirementActiveAction.bind(null, r.id, !r.active)} variant="outline">
                      {r.active ? "Switch off" : "Switch on"}
                    </ActionButton>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
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
