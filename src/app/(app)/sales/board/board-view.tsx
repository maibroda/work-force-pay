"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { moveOpportunityAction } from "@/app/actions/sales-deals";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { toast } from "@/components/toaster";

export interface CardData {
  id: string;
  name: string;
  accountName: string;
  ownerName: string;
  monthlyContractValue: string;
  probability: number;
  weighted: string;
  expectedCloseDate: string | null;
  nextStep: string | null;
  daysInStage: number;
  rotting: boolean;
}
export interface ColumnData {
  stage: { id: string; name: string; stageType: "OPEN" | "WON" | "LOST"; defaultProbability: number };
  totals: { count: number; value: string; weighted: string };
  deals: CardData[];
}

const LOST_REASONS = [
  ["PRICE", "Price"],
  ["QUALITY", "Quality of service"],
  ["RELATIONSHIP", "Relationship"],
  ["INCUMBENT_RETAINED", "The current provider was kept"],
  ["NO_DECISION", "No decision was made"],
  ["BUDGET", "Budget"],
  ["OTHER", "Other"],
];
const money = (s: string) => `₦${Number(s).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function BoardView({ columns, canMove }: { columns: ColumnData[]; canMove: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [move, setMove] = useState<{ deal: CardData; fromStageId: string; stageId: string } | null>(null);
  const [nextStep, setNextStep] = useState("");
  const [probability, setProbability] = useState("");
  const [lostReason, setLostReason] = useState("PRICE");
  const [detail, setDetail] = useState("");
  const [competitor, setCompetitor] = useState("");

  const open = (deal: CardData, fromStageId: string, stageId: string) => {
    if (!canMove || stageId === fromStageId) return;
    setNextStep("");
    setProbability("");
    setDetail("");
    setCompetitor("");
    setMove({ deal, fromStageId, stageId });
  };
  const target = move ? columns.find((c) => c.stage.id === move.stageId)?.stage : undefined;

  const submit = () => {
    if (!move || !target) return;
    start(async () => {
      const res = await moveOpportunityAction({
        id: move.deal.id,
        stageId: move.stageId,
        nextStep,
        probability: target.stageType === "OPEN" && probability ? Number(probability) : undefined,
        lostReason: target.stageType === "LOST" ? lostReason : undefined,
        lostReasonDetail: target.stageType === "LOST" ? detail : undefined,
        competitor: target.stageType === "LOST" ? competitor : undefined,
      });
      toast(res.ok, res.ok ? (res.message ?? "Moved.") : (res.error ?? "Could not move the deal."));
      if (res.ok) {
        setMove(null);
        router.refresh();
      }
    });
  };

  return (
    <>
      <div className="flex gap-3 overflow-x-auto pb-3">
        {columns.map((col) => (
          <div
            key={col.stage.id}
            className={`w-64 shrink-0 rounded-md border bg-muted/30 ${col.stage.stageType === "WON" ? "border-emerald-300" : col.stage.stageType === "LOST" ? "border-red-300" : ""}`}
            onDragOver={(e) => canMove && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain") || dragId;
              const from = columns.find((c) => c.deals.some((d) => d.id === id));
              const deal = from?.deals.find((d) => d.id === id);
              if (deal && from) open(deal, from.stage.id, col.stage.id);
              setDragId(null);
            }}
          >
            <div className="border-b px-3 py-2">
              <div className="flex items-center justify-between text-sm font-medium">
                <span>{col.stage.name}</span>
                <Badge>{col.totals.count}</Badge>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {money(col.totals.value)} a month
                {col.stage.stageType === "OPEN" && <> · weighted {money(col.totals.weighted)}</>}
              </div>
            </div>
            <div className="min-h-16 space-y-2 p-2">
              {col.deals.map((d) => (
                <div
                  key={d.id}
                  draggable={canMove}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", d.id);
                    setDragId(d.id);
                  }}
                  className={`rounded border bg-card p-2 text-xs shadow-sm ${canMove ? "cursor-grab" : ""} ${d.rotting ? "border-red-400 bg-red-50/60" : ""}`}
                >
                  <Link className="block text-sm font-medium underline" href={`/sales/opportunities/${d.id}`}>
                    {d.name}
                  </Link>
                  <div className="text-muted-foreground">{d.accountName}</div>
                  <div className="mt-1">{money(d.monthlyContractValue)} · {d.probability}%</div>
                  <div className="text-muted-foreground">
                    {d.ownerName} · {d.daysInStage} day(s) here{d.expectedCloseDate ? ` · closes ${d.expectedCloseDate.slice(0, 10)}` : ""}
                  </div>
                  {d.nextStep && <div className="mt-1 italic">Next: {d.nextStep}</div>}
                  {d.rotting && <div className="mt-1 font-medium text-red-700">No activity for a while</div>}
                  {canMove && col.stage.stageType === "OPEN" && (
                    <label className="mt-2 block">
                      <span className="sr-only">Move {d.name} to</span>
                      <select
                        className="h-7 w-full rounded border bg-background px-1 text-xs"
                        value=""
                        onChange={(e) => e.target.value && open(d, col.stage.id, e.target.value)}
                      >
                        <option value="">Move to…</option>
                        {columns.filter((c) => c.stage.id !== col.stage.id).map((c) => (
                          <option key={c.stage.id} value={c.stage.id}>
                            {c.stage.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {move && target && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md space-y-3 rounded-md bg-card p-4 shadow-lg">
            <h3 className="text-base font-semibold">
              Move “{move.deal.name}” to {target.name}
            </h3>
            <div className="space-y-1">
              <Label htmlFor="next">What is the next step? (required)</Label>
              <Input id="next" value={nextStep} onChange={(e) => setNextStep(e.target.value)} autoFocus />
            </div>
            {target.stageType === "OPEN" && (
              <div className="space-y-1">
                <Label htmlFor="prob">Probability % (this stage starts at {target.defaultProbability}%)</Label>
                <Input id="prob" type="number" min={0} max={100} value={probability} onChange={(e) => setProbability(e.target.value)} placeholder={String(target.defaultProbability)} />
              </div>
            )}
            {target.stageType === "WON" && <p className="text-xs text-muted-foreground">Won needs a monthly value, a term and a start date on the deal. The probability becomes 100%.</p>}
            {target.stageType === "LOST" && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="why">Why was it lost?</Label>
                  <select id="why" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={lostReason} onChange={(e) => setLostReason(e.target.value)}>
                    {LOST_REASONS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="detail">More detail</Label>
                  <Input id="detail" value={detail} onChange={(e) => setDetail(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="comp">Who won it, if known</Label>
                  <Input id="comp" value={competitor} onChange={(e) => setCompetitor(e.target.value)} />
                </div>
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setMove(null)} disabled={pending}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={pending || nextStep.trim().length < 3}>
                {pending ? "Moving…" : "Move"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
