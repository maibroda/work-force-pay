import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { orgChart, type OrgNode } from "@/server/services/hr";
import { PageHeader, Section, Empty } from "@/components/page";
import { StatusBadge } from "@/components/ui/badge";

export default async function OrgChartPage() {
  const ctx = await requirePage("employee.view");
  const { tree, unassignedCount } = await orgChart(ctx);
  return (
    <>
      <PageHeader
        title="Org chart"
        description="Reporting lines from each employee's “Reports to” field (set on the employee's Overview tab). Employees with no manager set are shown as top-level."
      />
      <Section title="Reporting structure" flush>
        {tree.length ? (
          <div className="p-4">
            <ul className="space-y-1">
              {tree.map((n) => (
                <OrgNodeItem key={n.id} node={n} depth={0} />
              ))}
            </ul>
          </div>
        ) : (
          <Empty>No employees to show.</Empty>
        )}
      </Section>
      {unassignedCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {unassignedCount} employee(s) report to a manager who has since exited — shown at top level.
        </p>
      )}
    </>
  );
}

function OrgNodeItem({ node, depth }: { node: OrgNode; depth: number }) {
  return (
    <li>
      <div
        className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
        style={{ marginLeft: depth * 24 }}
      >
        <Link className="font-medium text-primary hover:underline" href={`/employees/${node.id}`}>
          {node.employeeNumber} — {node.name}
        </Link>
        <span className="text-xs text-muted-foreground">{node.categoryName}</span>
        <StatusBadge status={node.status} />
        {node.children.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {node.children.length} direct report{node.children.length > 1 ? "s" : ""}
          </span>
        )}
      </div>
      {node.children.length > 0 && (
        <ul className="mt-1 space-y-1">
          {node.children.map((c) => (
            <OrgNodeItem key={c.id} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
