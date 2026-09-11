export interface QuickReplyImageFields {
  content_text?: string | null;
  media_url?: string | null;
  media_path?: string | null;
  media_filename?: string | null;
}

export interface QuickReplyImageDraft {
  kind: 'image';
  mediaUrl: string;
  filename: string;
  caption: string;
}

export type QuickReplyMediaValidation =
  | {
      ok: true;
      media_url: string | null;
      media_path: string | null;
      media_filename: string | null;
    }
  | { ok: false; error: string };

/** Convert a saved quick-reply image into the composer's media draft shape. */
export function buildQuickReplyImageDraft(
  quickReply: QuickReplyImageFields
): QuickReplyImageDraft | null {
  const mediaUrl = quickReply.media_url?.trim();
  if (!mediaUrl) return null;

  return {
    kind: 'image',
    mediaUrl,
    filename: quickReply.media_filename?.trim() || 'quick-reply-image',
    caption: quickReply.content_text ?? '',
  };
}

/** Combine an existing composer draft with a quick reply's image caption. */
export function buildQuickReplyImageCaption(
  existingText: string,
  quickReplyText: string | null | undefined
): string {
  const existing = existingText.trim();
  const body = quickReplyText?.trim() ?? '';
  if (!existing) return body;
  if (!body) return existing;
  return `${existing}\n${body}`;
}

/** Validate persisted image fields at the API trust boundary. */
export function validateQuickReplyMedia(
  input: {
    media_url?: unknown;
    media_path?: unknown;
    media_filename?: unknown;
  },
  accountId: string
): QuickReplyMediaValidation {
  const rawUrl = input.media_url;
  const rawPath = input.media_path;
  const rawFilename = input.media_filename;
  const hasAny = rawUrl != null || rawPath != null || rawFilename != null;
  if (!hasAny) {
    return {
      ok: true,
      media_url: null,
      media_path: null,
      media_filename: null,
    };
  }

  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return {
      ok: false,
      error: 'media_url is required when an image is attached',
    };
  }
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    return {
      ok: false,
      error: 'media_path is required when an image is attached',
    };
  }

  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'media_url must use http(s) scheme' };
    }
  } catch {
    return { ok: false, error: 'media_url must be a valid URL' };
  }

  const path = rawPath.trim();
  const accountPrefix = `account-${accountId}/`;
  if (!path.startsWith(accountPrefix) || path.includes('..')) {
    return { ok: false, error: 'media_path must belong to this account' };
  }

  const filename =
    typeof rawFilename === 'string' && rawFilename.trim()
      ? rawFilename.trim().slice(0, 255)
      : 'quick-reply-image';
  return {
    ok: true,
    media_url: rawUrl.trim(),
    media_path: path,
    media_filename: filename,
  };
}

/** A saved object is removable only when a different object replaces it. */
export function shouldDeleteQuickReplyMedia(
  previousPath: string | undefined,
  nextPath: string | undefined
): boolean {
  return Boolean(previousPath && previousPath !== nextPath);
}
