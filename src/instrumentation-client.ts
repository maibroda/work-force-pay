import * as Sentry from "@sentry/nextjs";
import { scrubBeforeSend } from "./lib/sentry-scrub";

// Inert until NEXT_PUBLIC_SENTRY_DSN is set.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.NODE_ENV,
  beforeSend: scrubBeforeSend,
});
