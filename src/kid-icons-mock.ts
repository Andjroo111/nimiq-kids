// The ONE stub for public/kid/js/icons.js, shared by every test that loads a kid-app module.
//
// icons.js cannot be loaded under `bun test` at all: it imports `/js/lib/box-glyphs.js`, a
// browser-absolute specifier with no filesystem meaning. So any test that reaches util.js or a
// screen module has to mock it.
//
// It has to be THIS stub and not a local one, because `mock.module()` registrations are keyed
// by resolved path and the LAST one registered in a `bun test` run wins for the whole run —
// including for files that were loaded earlier. A file mocking icons.js down to `{ closeIcon }`
// therefore breaks an unrelated file that imported a screen needing `waitIcon`, with a
// link-time "Export named 'waitIcon' not found" that names neither file. Passing the same
// complete factory everywhere makes the race unobservable.
//
// Every export of icons.js is a pure string builder, so a stub that returns identifiable
// markup is a faithful stand-in for assertions about SURROUNDING markup.

const glyph = (name: string) => (): string => `<svg data-icon="${name}"></svg>`;

/** Pass to `mock.module("../public/kid/js/icons.js", kidIconsMock)`. */
export const kidIconsMock = () => ({
  GLYPHS: {} as Record<string, string>,
  loadIcons: async () => {},
  icon: glyph("icon"),
  maskIcon: glyph("mask"),
  arrowIcon: glyph("arrow"),
  stakingIcon: glyph("staking"),
  plantIcon: glyph("plant"),
  checkIcon: glyph("check"),
  searchIcon: glyph("search"),
  deleteIcon: glyph("delete"),
  nqCloseIcon: glyph("nq-close"),
  plusIcon: glyph("plus"),
  closeIcon: glyph("close"),
  scanIcon: glyph("scan"),
  goldHexIcon: glyph("gold-hex"),
  ph: (name: string) => `<svg data-icon="ph-${name}"></svg>`,
  calendarIcon: glyph("calendar"),
  chevronIcon: glyph("chevron"),
  targetIcon: glyph("target"),
  hexIcon: glyph("hex"),
  musicIcon: glyph("music"),
  pictureIcon: glyph("picture"),
  cameraIcon: glyph("camera"),
  playIcon: glyph("play"),
  glyph: glyph("glyph"),
  minuteDialIcon: glyph("minute-dial"),
  caretIcon: glyph("caret"),
  waitIcon: glyph("wait"),
});
