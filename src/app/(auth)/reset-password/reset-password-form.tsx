"use client";
import { useActionState } from "react";
import { resetPasswordAction, type SimpleState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<SimpleState | undefined, FormData>(
    resetPasswordAction,
    undefined,
  );
  return (
    <form action={action} className="space-y-4 rounded-lg bg-white p-6 shadow-xl">
      <input type="hidden" name="token" value={token} />
      <div className="space-y-1">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          autoFocus
        />
      </div>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
