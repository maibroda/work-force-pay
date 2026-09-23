"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

type Toast = { id: number; ok: boolean; text: string };
const listeners = new Set<(t: Toast) => void>();
let seq = 0;

export function toast(ok: boolean, text: string) {
  const t = { id: ++seq, ok, text };
  listeners.forEach((l) => l(t));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const l = (t: Toast) => {
      setItems((x) => [...x, t]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== t.id)), t.ok ? 3500 : 8000);
    };
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return (
    <div
      className="no-print fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-lg ${t.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900"}`}
        >
          {t.ok ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
