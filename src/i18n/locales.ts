export const SUPPORTED_LOCALES = ["en", "es", "ko"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export function isSupportedLocale(value: string | undefined): value is SupportedLocale {
  return Boolean(value && SUPPORTED_LOCALES.includes(value as SupportedLocale));
}

export function localeFromAcceptLanguage(
  acceptLanguage: string | null | undefined,
): SupportedLocale | null {
  if (!acceptLanguage) return null;

  const candidates = acceptLanguage
    .split(",")
    .map((part, index) => {
      const [rawLocale, ...parameters] = part.trim().split(";");
      const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
      const weight = quality ? Number(quality.trim().slice(2)) : 1;
      return {
        locale: rawLocale.toLowerCase().split("-")[0],
        weight: Number.isFinite(weight) ? weight : 0,
        index,
      };
    })
    .filter((candidate) => candidate.locale !== "*" && candidate.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);

  for (const candidate of candidates) {
    if (isSupportedLocale(candidate.locale)) return candidate.locale;
  }

  return null;
}

export function resolveLocale(input: {
  cookie?: string | null;
  acceptLanguage?: string | null;
  configured?: string | null;
}): SupportedLocale {
  if (isSupportedLocale(input.cookie ?? undefined)) return input.cookie as SupportedLocale;

  const browserLocale = localeFromAcceptLanguage(input.acceptLanguage);
  if (browserLocale) return browserLocale;

  if (isSupportedLocale(input.configured ?? undefined)) {
    return input.configured as SupportedLocale;
  }

  return "en";
}

type MessageTree = Record<string, unknown>;

/** Merge partial dictionaries over English so new translations can land
 * incrementally without rendering raw next-intl key paths. */
export function mergeMessages(base: MessageTree, override: MessageTree): MessageTree {
  const merged: MessageTree = { ...base };

  for (const [key, value] of Object.entries(override)) {
    const baseValue = merged[key];
    if (isMessageTree(baseValue) && isMessageTree(value)) {
      merged[key] = mergeMessages(baseValue, value);
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

function isMessageTree(value: unknown): value is MessageTree {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
