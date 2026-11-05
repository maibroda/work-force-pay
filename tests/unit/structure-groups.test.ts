import { describe, expect, it } from "vitest";
import { arrangeStructures } from "@/lib/structure-groups";

/** How the Salary structures page lists them (docs/plans/client-salary-structures.md): company-wide, then each client's, each client structure followed by its role structures. */
const s = (id: string, name: string, over: Record<string, unknown> = {}) => ({ id, name, clientId: null as string | null, parentId: null as string | null, client: null as { id: string; name: string } | null, category: null as { name: string } | null, ...over });
const abc = { id: "c1", name: "ABC Bank" };
const xyz = { id: "c2", name: "XYZ Plc" };

describe("arranging the structures", () => {
  it("puts company-wide structures first, in the order given, then clients alphabetically", () => {
    const list = [s("a", "ABC Bank salary structure", { clientId: "c1", client: abc }), s("d", "Default"), s("x", "XYZ structure", { clientId: "c2", client: xyz }), s("z", "Zed")];
    const g = arrangeStructures(list);
    expect(g.map((x) => x.heading)).toEqual(["Company-wide", "ABC Bank", "XYZ Plc"]);
    expect(g[0].rows.map((r) => r.structure.id)).toEqual(["d", "z"]);
  });

  it("follows each client structure with its role structures, indented, by category name", () => {
    const list = [
      s("p", "ABC Bank salary structure", { clientId: "c1", client: abc }),
      s("r2", "ABC — Supervisor", { clientId: "c1", client: abc, parentId: "p", category: { name: "Supervisor" } }),
      s("r1", "ABC — Driver", { clientId: "c1", client: abc, parentId: "p", category: { name: "Driver" } }),
    ];
    const rows = arrangeStructures(list)[0].rows;
    expect(rows.map((r) => [r.structure.id, r.depth])).toEqual([["p", 0], ["r1", 1], ["r2", 1]]);
  });

  it("keeps two client structures separate, each with its own roles, and still shows a role structure whose parent is missing", () => {
    const list = [
      s("p2", "Second", { clientId: "c1", client: abc }),
      s("p1", "First", { clientId: "c1", client: abc }),
      s("c-of-p1", "Guard", { clientId: "c1", client: abc, parentId: "p1", category: { name: "Guard" } }),
      s("lost", "Lost role", { clientId: "c1", client: abc, parentId: "gone", category: { name: "Cleaner" } }),
    ];
    const rows = arrangeStructures(list)[0].rows;
    expect(rows.map((r) => r.structure.id)).toEqual(["p1", "c-of-p1", "p2", "lost"]);
  });

  it("returns nothing for nothing, and only the groups that have structures", () => {
    expect(arrangeStructures([])).toEqual([]);
    expect(arrangeStructures([s("a", "A", { clientId: "c1", client: abc })]).map((g) => g.heading)).toEqual(["ABC Bank"]);
  });
});
