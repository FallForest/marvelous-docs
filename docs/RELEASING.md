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
2. Bump the version in `package.json`, `apps/server/package.json`,
   `apps/web/package.json`, `packages/cli/package.json`, plus
   `.env.example`, `apps/server/.env.example`, `docker-compose.yml`,
   `release/latest.json` and the version string in `docs/API.md`.
3. Write one `CHANGELOG.md` section covering the whole batch, grouped by
   Added / Changed / Fixed / Security / Accessibility. A changelog entry is for
   the reader deciding whether to upgrade, not a commit log.
4. Commit, push `main`, then tag: `git tag -a vX.Y.Z -m 'Marvelous Docs X.Y.Z'`
   and push the tag. The Release workflow builds arm64 images natively and
   publishes the GitHub release.
5. Deploy: pull the new tags on the server, update `docker-compose.deploy.yml`
   and `.env`, `docker compose up -d api web`, then check `/healthz`,
   `/api/v1/system/version` and that `sub2api` on port 80 still answers.

## Rolling back

The previous image tag stays in GHCR and the server keeps the last
`docker-compose.deploy.yml` in `backups/`. Re-point the compose file at the
older tag and `up -d`. A database dump is taken before each deploy.

## What not to do

- Do not tag every commit.
- Do not release with a failing test "because it was already failing" — the
  suite is the only thing standing between a typo and a broken editor.
- Do not batch a security fix with feature work to save a release; ship it.
