/**
 * Visibility for the xterm canvas host.
 *
 * The Terminal panel stays mounted under Setup/Run (`.is-parked`). A child
 * `visibility: visible` overrides a hidden ancestor, so the host must stay
 * hidden until the canvas is ready *and* the Terminal tab is showing.
 */
export function xtermHostVisibility(
  ready: boolean,
  active: boolean,
): 'visible' | 'hidden' {
  return ready && active ? 'visible' : 'hidden';
}
