import type { HealthView } from "@/server/services/sales/health";
import { Section } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

const BAND = { HEALTHY: ["Healthy", "green"], WATCH: ["Watch", "amber"], AT_RISK: ["At risk", "red"] } as const;
export const bandBadge = (b: keyof typeof BAND) => ({ label: BAND[b][0], tone: BAND[b][1] });
const when = (d: Date) => d.toLocaleString("en-NG", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** The health score of a client account and what produced it: each measure, its weight, its sub-score and a sentence. */
export function HealthPanel({ health }: { health: HealthView }) {
  const b = bandBadge(health.band);
  return (
    <Section title="Account health" description="From 70 to 100 healthy, 40 to 69 watch, 0 to 39 at risk. Recalculated every night and when a case on the account changes." flush>
      <div className="flex flex-wrap items-center gap-3 px-4 pt-4 text-sm">
        <span className="text-2xl font-semibold">{health.score}</span>
        <span>of 100</span>
        <Badge tone={b.tone}>{b.label}</Badge>
        {health.previousBand && health.bandChangedAt && <span className="text-xs text-muted-foreground">was {BAND[health.previousBand][0].toLowerCase()} until {when(health.bandChangedAt)}</span>}
        <span className="text-xs text-muted-foreground">worked out {when(health.computedAt)}</span>
      </div>
      <Table>
        <THead><TR><TH>Measure</TH><TH className="text-right">Weight</TH><TH className="text-right">Score</TH><TH>What it found</TH></TR></THead>
        <TBody>
          {health.components.map((c) => (
            <TR key={c.key}>
              <TD className="whitespace-normal text-xs">{c.label}</TD>
              <TD className="text-right text-xs">{c.weight}</TD>
              <TD className="text-right text-xs">{c.subScore === null ? "left out" : c.subScore}</TD>
              <TD className="whitespace-normal text-xs">{c.detail}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Section>
  );
}
