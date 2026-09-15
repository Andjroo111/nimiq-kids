# changelog.d — one file per branch, folded on main

**Do not edit `CHANGELOG.md` or the `version` in `package.json` in a pull request.** Write a
fragment here instead. `.github/workflows/changelog-fold.yml` folds every fragment into
`CHANGELOG.md`, bumps the version, deletes the fragments and commits that to `main` — once,
after the merge, where there is nobody to race.

## Why

Those two files are the only ones in this tree that *every* PR touches, which makes them the
only two guaranteed to conflict when more than one session is open. It is not hypothetical:
three PRs stacked on the evening of 2026-08-02 and two of them collided there, each costing a
rebase that had nothing to do with the change being shipped.

A fragment is named after the branch, so no two branches can ever write the same path.

## Writing one

```bash
# from your feature branch
mkdir -p "changelog.d/$(dirname "$(git branch --show-current)")"
$EDITOR "changelog.d/$(git branch --show-current).md"
```

`feat/kid-balance` therefore gives `changelog.d/feat/kid-balance.md`. The fold scans
recursively, so the nesting is fine.

The body is the release note itself — `###` headings, exactly as they appear in
`CHANGELOG.md`. Two branches that both write `### Fixed` produce one `### Fixed` in the
release:

```markdown
### Fixed
- A failed `build:shell` now fails the boot instead of serving the previous bundle (#119).
```

## The version

Patch by default. Put `<!-- bump: minor -->` (or `major`) on its own line to ask for more;
across a release the strongest request wins, so one feature makes the whole release a minor
even if everything else in it is a fix. The directive is stripped from the published note.

## Checking it before you push

```bash
node tools/changelog-fold.mjs --dry-run   # prints the version and the files, writes nothing
```
