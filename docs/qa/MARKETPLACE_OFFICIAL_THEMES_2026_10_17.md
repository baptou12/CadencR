# Official theme local visual QA — 2026-10-17

## Scope

- Tested current-source service and browser-only Vite renderer in a new isolated HOME, settings directory, database, and distinct loopback ports.
- Added byte-for-byte local copies of `plugins/themes/{graphite,ember,fjord}` into the isolated watched user-theme directory. This is **local theme discovery**, not signed marketplace installation, publication, or trusted-feed qualification.
- No author theme projects were created; project classification was not exercised. No existing user database or workspace state was changed.

## Source provenance

- Tested source commit: `da8849bf4c573db1ffe27f5153e171c0aee4aaf7`.
- The three source documents were unchanged versus current `origin/main`; these digests identify the local theme documents, not published archives.

| Source document                      | SHA256                                                             |
| ------------------------------------ | ------------------------------------------------------------------ |
| `plugins/themes/graphite/theme.json` | `ec1af0e82fdaacbda8fd7648eafa638fa2e515fb0ca10c449d27c0eb9b2347c5` |
| `plugins/themes/ember/theme.json`    | `a021721902aba17a5fa8b9156941482cd98b40a3b5c33763f2f3ec9c07aa4079` |
| `plugins/themes/fjord/theme.json`    | `05cd4fb4b1819bdae1a3316c5cb0d398fcefd9813dd30c220468828e7eebe14e` |

## Exercised interfaces

- CLI validation: `target/debug/cadencr-service check-theme <isolated-theme-directory>` once each for Graphite, Ember, and Fjord. This was a CLI command, not an HTTP validation endpoint.
- Browser-driven picker selection and Settings navigation used the live browser-only renderer and isolated HTTP backend.
- `GET /api/themes` supplied before/after inventory assertions; `POST /api/themes` exercised invalid creation; `PUT /api/themes/ember` exercised invalid draft persistence.

## Results

| Check                                   | Result                                                                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check-theme` on Graphite, Ember, Fjord | All valid, no issues                                                                                                                                                      |
| Live picker activation                  | Graphite → Fjord → Ember applied `user:graphite`, `user:fjord`, `user:ember`                                                                                              |
| Appearance and background               | Graphite dark `#171d25`; Fjord light `#f3f7fa`; Ember dark `#251b19`                                                                                                      |
| Persistence                             | Ember remained selected after closing picker and navigating to Settings                                                                                                   |
| Local restoration                       | Returned isolated selection to `cadencr-dark`; all three theme inventories had zero issues                                                                                |
| Invalid creation                        | Incomplete xterm payload returned HTTP 422; before/after theme inventory identical                                                                                        |
| Invalid author draft                    | PUT intentionally persisted invalid draft with validation issue; original isolated Ember document was restored. This endpoint is not a rejected-save/nonmutation boundary |

## Canonical packaging

The local Rust CLI (`cadencr plugin validate --kind theme` and
`cadencr registry pack-theme`) validated all three source directories and built
each archive twice. Each pair was byte-identical. Independent tar inspection
found exactly one regular `theme.json`, byte-identical to its tracked source.
Receipt sizes and SHA-256 values matched independent calculations.

| Theme    | Archive bytes | Archive SHA-256                                                    |
| -------- | ------------: | ------------------------------------------------------------------ |
| Graphite |          1100 | `feb4ba028cbb4abf9014284322d7920ad647e7c26318db586c8a50d9326ceb17` |
| Ember    |          1100 | `1cdc169f0c6b037d6117496c9a7c14423b7a3a12147430c124f7ac09f174c05e` |
| Fjord    |          1120 | `7b9b7cff609f794dc73234e91ddc683ef97b2448718fa413bf4b8b3c9e8f727a` |

Local CLI SHA-256:
`6911c341ece0039d1b10df5ded9223b9b8882510230ed0b9ac632b20c283efa9`.
This is local-build evidence, not qualification of a distributed Linux binary or
author-release metadata. No source tag, release or registry entry was created.

## Visual inspection and contrast

- Inspected actual picker screenshots for all three palettes: headings, secondary copy, selected swatch, controls, and light/dark transition were readable. Settings behind the picker also changed live.
- Screenshots are cropped to the picker to avoid exposing local paths; retained with scratch QA artifacts, not committed.
- Carousel scrolls horizontally; an off-screen click first scrolled a swatch into view, and a second click activated it. Partially clipped adjacent tiles at the carousel edge were visible. No source changes were made.

| Theme    | Foreground/background | Muted/background | Primary foreground/primary |
| -------- | --------------------: | ---------------: | -------------------------: |
| Graphite |               15.19:1 |           8.60:1 |                     8.87:1 |
| Ember    |               15.08:1 |           8.73:1 |                    10.32:1 |
| Fjord    |               12.99:1 |           5.65:1 |                     6.97:1 |

Ratios use sRGB relative luminance on the source hex tokens. They are representative token checks, not a complete accessibility audit.

## Runtime observations and limits

- Browser console reported the existing meta-delivered CSP `frame-ancestors` warning. No theme activation exception was observed.
- Network recorder reported font `ERR_CACHE_MISS` and WebSocket upgrade entries despite active application subscriptions; these were not established as theme defects.
- Expected HTTP 422 was generated by the negative creation test.
- Native Electron shell, real terminal/editor conversations, OS-driven appearance switching, signed-feed preview/install/update/removal, and publication were not tested.
- Isolated service was subsequently shared for a coordinated test-only provider catalog check; its results belong to the separate provider QA report.

- Cleanup: stopped only the QA-owned backend and frontend after provider handoff completed; retained the scratch database and all evidence. The QA tab was navigated to a blank local file because this browser connector exposes no tab-close operation.
