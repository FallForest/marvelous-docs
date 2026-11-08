# mdocs CLI

`mdocs` is the command line client for Marvelous Docs. It talks to the versioned REST API
(`/api/v1`) documented in [docs/API.md](../../docs/API.md), keeps its credentials in named
profiles, and supports every document, comment, version, sharing, and workspace operation.

- Zero runtime dependencies, Node.js >= 20, ESM.
- Human-readable tables on a TTY, machine-readable JSON envelopes with `--json`.
- Documented exit codes for scripts and CI.
- Shell completion for bash, zsh, fish, and PowerShell.

## Installation

Build from the repository root:

```sh
pnpm --filter @marvelous-docs/cli build
node packages/cli/dist/index.js --help
```

Run it through pnpm during development:

```sh
pnpm cli -- list
```

Install the `mdocs` bin globally from the built package:

```sh
cd packages/cli
npm link          # or: pnpm link --global
mdocs --help
```

## Quick start

```sh
mdocs login --server https://docs.example.com --email you@example.com
mdocs whoami
mdocs list
mdocs create --title "Project notes" --template project-plan
mdocs read DOCUMENT_ID
```

`login` saves the server URL and token and never prints the token. Use `MDOCS_PASSWORD` to keep
the password out of shell history:

```sh
MDOCS_PASSWORD=secret mdocs login --server https://docs.example.com --email you@example.com
```

## Global options

Global options are accepted before or after the command name.

| Option | Description |
| --- | --- |
| `--server URL` | Server base URL; overrides the active profile and `MDOCS_SERVER`. |
| `--token TOKEN` | Bearer token; overrides the active profile and `MDOCS_TOKEN`. |
| `--profile NAME` | Profile to use; overrides `MDOCS_PROFILE` and the default profile. |
| `--json` | Emit a machine-readable JSON envelope instead of a table. |
| `--quiet` | Suppress confirmations and notes; data and errors are still printed. |
| `--no-color` | Disable ANSI colours even when stdout is a TTY. |
| `--version` | Print the CLI version and exit 0. |
| `--help` | Print help for the CLI or for a command and exit 0. |

## Environment variables

| Variable | Description |
| --- | --- |
| `MDOCS_SERVER` | Server base URL; overrides the profile value. |
| `MDOCS_TOKEN` | Bearer token; overrides the profile value. |
| `MDOCS_PASSWORD` | Password for `mdocs login`. |
| `MDOCS_PROFILE` | Profile name used when `--profile` is absent. |
| `MDOCS_CONFIG_DIR` | Configuration directory (see below). |
| `NO_COLOR` | Any value disables ANSI colours, like `--no-color`. |

## Configuration

The config file lives at:

- Windows: `%APPDATA%\mdocs\config.json`
- Linux/macOS: `$XDG_CONFIG_HOME/mdocs/config.json` or `~/.config/mdocs/config.json`
- Any platform: `$MDOCS_CONFIG_DIR/config.json`

Profiles keep several servers or accounts apart:

```json
{
  "version": 1,
  "defaultProfile": "default",
  "profiles": {
    "default": { "server": "https://docs.example.com", "token": "<jwt>" },
    "ci": { "server": "https://staging.example.com", "token": "<jwt>" }
  },
  "updateCheckedAt": 1767225600000
}
```

- The directory is created with mode `0700` and the file with mode `0600` (POSIX).
- The previous `{ "server": ..., "token": ... }` file is migrated to
  `{ version: 1, defaultProfile, profiles }` on the next read and written back automatically.
- Selecting an unknown profile is a usage error (exit code 2).
- `mdocs login --profile NAME` creates the profile when it does not exist yet.

## Output conventions

- **Tables** are aligned on a TTY and in pipes; colours are added only when stdout is a TTY,
  `NO_COLOR` is unset, and `TERM` is not `dumb`. `--no-color` forces them off.
- **--json** prints `{ "ok": true, "command": "<name>", "data": { ... } }`.
- **Document payloads** stay raw so they can be piped: `read` prints the full Document object,
  `export` (default format `json`) prints the `DocJson` object, and `versions show` /
  `export --format markdown|html` print the payload itself.
- `--output FILE` writes to a file (`-` means stdout). Without `--output` the payload goes to stdout.
- `--quiet` silences confirmations such as `Created ...` and `Wrote ...`, not data or errors.

## Commands

Every command supports `--help`.

### Authentication

#### mdocs login

```
mdocs login --server URL (--email EMAIL [--password PASSWORD] | --token TOKEN) [--profile NAME]
```

Stores the server URL and token. `--password` falls back to `MDOCS_PASSWORD`. With `--token` the
token is verified against `GET /me` before it is saved. The token is never printed.

```sh
mdocs login --server https://docs.example.com --email ada@example.com
mdocs login --server https://docs.example.com --token "$JWT" --profile ci
```

#### mdocs logout

```
mdocs logout [--profile NAME]
```

Removes the saved token; the server URL stays for the next login.

#### mdocs whoami

```
mdocs whoami
```

Shows the authenticated user (`GET /me`) plus the active profile and server.

#### mdocs doctor

```
mdocs doctor
```

Runs three checks: server reachability (`GET /healthz`), the token (`GET /me`), and the
server version (`GET /system/version`). Exit code 3 means the server is unreachable or
unhealthy, 4 means the token was rejected.

#### mdocs completion

```
mdocs completion bash|zsh|fish|powershell
```

Prints a completion script on stdout:

```sh
mdocs completion bash > /etc/bash_completion.d/mdocs
mdocs completion zsh > ${fpath[1]}/_mdocs
mdocs completion fish > ~/.config/fish/completions/mdocs.fish
mdocs completion powershell | Out-String | Invoke-Expression
```

### Documents

#### mdocs list

```
mdocs list [--folder ID] [--trash] [--favorites] [--recent] [--json]
```

Lists documents and folders (newest first) with the columns
`ID`, `TITLE`, `KIND`, `VERSION`, `UPDATED`. `--folder` keeps the direct children of a
folder. `--trash`, `--favorites`, and `--recent` use the matching API endpoints and are
mutually exclusive.

```sh
mdocs list
mdocs list --trash --json
mdocs list --folder FOLDER_ID
```

#### mdocs tree

```
mdocs tree
```

Prints the hierarchy built from `parentId`, folders suffixed with `/` and every id dimmed.

#### mdocs search

```
mdocs search QUERY [--scope all|title|content] [--limit N]
```

Case-insensitive search. `--scope` defaults to `all`, `--limit` accepts 1-100. Snippets are
rendered with collapsed whitespace.

```sh
mdocs search "quarterly plan"
mdocs search roadmap --scope title --json
```

#### mdocs create

```
mdocs create --title TITLE [--folder ID|--parent ID] [--template ID] [--input FILE|-] [--markdown FILE|-]
```

Without `--input`, `--markdown`, or `--template` the document starts blank. `--template` resolves the
template through `GET /templates` and creates the document with its content.
`--markdown` is converted by `POST /documents/import`.

```sh
mdocs create --title "Project notes"
mdocs create --title "Weekly report" --template weekly-report
mdocs create --title "Notes" --markdown notes.md --parent FOLDER_ID
cat document.json | mdocs create --title "Restored" --input -
```

#### mdocs mkdir

```
mdocs mkdir TITLE [--parent ID|--folder ID]
```

Creates a folder, optionally inside another folder. Folders are the only valid
document parents; `mdocs update` can rename or move them like documents.

```sh
mdocs mkdir "Projects"
mdocs mkdir "2026" --parent FOLDER_ID
```

#### mdocs read

```
mdocs read ID [--output FILE|-]
```

Prints the full Document object, including `content` and the current `version`.

#### mdocs export

```
mdocs export ID [--format json|markdown|html] [--output FILE|-]
```

`json` (default) prints the `DocJson` object, exactly like earlier releases.
`markdown` and `html` come from `GET /documents/:id/export`.

```sh
mdocs export DOCUMENT_ID > document.json
mdocs export DOCUMENT_ID --format markdown --output notes.md
mdocs export DOCUMENT_ID --format html | less
```

#### mdocs import

```
mdocs import FILE [--title TITLE] [--parent ID]
```

`.md` and `.markdown` are converted by `POST /documents/import`; `.json` is treated as Tiptap
JSON. `-` reads stdin and sniffs the format.

```sh
mdocs import notes.md
mdocs import document.json --title "Imported"
cat notes.md | mdocs import -
```

#### mdocs update

```
mdocs update ID --expected-version N [--title TITLE] [--parent ID] [--input FILE|-]
```

`--expected-version` enables optimistic concurrency. A stale version returns HTTP 409
`VERSION_CONFLICT` and exit code 5: read the latest document, review the change, and retry.

```sh
mdocs update DOCUMENT_ID --expected-version 3 --title "Renamed"
mdocs read DOCUMENT_ID --output doc.json
mdocs update DOCUMENT_ID --expected-version 3 --input doc.json
```

#### mdocs duplicate

```
mdocs duplicate ID [--title TITLE] [--parent ID]
```

Copies a document; the default title is `"<title> (copy)"`.

#### mdocs trash and mdocs delete

```
mdocs trash ID
mdocs delete ID
```

Moves a document to the trash (owners only). `delete` is an alias.

#### mdocs restore

```
mdocs restore ID
```

Restores a trashed document.

#### mdocs purge

```
mdocs purge ID --yes
```

Permanently deletes a trashed document. Without `--yes` the command refuses with exit code 2.

#### mdocs favorite

```
mdocs favorite ID --on|--off
```

Adds or removes the document from the caller favourites.

### Comments

```
mdocs comments list ID
mdocs comments add ID --body TEXT [--parent COMMENT_ID]
mdocs comments resolve ID COMMENT_ID
mdocs comments reopen ID COMMENT_ID
```

```sh
mdocs comments add DOCUMENT_ID --body "Can we split this section?"
mdocs comments resolve DOCUMENT_ID COMMENT_ID
```

### Versions

```
mdocs versions list ID
mdocs versions show ID VERSION_ID
mdocs versions restore ID VERSION_ID --expected-version N
```

`versions show` prints the metadata plus the stored `DocJson`; `versions restore` is an
optimistic-concurrency write and returns exit code 5 on a conflict.

### Sharing

```
mdocs share list ID
mdocs share grant ID --user UUID --role viewer|editor|owner
mdocs share revoke ID --user UUID
mdocs share restrict ID --on|--off
```

`share list` prints the `restricted` flag and the explicit permissions.
Granting a role turns `restricted` on. Because `PUT /documents/:id/acl` requires a `userId`,
`share restrict` re-sends the caller owner role together with the new `restricted` value.

### Workspace

| Command | Description |
| --- | --- |
| `mdocs members` | List workspace members. |
| `mdocs invite EMAIL [--role member|admin]` | Create a one-time invite (administrators). Prints the invite token and expiry. |
| `mdocs templates` | List built-in templates (blank, meeting-notes, weekly-report, project-plan, product-spec, release-notes). |
| `mdocs stats` | Workspace counters (documents, folders, members, open comments, trash, versions). |
| `mdocs activity ID [--limit N]` | Activity log of a document (view, edit, restore). |
| `mdocs upload FILE` | Upload a file and print its absolute URL. |

Uploads send the raw body to `PUT /uploads` with a content type derived from the extension
(`.png`, `.jpg`/`.jpeg`, `.gif`, `.webp`, `.pdf`; anything else is
`application/octet-stream`) and `X-File-Name`. Files are limited to 20 MB.

```sh
URL=$(mdocs upload diagram.png)
```

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success. |
| 1 | Unexpected failure (for example an unreadable config file). |
| 2 | Usage error: unknown command or option, missing value, invalid argument. |
| 3 | Network or server failure, including timeouts and 5xx responses. |
| 4 | Authentication or permission failure (401, 403). |
| 5 | Version conflict: `--expected-version` did not match the stored document. |
| 6 | Not found: document, folder, version, comment, template, or upload. |

The CLI never retries writes. Each request uses an `AbortSignal` timeout (20 s for API calls,
120 s for uploads) and reports a single, readable failure.

## CI usage

```sh
export MDOCS_SERVER=https://docs.example.com
export MDOCS_TOKEN="$MDOCS_JWT"
mdocs list --json | jq -r '.data.documents[].id'
mdocs create --title "Release $CI_COMMIT_TAG" --template release-notes --json
mdocs export "$DOC_ID" --format markdown --output CHANGELOG.md
```

No config file is needed when `MDOCS_SERVER` and `MDOCS_TOKEN` are set. Add `--json` for stable
payloads and rely on exit codes instead of parsing messages. Tokens expire after 12 hours;
mint a new one with `mdocs login` or the API.

## stdin and stdout conventions

- `--input -`, `--markdown -`, and `import -` read stdin; the CLI refuses to block when stdin is a TTY.
- `--output -` or an omitted `--output` writes to stdout.
- Data goes to stdout; diagnostics, warnings, and errors go to stderr.
- `--json` envelopes are pretty-printed with two spaces and a trailing newline.

## Troubleshooting

```sh
mdocs doctor              # server, token, version
mdocs whoami              # active profile and user
mdocs doctor --json       # same checks for scripts
```

- `exit 5` - the document changed: `mdocs read ID`, review, then retry with the current version.
- `exit 4` - the token expired or the account lacks the required role.
- `exit 3` - the server is unreachable, timed out, or returned 5xx.
- `Unknown profile` - run `mdocs logout --profile NAME` or `mdocs login --profile NAME ...`.
- The advisory update check runs at most once every 24 hours and never fails a command.
