"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createRuleAction, testRuleAction } from "@/app/actions/sales-automation";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { toast } from "@/components/toaster";

interface Opt {
  id: string;
  name: string;
}
export interface FormData {
  pipelines: Array<{ id: string; name: string; stages: Opt[] }>;
  people: Opt[];
}

const sel = "h-9 w-full rounded-md border bg-background px-2 text-sm";
const PLACEHOLDERS = "{{contactFirstName}}, {{dealName}}, {{company}}, {{ownerName}}";

/** Makes a rule. It starts switched off. */
export function RuleForm({ data }: { data: FormData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState<Record<string, string>>({ trigger: "STAGE_ENTRY", actionType: "CREATE_TASK", assignee: "OWNER", to: "OWNER", purpose: "SERVICE", field: "nextStep", condOp: ">", condField: "monthlyContractValue", pipelineId: data.pipelines[0]?.id ?? "" });
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const pipeline = data.pipelines.find((p) => p.id === f.pipelineId) ?? data.pipelines[0];
  const text = (k: string, label: string, props: { type?: string; placeholder?: string } = {}) => (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input type={props.type} placeholder={props.placeholder} value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
    </div>
  );
  const choose = (k: string, label: string, options: Array<[string, string]>) => (
    <div className="space-y-1">
      <Label>{label}</Label>
      <select className={sel} value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
  const peopleOptions: Array<[string, string]> = [["", "— choose —"], ...data.people.map((p) => [p.id, p.name] as [string, string])];

  const submit = () =>
    start(async () => {
      const res = await createRuleAction(f);
      toast(res.ok, res.ok ? (res.message ?? "Saved.") : (res.error ?? "Could not make the rule."));
      if (res.ok) router.refresh();
    });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {text("name", "Name of the rule")}
        {choose("trigger", "When", [["STAGE_ENTRY", "A deal enters a stage"], ["QUOTE_ACCEPTED", "The deal's quote is accepted"], ["HANDOVER_ACCEPTED", "The deal's handover is accepted"], ["NO_ACTIVITY", "A deal has had no activity"]])}
        {choose("pipelineId", "Pipeline", data.pipelines.map((p) => [p.id, p.name]))}
        {f.trigger === "STAGE_ENTRY" && choose("stageId", "Stage entered", [["", "— choose —"], ...(pipeline?.stages ?? []).map((s) => [s.id, s.name] as [string, string])])}
        {f.trigger === "NO_ACTIVITY" && text("quietDays", "Quiet for how many days", { type: "number" })}
        {f.trigger !== "NO_ACTIVITY" && (
          <>
            {text("delayDays", "Wait (days)", { type: "number", placeholder: "0" })}
            {text("delayHours", "and (hours)", { type: "number", placeholder: "0" })}
          </>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {choose("condField", "Only if (optional)", [["monthlyContractValue", "monthly value"], ["probability", "probability %"], ["source", "source"], ["serviceType", "service"]])}
        {choose("condOp", "is", [[">", "above"], [">=", "at least"], ["<", "below"], ["<=", "at most"], ["=", "equal to"], ["!=", "not equal to"]])}
        {text("condValue", "this value (leave empty for always)", { placeholder: "5000000" })}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {choose("actionType", "Then", [["CREATE_TASK", "Create a task"], ["NOTIFY", "Tell people (app and email)"], ["SEND_EMAIL", "Email the deal's primary contact"], ["CHANGE_OWNER", "Change the owner"], ["SET_FIELD", "Set a field"], ["CREATE_FOLLOW_UP", "Open a follow-up deal in another pipeline"], ["MOVE_TO_STAGE", "Move the deal to a stage (quote or handover events only)"]])}
        {f.actionType === "CREATE_TASK" && (
          <>
            {text("title", "Task")}
            {text("dueInHours", "Due in (hours)", { type: "number" })}
            {choose("assignee", "For", [["OWNER", "The deal's owner"], ["USER", "A named person"]])}
            {f.assignee === "USER" && choose("userId", "Person", peopleOptions)}
          </>
        )}
        {f.actionType === "NOTIFY" && (
          <>
            {choose("to", "Tell", [["OWNER", "The deal's owner"], ["MANAGERS", "The sales managers"], ["OPERATIONS", "Operations"], ["USER", "A named person"]])}
            {f.to === "USER" && choose("userId", "Person", peopleOptions)}
            {text("subject", "Subject")}
          </>
        )}
        {f.actionType === "SEND_EMAIL" && (
          <>
            {choose("purpose", "This message is", [["SERVICE", "A service message (client only)"], ["MARKETING", "Marketing (needs consent)"]])}
            {text("subject", "Subject")}
          </>
        )}
        {f.actionType === "CHANGE_OWNER" && choose("userId", "New owner", peopleOptions)}
        {f.actionType === "SET_FIELD" && (
          <>
            {choose("field", "Field", [["nextStep", "Next step"], ["probability", "Probability (0 to 100)"], ["competitor", "Competitor"]])}
            {text("value", "Value")}
          </>
        )}
        {f.actionType === "CREATE_FOLLOW_UP" && (
          <>
            {choose("followPipelineId", "In pipeline", [["", "— choose —"], ...data.pipelines.filter((p) => p.id !== f.pipelineId).map((p) => [p.id, p.name] as [string, string])])}
            {text("followName", "Name of the new deal")}
          </>
        )}
        {f.actionType === "MOVE_TO_STAGE" && choose("moveStageId", "Move to", [["", "— choose —"], ...(pipeline?.stages ?? []).map((s) => [s.id, s.name] as [string, string])])}
      </div>
      {(f.actionType === "NOTIFY" || f.actionType === "SEND_EMAIL") && (
        <div className="space-y-1">
          <Label>Message (you may use {PLACEHOLDERS})</Label>
          <Textarea rows={3} value={f.message ?? ""} onChange={(e) => set("message", e.target.value)} />
        </div>
      )}
      <Button onClick={submit} disabled={pending}>
        {pending ? "Saving…" : "Make the rule (it starts switched off)"}
      </Button>
    </div>
  );
}

/** Pick a rule and a deal and see what the rule would do. Nothing is changed. */
export function RuleTester({ rules, deals }: { rules: Opt[]; deals: Opt[] }) {
  const [pending, start] = useTransition();
  const [ruleId, setRuleId] = useState(rules[0]?.id ?? "");
  const [dealId, setDealId] = useState(deals[0]?.id ?? "");
  const [out, setOut] = useState<{ wouldRun: boolean; steps: string[] } | null>(null);
  const go = () =>
    start(async () => {
      const res = await testRuleAction({ ruleId, opportunityId: dealId });
      if (!res.ok) return toast(false, res.error ?? "Could not test it.");
      setOut(res.data as { wouldRun: boolean; steps: string[] });
    });
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <select className={sel} value={ruleId} onChange={(e) => setRuleId(e.target.value)}>
          {rules.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <select className={sel} value={dealId} onChange={(e) => setDealId(e.target.value)}>
          {deals.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <Button onClick={go} disabled={pending || !ruleId || !dealId} variant="outline">
          Show what it would do
        </Button>
      </div>
      {out && (
        <div className="rounded-md border p-3 text-sm">
          <p className="font-medium">{out.wouldRun ? "It would run:" : "It would not run:"}</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {out.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">Nothing was done: this is only a preview.</p>
        </div>
      )}
    </div>
  );
}
