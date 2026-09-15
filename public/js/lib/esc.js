// HTML escaping, once, for both apps.
//
// There were four of these. Two escaped `&<>"` and two escaped `&<>"'`, which meant the
// answer to "is this string safe inside an attribute?" depended on which file you happened
// to be in. A single quote ends a single-quoted attribute, and single-quoted attributes are
// perfectly legal HTML, so the short version was wrong wherever it was used that way.
//
// Nobody is going to notice a divergence like that by reading. They notice it the day one
// of the four is used somewhere the other three would have been safe.
//
// Imported by RELATIVE path everywhere. The other shared modules here use `/js/lib/...`,
// which the browser resolves fine but a test importing the file straight off disk reads as
// the root of the filesystem. A relative specifier is correct in both.
//
// It is not the first line of defence. Markup belongs in the template and DATA belongs in
// `textContent` wherever the DOM allows it; this is for the places that build a string of
// HTML because that is how the view is written.

const MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Safe in element content AND in an attribute, single or double quoted. */
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => MAP[c]);
