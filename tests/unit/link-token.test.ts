import { describe, expect, it } from "vitest";
import { decodeLinkToken } from "@/lib/sales/link-token";

describe("reading the token from a link's web address (review finding F-13)", () => {
  it("gives back an ordinary token as it is, and decodes one the browser has escaped", () => {
    expect(decodeLinkToken("abc_DEF-123.xyz")).toBe("abc_DEF-123.xyz");
    expect(decodeLinkToken("abc%2EDEF")).toBe("abc.DEF");
  });

  it("gives back nothing for an address with a broken escape (such as a stray %), so the page can say the link is not valid rather than that something went wrong", () => {
    expect(decodeLinkToken("abc%")).toBeNull();
    expect(decodeLinkToken("%E0%A4%A")).toBeNull();
    expect(decodeLinkToken("%zz")).toBeNull();
  });

  it("gives back nothing for an empty or absurdly long address, without trying to decode it", () => {
    expect(decodeLinkToken("")).toBeNull();
    expect(decodeLinkToken("a".repeat(5000))).toBeNull();
  });
});
