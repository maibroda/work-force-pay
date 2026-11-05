/**
 * How the Salary structures page lists structures: company-wide first, then each client's structures, each client structure followed by its role structures (guard, supervisor, driver,
 * cleaner), indented. Pure, so it can be tested without a database. A role structure whose parent is not in the list (it should not happen) is still shown, under its client.
 */
export interface Arrangeable {
  id: string;
  name: string;
  clientId: string | null;
  parentId: string | null;
  client?: { id: string; name: string } | null;
  category?: { name: string } | null;
}

export interface StructureGroup<T> {
  /** "Company-wide" or the client's name. */
  heading: string;
  clientId: string | null;
  rows: Array<{ structure: T; depth: 0 | 1 }>;
}

export function arrangeStructures<T extends Arrangeable>(list: T[]): Array<StructureGroup<T>> {
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const groups: Array<StructureGroup<T>> = [];
  const companyWide = list.filter((s) => !s.clientId);
  if (companyWide.length) groups.push({ heading: "Company-wide", clientId: null, rows: companyWide.map((structure) => ({ structure, depth: 0 as const })) });
  const clientIds = [...new Set(list.filter((s) => s.clientId).map((s) => s.clientId as string))];
  const nameOf = (id: string) => list.find((s) => s.clientId === id)?.client?.name ?? "Client";
  clientIds.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  for (const id of clientIds) {
    const mine = list.filter((s) => s.clientId === id);
    const parents = mine.filter((s) => !s.parentId).sort(byName);
    const rows: StructureGroup<T>["rows"] = [];
    const placed = new Set<string>();
    for (const p of parents) {
      rows.push({ structure: p, depth: 0 });
      for (const c of mine.filter((s) => s.parentId === p.id).sort((a, b) => (a.category?.name ?? a.name).localeCompare(b.category?.name ?? b.name))) {
        rows.push({ structure: c, depth: 1 });
        placed.add(c.id);
      }
    }
    for (const orphan of mine.filter((s) => s.parentId && !placed.has(s.id)).sort(byName)) rows.push({ structure: orphan, depth: 1 });
    groups.push({ heading: nameOf(id), clientId: id, rows });
  }
  return groups;
}
