# Contributing

Thanks for improving Marvelous Docs. This repository is a pnpm monorepo with a
Fastify API, a React client, a CLI, the deployment stack, and the documentation.

## Workflow

1. Create a branch from `main`: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`,
   or `chore/<topic>`.
2. Install once: `pnpm install` (Node 22+, pnpm 11+; `corepack enable`).
3. Make the change, including tests and documentation for behaviour changes.
4. Run the same checks CI runs:

   ```sh
   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm build
   ```
5. Commit with a conventional message and open a pull request.

Do not commit `node_modules`, `dist`, `*.tsbuildinfo`, `.env*` (other than
`.env.example`), backups, or coverage output. `pnpm-lock.yaml` is the only
lockfile; npm and yarn lockfiles must not be added.

## Commit style

[Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, `chore`,
  `perf`.
- Scopes used here: `server`, `web`, `cli`, `infra`, `docs`, `api`.
- Subject in the imperative mood, lower case, no trailing period, 72 characters or
  fewer.
- Explain the motivation in the body. Reference issues with `Refs #123` /
  `Closes #123`.
- Breaking changes: append `!` to the type/scope and describe the migration in a
  `BREAKING CHANGE:` footer.

Examples:

```
feat(cli): add export --format markdown

docs(api): document the version restore conflict code
fix(web): scope collaboration provider to the open document
```

Do not include secrets, tokens, or production data in commit messages, diffs, or
screenshots.

## Pull requests

- Keep PRs focused; split unrelated refactors.
- Describe the problem, the approach, and the verification you ran (commands and
  results, not "tested locally").
- Update [CHANGELOG.md](CHANGELOG.md) under `[Unreleased]` for user-visible
  changes.
- API changes require an update to [docs/API.md](docs/API.md) in the same PR; it is
  the authoritative contract.
- Deployment or environment changes require matching updates to
  [`.env.example`](.env.example), `docker-compose.yml`, and
  [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- Screenshots help for UI changes; include before/after for visual work.

## Checks

`.github/workflows/ci.yml` runs on every push and pull request:

| Step | Command |
| --- | --- |
| Install | `pnpm install --frozen-lockfile` |
| Lint | `pnpm lint` |
| Typecheck | `pnpm typecheck` |
| Tests | `pnpm test` |
| Build | `pnpm build` |

Releases are tag-driven (`v*.*.*`) and publish multi-arch images plus
`release/latest.json` through `.github/workflows/release.yml`.

## Code style

- **Formatting**: 2 spaces, LF line endings, UTF-8, final newline - enforced by
  `.editorconfig` and `.gitattributes`. Shell scripts are POSIX `sh` with
  `set -eu`; PowerShell helpers use CRLF.
- **Server**: semicolons, single quotes, `node:` built-in prefixes, errors from
  the documented code list.
- **Web**: no semicolons, single quotes, function components, hooks at the top
  level.
- **CLI**: dependency-free Node.js, ESM, explicit exit codes.
- **Comments**: explain why, not what. English everywhere; Chinese only in UI copy
  that is already Chinese.
- **Lint**: `eslint.config.mjs` is the single source of truth. Do not add
  file-level disables for style rules; fix the code or change the shared config
  with a justification.

## Tests

- `node --test` files live next to the package they cover
  (`packages/cli/test/*.test.mjs`). Add a case for every new CLI command or
  validation branch.
- Server and web changes should ship with tests when the logic is testable without
  a browser; keep database-dependent tests isolated and skippable.
- A change that fixes a bug should first add a failing test.

## Migrations and API changes

- Add `apps/server/migrations/NNN_description.sql`, idempotent and additive; never
  edit an applied migration.
- Content shape changes must keep `schemaVersion` and the Tiptap schema in sync
  between `apps/web` and `apps/server`.
- Document new routes, fields, and error codes in [docs/API.md](docs/API.md).

## Documentation

User-facing docs live in `docs/`; the root `README.md` is the entry point. When
you add a script, environment variable, or service, update the README, the
relevant `docs/` page, and `.env.example` in the same PR. Do not duplicate the
full CLI reference outside `packages/cli/README.md`.
