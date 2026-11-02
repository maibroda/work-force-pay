/**
 * What a marketing WhatsApp message ends with. It lives in its own file, with no Node import, because the browser component that builds the message uses it: putting it in
 * privacy.ts (which signs and hashes with Node's crypto) broke the production build.
 */
export const whatsappFooter = (url: string) => `\n\nTo stop these messages: ${url}`;
