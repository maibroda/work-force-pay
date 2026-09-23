"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "./toaster";

/** Button bound to a server action (use .bind on the server). Optional confirm / reason prompt. */
export function ActionButton({
  action,
  children,
  confirm,
  reason,
  reasonPlaceholder = "Documented reason…",
  variant,
  size = "sm",
}: {
  action: (reason?: string) => Promise<ActionResult>;
  children: React.ReactNode;
  confirm?: string;
  reason?: boolean;
  reasonPlaceholder?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [armed, setArmed] = useState(false);

  const fire = (r?: string) =>
    start(async () => {
      const res = await action(r);
      toast(res.ok, res.ok ? (res.message ?? "Done.") : (res.error ?? "Failed."));
      if (res.ok) {
        setOpen(false);
        setText("");
        setArmed(false);
        if (res.redirectTo) router.push(res.redirectTo);
        else router.refresh();
      }
    });

  if (reason && open)
    return (
      <span className="inline-flex items-center gap-1">
        <Input
          className="h-8 w-64 text-xs"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={reasonPlaceholder}
        />
        <Button
          size="sm"
          variant={variant}
          disabled={pending || text.trim().length < 3}
          onClick={() => fire(text)}
        >
          {pending ? "…" : "Confirm"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </span>
    );
  if (confirm && armed)
    return (
      <span className="inline-flex items-center gap-1 text-xs">
        <span className="text-muted-foreground">{confirm}</span>
        <Button size="sm" variant={variant} disabled={pending} onClick={() => fire()}>
          {pending ? "…" : "Yes"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setArmed(false)}>
          No
        </Button>
      </span>
    );
  return (
    <Button
      size={size}
      variant={variant}
      disabled={pending}
      onClick={() => (reason ? setOpen(true) : confirm ? setArmed(true) : fire())}
    >
      {pending ? "Working…" : children}
    </Button>
  );
}
