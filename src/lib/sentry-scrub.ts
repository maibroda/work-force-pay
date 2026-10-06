import type { ErrorEvent } from "@sentry/nextjs";
import { scrubDeep, scrubText } from "./pii-scrub";

/**
 * Strips session cookies, auth headers and anything that looks like personal data (emails, phone numbers,
 * account and ID numbers, tokens) before an event ever leaves the process.
 */
export function scrubBeforeSend(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data; // request bodies are form posts: names, bank details, passwords
    delete event.request.query_string;
    if (event.request.url) event.request.url = scrubText(event.request.url.split("?")[0]);
    if (event.request.headers) {
      delete event.request.headers["cookie"];
      delete event.request.headers["authorization"];
      delete event.request.headers["x-forwarded-for"];
    }
  }
  if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined;
  if (event.message) event.message = scrubText(event.message);
  for (const ex of event.exception?.values ?? []) if (ex.value) ex.value = scrubText(ex.value);
  for (const b of event.breadcrumbs ?? []) {
    if (b.message) b.message = scrubText(b.message);
    if (b.data) b.data = scrubDeep(b.data);
  }
  if (event.extra) event.extra = scrubDeep(event.extra);
  return event;
}
