const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const YAML = require("yaml");
const { inlineProjectResources } = require("../cli");
const { validateProject } = require("../project");

const cliPath = path.join(__dirname, "..", "cli.js");

async function createProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openux-project-test-"));
  const files = {
    "project.yml": [
      "name: Test project",
      "screens:",
      "  - id: home",
      "    file: screens/home.yml",
      "assets:",
      "  - id: layout",
      "    directory: assets/layout",
      "  - id: unused",
      "    directory: assets/unused",
      "theme: theme/theme.yml",
      "workflows:",
      "  - id: orphan",
      "    file: workflows/orphan.yml",
      ""
    ].join("\n"),
    "screens/home.yml": [
      "name: Home",
      "description: Test screen",
      "assets:",
      "  - asset-template: layout",
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
    "workflows/orphan.yml": [
      "id: orphan",
      "name: Unused workflow",
      "entry: begin",
      "steps:",
      "  - id: begin",
      "    transitions:",
      "      - when: completed",
      "        result: Done",
      ""
    ].join("\n")
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
    assert.match(report.stdout, /workflow orphan/);
    assert.equal(await fs.readFile(manifestPath, "utf8"), originalManifest);
    await fs.access(path.join(root, "assets", "unused", "asset.yml"));

    const applied = spawnSync(process.execPath, [cliPath, "prune", "--apply", "--project", root], {
      encoding: "utf8"
    });
    assert.equal(applied.status, 0, applied.stderr);
    const manifest = YAML.parse(await fs.readFile(manifestPath, "utf8"));
    assert.deepEqual(manifest.assets.map((asset) => asset.id), ["layout"]);
    assert.deepEqual(manifest.workflows, []);
    await assert.rejects(fs.access(path.join(root, "assets", "unused")));
    await assert.rejects(fs.access(path.join(root, "workflows", "orphan.yml")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
