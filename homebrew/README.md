# Homebrew distribution

Cadencr is installable as a [Homebrew Cask](https://docs.brew.sh/Cask-Cookbook) from
its own tap:

```bash
brew install --cask merkr-software/cadencr/cadencr
```

(After `brew tap merkr-software/cadencr`, the short `brew install --cask cadencr`
also works.)

## How it works

- `cadencr.rb.tmpl` is the source-of-truth cask template. `__VERSION__`,
  `__SHA256_ARM__`, and `__SHA256_INTEL__` are filled in per release.
- `scripts/update-homebrew-cask.sh` downloads the notarized DMGs from the GitHub
  release, computes their SHA-256 digests, renders the template, and pushes
  `Casks/cadencr.rb` to the tap repo.
- The `Update Homebrew cask` step in `.github/workflows/desktop-release.yml` runs
  this script automatically after each tagged release is published.

The cask sets `auto_updates true` because the app ships electron-updater — Homebrew
will not report it as outdated when it updates itself in place.

## One-time setup

1. **Create the tap repo.** Make a public GitHub repo named
   `merkr-software/homebrew-cadencr` (the `homebrew-` prefix is required for
   `brew tap` to resolve `merkr-software/cadencr`). A `Casks/` directory is enough;
   the first release run will populate it.

2. **Create a tap token.** Generate a token with write access to the tap repo:
   - Fine-grained PAT scoped to `merkr-software/homebrew-cadencr` with
     **Contents: Read and write**, or
   - a classic PAT with `repo` scope.

3. **Add the secret.** In `merkr-software/cadencr` → Settings → Secrets and
   variables → Actions, add `HOMEBREW_TAP_TOKEN` with that token. Until this
   secret exists the workflow step is skipped, so releases keep working unchanged.

## Seeding the cask before the next release

To publish the cask for the current release (`v0.4.1`) without waiting for the next
tag, run the script locally against an existing release:

```bash
HOMEBREW_TAP_TOKEN=<token> scripts/update-homebrew-cask.sh v0.4.1
```

## Verifying a cask change

```bash
brew audit --cask --new merkr-software/cadencr/cadencr   # full style/lint audit
brew install --cask merkr-software/cadencr/cadencr       # end-to-end install test
```
