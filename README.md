# OpenUX

The OpenUX Standard.

The `schema/` directory contains the OpenUX artifact schemas and authoring guidance. Other project documentation lives in `doc/`. The Node.js server and browser editor are at the repository root, and the editor's sample OpenUX project is in `openux/`. Run `npm install` once, then `npm start` to launch the local editor at `http://127.0.0.1:3000/`.

## Install

Install the CLI package from the current development branch, then install the OpenUX authoring skill from that same branch:

```sh
npm install git+https://github.com/openux-ivcode-org/.github.git#feature/editor-asset-add-flow
npx skills add https://raw.githubusercontent.com/openux-ivcode-org/.github/feature/editor-asset-add-flow/skills/openux/SKILL.md
```

Both commands install project-locally: npm records the CLI dependency in the current project's `package.json`, and the skill installer adds the skill to the current project for your detected coding agent. For GitHub Copilot, the skill is installed under `.agents/skills/openux/`. The direct `SKILL.md` URL avoids ambiguity with the slash in the branch name. This lets different projects use different OpenUX versions. Run the CLI with `npx openux <command>`.

See [Editor Requirements](doc/editor.md) for the current editor behavior and prototype status.

See the [CLI documentation](doc/cli.md) for the commands and AI-assisted project workflow.
