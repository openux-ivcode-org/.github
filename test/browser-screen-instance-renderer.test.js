const assert = require("node:assert/strict");
const test = require("node:test");

function createElement(tagName, className = "") {
  return {
    tagName,
    dataset: {},
    attributes: {},
    children: [],
    listeners: [],
    classList: {
      values: new Set(className ? [className] : []),
      add(name) { this.values.add(name); }
    },
    append(child) { this.children.push(child); },
    addEventListener(...listener) { this.listeners.push(listener); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    setAttribute(name, value) { this.attributes[name] = value; }
  };
}

test("does not expose asset selection interactions in render-only mode", async () => {
  const { ScreenInstanceRenderer } = await import("../browser/ScreenInstanceRenderer.mjs");
  const hosts = [];
  const renderer = new ScreenInstanceRenderer({
    state: {
      isRenderOnly: true,
      activeInstancePath: [0]
    },
    services: {
      element(tagName, className) {
        const element = createElement(tagName, className);
        hosts.push(element);
        return element;
      },
      isInstanceVisible: () => true,
      sameInstancePath: () => true,
      getElementLabel: () => "Balance",
      safeProjectUrl: (path) => new URL(path, "http://localhost/")
    }
  });

  const host = await renderer.render({
    id: "balance",
    type: "image",
    src: "assets/balance.png",
    alt: "Balance"
  }, null, [0], "home", "Home");

  assert.equal(host.draggable, undefined);
  assert.equal(host.tabIndex, undefined);
  assert.equal(host.attributes.role, undefined);
  assert.equal(host.attributes["aria-label"], undefined);
  assert.equal(host.classList.values.has("selected"), false);
  assert.deepEqual(host.listeners, []);
  assert.equal(host.children.length, 1);
  assert.equal(hosts[1].tagName, "img");
});

test("does not expose drop-zone interactions in render-only mode", async () => {
  const { ScreenInstanceRenderer } = await import("../browser/ScreenInstanceRenderer.mjs");
  const target = createElement("div");
  target.attributes["data-openux-slot"] = "content";
  const renderer = new ScreenInstanceRenderer({
    state: { isRenderOnly: true },
    services: {}
  });

  await renderer.renderSlots(
    { querySelectorAll: () => [target] },
    { slots: {} },
    { id: "layout", data: { slots: [{ id: "content", name: "Content" }] } },
    [0],
    "home",
    "Home"
  );

  assert.equal(target.classList.values.has("openux-drop-slot"), false);
  assert.equal(target.classList.values.has("openux-render-slot"), true);
  assert.equal(target.attributes.role, undefined);
  assert.equal(target.attributes["aria-label"], undefined);
  assert.equal(target.attributes["data-placeholder"], undefined);
  assert.deepEqual(target.listeners, []);
});
