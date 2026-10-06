import Link from "next/link";
import type { Ctx } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { fmtDate, iso } from "@/lib/dates";
import { naira, num } from "@/lib/money";
import {
  ageOn,
  BENEFICIARY_KINDS,
  benefitShares,
  CONTACT_KINDS,
  CONTACT_LABELS,
  GUARANTOR_ID_TYPES,
  PRIMARY_KINDS,
  RELATIONSHIPS,
  type ContactKindName,
} from "@/lib/personal-records";
import { listContacts, listGuarantors, recordsStatus } from "@/server/services/personal-records";
import {
  addContactAction,
  addGuarantorAction,
  deleteGuarantorAction,
  rejectGuarantorAction,
  releaseGuarantorAction,
  removeContactAction,
  setPrimaryContactAction,
  updateContactAction,
  updateGuarantorAction,
  verifyGuarantorAction,
} from "@/app/actions/personal-records";
import { ActionButton } from "@/components/action-button";
import { Empty, FormPanel, Section } from "@/components/page";
import { SmartForm, type Field } from "@/components/smart-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const SECTION_TITLES: Record<ContactKindName, string> = {
  NEXT_OF_KIN: "Next of kin",
  EMERGENCY_CONTACT: "Emergency contacts",
  DEPENDANT: "Dependants",
  REFEREE: "Referees",
};
const relOptions = RELATIONSHIPS.map((r) => ({ value: r, label: r }));
const withParam = (base: string, k: string, v: string) => `${base}${base.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(v)}`;

type Contact = Awaited<ReturnType<typeof listContacts>>[number];
type Guarantor = Awaited<ReturnType<typeof listGuarantors>>[number];

function contactFields(kind: ContactKindName | null, c?: Contact): Field[] {
  const k = kind ?? c?.kind ?? "NEXT_OF_KIN";
  return [
    ...(kind
      ? [{ name: "kind", label: "This person is a", type: "select" as const, required: true, defaultValue: kind, options: CONTACT_KINDS.map((x) => ({ value: x, label: CONTACT_LABELS[x] })) }]
      : []),
    { name: "fullName", label: "Full name", required: true, defaultValue: c?.fullName },
    { name: "relationship", label: "Relationship", type: "select", required: true, defaultValue: c?.relationship, options: relOptions },
    { name: "phone", label: "Phone", defaultValue: c?.phone ?? undefined, help: k === "DEPENDANT" ? "Optional for a dependant." : "Required — they must be reachable." },
    { name: "altPhone", label: "Other phone", defaultValue: c?.altPhone ?? undefined },
    { name: "email", label: "Email", type: "email", defaultValue: c?.email ?? undefined },
    { name: "dateOfBirth", label: "Date of birth", type: "date", defaultValue: c?.dateOfBirth ? iso(c.dateOfBirth) : undefined, help: "Required for a dependant." },
    { name: "address", label: "Address", defaultValue: c?.address ?? undefined, span: 2 },
    { name: "occupation", label: "Occupation", defaultValue: c?.occupation ?? undefined },
    { name: "isPrimary", label: "The main one (next of kin / emergency contact only)", type: "checkbox", defaultValue: c?.isPrimary ?? false },
    { name: "isBeneficiary", label: "Receives benefits (next of kin / dependant only)", type: "checkbox", defaultValue: c?.isBeneficiary ?? false },
    { name: "benefitSharePct", label: "Share of the benefit (%)", type: "number", min: 1, max: 100, defaultValue: c?.benefitSharePct ?? undefined, help: "A beneficiary's shares should total 100%." },
    { name: "notes", label: "Notes", type: "textarea", defaultValue: c?.notes ?? undefined, span: 2 },
  ];
}

function guarantorFields(g?: Guarantor): Field[] {
  return [
    { name: "fullName", label: "Guarantor's full name", required: true, defaultValue: g?.fullName },
    { name: "relationship", label: "Relationship to the employee", type: "select", required: true, defaultValue: g?.relationship, options: relOptions },
    { name: "phone", label: "Phone", required: true, defaultValue: g?.phone },
    { name: "altPhone", label: "Other phone", defaultValue: g?.altPhone ?? undefined },
    { name: "email", label: "Email", type: "email", defaultValue: g?.email ?? undefined },
    { name: "yearsKnown", label: "Years known", type: "number", min: 0, max: 80, defaultValue: g?.yearsKnown ?? undefined },
    { name: "address", label: "Home address", required: true, defaultValue: g?.address, span: 3 },
    { name: "occupation", label: "Occupation", defaultValue: g?.occupation ?? undefined },
    { name: "employer", label: "Employer", defaultValue: g?.employer ?? undefined },
    { name: "employerAddress", label: "Employer's address", defaultValue: g?.employerAddress ?? undefined },
    { name: "idType", label: "ID type", type: "select", defaultValue: g?.idType ?? undefined, options: GUARANTOR_ID_TYPES, help: "ID and signed form are needed before verifying." },
    { name: "idNumber", label: "ID number", defaultValue: g?.idNumber ?? undefined },
    { name: "formReference", label: "Signed guarantee form (file no. / reference)", defaultValue: g?.formReference ?? undefined },
    { name: "guaranteeAmount", label: "Guaranteed up to (₦, if capped)", type: "number", min: 0, defaultValue: g?.guaranteeAmount ? num(g.guaranteeAmount) : undefined },
  ];
}

/**
 * Everything on file for one employee: next of kin, emergency contacts, dependants, referees and
 * guarantors, with the add / edit forms. Used on the employee page (HR) and on My Contacts
 * (self-service, where guarantors are HR's business and not shown).
 */
export async function PersonalRecordsPanel({
  ctx,
  employeeId,
  base,
  edit,
  editGuarantor,
  selfService = false,
}: {
  ctx: Ctx;
  employeeId: string;
  /** This page's own URL (with any query it needs), used for edit links and to return after an edit. */
  base: string;
  edit?: string;
  editGuarantor?: string;
  selfService?: boolean;
}) {
  const manage = can(ctx.role, "hr.manage");
  const canEditContacts = selfService || manage;
  const showGuarantors = !selfService && can(ctx.role, "employee.sensitive");
  const [contacts, status, guarantors] = await Promise.all([
    listContacts(ctx, employeeId),
    recordsStatus(ctx, employeeId),
    showGuarantors ? listGuarantors(ctx, { employeeId }) : Promise.resolve([] as Guarantor[]),
  ]);
  const editing = edit ? contacts.find((c) => c.id === edit) : undefined;
  const editingG = editGuarantor ? guarantors.find((g) => g.id === editGuarantor) : undefined;
  const g = status.gaps;
  const today = new Date();
  const gaps = [
    g.nextOfKinMissing > 0 && `${g.nextOfKinMissing} next of kin to add`,
    g.emergencyMissing > 0 && `${g.emergencyMissing} emergency contact(s) to add`,
    g.guarantorsMissing > 0 &&
      (selfService
        ? `HR still has to verify ${g.guarantorsMissing} guarantor(s) for you`
        : `${g.guarantorsMissing} more verified guarantor(s) needed${g.guarantorsPending ? ` (${g.guarantorsPending} awaiting verification)` : ""}`),
    status.shares.count > 0 && !status.shares.complete && `beneficiary shares total ${status.shares.total}% — they should total 100%`,
  ].filter(Boolean) as string[];

  const table = (kind: ContactKindName) => {
    const rows = contacts.filter((c) => c.kind === kind);
    const beneficiaries = BENEFICIARY_KINDS.includes(kind);
    return (
      <Section key={kind} title={SECTION_TITLES[kind]} flush>
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Relationship</TH>
              <TH>Phone</TH>
              <TH>{kind === "DEPENDANT" ? "Date of birth" : "Address"}</TH>
              {beneficiaries && <TH>Benefit share</TH>}
              <TH />
            </TR>
          </THead>
          <TBody>
            {rows.map((c) => (
              <TR key={c.id}>
                <TD>
                  {c.fullName} {c.isPrimary && <Badge tone="blue">Main</Badge>}
                  {c.occupation && <div className="text-xs text-muted-foreground">{c.occupation}</div>}
                </TD>
                <TD className="text-xs">{c.relationship}</TD>
                <TD className="text-xs">
                  {c.phone ?? "—"}
                  {c.altPhone && <div className="text-muted-foreground">{c.altPhone}</div>}
                </TD>
                <TD className="max-w-xs whitespace-normal text-xs">
                  {kind === "DEPENDANT" ? (c.dateOfBirth ? `${fmtDate(c.dateOfBirth)} (age ${ageOn(c.dateOfBirth, today)})` : "—") : (c.address ?? "—")}
                </TD>
                {beneficiaries && <TD className="text-xs">{c.isBeneficiary ? `${c.benefitSharePct}%` : "—"}</TD>}
                <TD className="space-x-1 whitespace-nowrap text-right">
                  {canEditContacts && (
                    <>
                      <Link className="text-xs text-primary underline" href={withParam(base, "edit", c.id)}>
                        Edit
                      </Link>
                      {PRIMARY_KINDS.includes(kind) && !c.isPrimary && (
                        <ActionButton action={setPrimaryContactAction.bind(null, c.id)} variant="outline">
                          Make main
                        </ActionButton>
                      )}
                      <ActionButton action={removeContactAction.bind(null, c.id)} confirm={`Remove ${c.fullName}?`} variant="outline">
                        Remove
                      </ActionButton>
                    </>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {!rows.length && <Empty>None recorded.</Empty>}
      </Section>
    );
  };

  return (
    <>
      <div className={`mb-5 rounded-lg border px-4 py-3 text-sm ${gaps.length ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>
        {gaps.length ? (
          <>
            <b>Records incomplete:</b> {gaps.join("; ")}.
          </>
        ) : (
          <>
            <b>Records complete</b> for this employee&apos;s category.
          </>
        )}
      </div>

      {(["NEXT_OF_KIN", "EMERGENCY_CONTACT", "DEPENDANT", "REFEREE"] as const).map(table)}

      {canEditContacts && (
        <FormPanel title={editing ? `Edit ${editing.fullName}` : "Add a contact"} open={Boolean(editing) || !contacts.length}>
          <div key={editing?.id ?? "new"}>
            <SmartForm
              columns={3}
              submitLabel={editing ? "Save changes" : "Add"}
              resetOnSuccess={!editing}
              action={editing ? updateContactAction.bind(null, editing.id, base) : addContactAction.bind(null, employeeId)}
              fields={contactFields(editing ? null : "NEXT_OF_KIN", editing)}
            />
            {editing && (
              <Link className="mt-2 inline-block text-xs text-primary underline" href={base}>
                Cancel
              </Link>
            )}
          </div>
        </FormPanel>
      )}

      {selfService && <p className="mb-8 text-xs text-muted-foreground">Guarantor records are kept by HR. Keep these details current — they&apos;re who the company calls in an emergency.</p>}

      {showGuarantors && (
        <>
          <Section
            title="Guarantors"
            description={`${g.guarantorsNeeded ? `This employee's category needs ${g.guarantorsNeeded} verified guarantor(s) — ${g.guarantorsVerified} verified.` : "No guarantors are required for this employee's category."} A guarantor is verified once an ID and the signed form are on file.`}
            flush
          >
            <Table>
              <THead>
                <TR>
                  <TH>Guarantor</TH>
                  <TH>Phone</TH>
                  <TH>Work / ID</TH>
                  <TH>Form</TH>
                  <TH>Status</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {guarantors.map((x) => (
                  <TR key={x.id}>
                    <TD className="max-w-xs whitespace-normal">
                      {x.fullName}
                      <div className="text-xs text-muted-foreground">
                        {x.relationship}
                        {x.yearsKnown != null ? ` · known ${x.yearsKnown} yr` : ""}
                      </div>
                      <div className="text-xs text-muted-foreground">{x.address}</div>
                    </TD>
                    <TD className="text-xs">{x.phone}</TD>
                    <TD className="text-xs">
                      {[x.occupation, x.employer].filter(Boolean).join(" at ") || "—"}
                      <div className="font-mono text-muted-foreground">{x.idType ? `${x.idType.replace(/_/g, " ")} ${x.idNumber ?? ""}` : "no ID"}</div>
                    </TD>
                    <TD className="text-xs">
                      {x.formReference ?? "—"}
                      {x.guaranteeAmount && <div className="text-muted-foreground">up to {naira(x.guaranteeAmount)}</div>}
                    </TD>
                    <TD className="max-w-[14rem] whitespace-normal text-xs">
                      <StatusBadge status={x.status} />
                      {x.verifiedBy && (
                        <div className="mt-1 text-muted-foreground">
                          {x.verifiedBy}, {fmtDate(x.verifiedAt)} — {x.verificationNote}
                        </div>
                      )}
                      {x.releasedAt && (
                        <div className="mt-1 text-muted-foreground">
                          Released {fmtDate(x.releasedAt)} — {x.releaseReason}
                        </div>
                      )}
                    </TD>
                    <TD className="space-x-1 whitespace-nowrap text-right">
                      {manage && x.status !== "RELEASED" && (
                        <>
                          <Link className="text-xs text-primary underline" href={withParam(base, "editg", x.id)}>
                            Edit
                          </Link>
                          {x.status === "PENDING" && (
                            <>
                              <ActionButton action={verifyGuarantorAction.bind(null, x.id)} reason reasonPlaceholder="How you verified (called, visited…)">
                                Verify
                              </ActionButton>
                              <ActionButton action={rejectGuarantorAction.bind(null, x.id)} reason variant="outline">
                                Reject
                              </ActionButton>
                            </>
                          )}
                          {x.status === "VERIFIED" ? (
                            <ActionButton action={releaseGuarantorAction.bind(null, x.id)} reason variant="outline">
                              Release
                            </ActionButton>
                          ) : (
                            <ActionButton action={deleteGuarantorAction.bind(null, x.id)} confirm="Delete this entry?" variant="outline">
                              Delete
                            </ActionButton>
                          )}
                        </>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {!guarantors.length && <Empty>No guarantors recorded.</Empty>}
          </Section>
          {manage && (
            <FormPanel title={editingG ? `Edit guarantor ${editingG.fullName}` : "Add a guarantor"} open={Boolean(editingG)}>
              <div key={editingG?.id ?? "new"}>
                <SmartForm
                  columns={3}
                  submitLabel={editingG ? "Save changes" : "Record guarantor"}
                  resetOnSuccess={!editingG}
                  action={editingG ? updateGuarantorAction.bind(null, editingG.id, base) : addGuarantorAction.bind(null, employeeId)}
                  fields={guarantorFields(editingG)}
                />
                {editingG && (
                  <p className="mt-2 text-xs text-muted-foreground">Changing the name, phone, address, ID or form sends a verified guarantor back to pending.</p>
                )}
              </div>
            </FormPanel>
          )}
        </>
      )}
      {benefitShares(contacts).count > 0 && <p className="mb-8 text-xs text-muted-foreground">Beneficiary shares total {benefitShares(contacts).total}%.</p>}
    </>
  );
}
