# Fetching the dataset

`scripts/fetch-lunaris.mjs` downloads every data file and image this project
needs from the [lunaris.moe](https://lunaris.moe) API into `public/`. It is the
supported way to populate or refresh the dataset; the older one-off scripts that
used to live in `scratch/` have been superseded by it.

```bash
npm run fetch           # incremental update (the normal case)
npm run fetch:check     # report what would change, write nothing
npm run fetch:force     # ignore the manifest and re-download everything
```

## Why it exists

The data is a mirror of a live site, so it drifts: characters are added, icons
are renamed, and a game version bump can change a file's contents without
changing its path. Downloading by hand produced a pile of single-purpose scripts
that each knew one URL pattern, and several of those patterns rotted — the card
art folder moved from `avatarside/` to `gachaicon/`, and the weapon icon prefix
changed from `UI_EquipIcon_` to `UI_Gacha_EquipIcon_`. This tool centralises
every endpoint in one place so a change is fixed once.

## What it fetches

| Stage | Destination | Contents |
| --- | --- | --- |
| data | `public/data/charlist.json` | every character's names, element, quality |
| data | `public/data/char/<lang>/<id>.json` | skills, constellations, passives, materials, costumes |
| images | `public/img/avatar/<id>.webp` | grid avatar |
| images | `public/img/char/<id>.webp` | full-body card art |
| images | `public/img/skill/<icon>.webp` | active talent icons |
| images | `public/img/talent/<icon>.webp` | constellation and passive icons |
| images | `public/img/item/<id>.webp` | ascension materials |
| images | `public/img/weapon/<icon>.webp` | weapon art |
| images | `public/img/artifact/<icon>.webp` | artifact set emblems |
| images | `public/img/icons/<name>.webp` | element, stat and weapon-type glyphs |

**Languages.** Only `chs` and `en` are fetched, because those are the only two
the UI can render (`src/i18n.jsx` defines exactly that pair). The upstream API
also serves `ru`, `fr` and `pt`; adding one is a one-line change to `LANGS`.

## Incremental behaviour

Every file fetched is recorded in `public/.lunaris-manifest.json` with its size
and — for JSON — a content hash. On a later run:

- a file the manifest knows about, still present at the recorded size, is
  **skipped without a network request**, so a no-op run takes seconds;
- a file that is missing, truncated or resized is re-downloaded;
- when the upstream **version changes**, all JSON records are invalidated and
  re-validated, because a detail file can change under an unchanged path.
  Images are addressed by content-bearing name and are almost never rewritten,
  so they are still skipped by size.

Files that 404 are also recorded, and not retried. This matters more than it
sounds: 2,814 of the 12,869 referenced images have no upstream file, and
re-requesting them every run cost ~95 seconds for no benefit. `--retry-missing`
forces a re-check, which is what you want after a game version that may have
published art which did not exist before.

Measured on the full dataset (10,330 files):

| Run | Time | Fetched |
| --- | --- | --- |
| first run | ~14 min | 12,869 images + 279 JSON |
| no-op re-run | **~5 s** | nothing |
| after `--force` | ~14 min | everything |

`public/.lunaris-manifest.json` is git-ignored: it describes *your* local copy,
not the repository.

## Resumability

Downloads are written to `<name>.part` and renamed only on success, so an
interrupted run cannot leave a truncated WebP that a later run would mistake for
a complete one. Re-running after an interruption picks up exactly the files that
are still missing.

## Progress

A live single-line bar reports files done, bytes, throughput and ETA:

```
images       ████████████░░░░░░░░░░░░░░░░  43%  5532/12854   61.4MB  142/s eta 51s
```

It is drawn only when stdout is a TTY, so redirecting to a file or a CI log
yields clean lines instead of thousands of carriage returns. Pass `--quiet` to
suppress it in a terminal, or set `NO_COLOR=1` to drop the colour.

## Options

| Flag | Effect |
| --- | --- |
| `--check` | print the plan and exit; writes nothing |
| `--force` | ignore the manifest and re-fetch every file |
| `--retry-missing` | re-check files previously recorded as absent upstream |
| `--data-only` | JSON only, no images |
| `--images-only` | images only, no JSON |
| `--concurrency N` | parallel requests (default 8) |
| `--quiet` | no progress bar |

## How endpoints were determined

None of the URLs are guessed. Each was confirmed against the live site by
watching its own network traffic, and the icon *names* come from the upstream
lists (`weaponlist.json`, `artifactlist.json`) rather than from string
manipulation:

```
data/version.json                    -> { version, versions[] }
data/<version>/charlist.json         -> roster
data/<version>/weaponlist.json       -> weaponIcon per weapon
data/<version>/artifactlist.json     -> setIcon per artifact set
data/<version>/materiallist.json     -> ascension material ids
data/<version>/<lang>/char/<id>.json -> per-character detail
data/assets/<folder>/<name>.webp     -> images
```

The trickiest are recorded in comments in the script, because they look like
bugs otherwise:

- the weapon list says `UI_EquipIcon_*` but the file is `UI_Gacha_EquipIcon_*`;
- **a material's icon is not named after its id.** The `materiallist` entries
  carry an explicit `icon` field (material `115` is `UI_ItemIcon_200005`), and
  only 2,627 of the 10,663 ids have a file named after themselves. Deriving
  `UI_ItemIcon_<id>` produced 8,033 spurious 404s and left most materials with
  no artwork at all;
- the per-character detail path is version-scoped, so a hardcoded version
  silently 404s after an update;
- `icons/unknown.webp` does not exist upstream and is generated locally.

## Result

| Folder | Files |
| --- | --- |
| `img/item` | 7,856 |
| `img/talent` | 1,177 |
| `img/skill` | 417 |
| `img/weapon` | 255 |
| `img/avatar` | 139 |
| `img/char` | 139 |
| `img/artifact` | 65 |
| `img/icons` | 26 |
| **total** | **10,074 (99 MB)** |

## Known gaps

Some references have no upstream file at all. These are reported at the end of a
run, recorded in the manifest, and not retried:

- **2,656 material icons.** `materiallist.json` lists 10,663 entries but only
  about 2,700 have artwork upstream; the rest are internal or unreleased items;
- the Traveler (every element variant) and the two mannequins have no
  full-body art upstream; only small avatar icons exist;
- some `UI_AvatarIcon_*Costume*` icons exist only for released costumes;
- the planner's two signature weapons (`苍狼之牙`, `苍耀的星辉之剑`) are custom to
  this dataset and have no upstream entry, so stand-ins are used.

The UI degrades gracefully for all of these: every `<img>` has an `onError`
fallback, so a missing file hides the element rather than showing a broken
glyph.
