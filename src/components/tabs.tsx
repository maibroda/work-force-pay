import Link from "next/link";
import { cn } from "@/lib/utils";

export function Tabs({
  tabs,
  active,
  base,
}: {
  tabs: Array<{ key: string; label: string }>;
  active: string;
  base: string;
}) {
  return (
    <div className="no-print mb-4 flex gap-1 overflow-x-auto border-b">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={`${base}${base.includes("?") ? "&" : "?"}tab=${t.key}`}
          className={cn(
            "whitespace-nowrap border-b-2 px-3 py-2 text-sm",
            active === t.key
              ? "border-primary font-medium text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
