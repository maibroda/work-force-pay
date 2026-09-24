import * as Sentry from "@sentry/nextjs";
import { scrubBeforeSend } from "./src/lib/sentry-scrub";

// Middleware runs on the edge runtime — kept separate from the Node config per Sentry's Next.js setup.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.NODE_ENV,
  beforeSend: scrubBeforeSend,
});
