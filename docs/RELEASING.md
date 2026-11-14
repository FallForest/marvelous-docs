# Releasing

How a version reaches production, and when to cut one.

## Cadence

Release in batches, not per commit.

Every release runs the full image build and a deploy, and each one costs a tag,
a changelog section, a version bump across four `package.json` files, a compose
update on the server and a rollback window. Paying that for a one-line fix is
noise.

Cut a release when one of these is true:

- A user-visible batch is done (a feature plus the fixes it needed).
- A security or data-integrity fix landed — these do not wait.
- A regression is live in production — fix and release immediately.

Otherwise keep committing to `main` and accumulate. Untagged commits are not
"unreleased work" in the risky sense: CI still runs lint, typecheck, tests and
the build on every push, so `main` is always known-good. What waiting costs is
only that the running images lag `main`.

## Steps

1. Confirm the batch is coherent: `pnpm typecheck`, `pnpm test`, `pnpm build`,
   `npx eslint .` all clean.
2. Bump `version` in the root `package.json` only, then run
   `node scripts/release/bump-version.mjs`. The script carries that number into
   the other three `package.json` files, both `.env.example` templates (the
   value and the `(default ...)` comment above it), the `APP_VERSION` default
   in `docker-compose.yml`, the version plus its two image tags and release URL
   in `release/latest.json`, and the example payload in `docs/API.md`. The root
   manifest is the source of truth because the tag is named after it.
   `--dry-run` lists what would change; `--check` changes nothing and exits 1
   if a copy has drifted, which is what CI runs. Never hand-edit one of the
   eight copies — a stale copy is a silent lie (the API reports one version and
   the bundle another).
3. Write one `CHANGELOG.md` section covering the whole batch, grouped by
   Added / Changed / Fixed / Security / Accessibility. A changelog entry is for
   the reader deciding whether to upgrade, not a commit log.
4. Commit, push `main`, then tag: `git tag -a vX.Y.Z -m 'Marvelous Docs X.Y.Z'`
   and push the tag. The Release workflow builds arm64 images natively and
   publishes the GitHub release.
5. Deploy: on the server, pull the new tags and update `docker-compose.yml`
   and `.env` (`API_IMAGE`, `WEB_IMAGE`, `APP_VERSION`), then
   `docker compose up -d api web`, then check `/healthz`,
   `/api/v1/system/version` and that `sub2api` on port 80 still answers.
   There is no `docker-compose.deploy.yml` in this repository: the compose file
   is `docker-compose.yml`, and a server that adds an override passes it through
   `COMPOSE_FILE` ("base.yml override.yml", space separated), which
   `scripts/deploy/*.sh` and the updater both honour.

## Rolling back

The previous image tag stays in GHCR and `scripts/deploy/update.sh` keeps the
newest five `pre-update-*` snapshots of every compose file and `.env` in
`backups/` (`BACKUP_KEEP`). Re-point `API_IMAGE`/`WEB_IMAGE`/`APP_VERSION`
at the older tag and `up -d`, or restore the matching `pre-update-*` files. A
database dump is taken before each deploy.

## What not to do

- Do not tag every commit.
- Do not release with a failing test "because it was already failing" — the
  suite is the only thing standing between a typo and a broken editor.
- Do not batch a security fix with feature work to save a release; ship it.
