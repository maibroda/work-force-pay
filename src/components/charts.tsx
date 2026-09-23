"use client";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// Categorical slots from the validated reference palette (fixed order, never cycled).
const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];
const fmt = (v: number) =>
  Math.abs(v) >= 1e6
    ? `₦${(v / 1e6).toFixed(1)}m`
    : Math.abs(v) >= 1e3
      ? `₦${(v / 1e3).toFixed(0)}k`
      : `₦${v}`;
const full = (v: unknown) => `₦${Number(v).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
const axis = { stroke: "hsl(215 14% 60%)", fontSize: 11, tickLine: false, axisLine: false } as const;

export function BarsChart({
  data,
  xKey,
  series,
  height = 260,
  horizontal,
  money = true,
}: {
  data: Array<Record<string, unknown>>;
  xKey: string;
  series: Array<{ key: string; label: string }>;
  height?: number;
  horizontal?: boolean;
  money?: boolean;
}) {
  return (
    <div style={{ height }} role="img" aria-label={`Bar chart of ${series.map((s) => s.label).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout={horizontal ? "vertical" : "horizontal"}
          margin={{ left: horizontal ? 8 : 0, right: 12, top: 8, bottom: 0 }}
          barGap={2}
        >
          <CartesianGrid stroke="hsl(214 20% 92%)" vertical={!!horizontal} horizontal={!horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" tickFormatter={money ? fmt : undefined} {...axis} />
              <YAxis type="category" dataKey={xKey} width={150} {...axis} />
            </>
          ) : (
            <>
              <XAxis dataKey={xKey} {...axis} />
              <YAxis tickFormatter={money ? fmt : undefined} width={56} {...axis} />
            </>
          )}
          <Tooltip
            formatter={(v) => (money ? full(v) : String(v))}
            cursor={{ fill: "hsl(214 30% 94% / 0.6)" }}
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
          />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={SERIES[i]}
              radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
              maxBarSize={28}
              stroke="#fff"
              strokeWidth={1}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LinesChart({
  data,
  xKey,
  series,
  height = 260,
}: {
  data: Array<Record<string, unknown>>;
  xKey: string;
  series: Array<{ key: string; label: string }>;
  height?: number;
}) {
  return (
    <div style={{ height }} role="img" aria-label={`Line chart of ${series.map((s) => s.label).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
          <CartesianGrid stroke="hsl(214 20% 92%)" vertical={false} />
          <XAxis dataKey={xKey} {...axis} />
          <YAxis tickFormatter={fmt} width={56} {...axis} />
          <Tooltip formatter={(v) => full(v)} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={SERIES[i]}
              strokeWidth={2}
              dot={{ r: 4, strokeWidth: 2, fill: "#fff" }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
