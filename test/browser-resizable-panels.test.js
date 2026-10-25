const assert = require("node:assert/strict");
const test = require("node:test");

function createHandle() {
  return {
    attributes: {},
    listeners: new Map(),
    capturedPointer: null,
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    focus() {},
    setPointerCapture(pointerId) {
      this.capturedPointer = pointerId;
    },
    hasPointerCapture(pointerId) {
      return this.capturedPointer === pointerId;
    },
    releasePointerCapture(pointerId) {
      this.capturedPointer = null;
    }
  };
}

function createHarness(savedLayout) {
  const values = new Map(savedLayout ? [["openux-studio.layout.v1", savedLayout]] : []);
  const properties = new Map();
  const handles = new Map([
    ["sidebar-resizer", createHandle()],
    ["inspector-resizer", createHandle()]
  ]);
  const bodyClasses = new Set();
  const messages = [];
  const windowObject = {
    localStorage: {
      getItem(key) {
        return values.get(key) || null;
      },
      setItem(key, value) {
        values.set(key, value);
      }
    },
    addEventListener() {}
  };
  const documentObject = {
    body: { classList: {
      add: (name) => bodyClasses.add(name),
      remove: (name) => bodyClasses.delete(name)
    } },
    getElementById: (id) => handles.get(id) || null
  };
  const workspace = {
    style: {
      setProperty(name, value) {
        properties.set(name, value);
      }
    }
  };
  return { windowObject, documentObject, workspace, handles, bodyClasses, properties, values, messages };
}

test("restores clamped panel sizes and persists keyboard and pointer resizing", async () => {
  const { ResizablePanels } = await import("../browser/ResizablePanels.mjs");
  const harness = createHarness('{"sidebar":999,"inspector":100}');
  const controller = new ResizablePanels({
    ...harness,
    showMessage: (...message) => harness.messages.push(message)
  });
  controller.bind();

  assert.equal(harness.properties.get("--sidebar-width"), "420px");
  assert.equal(harness.properties.get("--inspector-width"), "220px");
  assert.equal(harness.handles.get("sidebar-resizer").attributes["aria-valuenow"], "420");

  const inspector = harness.handles.get("inspector-resizer");
  let prevented = false;
  inspector.listeners.get("keydown")({
    key: "ArrowLeft",
    shiftKey: false,
    preventDefault() { prevented = true; }
  });
  assert.equal(prevented, true);
  assert.equal(harness.properties.get("--inspector-width"), "232px");
  assert.deepEqual(JSON.parse(harness.values.get("openux-studio.layout.v1")), {
    sidebar: 420,
    inspector: 232
  });

  const sidebar = harness.handles.get("sidebar-resizer");
  sidebar.listeners.get("pointerdown")({
    button: 0,
    pointerId: 5,
    clientX: 100,
    preventDefault() {}
  });
  assert.equal(harness.bodyClasses.has("panel-resizing"), true);
  sidebar.listeners.get("pointermove")({ pointerId: 5, clientX: 80 });
  sidebar.listeners.get("pointerup")({ pointerId: 5 });
  assert.equal(harness.properties.get("--sidebar-width"), "400px");
  assert.deepEqual(JSON.parse(harness.values.get("openux-studio.layout.v1")), {
    sidebar: 400,
    inspector: 232
  });
  assert.equal(harness.bodyClasses.has("panel-resizing"), false);
  assert.deepEqual(harness.messages, []);
});
