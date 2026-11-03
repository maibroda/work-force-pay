import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => undefined) }));

import { db } from "@/lib/db";
import { setAssignmentMethod, setAssignmentRule } from "@/server/services/sales/assignment";
import { commitImport } from "@/server/services/sales/import";
import { createLead } from "@/server/services/sales/records";
import { updateSalesSetting } from "@/server/services/sales/setting";
import { addTeamMember, createTeam, deactivateTeam, removeTeamMember } from "@/server/services/sales/teams";
import { isolatedOrg } from "../helpers";

/**
 * Admin; Lagos team (manager Mgr; members RepA, RepB); Abuja team (manager Mgr2; member RepC); Mgr3 manages no team; RepD is in no team.
 * The organization's method is round robin unless a test says otherwise.
 */
async function world(method: "ROUND_ROBIN" | "BY_STATE" | "NONE" = "ROUND_ROBIN") {
  const t = await isolatedOrg();
  const mk = (role: string, n: number) => t.ctx(role as never, null, n);
  const c = { admin: mk("COMPANY_ADMIN", 1), mgr: mk("SALES_MANAGER", 1), mgr2: mk("SALES_MANAGER", 2), mgr3: mk("SALES_MANAGER", 3), repA: mk("SALES_REP", 1), repB: mk("SALES_REP", 2), repC: mk("SALES_REP", 3), repD: mk("SALES_REP", 4) };
  for (const x of Object.values(c)) await db.user.create({ data: { id: x.userId, organizationId: t.org.id, email: x.email, name: x.name, passwordHash: "not-a-real-hash", role: x.role as never } });
  await updateSalesSetting(c.admin, { enabled: true });
  const lagos = await createTeam(c.admin, { name: "Lagos", managerUserId: c.mgr.userId });
  const abuja = await createTeam(c.admin, { name: "Abuja", managerUserId: c.mgr2.userId });
  await addTeamMember(c.admin, lagos.id, c.repA.userId);
  await addTeamMember(c.admin, lagos.id, c.repB.userId);
  await addTeamMember(c.admin, abuja.id, c.repC.userId);
  await setAssignmentMethod(c.admin, method);
  return { t, c, lagos, abuja };
}
type W = Awaited<ReturnType<typeof world>>;
const lead = (ctx: W["c"]["mgr"], n: string, extra: object = {}) => createLead(ctx, { companyName: `Lead ${n}`, ...extra });
const owners = (rows: { ownerUserId: string }[], w: W) => rows.map((r) => Object.entries(w.c).find(([, x]) => x.userId === r.ownerUserId)?.[0]);

describe("a sales manager's new leads are shared out among their own team", () => {
  it("rotates leads that a manager adds with no owner through the members of their team, and through nobody else", async () => {
    const w = await world();
    const made = [];
    for (let i = 0; i < 6; i++) made.push(await lead(w.c.mgr, String(i)));
    const got = owners(made, w);
    expect(new Set(got)).toEqual(new Set(["repA", "repB"])); // only the team
    for (let i = 2; i < got.length; i++) expect(got[i]).toBe(got[i - 2]); // a strict rotation of two
    expect(got[0]).not.toBe(got[1]); // alternating, not one person every time
  });

  it("gives each team its own rotation, so one team's leads never throw another's off", async () => {
    const w = await world();
    const lagos: unknown[] = [];
    for (let i = 0; i < 6; i++) {
      lagos.push(owners([await lead(w.c.mgr, `L${i}`)], w)[0]);
      const abuja = await lead(w.c.mgr2, `A${i}`); // interleaved, a team of one
      expect(owners([abuja], w)).toEqual(["repC"]);
    }
    expect(lagos.filter((x) => x === "repA")).toHaveLength(3);
    expect(lagos.filter((x) => x === "repB")).toHaveLength(3);
    expect(lagos[0]).not.toBe(lagos[1]);
  });

  it("lets a manager of no team, and a salesperson, keep what they add; and an explicit owner always wins", async () => {
    const w = await world();
    expect(owners([await lead(w.c.mgr3, "x")], w)).toEqual(["mgr3"]); // no team to share it out to
    expect(owners([await lead(w.c.repD, "y")], w)).toEqual(["repD"]); // a salesperson owns what they add
    expect(owners([await lead(w.c.repA, "z")], w)).toEqual(["repA"]); // even a team member
    expect(owners([await lead(w.c.mgr, "named", { ownerUserId: w.c.repB.userId })], w)).toEqual(["repB"]);
    await expect(lead(w.c.mgr, "outside", { ownerUserId: w.c.repC.userId })).rejects.toThrow(/team/i); // another team's person
  });

  it("follows changes to the team at once: a person removed is no longer given leads, an added one is, a closed team keeps the manager's leads with the manager", async () => {
    const w = await world();
    await removeTeamMember(w.c.admin, w.lagos.id, w.c.repB.userId);
    const only = [await lead(w.c.mgr, "1"), await lead(w.c.mgr, "2"), await lead(w.c.mgr, "3")];
    expect(owners(only, w)).toEqual(["repA", "repA", "repA"]);
    await addTeamMember(w.c.admin, w.lagos.id, w.c.repD.userId);
    const both = owners([await lead(w.c.mgr, "4"), await lead(w.c.mgr, "5"), await lead(w.c.mgr, "6"), await lead(w.c.mgr, "7")], w);
    expect(new Set(both)).toEqual(new Set(["repA", "repD"]));
    await deactivateTeam(w.c.admin, w.lagos.id);
    expect(owners([await lead(w.c.mgr, "8")], w)).toEqual(["mgr"]);
  });

  it("skips a member who is no longer an active user", async () => {
    const w = await world();
    await db.user.update({ where: { id: w.c.repB.userId }, data: { active: false } });
    expect(owners([await lead(w.c.mgr, "1"), await lead(w.c.mgr, "2")], w)).toEqual(["repA", "repA"]);
  });

  it("leaves the administrator's leads on the organization-wide rotation, as before", async () => {
    const w = await world();
    const got = owners(await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map(async (i) => lead(w.c.admin, String(i)))), w);
    expect(got.every((x) => x && x !== "admin")).toBe(true); // given to sales people, not kept
    expect(new Set(got).size).toBeGreaterThan(2); // spread over more than one team
  });

  it("does nothing when no method is set", async () => {
    const w = await world("NONE");
    expect(owners([await lead(w.c.mgr, "1")], w)).toEqual(["mgr"]);
  });

  it("by state: a rule may send a manager's lead only to someone in their reach; a rule naming someone outside leaves it with the manager", async () => {
    const w = await world("BY_STATE");
    await setAssignmentRule(w.c.admin, { kind: "STATE", key: "Lagos", userId: w.c.repA.userId });
    await setAssignmentRule(w.c.admin, { kind: "STATE", key: "Kano", userId: w.c.repC.userId }); // in the Abuja team
    expect(owners([await lead(w.c.mgr, "1", { state: "Lagos" })], w)).toEqual(["repA"]);
    expect(owners([await lead(w.c.mgr, "2", { state: "Kano" })], w)).toEqual(["mgr"]);
    expect(owners([await lead(w.c.admin, "3", { state: "Kano" })], w)).toEqual(["repC"]); // the administrator reaches anyone
  });

  it("applies to a manager's import of leads in the same way", async () => {
    const w = await world();
    const csv = ["Company Name", "Co One", "Co Two", "Co Three", "Co Four"].join("\n");
    await commitImport(w.c.mgr, "LEADS", csv);
    const rows = await db.crmLead.findMany({ where: { organizationId: w.t.org.id }, orderBy: { number: "asc" } });
    expect(rows).toHaveLength(4);
    expect(new Set(owners(rows, w))).toEqual(new Set(["repA", "repB"]));
  });
});
