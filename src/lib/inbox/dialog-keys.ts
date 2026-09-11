export type BulkDialogKind = 'transfer' | 'close';

/** Give sibling bulk-action dialogs independent identity namespaces. */
export function getBulkDialogKey(
  kind: BulkDialogKind,
  open: boolean,
): string {
  return `bulk-${kind}-${open ? 'open' : 'closed'}`;
}
