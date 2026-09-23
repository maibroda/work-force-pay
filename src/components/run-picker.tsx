import { Select } from "@/components/ui/input";
import { FilterBar, FilterField } from "@/components/page";

/** Server-rendered run selector (GET form). */
export function RunPicker({
  runs,
  runId,
  extra,
}: {
  runs: Array<{ value: string; label: string }>;
  runId?: string;
  extra?: React.ReactNode;
}) {
  return (
    <FilterBar>
      <FilterField label="Payroll run">
        <Select name="runId" defaultValue={runId} className="min-w-72">
          {runs.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      </FilterField>
      {extra}
    </FilterBar>
  );
}
