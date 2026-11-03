/**
 * Reads the token out of the web address of a link (an unsubscribe link). The browser may have escaped it; an address with a broken escape (a stray %), an empty one or an absurdly
 * long one gives nothing, so the page can say the link is not valid instead of failing. No crypto here: it is checked afterwards (privacy.ts verifyUnsubscribe).
 */
export function decodeLinkToken(raw: string): string | null {
  if (!raw || raw.length > 1000) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}
