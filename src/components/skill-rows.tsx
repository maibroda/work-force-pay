import { SKILL_LEVEL_LABELS } from "@/lib/skills";
import { fmtDate } from "@/lib/dates";
import { Empty } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export interface SkillRow {
  skillId: string;
  name: string;
  requiredLevel: number;
  current: number | null;
  status: string;
  gap: number;
  history: Array<{ level: number; assessedOn: string; assessedBy: string; comment: string | null }>;
}

const lvl = (n: number | null) => (n === null ? "Not assessed" : `${n}: ${SKILL_LEVEL_LABELS[n as 1 | 2 | 3 | 4]}`);

/** One person's skills: what the role needs, the current level, and the whole history (newest first). Read by the person, their manager and HR. */
export function SkillRows({ rows, extra }: { rows: SkillRow[]; extra?: (r: SkillRow) => React.ReactNode }) {
  if (!rows.length) return <Empty>The company has set no skill for this role yet.</Empty>;
  return (
    <Table>
      <THead>
        <TR>
          <TH>Skill</TH>
          <TH>Needed</TH>
          <TH>Now</TH>
          <TH>History</TH>
          {extra && <TH />}
        </TR>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.skillId}>
            <TD className="font-medium">{r.name}</TD>
            <TD className="text-xs">{lvl(r.requiredLevel)}</TD>
            <TD>
              <Badge tone={r.status === "MET" ? "green" : r.status === "BELOW" ? "amber" : "gray"}>{r.status === "NOT_ASSESSED" ? "Not assessed" : r.status === "MET" ? `Met (${r.current})` : `Below (${r.current}, ${r.gap} short)`}</Badge>
            </TD>
            <TD className="max-w-md whitespace-normal text-xs">
              {r.history.length === 0 ? (
                "—"
              ) : (
                <ul className="space-y-1">
                  {r.history.map((h, i) => (
                    <li key={i}>
                      {fmtDate(h.assessedOn)}: level {h.level} by {h.assessedBy}
                      {h.comment ? ` — ${h.comment}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </TD>
            {extra && <TD>{extra(r)}</TD>}
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
