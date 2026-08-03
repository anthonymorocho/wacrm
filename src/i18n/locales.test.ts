import { describe, expect, it } from "vitest";
import {
  localeFromAcceptLanguage,
  mergeMessages,
  resolveLocale,
} from "./locales";

describe("locale resolution", () => {
  it("prefers the saved cookie over the browser language", () => {
    expect(
      resolveLocale({ cookie: "es", acceptLanguage: "en-US,en;q=0.8" }),
    ).toBe("es");
  });

  it("uses the browser language before the configured fallback", () => {
    expect(resolveLocale({ acceptLanguage: "es-MX,es;q=0.9,en;q=0.8" })).toBe("es");
  });

  it("falls back to English for unsupported languages", () => {
    expect(resolveLocale({ acceptLanguage: "fr-FR", configured: "invalid" })).toBe("en");
  });

  it("honors quality weights and ignores unsupported languages", () => {
    expect(localeFromAcceptLanguage("fr-FR,ko;q=0.8,en;q=0.5")).toBe("ko");
  });
});

describe("message merging", () => {
  it("keeps English fallback keys while replacing translated branches", () => {
    expect(
      mergeMessages(
        { Header: { dashboard: "Dashboard", inbox: "Inbox" } },
        { Header: { dashboard: "Panel" } },
      ),
    ).toEqual({ Header: { dashboard: "Panel", inbox: "Inbox" } });
  });
});
