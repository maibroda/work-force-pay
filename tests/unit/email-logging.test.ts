import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { info, error, send } = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), send: vi.fn() })); // mock factories run before the rest of the file
vi.mock("@/lib/logger", () => ({ logger: { info, error, warn: vi.fn(), debug: vi.fn() } }));
vi.mock("resend", () => ({ Resend: class { emails = { send }; } }));

import { sendEmail } from "@/lib/email";

const mail = { to: "funmi.bello@lekki.test", subject: "Reset your password", html: "<p>x</p>", text: "Open https://app.test/reset-password?token=SECRETTOKEN to choose a password", headers: { "List-Unsubscribe": "<https://app.test/api/unsubscribe/TOKEN>" } };
const everything = (fn: typeof info) => JSON.stringify(fn.mock.calls);

beforeEach(() => {
  info.mockClear();
  error.mockClear();
  send.mockReset();
  vi.unstubAllEnvs();
});
afterEach(() => vi.unstubAllEnvs());

describe("what an email writes to the log (review finding F-08)", () => {
  it("in development with no email provider, still shows the whole message, because a developer needs the link or code in it", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("NODE_ENV", "development");
    await sendEmail(mail);
    expect(info).toHaveBeenCalledTimes(1);
    expect(everything(info)).toContain("SECRETTOKEN");
    expect(everything(info)).toContain(mail.to);
  });

  it("in production with no email provider, sends nothing and logs neither the message, its links, its headers nor the full address", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    await sendEmail(mail);
    expect(send).not.toHaveBeenCalled();
    const logged = everything(info) + everything(error);
    expect(logged).not.toContain("SECRETTOKEN");
    expect(logged).not.toContain("List-Unsubscribe");
    expect(logged).not.toContain("funmi.bello@lekki.test");
    expect(logged).toContain("f***@lekki.test"); // enough to see who it was meant for
    expect(logged).toContain("Reset your password");
    expect(logged).toMatch(/no email provider|not sent/i); // and why
  });

  it("when the provider refuses a send, logs a masked address (never the full one), in every environment", async () => {
    for (const env of ["development", "production", "test"]) {
      error.mockClear();
      vi.stubEnv("RESEND_API_KEY", "re_test_key");
      vi.stubEnv("NODE_ENV", env);
      send.mockResolvedValueOnce({ error: { message: "mailbox full" } });
      await expect(sendEmail(mail)).rejects.toThrow("Failed to send email.");
      const logged = everything(error);
      expect(logged, env).not.toContain("funmi.bello@lekki.test");
      expect(logged, env).toContain("f***@lekki.test");
      expect(logged, env).toContain("mailbox full");
    }
  });

  it("still sends normally when the provider accepts it, and logs nothing about it", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    send.mockResolvedValueOnce({ error: null });
    await sendEmail(mail);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: mail.to, subject: mail.subject, text: mail.text, headers: mail.headers }));
    expect(info).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
