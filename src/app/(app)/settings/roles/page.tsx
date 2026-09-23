import { requirePage } from "@/lib/auth/session";
import { PERMISSIONS, ROLE_PERMISSIONS, type Role } from "@/lib/auth/permissions";
import { PageHeader, Section } from "@/components/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export default async function RolesPage() {
  await requirePage();
  const roles = Object.keys(ROLE_PERMISSIONS) as Role[];
  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="Role-based authorization is enforced on the server for every page, action and export."
      />
      <Section title="Permission matrix" flush>
        <Table>
          <THead>
            <TR>
              <TH>Permission</TH>
              {roles.map((r) => (
                <TH key={r} className="text-center text-[10px]">
                  {r.replace("_", " ")}
                </TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {PERMISSIONS.map((p) => (
              <TR key={p}>
                <TD className="font-mono text-xs">{p}</TD>
                {roles.map((r) => (
                  <TD key={r} className="text-center">
                    {ROLE_PERMISSIONS[r].includes(p) ? "✓" : ""}
                  </TD>
                ))}
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </>
  );
}
