import type { ErrorEvent } from "@sentry/nextjs";

/** Strips session cookies and auth headers before an event ever leaves the process. */
export function scrubBeforeSend(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.cookies;
    if (event.request.headers) {
      delete event.request.headers["cookie"];
      delete event.request.headers["authorization"];
    }
  }
  return event;
}
