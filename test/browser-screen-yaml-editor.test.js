const assert = require("node:assert/strict");
const test = require("node:test");

function createElement() {
  return {
    value: "",
    hidden: false,
    textContent: "",
    attributes: {},
    classList: {
      values: new Set(),
      toggle(name, enabled) {
        if (enabled) this.values.add(name);
        else this.values.delete(name);
      }
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
  };
}

test("parses valid Screen YAML and refreshes the active Screen", async () => {
  const { ScreenYamlEditor } = await import("../browser/ScreenYamlEditor.mjs");
  const screen = {
    id: "home",
    file: "screens/home/screen.yml",
    data: { name: "Home" },
    yamlParseVersion: 2
  };
  const status = createElement();
  const elements = new Map([["screen-yaml-status", status]]);
  const invalidYamlFiles = new Map([[screen.file, "Validating Screen YAML..."]]);
  const calls = { navigation: 0, renders: [], saves: 0, validations: [] };
  const editor = new ScreenYamlEditor({
    documentObject: { getElementById: (id) => elements.get(id) || createElement() },
    fetcher: async () => ({ ok: true, json: async () => ({ data: { name: "Updated" } }) }),
    getActiveScreen: () => screen,
    getActiveScreenIndex: () => 0,
    getScreenIndex: () => 0,
    invalidYamlFiles,
    markEdited() {},
    renderNavigation: () => { calls.navigation += 1; },
    renderScreen: async (index) => { calls.renders.push(index); },
    updateSaveControls: () => { calls.saves += 1; },
    validatePreviewStates: (data, file) => { calls.validations.push([data, file]); }
  });

  await editor.parse(screen, "name: Updated", 2);

  assert.deepEqual(screen.data, { name: "Updated" });
  assert.equal(screen.yamlSource, "name: Updated");
  assert.equal(screen.yamlSourceMode, "source");
  assert.equal(invalidYamlFiles.has(screen.file), false);
  assert.equal(status.textContent, "YAML is valid. Save to persist changes.");
  assert.equal(calls.navigation, 1);
  assert.deepEqual(calls.renders, [0]);
  assert.equal(calls.saves, 1);
  assert.deepEqual(calls.validations, [[{ name: "Updated" }, screen.file]]);
});

test("ignores a stale Screen YAML parse response", async () => {
  const { ScreenYamlEditor } = await import("../browser/ScreenYamlEditor.mjs");
  const screen = {
    file: "screens/home/screen.yml",
    data: { name: "Home" },
    yamlParseVersion: 3
  };
  const editor = new ScreenYamlEditor({
    documentObject: { getElementById: () => createElement() },
    fetcher: async () => ({ ok: true, json: async () => ({ data: { name: "Stale" } }) }),
    getActiveScreen: () => screen,
    getActiveScreenIndex: () => 0,
    getScreenIndex: () => 0,
    invalidYamlFiles: new Map(),
    markEdited() {},
    renderNavigation() { assert.fail("stale response must not rerender navigation"); },
    renderScreen() { assert.fail("stale response must not rerender the Screen"); },
    updateSaveControls() { assert.fail("stale response must not update save controls"); },
    validatePreviewStates() { assert.fail("stale response must not validate data"); }
  });

  await editor.parse(screen, "name: Stale", 2);
  assert.deepEqual(screen.data, { name: "Home" });
});

test("generates Screen YAML and fills the active YAML editor", async () => {
  const { ScreenYamlEditor } = await import("../browser/ScreenYamlEditor.mjs");
  const screen = {
    file: "screens/home/screen.yml",
    data: { name: "Home" },
    yamlSourceMode: "data",
    yamlSerializeVersion: 0
  };
  const textarea = createElement();
  const status = createElement();
  const elements = new Map([
    ["screen-yaml-source", textarea],
    ["screen-yaml-status", status]
  ]);
  const editor = new ScreenYamlEditor({
    documentObject: { getElementById: (id) => elements.get(id) || createElement() },
    fetcher: async (url) => ({
      ok: true,
      json: async () => url.endsWith("/stringify") ? { source: "name: Home\n" } : {}
    }),
    getActiveScreen: () => screen,
    getActiveScreenIndex: () => 0,
    getScreenIndex: () => 0,
    invalidYamlFiles: new Map(),
    markEdited() {},
    renderNavigation() {},
    renderScreen() {},
    updateSaveControls() {},
    validatePreviewStates() {}
  });
  editor.mode = "yaml";

  await editor.prepareSource(screen);

  assert.equal(screen.yamlSource, "name: Home\n");
  assert.equal(screen.yamlSourceMode, "generated");
  assert.equal(textarea.value, "name: Home\n");
  assert.equal(status.textContent, "YAML source is ready.");
});
