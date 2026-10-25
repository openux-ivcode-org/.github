const assert = require("node:assert/strict");
const test = require("node:test");

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

test("clears prior-session annotations before loading a Screen", async () => {
  const { ScreenAnnotationController } = await import("../browser/ScreenAnnotationController.mjs");
  const requests = [];
  const controller = new ScreenAnnotationController({
    state: {},
    services: {
      byId: () => ({ textContent: "", classList: { toggle() {} } }),
      fetcher: async (url, options = {}) => {
        requests.push({ url, method: options.method || "GET" });
        if (url === "/api/annotations" && options.method === "DELETE") {
          return response({ cleared: 1 });
        }
        if (url === "/api/annotations?screenId=home") {
          return response({ screenId: "home", annotations: [], updatedAt: null });
        }
        throw new Error(`Unexpected request: ${url}`);
      }
    }
  });
  controller.render = () => {};
  controller.updateControls = () => {};

  await controller.setScreen({ id: "home" });

  assert.deepEqual(requests, [
    { url: "/api/annotations", method: "DELETE" },
    { url: "/api/annotations?screenId=home", method: "GET" }
  ]);
});

test("updates annotation tool buttons and actions for the active tool", async () => {
  const { ScreenAnnotationController } = await import("../browser/ScreenAnnotationController.mjs");
  const attributes = new Map();
  const makeButton = (tool) => ({
    dataset: { annotationTool: tool },
    disabled: false,
    setAttribute(name, value) {
      attributes.set(`${tool || "mode"}:${name}`, value);
    }
  });
  const toolButtons = ["pen", "circle", "rectangle", "arrow", "highlight", "note"]
    .map(makeButton);
  const controls = new Map([
    ["annotation-mode-exit", { ...makeButton(null), hidden: true }],
    ["annotation-undo", makeButton(null)],
    ["annotation-redo", makeButton(null)],
    ["annotation-clear", makeButton(null)]
  ]);
  const controller = new ScreenAnnotationController({
    state: {},
    services: {
      byId: (id) => controls.get(id),
      document: { querySelectorAll: () => toolButtons }
    }
  });
  controller.screenId = "home";
  controller.enabled = true;
  controller.tool = "rectangle";
  controller.annotations = [{ id: "mark-1" }];

  controller.updateControls();

  assert.equal(controls.get("annotation-mode-exit").hidden, false);
  assert.equal(attributes.get("rectangle:aria-pressed"), "true");
  assert.equal(attributes.get("circle:aria-pressed"), "false");
  assert.equal(toolButtons.every((button) => !button.disabled), true);
  assert.equal(controls.get("annotation-undo").disabled, false);
  assert.equal(controls.get("annotation-redo").disabled, true);
  assert.equal(controls.get("annotation-clear").disabled, false);
});

test("selecting a tool enters annotation mode and Exit leaves it", async () => {
  const { ScreenAnnotationController } = await import("../browser/ScreenAnnotationController.mjs");
  const attributes = new Map();
  const toolButtons = ["pen", "circle", "rectangle", "arrow", "highlight", "note"].map((tool) => ({
    dataset: { annotationTool: tool },
    setAttribute(name, value) {
      attributes.set(`${tool}:${name}`, value);
    }
  }));
  const exitButton = { hidden: true, disabled: false };
  const status = { textContent: "", classList: { toggle() {} } };
  const controller = new ScreenAnnotationController({
    state: {},
    services: {
      byId: (id) => id === "annotation-mode-exit" ? exitButton : status,
      document: { querySelectorAll: () => toolButtons }
    }
  });
  controller.screenId = "home";
  controller.render = () => {};

  controller.selectTool("circle");

  assert.equal(controller.enabled, true);
  assert.equal(controller.tool, "circle");
  assert.equal(exitButton.hidden, false);
  assert.equal(attributes.get("circle:aria-pressed"), "true");
  controller.setEnabled(false);
  assert.equal(exitButton.hidden, true);
  assert.equal(attributes.get("circle:aria-pressed"), "false");
});

test("caches a browser snapshot after saving an annotation set", async () => {
  const { ScreenAnnotationController } = await import("../browser/ScreenAnnotationController.mjs");
  const png = Buffer.from("browser preview");
  const annotationUpdatedAt = "2026-10-25T12:00:00.000Z";
  const selectionUpdatedAt = "2026-10-25T11:59:00.000Z";
  let snapshotRequest;
  const status = { textContent: "", classList: { toggle() {} } };
  const controller = new ScreenAnnotationController({
    state: {},
    services: {
      byId: () => status,
      capturePreview: async () => png,
      fetcher: async (url, options = {}) => {
        if (url === "/api/annotations") {
          return response({ saved: 1, updatedAt: annotationUpdatedAt });
        }
        if (url === "/api/selection") {
          return response({
            updatedAt: selectionUpdatedAt,
            selection: {
              view: "screen",
              screen: { id: "home" },
              previewStateId: "default"
            },
            annotations: { updatedAt: annotationUpdatedAt }
          });
        }
        if (url === "/api/snapshots?screenId=home") {
          snapshotRequest = options;
          return response({ saved: true });
        }
        throw new Error(`Unexpected request: ${url}`);
      }
    }
  });
  controller.screenId = "home";
  controller.annotationRevision = 1;
  controller.annotations = [{ id: "note-1" }];

  await controller.persist();

  assert.equal(snapshotRequest.method, "POST");
  assert.equal(snapshotRequest.headers["Content-Type"], "image/png");
  assert.equal(snapshotRequest.headers["X-OpenUX-Selection-Updated-At"], selectionUpdatedAt);
  assert.equal(snapshotRequest.headers["X-OpenUX-Annotation-Updated-At"], annotationUpdatedAt);
  assert.equal(snapshotRequest.body, png);
  assert.match(status.textContent, /Browser snapshot cached for CLI/);
});
