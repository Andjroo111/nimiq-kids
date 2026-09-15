// Appending a secret to an instance env file, without leaving it world-readable.
//
// Both key generators used to do this themselves, as `writeFileSync(envPath, env, { mode: 0o600 })`
// with a header comment stating "chmod 600" as a fact. `mode` is only honoured when the call
// CREATES the file, and both scripts `existsSync`-check and bail when it is missing — so the file
// always already exists and the argument was dead in both. An operator who made the env file with
// a plain `touch` under the usual umask 022 got 0644, ran the generator, was told it succeeded,
// and left the HD master seed behind every kid account on the instance readable by every local
// account and every backup tool on the box.
//
// The permission is now ENFORCED rather than requested, and it is enforced BEFORE the write, so
// the secret is never briefly present in a readable file. Written once, here, because the version
// of this that lived in two scripts is what let it be wrong in two scripts.

import { appendFileSync, chmodSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";

/** No group and no other bits, on either a file or a directory. */
const isPrivate = (mode: number) => (mode & 0o077) === 0;

export const readEnv = (envPath: string): string => readFileSync(envPath, "utf8");

/**
 * Append `lines` to the env file, with the file locked down first.
 *
 * The containing directory is checked but NOT changed: it is the operator's, it may hold things
 * this script knows nothing about, and silently widening or narrowing it is not a key
 * generator's call. It says what to run instead, because a 0600 file inside a 0755 directory is
 * still fine to READ only by its owner, and the warning is about the neighbours it sits with.
 */
export function appendSecretLines(envPath: string, lines: string[]): void {
  chmodSync(envPath, 0o600); // BEFORE the write: the secret never exists in a readable file
  appendFileSync(envPath, lines.join("\n"));

  const dir = dirname(envPath);
  if (!isPrivate(statSync(dir).mode)) {
    console.warn(
      `\n⚠️  ${dir} is readable by other accounts on this machine (mode ` +
      `${(statSync(dir).mode & 0o777).toString(8)}). The env file itself is 0600, but the ` +
      `directory is where the deploy templates put every other secret too. Consider:\n` +
      `    chmod 700 ${dir}\n`,
    );
  }
}
