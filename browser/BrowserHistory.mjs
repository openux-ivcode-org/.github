export class BrowserHistory {
  constructor({
    windowObject,
    getCurrentSelection,
    getSelectionFilePath,
    isRenderOnly,
    isUpdatesSuppressed
  }) {
    this.window = windowObject;
    this.getCurrentSelection = getCurrentSelection;
    this.getSelectionFilePath = getSelectionFilePath;
    this.isRenderOnly = isRenderOnly;
    this.isUpdatesSuppressed = isUpdatesSuppressed;
    this.initialized = false;
  }

  selectionFromLocation() {
    const parameters = new URLSearchParams(this.window.location.search);
    const file = parameters.get("file");
    if (!file) return null;

    let instancePath = null;
    const encodedInstancePath = parameters.get("instancePath");
    if (encodedInstancePath) {
      try {
        const parsed = JSON.parse(encodedInstancePath);
        if (Array.isArray(parsed) && parsed.every((part) =>
          typeof part === "string" || (Number.isInteger(part) && part >= 0)
        )) {
          instancePath = parsed;
        }
      } catch {
        instancePath = null;
      }
    }
    return {
      view: "url",
      file,
      requestedView: parameters.get("view"),
      screen: parameters.get("screen") ? { id: parameters.get("screen") } : null,
      owner: parameters.get("owner"),
      instancePath,
      assetId: parameters.get("assetId")
    };
  }

  sync(forceReplace = false) {
    if (this.isRenderOnly() || this.isUpdatesSuppressed()) return;
    const selection = this.getCurrentSelection();
    const filePath = this.getSelectionFilePath(selection);
    if (!filePath) return;

    const url = new URL(this.window.location.href);
    url.searchParams.set("file", filePath);
    url.searchParams.set("view", selection.view);
    if (selection.screen?.id) url.searchParams.set("screen", selection.screen.id);
    else url.searchParams.delete("screen");
    if (selection.view === "spec" && selection.spec?.owner) {
      url.searchParams.set("owner", selection.spec.owner);
    } else {
      url.searchParams.delete("owner");
    }
    const instancePath = selection.spec?.instancePath || selection.selectedAsset?.instancePath;
    if (Array.isArray(instancePath)) {
      url.searchParams.set("instancePath", JSON.stringify(instancePath));
    } else {
      url.searchParams.delete("instancePath");
    }
    if (selection.view === "asset-template" && selection.asset?.id) {
      url.searchParams.set("assetId", selection.asset.id);
    } else {
      url.searchParams.delete("assetId");
    }

    const state = this.window.history.state && typeof this.window.history.state === "object"
      ? { ...this.window.history.state }
      : {};
    state.openuxEditor = {
      file: filePath,
      selection: this.createHistorySelection(selection)
    };
    const previousFile = new URL(this.window.location.href).searchParams.get("file");
    if (!this.initialized || forceReplace || previousFile === filePath) {
      this.window.history.replaceState(state, "", url);
    } else {
      this.window.history.pushState(state, "", url);
    }
    this.initialized = true;
  }

  createHistorySelection(selection) {
    const snapshot = { view: selection.view };
    if (selection.screen?.id) snapshot.screen = { id: selection.screen.id };
    if (selection.view === "theme") snapshot.file = selection.file;
    if (selection.view === "spec" && selection.spec) {
      snapshot.spec = {
        file: selection.spec.file,
        owner: selection.spec.owner,
        ...(Array.isArray(selection.spec.instancePath)
          ? { instancePath: [...selection.spec.instancePath] }
          : {})
      };
    }
    if (selection.view === "asset-template" && selection.asset) {
      snapshot.asset = {
        id: selection.asset.id,
        file: selection.asset.file
      };
    }
    if (selection.selectedAsset?.instancePath) {
      snapshot.selectedAsset = { instancePath: [...selection.selectedAsset.instancePath] };
    }
    return snapshot;
  }
}
