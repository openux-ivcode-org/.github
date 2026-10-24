const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const YAML = require("yaml");
const { inlineProjectResources } = require("../cli");
const { OPENUX_VERSION, validateProject } = require("../project");
const validation = require("../validation");

const cliPath = path.join(__dirname, "..", "cli.js");
const validSpec = [
  "# Layout behavior",
  "",
  "## Purpose",
  "Describe the behavior of the layout asset.",
  "",
  "## Requirements",
  "",
  "### Requirement: Place content",
  "The layout SHALL display child content in its declared content slot.",
  "",
  "#### Scenario: Content is present",
  "- **GIVEN** child content is assigned to the slot",
  "- **WHEN** the layout is rendered",
  "- **THEN** the content appears in the content area.",
  ""
].join("\n");

async function createProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openux-project-test-"));
  const files = {
    "project.yml": [
      "name: Test project",
      `openux: "${OPENUX_VERSION}"`,
      "screens:",
      "  - id: home",
      "    file: screens/home.yml",
      "assets:",
      "  - id: layout",
      "    directory: assets/layout",
      "  - id: unused",
      "    directory: assets/unused",
      "theme: theme/theme.yml",
      ""
    ].join("\n"),
    "screens/home.yml": [
      "name: Home",
      "description: Test screen",
      "assets:",
      "  - asset-template: layout",
      "    spec: specs/layout-behavior.md",
      "    slots:",
      "      content: []",
      ""
    ].join("\n"),
    "assets/layout/asset.yml": [
      "id: layout",
      "name: Layout",
      "description: Root layout",
      "render:",
      "  source: asset.html",
      "slots:",
      "  - id: content",
      ""
    ].join("\n"),
    "assets/layout/asset.html": "<main><div data-openux-slot=\"content\"></div></main>\n",
    "assets/unused/asset.yml": [
      "id: unused",
      "name: Unused",
      "description: Reusable asset",
      "render:",
      "  source: asset.html",
      ""
    ].join("\n"),
    "assets/unused/asset.html": "<button>Unused</button>\n",
    "theme/theme.yml": [
      "name: Test theme",
      "styles: theme.css",
      "colors:",
      "  background: '#ffffff'",
      ""
    ].join("\n"),
    "theme/theme.css": ":root { color-scheme: light; }\n",
    "specs/layout-behavior.md": validSpec
  };
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, ...relativePath.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  return root;
}

test("validates a complete OpenUX project and its asset bundle", async () => {
  const root = await createProject();
  try {
    const result = await validateProject(root);
    assert.deepEqual(result.errors, []);
    assert.equal(result.usedAssetIds.has("layout"), true);
    assert.equal(result.usedAssetIds.has("unused"), false);
    assert.deepEqual([...result.referencedSpecPaths], ["specs/layout-behavior.md"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("allows a Screen to remain empty while being built", async () => {
  const root = await createProject();
  try {
    const screenPath = path.join(root, "screens", "home.yml");
    const screen = YAML.parse(await fs.readFile(screenPath, "utf8"));
    screen.assets = [];
    await fs.writeFile(screenPath, YAML.stringify(screen));

    const result = await validateProject(root);
    assert.deepEqual(result.errors, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("validates preview states and per-instance visibility", async () => {
  const root = await createProject();
  try {
    const screenPath = path.join(root, "screens", "home.yml");
    const screen = YAML.parse(await fs.readFile(screenPath, "utf8"));
    screen["preview-states"] = [
      { id: "default", name: "Page" },
      { id: "dialog-open", name: "Dialog open" }
    ];
    screen.assets[0].slots.content = [{
      "asset-template": "unused",
      name: "Dialog",
      visibility: { default: false, "dialog-open": true }
    }];
    await fs.writeFile(screenPath, YAML.stringify(screen));

    let result = await validateProject(root);
    assert.deepEqual(result.errors, []);

    const unknownState = spawnSync(process.execPath, [
      cliPath,
      "render",
      "home",
      "--format",
      "html",
      "--state",
      "missing-state",
      "--project",
      root
    ], { encoding: "utf8" });
    assert.equal(unknownState.status, 1);
    assert.match(unknownState.stderr, /Unknown preview state "missing-state".*default, dialog-open/);

    screen.assets[0].slots.content[0].visibility = {
      default: false,
      "missing-state": true,
      "dialog-open": "true"
    };
    await fs.writeFile(screenPath, YAML.stringify(screen));
    result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes('unknown preview state "missing-state"')));
    assert.ok(result.errors.some((error) => error.includes('visibility for preview state "dialog-open" must be a boolean')));

    screen.assets[0].visibility = { default: false };
    await fs.writeFile(screenPath, YAML.stringify(screen));
    result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes("root layout cannot have state-specific visibility")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("validates asset-instance behavior spec paths and referenced files", async () => {
  const root = await createProject();
  try {
    const screenPath = path.join(root, "screens", "home.yml");
    const screen = YAML.parse(await fs.readFile(screenPath, "utf8"));

    screen.assets[0].spec = ["specs/layout-behavior.md"];
    await fs.writeFile(screenPath, YAML.stringify(screen));
    let result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes("Behavior spec path must be")));

    screen.assets[0].spec = "specs/missing.md";
    await fs.writeFile(screenPath, YAML.stringify(screen));
    result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes('Behavior spec "specs/missing.md"')));

    screen.assets[0].spec = "notes.md";
    await fs.writeFile(screenPath, YAML.stringify(screen));
    result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes("specs/<name>.md")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rejects behavior specs on Screen files and asset templates", async () => {
  const root = await createProject();
  try {
    const assetPath = path.join(root, "assets", "layout", "asset.yml");
    const asset = YAML.parse(await fs.readFile(assetPath, "utf8"));
    asset.spec = "specs/template-behavior.md";
    await fs.writeFile(assetPath, YAML.stringify(asset));
    let result = await validateProject(root);
    assert.ok(result.errors.some((error) =>
      error.includes("behavior specs cannot be attached to asset templates")
    ));

    delete asset.spec;
    await fs.writeFile(assetPath, YAML.stringify(asset));
    const screenPath = path.join(root, "screens", "home.yml");
    const screen = YAML.parse(await fs.readFile(screenPath, "utf8"));
    screen.spec = "specs/screen-behavior.md";
    await fs.writeFile(screenPath, YAML.stringify(screen));
    result = await validateProject(root);
    assert.ok(result.errors.some((error) =>
      error.includes("Screen-level behavior specs are not supported")
    ));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("validates an optional project-level behavior spec", async () => {
  const root = await createProject();
  try {
    const manifestPath = path.join(root, "project.yml");
    const manifest = YAML.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.spec = "specs/project-behavior.md";
    await fs.writeFile(manifestPath, YAML.stringify(manifest));
    await fs.writeFile(path.join(root, "specs", "project-behavior.md"), validSpec);

    let result = await validateProject(root);
    assert.deepEqual(result.errors, []);
    assert.equal(result.referencedSpecPaths.has("specs/project-behavior.md"), true);

    manifest.spec = ["specs/project-behavior.md"];
    await fs.writeFile(manifestPath, YAML.stringify(manifest));
    result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes("project.yml spec")));
    assert.ok(result.errors.some((error) => error.includes("Behavior spec path must be")));

    manifest.spec = "project.md";
    await fs.writeFile(manifestPath, YAML.stringify(manifest));
    result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes("project.yml spec")));

    manifest.spec = "specs/missing-project-spec.md";
    await fs.writeFile(manifestPath, YAML.stringify(manifest));
    result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes('Behavior spec "specs/missing-project-spec.md"')));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("validates page-specific asset organization and usage", async () => {
  const root = await createProject();
  try {
    const manifestPath = path.join(root, "project.yml");
    const manifest = YAML.parse(await fs.readFile(manifestPath, "utf8"));
    const localAsset = manifest.assets.find((entry) => entry.id === "unused");
    localAsset.screen = "home";
    manifest.screens.push({ id: "settings", file: "screens/settings.yml" });
    await fs.writeFile(manifestPath, YAML.stringify(manifest));

    const homePath = path.join(root, "screens", "home.yml");
    const home = YAML.parse(await fs.readFile(homePath, "utf8"));
    home.assets[0].slots.content.push({ "asset-template": "unused" });
    await fs.writeFile(homePath, YAML.stringify(home));

    const settings = {
      name: "Settings",
      description: "Settings screen",
      assets: [{
        "asset-template": "layout",
        slots: { content: [] }
      }]
    };
    const settingsPath = path.join(root, "screens", "settings.yml");
    await fs.writeFile(settingsPath, YAML.stringify(settings));

    let result = await validateProject(root);
    assert.deepEqual(result.errors, []);

    settings.assets[0].slots.content.push({ "asset-template": "unused" });
    await fs.writeFile(settingsPath, YAML.stringify(settings));
    result = await validateProject(root);
    assert.ok(result.errors.some((error) =>
      error.includes('asset "unused" belongs to Screen "home" and cannot be used on Screen "settings"')
    ));

    settings.assets[0].slots.content.pop();
    manifest.assets.push({
      id: "settings-unused",
      directory: "assets/settings-unused",
      screen: "settings",
      "copied-from": "unused"
    });
    await fs.mkdir(path.join(root, "assets", "settings-unused"));
    await fs.writeFile(
      path.join(root, "assets", "settings-unused", "asset.yml"),
      (await fs.readFile(path.join(root, "assets", "unused", "asset.yml"), "utf8"))
        .replace(/^id: unused$/m, "id: settings-unused")
    );
    await fs.copyFile(
      path.join(root, "assets", "unused", "asset.html"),
      path.join(root, "assets", "settings-unused", "asset.html")
    );
    settings.assets[0].slots.content.push({ "asset-template": "settings-unused" });
    await fs.writeFile(settingsPath, YAML.stringify(settings));
    await fs.writeFile(manifestPath, YAML.stringify(manifest));
    result = await validateProject(root);
    assert.deepEqual(result.errors, []);

    localAsset.screen = "missing";
    await fs.writeFile(manifestPath, YAML.stringify(manifest));
    result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes('references unknown Screen "missing"')));

    localAsset.screen = "home";
    await fs.writeFile(manifestPath, YAML.stringify(manifest));
    result = await validateProject(root);
    assert.deepEqual(result.errors, []);

    home.assets[0].slots.content = home.assets[0].slots.content.filter(
      (instance) => instance["asset-template"] !== "unused"
    );
    manifest.assets = manifest.assets.filter((entry) => entry.id !== "unused");
    await fs.writeFile(homePath, YAML.stringify(home));
    await fs.writeFile(manifestPath, YAML.stringify(manifest));
    await fs.rm(path.join(root, "assets", "unused"), { recursive: true, force: true });
    result = await validateProject(root);
    assert.deepEqual(result.errors, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("validates OpenSpec behavior spec requirements and scenarios", async () => {
  assert.equal(validation.validateSpecContent(validSpec), true);
  assert.throws(
    () => validation.validateSpecContent(validSpec.replace("The layout SHALL", "The layout")),
    /normative SHALL, MUST, SHOULD, or MAY statement/
  );
  assert.throws(
    () => validation.validateSpecContent(validSpec.replace("- **THEN**", "- THEN")),
    /include "- \*\*WHEN\*\* \.\.\." and "- \*\*THEN\*\* \.\.\." steps/
  );

  const root = await createProject();
  try {
    const specPath = path.join(root, "specs", "layout-behavior.md");
    await fs.writeFile(specPath, validSpec.replace("## Requirements", "## Behavior"));
    const result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes('"## Requirements"')));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rejects legacy project Workflows and instance interactions", async () => {
  const root = await createProject();
  try {
    const manifestPath = path.join(root, "project.yml");
    const manifest = YAML.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.workflows = [];
    await fs.writeFile(manifestPath, YAML.stringify(manifest));
    let result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes("workflows are no longer supported")));

    delete manifest.workflows;
    await fs.writeFile(manifestPath, YAML.stringify(manifest));
    const screenPath = path.join(root, "screens", "home.yml");
    const screen = YAML.parse(await fs.readFile(screenPath, "utf8"));
    screen.assets[0].interactions = [];
    await fs.writeFile(screenPath, YAML.stringify(screen));
    result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes("interactions are no longer supported")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("init creates a valid starter project", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openux-init-test-"));
  try {
    const initialized = spawnSync(process.execPath, [cliPath, "init", "--project", root], {
      encoding: "utf8"
    });
    assert.equal(initialized.status, 0, initialized.stderr);
    assert.match(initialized.stdout, /Created OpenUX starter project/);
    const projectRoot = path.join(root, "openux");
    const result = await validateProject(projectRoot);
    assert.deepEqual(result.errors, []);
    assert.equal(result.project.openux, OPENUX_VERSION);
    assert.deepEqual(result.project.screens.map((screen) => screen.id), ["home"]);
    assert.equal(result.assets.has("page-layout"), true);
    const html = await fs.readFile(path.join(projectRoot, "assets", "page-layout", "asset.html"), "utf8");
    assert.match(html, /data-openux-slot="content"/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("version and schema reference commands expose the installed format guidance", () => {
  const version = spawnSync(process.execPath, [cliPath, "version"], { encoding: "utf8" });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), OPENUX_VERSION);

  const reference = spawnSync(process.execPath, [cliPath, "schema", "reference"], { encoding: "utf8" });
  assert.equal(reference.status, 0, reference.stderr);
  assert.match(reference.stdout, /every actionable UI element must have a behavior spec/i);
  assert.match(reference.stdout, /set `screen: <screen-id>`/);
});

test("project validation requires the supported OpenUX version", async () => {
  const root = await createProject();
  try {
    const projectPath = path.join(root, "project.yml");
    const projectSource = await fs.readFile(projectPath, "utf8");
    await fs.writeFile(projectPath, projectSource.replace(`openux: "${OPENUX_VERSION}"\n`, ""));
    let result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes("openux must specify the OpenUX version")));

    await fs.writeFile(projectPath, projectSource.replace(OPENUX_VERSION, "99.0.0"));
    result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes(`expected "${OPENUX_VERSION}"`)));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("init refuses to overwrite existing project files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openux-init-test-"));
  try {
    const projectDirectory = path.join(root, "openux");
    await fs.mkdir(projectDirectory);
    const manifestPath = path.join(projectDirectory, "project.yml");
    const originalManifest = "name: Existing project\n";
    await fs.writeFile(manifestPath, originalManifest);

    const initialized = spawnSync(process.execPath, [cliPath, "init", "--project", root], {
      encoding: "utf8"
    });
    assert.equal(initialized.status, 1);
    assert.match(initialized.stderr, /Cannot initialize OpenUX because these files already exist/);
    assert.equal(await fs.readFile(manifestPath, "utf8"), originalManifest);
    await assert.rejects(fs.access(path.join(projectDirectory, "theme", "theme.yml")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("reports broken Screen asset references", async () => {
  const root = await createProject();
  try {
    await fs.writeFile(path.join(root, "screens", "home.yml"), [
      "name: Home",
      "description: Test screen",
      "assets:",
      "  - asset-template: missing",
      ""
    ].join("\n"));
    const result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes('references unknown asset "missing"')));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("reports missing files referenced by asset markup", async () => {
  const root = await createProject();
  try {
    await fs.writeFile(
      path.join(root, "assets", "unused", "asset.html"),
      '<img src="images/missing.png">\n'
    );
    const result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes('resource "images/missing.png"')));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("validates URL-encoded local asset references", async () => {
  const root = await createProject();
  try {
    const imageDirectory = path.join(root, "assets", "unused", "images");
    await fs.mkdir(imageDirectory);
    await fs.writeFile(path.join(imageDirectory, "preview image.png"), Buffer.from("image"));
    await fs.writeFile(
      path.join(root, "assets", "unused", "asset.html"),
      '<img src="images/preview%20image.png">\n'
    );
    const result = await validateProject(root);
    assert.deepEqual(result.errors, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("reports missing files referenced by the Theme stylesheet", async () => {
  const root = await createProject();
  try {
    await fs.writeFile(
      path.join(root, "theme", "theme.css"),
      "body { background-image: url('./images/missing.png'); }\n"
    );
    const result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes('resource "./images/missing.png"')));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("allows fragment and data-image references in asset markup and CSS", async () => {
  const root = await createProject();
  try {
    await fs.writeFile(
      path.join(root, "assets", "unused", "asset.html"),
      '<a href="#section"><img src="data:image/png;base64,AAAA"></a>\n'
    );
    await fs.writeFile(
      path.join(root, "theme", "theme.css"),
      "body { background-image: url('#pattern'), url('data:image/png;base64,AAAA'); }\n"
    );
    const result = await validateProject(root);
    assert.deepEqual(result.errors, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("embeds local project files in rendered HTML output", async () => {
  const root = await createProject();
  try {
    const imagePath = path.join(root, "assets", "unused", "preview.png");
    const image = Buffer.from("test image");
    await fs.writeFile(imagePath, image);
    const html = await inlineProjectResources(
      '<img src="http://127.0.0.1:3210/openux/assets/unused/preview.png">',
      "http://127.0.0.1:3210",
      root
    );
    assert.equal(
      html,
      `<img src="data:image/png;base64,${image.toString("base64")}">`
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Sign In is a visual-only page without interactive form controls", async () => {
  const projectRoot = path.join(__dirname, "..", "openux");
  const manifest = YAML.parse(await fs.readFile(path.join(projectRoot, "project.yml"), "utf8"));
  const screen = YAML.parse(await fs.readFile(path.join(projectRoot, "screens", "sign-in.yml"), "utf8"));
  const signInAssets = manifest.assets.filter((asset) => asset.id.startsWith("sign-in"));
  const layout = screen.assets[0];
  assert.equal(layout["asset-template"], "sign-in-layout");
  assert.deepEqual(
    layout.slots.brand.map((instance) => instance["asset-template"]),
    ["sign-in-brand", "sign-in-story", "sign-in-snapshot", "sign-in-trust"]
  );
  assert.deepEqual(
    layout.slots.content.map((instance) => instance["asset-template"]),
    [
      "sign-in-heading",
      "sign-in-field-visual",
      "sign-in-field-visual",
      "sign-in-options-visual",
      "sign-in-action-visual",
      "sign-in-divider",
      "sign-in-action-visual",
      "sign-in-disclaimer"
    ]
  );
  assert.ok(signInAssets.length > 1, "Sign-in page should use individually selectable assets.");
  for (const asset of signInAssets) {
    const source = await fs.readFile(path.join(projectRoot, asset.directory, "asset.html"), "utf8");
    assert.doesNotMatch(source, /<\s*(?:input|button|textarea|select|form)\b/i);
  }
});

test("prune reports candidates without deleting and removes only with --apply", async () => {
  const root = await createProject();
  try {
    const manifestPath = path.join(root, "project.yml");
    const originalManifest = await fs.readFile(manifestPath, "utf8");
    const report = spawnSync(process.execPath, [cliPath, "prune", "--project", root], {
      encoding: "utf8"
    });
    assert.equal(report.status, 0, report.stderr);
    assert.match(report.stdout, /asset unused/);
    assert.equal(await fs.readFile(manifestPath, "utf8"), originalManifest);
    await fs.access(path.join(root, "assets", "unused", "asset.yml"));

    const applied = spawnSync(process.execPath, [cliPath, "prune", "--apply", "--project", root], {
      encoding: "utf8"
    });
    assert.equal(applied.status, 0, applied.stderr);
    const manifest = YAML.parse(await fs.readFile(manifestPath, "utf8"));
    assert.deepEqual(manifest.assets.map((asset) => asset.id), ["layout"]);
    await assert.rejects(fs.access(path.join(root, "assets", "unused")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
