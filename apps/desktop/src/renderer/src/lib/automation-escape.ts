/** Overlays inside the automation editor that own the next Escape. */
export const AUTOMATION_NESTED_ESCAPE_SELECTOR =
  '.composer-picker-backdrop, .composer-ac, .floating-menu, .md-image-overlay, .confirm-modal';

export function automationEditorShouldCloseOnEscape(
  event: { key: string; defaultPrevented: boolean },
  opts: { busy: boolean; nestedOverlayOpen: boolean },
): boolean {
  if (event.key !== 'Escape' || opts.busy || event.defaultPrevented) return false;
  return !opts.nestedOverlayOpen;
}
