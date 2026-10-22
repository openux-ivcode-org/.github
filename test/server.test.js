const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const YAML = require("yaml");
const { createServer } = require("../server");

async function withServer(run) {
  const rootDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "openux-server-test-"));
  await fs.mkdir(path.join(rootDirectory, "openux"), { recursive: true });
  await fs.mkdir(path.join(rootDirectory, "openux", "screens"), { recursive: true });
  await fs.mkdir(path.join(rootDirectory, "openux", "assets", "demo"), { recursive: true });
  await fs.writeFile(path.join(rootDirectory, "index.html"), "<h1>Editor</h1>");
  await fs.writeFile(path.join(rootDirectory, "app.js"), "window.editor = true;");
  await fs.writeFile(path.join(rootDirectory, "openux", "project.yml"), "name: Example\n");
  await fs.writeFile(path.join(rootDirectory, "openux", "screen.yml"), "name: Before\n");
  await fs.writeFile(path.join(rootDirectory, "openux", "assets", "demo", "asset.html"), "<p>Before</p>");
  await fs.writeFile(
    path.join(rootDirectory, "openux", "assets", "demo", "preview image.png"),
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
    const encodedResource = await fetch(`${baseUrl}/openux/assets/demo/preview%20image.png`);
    const traversal = await fetch(`${baseUrl}/openux/%2e%2e%2findex.html`);
    assert.equal(editor.status, 200);
    assert.match(await editor.text(), /Editor/);
    assert.equal(project.status, 200);
    assert.deepEqual(YAML.parse(await project.text()), { name: "Example" });
    assert.equal(encodedResource.status, 200);
    assert.equal(encodedResource.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await encodedResource.arrayBuffer()), Buffer.from("image"));
    assert.equal(traversal.status, 404);
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
      screen: { id: "home", name: "Home", file: "screens/home.yml" }
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
              screens: [{ id: "new-screen", file: "screens/new-screen.yml" }]
            }
          },
          {
            path: "screens/new-screen.yml",
            create: true,
            data: {
              name: "New Screen",
              description: "",
              assets: [{
                "asset-template": "centered-form-layout",
                slots: { content: [] }
              }]
            }
          }
        ]
      })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      saved: ["project.yml", "screens/new-screen.yml"]
    });
    assert.deepEqual(
      YAML.parse(await fs.readFile(path.join(rootDirectory, "openux", "project.yml"), "utf8")),
      {
        name: "Example",
        screens: [{ id: "new-screen", file: "screens/new-screen.yml" }]
      }
    );
    assert.deepEqual(
      YAML.parse(await fs.readFile(path.join(rootDirectory, "openux", "screens", "new-screen.yml"), "utf8")),
      {
        name: "New Screen",
        description: "",
        assets: [{
          "asset-template": "centered-form-layout",
          slots: { content: [] }
        }]
      }
    );

    const duplicate = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{
          path: "screens/new-screen.yml",
          create: true,
          data: { name: "Overwrite", assets: [] }
        }]
      })
    });
    assert.equal(duplicate.status, 409);

    const rejected = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{
          path: "assets/demo/asset.yml",
          create: true,
          data: { id: "demo" }
        }]
      })
    });
    assert.equal(rejected.status, 400);
  });
});

test("saves HTML source only inside an asset directory", async () => {
  await withServer(async ({ baseUrl, rootDirectory }) => {
    const response = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{ path: "assets/demo/asset.html", content: "<p>After</p>" }]
      })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { saved: ["assets/demo/asset.html"] });
    assert.equal(
      await fs.readFile(path.join(rootDirectory, "openux", "assets", "demo", "asset.html"), "utf8"),
      "<p>After</p>"
    );

    const rejected = await fetch(`${baseUrl}/api/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: [{ path: "screens/screen.html", content: "<p>No</p>" }]
      })
    });
    assert.equal(rejected.status, 400);
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
