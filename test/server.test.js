const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const YAML = require("yaml");
const { createServer } = require("../server");
const validation = require("../validation");

function assetDocument(data, body) {
  return validation.formatAssetDocument(YAML.stringify(data), body);
}

async function withServer(run) {
  const rootDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "openux-server-test-"));
  await fs.mkdir(path.join(rootDirectory, "openux"), { recursive: true });
  await fs.mkdir(path.join(rootDirectory, "openux", "screens"), { recursive: true });
  await fs.mkdir(path.join(rootDirectory, "openux", "assets"), { recursive: true });
  await fs.writeFile(path.join(rootDirectory, "index.html"), "<h1>Editor</h1>");
  await fs.writeFile(path.join(rootDirectory, "app.js"), "window.editor = true;");
  await fs.writeFile(path.join(rootDirectory, "openux", "project.yml"), "name: Example\n");
  await fs.writeFile(path.join(rootDirectory, "openux", "screen.yml"), "name: Before\n");
  await fs.writeFile(
    path.join(rootDirectory, "openux", "assets", "demo.stml"),
    assetDocument({ id: "demo", name: "Demo", description: "Test asset." }, "<p>Before</p>")
  );
  await fs.writeFile(
    path.join(rootDirectory, "openux", "assets", "preview image.png"),
    Buffer.from("image")
  );
  const server = createServer({ rootDirectory });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await run({ baseUrl, rootDirectory });
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    );
    await fs.rm(rootDirectory, { recursive: true, force: true });
  }
}

test("serves the editor root and the example project", async () => {
  await withServer(async ({ baseUrl }) => {
    const editor = await fetch(baseUrl);
    const project = await fetch(`${baseUrl}/openux/project.yml`);
    const encodedResource = await fetch(`${baseUrl}/openux/assets/preview%20image.png`);
    const template = await fetch(`${baseUrl}/openux/assets/demo.stml`);
    const traversal = await fetch(`${baseUrl}/openux/%2e%2e%2findex.html`);
    assert.equal(editor.status, 200);
    assert.match(await editor.text(), /Editor/);
    assert.equal(project.status, 200);
    assert.deepEqual(YAML.parse(await project.text()), { name: "Example" });
    assert.equal(encodedResource.status, 200);
    assert.equal(encodedResource.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await encodedResource.arrayBuffer()), Buffer.from("image"));
    assert.equal(template.status, 200);
    assert.equal(template.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.match(await template.text(), /^---\n/);
    assert.equal(traversal.status, 404);
  });
});

test("lists project files without exposing hidden paths", async () => {
  await withServer(async ({ baseUrl, rootDirectory }) => {
    await fs.mkdir(path.join(rootDirectory, "openux", "screens", "home", "specs"), { recursive: true });
    await fs.writeFile(path.join(rootDirectory, "openux", "screens", "home", "screen.yml"), "name: Home\n");
    await fs.writeFile(path.join(rootDirectory, "openux", ".private.yml"), "secret: true\n");

    const response = await fetch(`${baseUrl}/api/files`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).files, [
      "assets/demo.stml",
      "assets/preview image.png",
      "project.yml",
      "screen.yml",
      "screens/home/screen.yml"
    ]);
  });
});

test("reports server status and browser selection and notifies connected browsers", async () => {
  await withServer(async ({ baseUrl }) => {
    const status = await fetch(`${baseUrl}/api/status`);
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), {
      status: "ok",
      url: baseUrl + "/",
      connectedBrowsers: 0,
      selectionAvailable: false
    });

    const selection = {
      view: "screen",
      screen: { id: "home", name: "Home", file: "screens/home/screen.yml" }
    };
    const published = await fetch(`${baseUrl}/api/selection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selection })
    });
    assert.equal(published.status, 200);
    const currentSelection = await fetch(`${baseUrl}/api/selection`);
    const selectionState = await currentSelection.json();
    assert.deepEqual(selectionState.selection, selection);
    assert.equal(Number.isNaN(Date.parse(selectionState.updatedAt)), false);

    const controller = new AbortController();
    const events = await fetch(`${baseUrl}/api/events`, { signal: controller.signal });
    const reader = events.body.getReader();
    const decoder = new TextDecoder();
    assert.match(decoder.decode((await reader.read()).value), /connected/);
    const connectedStatus = await fetch(`${baseUrl}/api/status`);
    assert.equal((await connectedStatus.json()).connectedBrowsers, 1);

    const update = await fetch(`${baseUrl}/api/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    assert.deepEqual(await update.json(), { notifiedBrowsers: 1 });
    assert.match(decoder.decode((await reader.read()).value), /event: project-updated/);
    await reader.cancel();
    controller.abort();

    const rejected = await fetch(`${baseUrl}/api/update`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://example.invalid"
      },
      body: "{}"
    });
    assert.equal(rejected.status, 403);
  });
});

test("saves YAML data while retaining unknown project fields", async () => {
  await withServer(async ({ baseUrl, rootDirectory }) => {
    const response = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{
          path: "screen.yml",
          data: { name: "After", editorExtension: { preserved: true } }
        }]
      })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { saved: ["screen.yml"] });
    const saved = YAML.parse(await fs.readFile(path.join(rootDirectory, "openux", "screen.yml"), "utf8"));
    assert.deepEqual(saved, { name: "After", editorExtension: { preserved: true } });
  });
});

test("creates new Screen YAML files and updates the project manifest", async () => {
  await withServer(async ({ baseUrl, rootDirectory }) => {
    const response = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [
          {
            path: "project.yml",
            data: {
              name: "Example",
              screens: [{ id: "new-screen", file: "screens/new-screen/screen.yml" }]
            }
          },
          {
            path: "screens/new-screen/screen.yml",
            create: true,
            data: {
              name: "New Screen",
              description: "",
              elements: []
            }
          }
        ]
      })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      saved: ["project.yml", "screens/new-screen/screen.yml"]
    });
    assert.deepEqual(
      YAML.parse(await fs.readFile(path.join(rootDirectory, "openux", "project.yml"), "utf8")),
      {
        name: "Example",
        screens: [{ id: "new-screen", file: "screens/new-screen/screen.yml" }]
      }
    );
    assert.deepEqual(
      YAML.parse(await fs.readFile(
        path.join(rootDirectory, "openux", "screens", "new-screen", "screen.yml"),
        "utf8"
      )),
      {
        name: "New Screen",
        description: "",
        elements: []
      }
    );

    const duplicate = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{
          path: "screens/new-screen/screen.yml",
          create: true,
          data: { name: "Overwrite", elements: [] }
        }]
      })
    });
    assert.equal(duplicate.status, 409);

    const rejected = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{
          path: "assets/demo.stml",
          create: true,
          content: assetDocument({ id: "demo", name: "Demo", description: "Test asset." }, "<p>Demo</p>")
        }]
      })
    });
    assert.equal(rejected.status, 400);
  });
});

test("saves STML source only as a named template file", async () => {
  await withServer(async ({ baseUrl, rootDirectory }) => {
    const response = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{
          path: "assets/demo.stml",
          content: assetDocument({ id: "demo", name: "Demo", description: "Test asset." }, "<p>After</p>")
        }]
      })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { saved: ["assets/demo.stml"] });
    assert.equal(
      await fs.readFile(path.join(rootDirectory, "openux", "assets", "demo.stml"), "utf8"),
      assetDocument({ id: "demo", name: "Demo", description: "Test asset." }, "<p>After</p>")
    );

    const rejected = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{ path: "screens/screen.html", content: assetDocument({
          id: "screen",
          name: "Screen",
          description: ""
        }, "<p>No</p>") }]
      })
    });
    assert.equal(rejected.status, 400);

    const invalidDocument = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{ path: "assets/demo.stml", content: "<p>Missing header</p>" }]
      })
    });
    assert.equal(invalidDocument.status, 400);

    const staticHtml = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{ path: "assets/demo.html", content: "<p>Static HTML</p>" }]
      })
    });
    assert.equal(staticHtml.status, 400);
  });
});

test("copies page-specific Asset template files and resources on save", async () => {
  await withServer(async ({ baseUrl, rootDirectory }) => {
    const projectRoot = path.join(rootDirectory, "openux");
    await fs.mkdir(path.join(projectRoot, "screens"), { recursive: true });
    await fs.writeFile(
      path.join(projectRoot, "project.yml"),
      YAML.stringify({
        name: "Example",
        screens: [{ id: "source", file: "screens/source/screen.yml" }],
        theme: "theme/theme.yml"
      })
    );
    const sourceAssetDirectory = path.join(projectRoot, "screens", "source", "assets");
    await fs.mkdir(sourceAssetDirectory, { recursive: true });
    await fs.writeFile(path.join(projectRoot, "screens", "source", "screen.yml"), "name: Source\nelements: []\n");
    await fs.writeFile(
      path.join(sourceAssetDirectory, "demo.stml"),
      assetDocument({ id: "demo", name: "Demo", description: "Test asset." }, '<p><img src="preview image.png"></p>')
    );
    await fs.writeFile(path.join(sourceAssetDirectory, "preview image.png"), Buffer.from("image"));
    await fs.writeFile(path.join(sourceAssetDirectory, "edited image.png"), Buffer.from("edited image"));

    const nextProject = {
      name: "Example",
      screens: [
        { id: "source", file: "screens/source/screen.yml" },
        { id: "destination", file: "screens/destination/screen.yml" }
      ],
      theme: "theme/theme.yml"
    };
    const response = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [
          { path: "project.yml", data: nextProject },
          {
            path: "screens/destination/assets/destination-demo.stml",
            content: assetDocument({
              id: "destination-demo",
              name: "Edited Demo",
              description: "Edited copy."
            }, '<p><img src="edited image.png" alt="Edited"></p>')
          },
          {
            path: "screens/destination/screen.yml",
            create: true,
            data: {
              name: "Destination",
              elements: [{ id: "destination-demo", type: "template", src: "screens/destination/assets/destination-demo.stml" }]
            }
          }
        ],
        assetCopies: [{
          sourceId: "demo",
          sourceScreen: "source",
          sourceFile: "screens/source/assets/demo.stml",
          targetId: "destination-demo",
          targetFile: "screens/destination/assets/destination-demo.stml",
          targetScreen: "destination"
        }]
      })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      saved: [
        "project.yml",
        "screens/destination/assets/destination-demo.stml",
        "screens/destination/screen.yml"
      ],
      copied: ["destination-demo"]
    });
    const copiedAssetSource = await fs.readFile(
      path.join(projectRoot, "screens", "destination", "assets", "destination-demo.stml"),
      "utf8"
    );
    const copiedAsset = validation.splitAssetDocument(copiedAssetSource, "destination Asset");
    assert.equal(YAML.parse(copiedAsset.header).name, "Edited Demo");
    assert.equal(copiedAsset.body, '<p><img src="edited image.png" alt="Edited"></p>');
    assert.deepEqual(
      await fs.readFile(path.join(
        projectRoot,
        "screens",
        "destination",
        "assets",
        "edited image.png"
      )),
      Buffer.from("edited image")
    );
    await assert.rejects(fs.access(path.join(
      projectRoot,
      "screens",
      "destination",
      "assets",
      "preview image.png"
    )));
    const sourceAssetSource = await fs.readFile(path.join(sourceAssetDirectory, "demo.stml"), "utf8");
    assert.equal(YAML.parse(validation.splitAssetDocument(sourceAssetSource).header).id, "demo");
  });
});

test("creates and saves project, Screen, and Element behavior specs", async () => {
  await withServer(async ({ baseUrl, rootDirectory }) => {
    const content = [
      "# Sign-in button",
      "",
      "## Purpose",
      "Describe the sign-in action.",
      "",
      "## Requirements",
      "",
      "### Requirement: Submit the form",
      "The button SHALL submit the sign-in form when activated.",
      "",
      "#### Scenario: User activates the button",
      "- **GIVEN** the form contains valid credentials",
      "- **WHEN** the user activates the button",
      "- **THEN** the sign-in request is submitted.",
      ""
    ].join("\n");
    const updatedContent = content.replace(
      "The sign-in request is submitted.",
      "The sign-in request is sent."
    );
    const create = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{
          path: "specs/sign-in-button.md",
          create: true,
          content
        }]
      })
    });
    assert.equal(create.status, 200);
    assert.deepEqual(await create.json(), { saved: ["specs/sign-in-button.md"] });
    const specPath = path.join(rootDirectory, "openux", "specs", "sign-in-button.md");
    assert.equal(await fs.readFile(specPath, "utf8"), content);

    const update = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{
          path: "specs/sign-in-button.md",
          content: updatedContent
        }]
      })
    });
    assert.equal(update.status, 200);
    assert.equal(await fs.readFile(specPath, "utf8"), updatedContent);

    const screenSpecPath = "screens/sign-in/specs/element-sign-in-button.md";
    const assetSpecContent = `---\nelement-id: sign-in-button\n---\n\n${content}`;
    const screenSpecCreate = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{ path: screenSpecPath, create: true, content: assetSpecContent }]
      })
    });
    assert.equal(screenSpecCreate.status, 200);
    assert.deepEqual(await screenSpecCreate.json(), { saved: [screenSpecPath] });
    assert.equal(
      await fs.readFile(path.join(rootDirectory, "openux", ...screenSpecPath.split("/")), "utf8"),
      assetSpecContent
    );

    const invalidAssetHeader = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{
          path: "screens/sign-in/specs/element-wrong-name.md",
          create: true,
          content
        }]
      })
    });
    assert.equal(invalidAssetHeader.status, 400);

    const invalidContent = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{ path: "specs/invalid.md", create: true, content: "# Unstructured spec\n" }]
      })
    });
    assert.equal(invalidContent.status, 400);
    await assert.rejects(fs.access(path.join(rootDirectory, "openux", "specs", "invalid.md")));

    for (const pathValue of ["notes.md", "specs/nested/sign-in.md", "specs/invalid_name.md"]) {
      const rejected = await fetch(`${baseUrl}/api/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: [{ path: pathValue, content: "not allowed" }] })
      });
      assert.equal(rejected.status, 400, pathValue);
    }
  });
});

test("parses, serializes, and saves edited YAML source", async () => {
  await withServer(async ({ baseUrl, rootDirectory }) => {
    const source = "# retained comment\nname: Edited\nextension:\n  value: true\n";
    const parsedResponse = await fetch(`${baseUrl}/api/yaml/parse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source })
    });
    assert.equal(parsedResponse.status, 200);
    assert.deepEqual(await parsedResponse.json(), {
      data: { name: "Edited", extension: { value: true } }
    });

    const serializedResponse = await fetch(`${baseUrl}/api/yaml/stringify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: { name: "Edited", extension: { value: true } } })
    });
    assert.equal(serializedResponse.status, 200);
    assert.deepEqual(YAML.parse((await serializedResponse.json()).source), {
      name: "Edited",
      extension: { value: true }
    });

    const invalidYamlResponse = await fetch(`${baseUrl}/api/yaml/parse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "name: [unterminated" })
    });
    assert.equal(invalidYamlResponse.status, 400);
    assert.match((await invalidYamlResponse.json()).error, /Invalid YAML/);

    const savedResponse = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: [{ path: "screen.yml", content: source }] })
    });
    assert.equal(savedResponse.status, 200);
    assert.equal(
      await fs.readFile(path.join(rootDirectory, "openux", "screen.yml"), "utf8"),
      source
    );

    const rejectedSave = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: [{ path: "screen.yml", content: "name: [unterminated" }] })
    });
    assert.equal(rejectedSave.status, 400);
  });
});

test("rejects save paths outside the example project", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: [{ path: "../outside.yml", data: { name: "No" } }] })
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /relative paths inside the openux project/);
  });
});

test("does not serve repository files outside the editor and example project", async () => {
  await withServer(async ({ baseUrl }) => {
    const privateFile = await fetch(`${baseUrl}/doc/editor.md`);
    const vcsData = await fetch(`${baseUrl}/.git/config`);
    assert.equal(privateFile.status, 404);
    assert.equal(vcsData.status, 404);
  });
});
