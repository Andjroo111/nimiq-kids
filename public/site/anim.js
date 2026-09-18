/* nimiq.kids homepage: the animation mounts. The whole mechanism lives in the shared module
   (/js/lib/rive-mount.js, PR #515): every .anim with data-riv set gets the vendored Rive
   runtime once, plays Main, fires data-verb on tap, and is left untouched when the file is
   blank or missing, so the page's `.anim:empty { display: none }` keeps it collapsed. */
import { mountAll } from "/js/lib/rive-mount.js";
mountAll();
