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
  "# Call to action",
  "",
  "## Purpose",
  "Describe the behavior of this Element.",
  "",
  "## Requirements",
  "",
  "### Requirement: Continue the flow",
  "The Element SHALL continue the sign-in flow when activated.",
  "",
  "#### Scenario: User activates the Element",
  "- **WHEN** the user activates the Element",
  "- **THEN** the next step is displayed.",
  "- **SHOW** dialog-open",
  ""
].join("\n");
const validElementSpec = `---\nelement-id: continue-button\n---\n\n${validSpec}`;

function assetDocument(data, body) {
  return validation.formatAssetDocument(YAML.stringify(data), body);
}

async function createProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openux-project-test-"));
  const files = {
    "project.yml": YAML.stringify({
      name: "Test project",
      openux: OPENUX_VERSION,
      screens: [{ id: "home", file: "screens/home/screen.yml" }],
      theme: "theme/theme.yml"
    }),
    "screens/home/screen.yml": YAML.stringify({
      name: "Home",
      description: "Test screen",
      "preview-states": [
        { id: "default", name: "Default" },
        { id: "dialog-open", name: "Dialog open", description: "Show the dialog." }
      ],
      elements: [
        { id: "page-title", type: "text", tag: "h1", content: "Welcome" },
        { id: "brand-mark", type: "image", src: "assets/brand.png", alt: "Brand" },
        {
          id: "page-layout",
          type: "template",
          src: "screens/home/assets/layout.html",
          slots: {
            content: [{
              id: "continue-button",
              type: "template",
              src: "assets/button.html",
              attributes: { label: "Continue" },
              visibility: { default: false, "dialog-open": true }
            }]
          }
        }
      ]
    }),
    "assets/brand.png": Buffer.from("image"),
    "assets/button.html": assetDocument({
      id: "button",
      name: "Button",
      description: "A button template.",
      attributes: {
        label: { type: "string", default: "Continue", overridable: true }
      }
    }, "<button>${attributes.label}</button>\n"),
    "screens/home/assets/layout.html": assetDocument({
      id: "layout",
      name: "Layout",
      description: "A layout with a content slot.",
      slots: [{ id: "content", name: "Content" }]
    }, "<main><div data-openux-slot=\"content\"></div></main>\n"),
    "screens/home/assets/unused.html": assetDocument({
      id: "unused",
      name: "Unused",
      description: "Unused template asset."
    }, "<div>Unused</div>\n"),
    "screens/home/assets/images/chart.png": Buffer.from("chart"),
    "theme/theme.yml": YAML.stringify({
      name: "Test theme",
      styles: "theme.css",
      colors: { background: "#ffffff" }
    }),
    "theme/theme.css": ":root { color-scheme: light; }\n",
    "screens/home/specs/element-continue-button.md": validElementSpec
  };
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, ...relativePath.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  return root;
}

test("discovers Assets and validates text, image, and template Elements", async () => {
  const root = await createProject();
  try {
    const result = await validateProject(root);
    assert.deepEqual(result.errors, []);
    assert.equal(result.assets.get("assets/button.html").type, "template");
    assert.equal(result.assets.get("assets/brand.png").type, "image");
    assert.equal(result.assets.get("screens/home/assets/layout.html").type, "template");
    assert.equal(result.usedAssetFiles.has("assets/button.html"), true);
    assert.equal(result.usedAssetFiles.has("assets/brand.png"), true);
    assert.equal(result.usedAssetFiles.has("screens/home/assets/layout.html"), true);
    assert.equal(result.usedAssetFiles.has("screens/home/assets/unused.html"), false);
    assert.equal(result.usedAssetFiles.has("screens/home/assets/images/chart.png"), false);
    assert.deepEqual([...result.referencedSpecPaths], ["screens/home/specs/element-continue-button.md"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("rejects manifest Asset registries and invalid Screen Element references", async () => {
  const root = await createProject();
  try {
    const manifestPath = path.join(root, "project.yml");
    const manifest = YAML.parse(await fs.readFile(manifestPath, "utf8"));
    manifest["asset-templates"] = [];
    await fs.writeFile(manifestPath, YAML.stringify(manifest));
    let result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes("asset registries are no longer supported")));

    delete manifest["asset-templates"];
    await fs.writeFile(manifestPath, YAML.stringify(manifest));
    const screenPath = path.join(root, "screens", "home", "screen.yml");
    const screen = YAML.parse(await fs.readFile(screenPath, "utf8"));
    screen.elements[1].src = "assets/missing.png";
    screen.elements[2].type = "image";
    await fs.writeFile(screenPath, YAML.stringify(screen));
    result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes('does not reference a discovered image asset')));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("validates template front matter, filename IDs, resources, and slot declarations", async () => {
  const root = await createProject();
  try {
    const templatePath = path.join(root, "assets", "button.html");
    await fs.writeFile(templatePath, "<button>Missing front matter</button>");
    let result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes("must begin with a YAML front matter block")));

    await fs.writeFile(templatePath, assetDocument({
      id: "wrong-id",
      name: "Button",
      description: "A button template."
    }, "<button>Button</button>"));
    result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes("front matter id must match filename \"button\"")));

    const layoutPath = path.join(root, "screens", "home", "assets", "layout.html");
    await fs.writeFile(layoutPath, assetDocument({
      id: "layout",
      name: "Layout",
      description: "A layout.",
      slots: [{ id: "content" }]
    }, "<main><div data-openux-slot=\"unknown\"></div></main>"));
    result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes('must contain exactly one element with data-openux-slot="content"')));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("discovers image Assets recursively while requiring template HTML at the assets root", async () => {
  const root = await createProject();
  try {
    const nestedTemplate = path.join(root, "assets", "nested", "card.html");
    await fs.mkdir(path.dirname(nestedTemplate), { recursive: true });
    await fs.writeFile(nestedTemplate, assetDocument({
      id: "card",
      name: "Card",
      description: "Nested template."
    }, "<article>Card</article>"));
    const result = await validateProject(root);
    assert.ok(result.errors.some((error) => error.includes("template HTML files must be directly inside an assets directory")));
    assert.equal(result.assets.get("screens/home/assets/images/chart.png").type, "image");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("validates Element spec front matter and direct specs directory paths", async () => {
  assert.equal(validation.validateElementSpecHeader(validElementSpec), "continue-button");
  assert.doesNotThrow(() =>
    validation.validateElementSpecPath("screens/home/specs/element-continue-button.md", "continue-button")
  );
  assert.throws(
    () => validation.validateElementSpecPath("screens/home/specs/elements/continue-button.md", "continue-button"),
    /Behavior spec path must be/
  );
  assert.throws(
    () => validation.validateElementSpecHeader("---\nasset-id: continue-button\n---\n"),
    /element-id/
  );
});

test("CLI init creates a discoverable template Asset and an Element-based Screen", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "openux-init-test-"));
  try {
    const result = spawnSync(process.execPath, [cliPath, "init", "--project", parent], {
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const manifest = YAML.parse(await fs.readFile(path.join(parent, "openux", "project.yml"), "utf8"));
    const screen = YAML.parse(await fs.readFile(
      path.join(parent, "openux", "screens", "home", "screen.yml"),
      "utf8"
    ));
    assert.equal(Object.hasOwn(manifest, "asset-templates"), false);
    assert.equal(screen.elements[0].type, "template");
    assert.equal(screen.elements[0].src, "screens/home/assets/page-layout.html");
    assert.ok(await fs.readFile(
      path.join(parent, "openux", "screens", "home", "assets", "page-layout.html"),
      "utf8"
    ));
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("CLI prune reports discovered unreferenced Assets and removes only files on apply", async () => {
  const root = await createProject();
  try {
    const dryRun = spawnSync(process.execPath, [cliPath, "prune", "--project", root], {
      encoding: "utf8"
    });
    assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
    assert.match(dryRun.stdout, /template unused \(screens\/home\/assets\/unused\.html\)/);
    assert.match(dryRun.stdout, /image chart\.png \(screens\/home\/assets\/images\/chart\.png\)/);
    await fs.access(path.join(root, "screens", "home", "assets", "unused.html"));

    const originalManifest = await fs.readFile(path.join(root, "project.yml"), "utf8");
    const applied = spawnSync(process.execPath, [cliPath, "prune", "--apply", "--project", root], {
      encoding: "utf8"
    });
    assert.equal(applied.status, 0, applied.stderr || applied.stdout);
    await assert.rejects(fs.access(path.join(root, "screens", "home", "assets", "unused.html")));
    await assert.rejects(fs.access(path.join(root, "screens", "home", "assets", "images", "chart.png")));
    assert.equal(await fs.readFile(path.join(root, "project.yml"), "utf8"), originalManifest);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("inlines local resources referenced by rendered Screen output", async () => {
  const root = await createProject();
  try {
    const html = await inlineProjectResources(
      '<img src="http://127.0.0.1:3000/openux/assets/brand.png"><img src="http://127.0.0.1:3000/openux/screens/home/assets/images/chart.png">',
      "http://127.0.0.1:3000",
      root
    );
    assert.match(html, /data:image\/png;base64,/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
