/**
 * Render the body stored in a WhatsApp template with the values used for
 * one delivery. Keeping this in a shared pure module makes the preview,
 * optimistic bubble, and persisted message use the same representation.
 */
export function renderTemplateBody(
  body: string,
  params: readonly string[] = []
): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw: string) => {
    const index = Number(raw) - 1;
    return params[index] ?? `{{${raw}}}`;
  });
}
