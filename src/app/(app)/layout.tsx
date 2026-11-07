import { Suspense } from "react";
import { LogOut } from "lucide-react";
import Link from "next/link";
import { requirePage } from "@/lib/auth/session";
import { twoFactorStateFor } from "@/lib/auth/two-factor-gate";
import { twoFactorReminder } from "@/lib/two-factor-policy";
import { can } from "@/lib/auth/permissions";
import { AREAS, EMPLOYEE_SECTIONS, NAV, SELF_NAV, areaEntry, visibleSections, type JumpPage } from "@/lib/nav";
import { pageAllowed } from "@/lib/entitlements/guard";
import { db } from "@/lib/db";
import { Sidebar } from "@/components/sidebar";
import { AreaTabs } from "@/components/area-tabs";
import { GoTo } from "@/components/go-to";
import { NavTracker } from "@/components/nav-tracker";
import { logoutAction } from "@/app/actions/auth";
import { returnToBureauAction } from "@/app/actions/bureau";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Every page inside this layout runs its own requirePage (which enforces the two-factor requirement); the
  // layout itself must not, or someone sent to My security would be redirected from it, in a loop.
  const ctx = await requirePage(undefined, { allowUnenrolled: true });
  const [org, gate, salesSetting] = await Promise.all([db.organization.findUnique({ where: { id: ctx.orgId } }), twoFactorStateFor(ctx), db.crmSetting.findUnique({ where: { organizationId: ctx.orgId }, select: { enabled: true } })]);
  const salesOn = salesSetting?.enabled ?? false;
  const home = ctx.homeOrgId ? await db.organization.findUnique({ where: { id: ctx.homeOrgId }, select: { name: true } }) : null;
  const showBureau = Boolean(org?.isBureau || ctx.homeOrgId);
  const reminder = twoFactorReminder(gate.state, gate.enforceFrom, new Date(new Date().toISOString().slice(0, 10)));
  // What this person may see: their role, the company's modules, and whether they are in a bureau. An area (Payroll and so on) is ONE sidebar entry leading to the first of its pages
  // they may open; its pages are tabs inside it. Nothing here grants access: every page checks permission and module itself.
  const vis = { can: (p: Parameters<typeof can>[1]) => can(ctx.role, p), allowed: (href: string) => pageAllowed(ctx.entitlements, href), bureau: showBureau, sales: salesOn, client: ctx.role === "CLIENT_APPROVER" || ctx.role === "CLIENT_HR" };
  const areas = AREAS.map((area) => ({ area, sections: visibleSections(area, vis) })).filter((x) => x.sections.length);
  const groups = [
    ...(["SUPERVISOR", "EMPLOYEE"].includes(ctx.role) ? SELF_NAV : []),
    ...NAV,
    ...(!["SUPERVISOR", "EMPLOYEE"].includes(ctx.role) ? SELF_NAV : []),
  ]
    .map((g) => ({
      title: g.title,
      items: g.items.flatMap((i) => {
        if (i.area) {
          const found = areas.find((x) => x.area.key === i.area);
          const entry = found && areaEntry(found.area, vis);
          return entry && found ? [{ href: entry.href, label: entry.label, section: i.section, owns: [...(found.area.home ? [found.area.home] : []), ...found.sections.flatMap((s) => [s.href, ...(s.also ?? [])])] }] : [];
        }
        const ok = can(ctx.role, i.perm) && (!i.bureauOnly || showBureau) && (!i.salesOnly || salesOn) && (!i.clientOnly || ctx.role === "CLIENT_APPROVER" || ctx.role === "CLIENT_HR") && pageAllowed(ctx.entitlements, i.href);
        return ok ? [{ href: i.href, label: i.label, section: i.section, owns: undefined as string[] | undefined }] : [];
      }),
    }))
    .filter((g) => g.items.length);
  // The pages the Go to box can jump to: every page the menu or a tab row shows this person.
  const seen = new Set<string>();
  const jump: JumpPage[] = [];
  const addJump = (href: string, label: string, where: string) => {
    if (seen.has(href)) return;
    seen.add(href);
    jump.push({ href, label, where });
  };
  for (const { area, sections } of areas) for (const s of sections) addJump(s.href, s.label, `${area.title} › ${s.group}`);
  for (const s of EMPLOYEE_SECTIONS) if (can(ctx.role, s.perm) && pageAllowed(ctx.entitlements, s.href)) addJump(s.href, s.label, "Employees");
  for (const g of groups) for (const i of g.items) if (!i.owns) addJump(i.href, i.label, g.title);
  return (
    <div className="min-h-screen">
      <Suspense>
        <Sidebar groups={groups} org={org?.name ?? ""} />
      </Suspense>
      <Suspense>
        <NavTracker />
      </Suspense>
      <div className="lg:pl-60">
        <header className="no-print flex items-center justify-end gap-3 border-b bg-card px-4 py-2 text-sm">
          <GoTo pages={jump} />
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
        {ctx.homeOrgId && (
          <div className="no-print flex flex-wrap items-center gap-2 border-b border-blue-300 bg-blue-50 px-4 py-2 text-sm text-blue-900">
            You are working in <b>{org?.name}</b> for {home?.name ?? "the bureau"}. Everything you do here is recorded in this client&apos;s audit log under your name.
            <form action={returnToBureauAction}>
              <button className="font-medium underline" type="submit">
                Back to {home?.name ?? "the bureau"}
              </button>
            </form>
          </div>
        )}
        {reminder && (
          <div className="no-print border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            {reminder}{" "}
            <Link className="font-medium underline" href="/settings/security">
              Set it up
            </Link>
          </div>
        )}
        <main className="mx-auto max-w-[1400px] p-4 sm:p-6">
          <AreaTabs areas={areas.map(({ area, sections }) => ({ key: area.key, title: area.title, sections: sections.map(({ href, label, group, also }) => ({ href, label, group, also })) }))} />
          {children}
        </main>
      </div>
    </div>
  );
}
