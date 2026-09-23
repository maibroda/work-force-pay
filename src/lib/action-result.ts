export type ActionResult = {
  ok: boolean;
  message?: string;
  error?: string;
  redirectTo?: string;
  data?: unknown;
};
