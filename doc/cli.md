# OpenUX CLI

**Status:** Implemented prototype.

The OpenUX CLI helps people and AI agents inspect and validate an OpenUX project while using the browser editor. Artifact authoring guidance is available under `schema/` and through `openux schema`. It is not a second file-editing layer: edit project files directly, then use the CLI to check the project, inspect a rendered Screen, and refresh the editor.

Run the commands as `openux ...` when the package's `bin` entry is available, or from this repository with `npm run openux -- ...` (or `node cli.js ...`). Commands that operate on a project discover `project.yml` in the current directory or a parent directory, including an `openux/` subdirectory. Use `--project <directory>` to select a different project.

## Commands

| Command | Purpose |
| --- | --- |
| `openux server start [--port <port>] [--project <directory>]` | Start the local editor server in the foreground. The command blocks until interrupted. Defaults to port `3000` (or `OPENUX_PORT` / `PORT`) and binds to `127.0.0.1`. |
| `openux server status [--port <port>]` | Check whether the editor server is reachable and print JSON with its URL, connected browser count, and selection availability. |
| `openux server selected [--port <port>]` | Print JSON containing the current browser-editor selection and the time it was last updated. |
| `openux server update [--port <port>]` | Notify connected browser tabs after project files have changed. Tabs without unsaved edits refresh; tabs with unsaved edits are left untouched and prompted to save or reset before refreshing. |
| `openux init [--project <directory>]` | Create a starter project under `<directory>/openux` (defaults to the current directory). Refuses to overwrite any generated file that already exists. |
| `openux validate [--project <directory>]` | Validate project resources, asset bundles, local file references, and references between resources. |
| `openux schema [project\|screen\|asset\|theme\|spec]` | Print Markdown authoring guidance. Without a type, print all supported guidance. |
| `openux render <screen> --format <html\|image> [--output <file>] [--project <directory>]` | Render a Screen by ID as HTML or a full-page image. |
| `openux prune [--apply] [--project <directory>]` | Report unused assets. No files are removed unless `--apply` is supplied. |

`--port` selects the local server port for `server` commands. The status, selection, and update commands default to port `3000` or the `OPENUX_PORT` / `PORT` environment setting.

## Initialization

Run `openux init` from the working directory where the `openux/` project folder should be created. Use `--project <directory>` to choose another working directory:

```sh
openux init
openux validate
openux server start
```

The command creates `project.yml`, a `home` Screen, a `page-layout` asset with a `content` slot, and a default Theme. It does not overwrite existing files; if any generated path already exists, initialization stops with an error.

## Rendering

Rendering validates the project before opening the Screen. A Chromium-based browser must be installed; set `OPENUX_BROWSER` to its executable path to choose a specific browser.

HTML is written to standard output unless `--output <file>` is given. Local project resources used by the rendered markup are embedded in the HTML output. Image rendering captures the full Screen height as a PNG file and requires `--output`:

```sh
openux render sign-in --format html --output sign-in.html
openux render sign-in --format image --output sign-in.png
```

## Pruning

Pruning is non-destructive by default: `openux prune` reports candidates without removing them. Applying the cleanup requires `--apply`. An asset is a candidate only when no Screen instance uses it, including instances nested in asset slots. Applying prune removes the candidate asset directory and its entry in `project.yml`. A project-wide behavior spec may be linked from `project.yml`; instance-specific specs are linked from Screen asset instances.

## Intended workflow

1. Start the editor with `openux server start` and check it with `openux server status`.
2. Use `openux server selected` to get context about the item selected in the browser editor.
3. Read the relevant authoring guidance with `openux schema [type]`.
4. Edit project files directly.
5. Run `openux validate` to catch malformed files and project-level issues.
6. Run `openux render <screen> --format image --output <file>` to inspect the rendered result.
7. Run `openux server update` to refresh the browser editor after making changes.
