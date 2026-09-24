import * as Sentry from "@sentry/nextjs";
import { scrubBeforeSend } from "./src/lib/sentry-scrub";

// Inert until SENTRY_DSN is set — Sentry.init with no dsn simply never sends events.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.NODE_ENV,
  beforeSend: scrubBeforeSend,
});
