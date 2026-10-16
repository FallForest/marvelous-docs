# mdocs CLI

`mdocs` talks to the versioned REST API. Build it from the repository root:

```sh
pnpm --filter @marvelous-docs/cli build
pnpm cli -- --help
```

Log in once; the CLI stores the server URL and token under the platform config directory (`%APPDATA%/mdocs` on Windows, `$XDG_CONFIG_HOME/mdocs` or `~/.config/mdocs` on Linux/macOS):

```sh
pnpm cli -- login --server https://docs.example.com --email you@example.com
```

Provide the password with `MDOCS_PASSWORD` or `--password`. Then use:

```sh
pnpm cli -- list
pnpm cli -- create --title "Project notes"
pnpm cli -- read DOCUMENT_ID
pnpm cli -- export DOCUMENT_ID --output document.json
pnpm cli -- update DOCUMENT_ID --expected-version 3 --input document.json
```

`--input -` reads JSON from stdin. `--output -` or omitting `--output` writes JSON to stdout. Document content uses `{ "schemaVersion": 1, "doc": { "type": "doc", "content": [] } }`. Updates require the version returned by `read` or `list`; HTTP 409 means another write happened, so read the latest document and review the changes before retrying.

Set `MDOCS_SERVER` and `MDOCS_TOKEN` to override saved configuration in automation. `MDOCS_CONFIG_DIR` changes the config directory. The CLI returns a nonzero exit code for authentication, network, validation, and version conflicts.
