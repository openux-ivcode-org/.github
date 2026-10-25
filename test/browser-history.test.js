const assert = require("node:assert/strict");
const test = require("node:test");

function createWindow(href) {
  const location = new URL(href);
  const history = {
    calls: [],
    state: { retained: true },
    pushState(state, title, url) {
      this.calls.push({ method: "push", state, title, url: url.href });
      this.state = state;
      location.href = url.href;
    },
    replaceState(state, title, url) {
      this.calls.push({ method: "replace", state, title, url: url.href });
      this.state = state;
      location.href = url.href;
    }
  };
  return { location, history };
}

function createController(windowObject, options = {}) {
  return import("../browser/BrowserHistory.mjs").then(({ BrowserHistory }) =>
    new BrowserHistory({
      windowObject,
      getCurrentSelection: () => options.selection,
      getSelectionFilePath: (selection) => selection.screen?.file || null,
      isRenderOnly: () => false,
      isUpdatesSuppressed: () => false
    })
  );
}

test("reads editor selections and nested Element paths from the URL", async () => {
  const windowObject = createWindow(
    "http://localhost/?file=screens%2Fhome%2Fscreen.yml&view=screen&screen=home&instancePath=%5B%22layout%22%2C%22content%22%2C0%5D"
  );
  const controller = await createController(windowObject);
  assert.deepEqual(controller.selectionFromLocation(), {
    view: "url",
    file: "screens/home/screen.yml",
    requestedView: "screen",
    screen: { id: "home" },
    owner: null,
    instancePath: ["layout", "content", 0],
    assetId: null
  });
});

test("writes browser history while retaining unrelated history state", async () => {
  const windowObject = createWindow("http://localhost/");
  const options = {
    selection: {
      view: "screen",
      screen: { id: "home", file: "screens/home/screen.yml" },
      selectedAsset: { instancePath: ["layout", "content", 0] }
    }
  };
  const controller = await createController(windowObject, options);
  controller.sync();
  assert.equal(windowObject.history.calls[0].method, "replace");
  assert.equal(
    new URL(windowObject.history.calls[0].url).searchParams.get("instancePath"),
    JSON.stringify(["layout", "content", 0])
  );
  assert.equal(windowObject.history.calls[0].state.retained, true);
  assert.deepEqual(windowObject.history.calls[0].state.openuxEditor.selection.selectedAsset, {
    instancePath: ["layout", "content", 0]
  });

  options.selection = {
    view: "screen",
    screen: { id: "sign-in", file: "screens/sign-in/screen.yml" }
  };
  controller.sync();
  assert.equal(windowObject.history.calls[1].method, "push");
});
