import { Suspense } from "react";
import { LogOut } from "lucide-react";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { NAV, SELF_NAV } from "@/lib/nav";
import { db } from "@/lib/db";
import { Sidebar } from "@/components/sidebar";
import { logoutAction } from "@/app/actions/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePage();
  const org = await db.organization.findUnique({ where: { id: ctx.orgId } });
  const groups = [
    ...(["SUPERVISOR", "EMPLOYEE"].includes(ctx.role) ? SELF_NAV : []),
    ...NAV,
    ...(!["SUPERVISOR", "EMPLOYEE"].includes(ctx.role) ? SELF_NAV : []),
  ]
    .map((g) => ({
      title: g.title,
      items: g.items
        .filter((i) => can(ctx.role, i.perm))
        .map(({ href, label, section }) => ({ href, label, section })),
    }))
    .filter((g) => g.items.length);
  return (
    <div className="min-h-screen">
      <Suspense>
        <Sidebar groups={groups} org={org?.name ?? ""} />
      </Suspense>
      <div className="lg:pl-60">
        <header className="no-print flex items-center justify-end gap-3 border-b bg-card px-4 py-2 text-sm">
          <span className="hidden text-muted-foreground sm:inline">{org?.name}</span>
          <span className="font-medium">{ctx.name}</span>
          <span className="rounded bg-secondary px-2 py-0.5 text-[11px] font-medium">
            {ctx.role.replace("_", " ")}
          </span>
          <form action={logoutAction}>
            <button
              className="flex items-center gap-1 rounded px-2 py-1 text-muted-foreground hover:bg-accent"
              type="submit"
            >
              <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Sign out</span>
            </button>
          </form>
        </header>
        <main className="mx-auto max-w-[1400px] p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
