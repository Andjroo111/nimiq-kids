// Delete the media files left behind by every household purged BEFORE purgeFamily unlinked
// them (#143), and by any future row that goes missing without its file.
//
//   bun run src/scripts/sweep-orphan-media.ts              # report only
//   bun run src/scripts/sweep-orphan-media.ts --delete     # actually unlink
//
// Every visitor to /demo minted a household, the kid app handed them three rear-camera
// capture buttons, and the sweeper deleted the household a day later while leaving the JPEG
// on disk with no row pointing at it. What a judge photographed is plausibly a child, so
// these files are the retained images the fix upstream stops accruing; this clears the
// backlog that already exists on the two public instances.
//
// SAFE BY CONSTRUCTION, and the reason matters: the media table is the ONLY authority on
// which files are live, so an orphan is a file whose relative path no `media_assets.path`
// claims. That is decided from the database this instance is pointed at, so it must be run
// with the SAME DB_PATH and MEDIA_DIR as the instance that owns the directory — against the
// wrong pair every live file looks like an orphan. It refuses to run if the media table is
// empty AND the directory is not, which is exactly what a mismatched pair looks like.
//
// Reports only unless `--delete` is passed.

import { readdir, stat, unlink } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { initDb, getDb } from "../db";
import { mediaDir } from "../routes/media";

const DELETE = process.argv.includes("--delete");

/** Every file under `root`, as paths relative to it and in the same shape media_assets.path
 *  stores them (POSIX separators, since that is what `join` produced when they were written). */
async function walk(root: string, dir = root): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(root, abs));
    else if (e.isFile()) out.push(relative(root, abs).split(sep).join("/"));
  }
  return out;
}

async function main(): Promise<void> {
  initDb();
  const root = mediaDir();
  const known = new Set(
    (getDb().query("SELECT path FROM media_assets").all() as { path: string }[])
      .map((r) => r.path.split(sep).join("/")),
  );
  const files = await walk(root);
  const orphans = files.filter((f) => !known.has(f));

  console.log(`media dir : ${root}`);
  console.log(`db        : ${process.env.DB_PATH ?? "kids.db"}`);
  console.log(`on disk   : ${files.length} file(s)`);
  console.log(`indexed   : ${known.size} row(s)`);
  console.log(`orphans   : ${orphans.length}`);

  if (known.size === 0 && files.length > 0) {
    console.error(
      "\nREFUSING TO DELETE: the media table is empty and the directory is not.\n" +
      "That is what a mismatched DB_PATH/MEDIA_DIR pair looks like, and it is also what a\n" +
      "genuinely fully-orphaned directory looks like. Point this at the instance's own env\n" +
      "and re-run; if it really is all orphans, delete them by hand.",
    );
    process.exit(1);
  }
  if (!orphans.length) return;

  let bytes = 0;
  for (const p of orphans) bytes += (await stat(join(root, p)).catch(() => ({ size: 0 }))).size;
  console.log(`bytes     : ${bytes.toLocaleString()}`);
  for (const p of orphans.slice(0, 20)) console.log(`  ${p}`);
  if (orphans.length > 20) console.log(`  … and ${orphans.length - 20} more`);

  if (!DELETE) {
    console.log("\nreport only — pass --delete to unlink them");
    return;
  }
  let gone = 0;
  for (const p of orphans) {
    await unlink(join(root, p)).then(() => { gone++; }).catch((e) => {
      console.error(`  could not delete ${p}: ${String(e)}`);
    });
  }
  console.log(`\ndeleted ${gone} of ${orphans.length}`);
}

await main();
