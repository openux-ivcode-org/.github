---
name: openux
description: Create, inspect, and update OpenUX projects using the version-matched OpenUX CLI reference. Use when asked to build or revise OpenUX Screens, assets, Themes, behavior specs, or project files.
---

# OpenUX

OpenUX is a versioned, file-based standard for describing application Screens, reusable or Screen-specific asset templates, Themes, and intended UI behavior. An OpenUX project is identified by its `project.yml`; the project-local `openux` CLI initializes, explains, validates, and renders those files. Always work with the CLI version that supports the project's declared OpenUX format version.

## Set up OpenUX

Keep the CLI and skill project-local, not global, so different projects on one machine can use different OpenUX versions.

1. Identify the user's intended workspace. Look for `project.yml` in the current directory, its parents, and an `openux/` subdirectory. If more than one exists, select the one the user is asking about.
2. Check whether the OpenUX CLI is installed in the workspace's npm dependencies and whether that installed CLI is usable:

   ```sh
   npm ls openux-editor --depth=0
   npx --no-install openux version
   ```

   The second command prints the OpenUX format version supported by the installed CLI. A successful check does not by itself prove compatibility; compare it with the project's `openux` value in the next step.
3. If `project.yml` exists, read its `openux` value. This is the required format version. If the version is missing or unreadable, stop and ask the user; never change it just to fit an installed CLI. If the local CLI is missing or its supported format version does not match, install the CLI for the project's version before continuing.
4. Development mode currently provides only `0.1.0-SNAPSHOT`. For an existing project with that version and no matching local CLI, install the development build from the host workspace root (the directory whose `package.json` should own the dependency, not necessarily the directory containing `openux/project.yml`):

   ```sh
   npm install --save-dev git+https://github.com/openux-ivcode-org/.github.git#feature/editor-asset-add-flow
   ```

   This installs the latest commit on the development branch and records the exact resolved dependency in the workspace lockfile. Then rerun both checks in step 2 and confirm the CLI reports `0.1.0-SNAPSHOT`. No other OpenUX format versions are available in development mode yet; if an existing project declares another version, do not install a mismatched CLI or alter the project. Tell the user that version is unavailable and ask how they want to proceed.
5. If no `project.yml` exists, install the latest available OpenUX development build using the same command, then initialize a starter project in the intended workspace:

   ```sh
   npx openux init
   ```

   Initialization creates `openux/project.yml` with the format version supported by the installed CLI. Do not run `init` when a project already exists.
6. Once the local CLI version matches the project's version—or after initializing a new project—start here before authoring:

   ```sh
   npx openux schema reference
   ```


Run all OpenUX commands with `npx openux <command>` so they use the workspace-local CLI. Never silently fall back to a global or mismatched version.
