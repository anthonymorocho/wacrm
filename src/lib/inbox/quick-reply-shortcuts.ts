import type { QuickReply } from "@/types";

const COMMAND_CHARACTER_RE = /^[\p{L}\p{N}_-]*$/u;
const MAX_SUGGESTIONS = 6;

export interface QuickReplySuggestion {
  quickReply: QuickReply;
  shortcut: string;
}

export interface QuickReplyShortcutMatch {
  start: number;
  end: number;
  query: string;
}

export interface QuickReplyShortcutReplacement {
  text: string;
  caretPosition: number;
}

/** Convert a saved title into the slash command shown to agents. */
export function getQuickReplyShortcut(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Locate the slash command immediately before the current caret. */
export function findQuickReplyShortcut(
  text: string,
  caretPosition = text.length,
): QuickReplyShortcutMatch | null {
  const end = Math.max(0, Math.min(caretPosition, text.length));
  const beforeCaret = text.slice(0, end);
  const tokenStartMatch = /\S+$/.exec(beforeCaret);
  const start = tokenStartMatch ? end - tokenStartMatch[0].length : end;
  const token = text.slice(start, end);

  if (!token.startsWith("/") || !COMMAND_CHARACTER_RE.test(token.slice(1))) {
    return null;
  }

  return {
    start,
    end,
    query: getQuickReplyShortcut(token.slice(1)),
  };
}

/** Return the saved replies matching the command at the caret. */
export function getQuickReplySuggestions(
  text: string,
  quickReplies: QuickReply[],
  caretPosition = text.length,
): QuickReplySuggestion[] {
  const match = findQuickReplyShortcut(text, caretPosition);
  if (!match) return [];

  return quickReplies
    .map((quickReply) => ({
      quickReply,
      shortcut: getQuickReplyShortcut(quickReply.title),
    }))
    .filter(
      ({ shortcut }) =>
        shortcut.length > 0 && shortcut.startsWith(match.query),
    )
    .slice(0, MAX_SUGGESTIONS);
}

/** Replace only the command before the caret and keep the remaining draft. */
export function replaceQuickReplyShortcut(
  text: string,
  replacement: string,
  caretPosition = text.length,
): QuickReplyShortcutReplacement {
  const match = findQuickReplyShortcut(text, caretPosition);
  if (!match) return { text, caretPosition };

  const nextText =
    text.slice(0, match.start) + replacement + text.slice(match.end);
  return {
    text: nextText,
    caretPosition: match.start + replacement.length,
  };
}
