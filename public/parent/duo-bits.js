// The three pieces of markup the duo components leave to the host, shared by every parent
// screen that draws a hexagon node: the Nimiq hexagon path (nimiq-ui, Hexagon Icon), the
// ring an active or waiting node wears (track + arc), and the gift the prize node carries.
// Verbatim from the kid's goal-path.js so both apps draw one shape; no hue is written here.

export const HEX = "M19.964 8.156 15.758.844A1.69 1.69 0 0014.299 0H5.887c-.6 0-1.156.32-1.456.844L.225 8.156c-.3.523-.3 1.165 0 1.688l4.206 7.312c.3.523.856.844 1.456.844h8.412c.6 0 1.156-.32 1.456-.844l4.206-7.312a1.69 1.69 0 00.003-1.688z";

export const ring = () => `<svg class="duo-node-ring" viewBox="0 0 20 18" aria-hidden="true">
  <path class="duo-node-track" d="${HEX}"/><path class="duo-node-arc" d="${HEX}" pathLength="100"/></svg>`;

/** The gift, the prize node's face on every path (the 09-13 rule: no sticker, emoji or
 *  character on the path, the pack is data the kid's own screen reads). */
export const giftIcon = () => `<svg viewBox="0 0 11 12" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width=".956" d="M5.5 4v6.5m0-6.5c-.166-.745-.451-1.382-.82-1.828-.367-.446-.8-.68-1.242-.672a1.1 1.1 0 00-.81.366 1.3 1.3 0 00-.336.884c0 .332.12.65.335.884a1.1 1.1 0 00.81.366M5.5 4c.166-.745.451-1.382.82-1.828.367-.446.8-.68 1.242-.672a1.1 1.1 0 01.81.366c.216.235.336.552.336.884s-.12.65-.335.884a1.1 1.1 0 01-.81.366m1.145 2v3.5c0 .265-.096.52-.268.707a.88.88 0 01-.648.293H3.208a.88.88 0 01-.648-.293 1.05 1.05 0 01-.268-.707V6m-.459-2h7.334a.5.5 0 01.5.5V6H1.333V4.5a.5.5 0 01.5-.5z"/></svg>`;

/** goal.js rung state → duo-node class, the kid's own map. */
export const NODE_CLASS = { locked: "is-locked", open: "is-active", waiting: "is-waiting", climbed: "is-done" };
