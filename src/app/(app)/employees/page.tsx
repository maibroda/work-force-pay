import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { listEmployees } from "@/server/services/employees";
import { options } from "@/server/options";
import { fullName } from "@/lib/utils";
import { fmtDate } from "@/lib/dates";
import { FilterBar, FilterField, PageHeader, Section } from "@/components/page";
import { Input, Select } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";

type SP = Promise<Record<string, string | undefined>>;

export default async function EmployeesPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requirePage("employee.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const [o, { rows, total }] = await Promise.all([
    options(ctx),
    listEmployees(ctx, {
      q: sp.q,
      status: sp.status,
      categoryId: sp.categoryId,
      clientId: sp.clientId,
      unassigned: sp.unassigned === "1",
      take: 50,
      skip: (page - 1) * 50,
    }),
  ]);
  const qs = (p: number) =>
    `?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v) as [string, string][]), page: String(p) })}`;
  return (
    <>
      <PageHeader
        title="Employees"
        description="Employee master. Employee numbers are generated automatically and never change on transfer."
        actions={
          can(ctx.role, "employee.manage") && (
            <Link href="/employees/new" className={buttonVariants()}>
              + New employee
            </Link>
          )
        }
      />
      <FilterBar>
        <FilterField label="Search">
          <Input name="q" defaultValue={sp.q} placeholder="Number, name, phone, account" className="w-60" />
        </FilterField>
        <FilterField label="Status">
          <Select name="status" defaultValue={sp.status ?? ""}>
            <option value="">All</option>
            {["ACTIVE", "INACTIVE", "SUSPENDED", "ON_LEAVE", "TERMINATED", "RESIGNED", "EXITED"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Category">
          <Select name="categoryId" defaultValue={sp.categoryId ?? ""}>
            <option value="">All</option>
            {o.categories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </FilterField>
        <FilterField label="Current client">
          <Select name="clientId" defaultValue={sp.clientId ?? ""}>
            <option value="">All</option>
            {o.clients.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </FilterField>
        <label className="flex items-center gap-1 pb-2 text-xs">
          <input type="checkbox" name="unassigned" value="1" defaultChecked={sp.unassigned === "1"} />{" "}
          Unassigned only
        </label>
      </FilterBar>
      <Section title={`${total} employee(s)`} flush>
        <Table>
          <THead>
            <TR>
              <TH>Emp. No.</TH>
              <TH>Name</TH>
              <TH>Category</TH>
              <TH>Current client</TH>
              <TH>Current beat</TH>
              <TH>Employed</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((e) => (
              <TR key={e.id}>
                <TD>
                  <Link className="font-medium text-primary hover:underline" href={`/employees/${e.id}`}>
                    {e.employeeNumber}
                  </Link>
                </TD>
                <TD>{fullName(e)}</TD>
                <TD>{e.category.name}</TD>
                <TD>{e.currentClient?.name ?? <span className="text-amber-700">Unassigned</span>}</TD>
                <TD>{e.currentBeat?.name ?? "—"}</TD>
                <TD>{fmtDate(e.employmentDate)}</TD>
                <TD>
                  <StatusBadge status={e.status} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
          <span>
            Page {page} of {Math.max(1, Math.ceil(total / 50))}
          </span>
          <span className="space-x-3">
            {page > 1 && (
              <Link className="text-primary" href={qs(page - 1)}>
                ← Previous
              </Link>
            )}
            {page * 50 < total && (
              <Link className="text-primary" href={qs(page + 1)}>
                Next →
              </Link>
            )}
          </span>
        </div>
      </Section>
    </>
  );
}
