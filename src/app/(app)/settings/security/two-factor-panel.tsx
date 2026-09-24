"use client";
import { useState, useTransition } from "react";
import {
  beginTotpEnrollmentAction,
  confirmTotpEnrollmentAction,
  disableTotpAction,
} from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/toaster";

type Step = "idle" | "enrolling" | "backupCodes" | "disabling";

export function TwoFactorPanel({ initiallyEnabled }: { initiallyEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [step, setStep] = useState<Step>("idle");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [pending, start] = useTransition();

  const startEnrollment = () =>
    start(async () => {
      const res = await beginTotpEnrollmentAction();
      if (!res.ok) return toast(false, res.error ?? "Failed to start enrollment.");
      const data = res.data as { secret: string; qrDataUrl: string };
      setSecret(data.secret);
      setQrDataUrl(data.qrDataUrl);
      setCode("");
      setStep("enrolling");
    });

  const confirmEnrollment = () =>
    start(async () => {
      const res = await confirmTotpEnrollmentAction({ code });
      if (!res.ok) return toast(false, res.error ?? "Incorrect code.");
      setBackupCodes((res.data as { backupCodes: string[] }).backupCodes);
      setEnabled(true);
      setStep("backupCodes");
    });

  const disable = () =>
    start(async () => {
      const res = await disableTotpAction({ code });
      toast(res.ok, res.ok ? "Two-factor authentication turned off." : (res.error ?? "Failed."));
      if (res.ok) {
        setEnabled(false);
        setStep("idle");
        setCode("");
      }
    });

  if (step === "backupCodes")
    return (
      <div className="space-y-3 text-sm">
        <p className="font-medium text-emerald-700">Two-factor authentication is on.</p>
        <p className="text-muted-foreground">
          Save these one-time backup codes somewhere safe — each can be used once if you lose access to your
          authenticator app. They will not be shown again.
        </p>
        <div className="grid grid-cols-2 gap-1 rounded-md border bg-muted/40 p-3 font-mono text-xs">
          {backupCodes.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
        <Button size="sm" onClick={() => setStep("idle")}>
          Done
        </Button>
      </div>
    );

  if (step === "enrolling")
    return (
      <div className="space-y-3 text-sm">
        <p>Scan this QR code with Google Authenticator, Authy, or any TOTP app:</p>
        {qrDataUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- data: URI, no benefit from next/image
          <img src={qrDataUrl} alt="Two-factor authentication QR code" width={180} height={180} />
        )}
        <p className="text-xs text-muted-foreground">
          Can&apos;t scan it? Enter this code manually: <code className="font-mono">{secret}</code>
        </p>
        <div className="flex items-center gap-2">
          <Input
            className="w-40"
            placeholder="6-digit code"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button size="sm" disabled={pending || code.length < 6} onClick={confirmEnrollment}>
            {pending ? "Verifying…" : "Confirm"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setStep("idle")}>
            Cancel
          </Button>
        </div>
      </div>
    );

  if (step === "disabling")
    return (
      <div className="flex items-center gap-2 text-sm">
        <Input
          className="w-40"
          placeholder="Code or backup code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <Button size="sm" variant="destructive" disabled={pending || !code} onClick={disable}>
          {pending ? "Working…" : "Confirm disable"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setStep("idle")}>
          Cancel
        </Button>
      </div>
    );

  return (
    <div className="text-sm">
      <p className="mb-3 text-muted-foreground">
        {enabled
          ? "Two-factor authentication is on — you'll be asked for a code from your authenticator app when signing in."
          : "Add an authenticator app (Google Authenticator, Authy, 1Password, …) as a second sign-in step."}
      </p>
      {enabled ? (
        <Button size="sm" variant="outline" onClick={() => setStep("disabling")}>
          Turn off two-factor authentication
        </Button>
      ) : (
        <Button size="sm" disabled={pending} onClick={startEnrollment}>
          {pending ? "Starting…" : "Set up two-factor authentication"}
        </Button>
      )}
    </div>
  );
}
