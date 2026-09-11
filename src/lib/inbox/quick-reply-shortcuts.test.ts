import { describe, expect, it } from "vitest";

import type { QuickReply } from "@/types";
import {
  getQuickReplyShortcut,
  getQuickReplySuggestions,
  replaceQuickReplyShortcut,
} from "./quick-reply-shortcuts";

const replies: QuickReply[] = [
  {
    id: "reply-greeting",
    account_id: "account-1",
    user_id: "agent-1",
    title: "Saludo inicial",
    kind: "text",
    content_text: "¡Hola! ¿En qué podemos ayudarte?",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "reply-follow-up",
    account_id: "account-1",
    user_id: "agent-1",
    title: "Seguimiento",
    kind: "text",
    content_text: "¿Pudiste revisar la información?",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
];

describe("quick-reply shortcuts", () => {
  it("normalizes a quick-reply title into a slash command", () => {
    expect(getQuickReplyShortcut("¡Información útil! ")).toBe(
      "informacion-util",
    );
  });

  it("suggests replies for the slash command at the caret", () => {
    const suggestions = getQuickReplySuggestions("Hola /SAL", replies, 9);

    expect(
      suggestions.map(({ quickReply, shortcut }) => ({
        id: quickReply.id,
        shortcut,
      })),
    ).toEqual([{ id: "reply-greeting", shortcut: "saludo-inicial" }]);
  });

  it("does not treat a URL slash as a quick-reply command", () => {
    expect(
      getQuickReplySuggestions("Visita https://example.com", replies),
    ).toEqual([]);
  });

  it("replaces only the command and returns the next caret position", () => {
    expect(
      replaceQuickReplyShortcut("Hola /saludo-inicial", replies[0].content_text!),
    ).toEqual({
      text: "Hola ¡Hola! ¿En qué podemos ayudarte?",
      caretPosition: 37,
    });
  });
});
