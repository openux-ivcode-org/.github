const appRoot = new URL("./openux/", window.location.href);
const booleanHtmlAttributes = new Set([
  "allowfullscreen", "async", "autofocus", "autoplay", "checked", "controls", "default",
  "defer", "disabled", "formnovalidate", "hidden", "inert", "ismap", "loop", "multiple",
  "muted", "nomodule", "novalidate", "open", "playsinline", "readonly", "required",
  "reversed", "selected"
]);
const sharedValidation = window.OpenuxValidation;
const { attributeTypes, numberFormats, themeModeNames } = sharedValidation;
const systemThemeQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
const renderParameters = new URLSearchParams(window.location.search);
const renderRequestedScreen = renderParameters.get("render");
const renderRequestedState = renderParameters.get("state");
const isRenderOnly = renderRequestedScreen !== null;
const assetDragType = "application/x-openux-asset-template";
const assetInstanceDragType = "application/x-openux-asset-instance";
const byId = (id) => document.getElementById(id);

let project;
let screens = [];
let assets = new Map();
let specSources = new Map();
let theme;
let themeStylesheet = "";
let themeStylesheetBase = appRoot;
let themeModePreference = "system";
let systemThemeMode = systemThemeQuery?.matches ? "dark" : "light";
let appliedThemeTokens = new Set();
let activeScreenIndex = 0;
const activePreviewStateIds = new Map();
const expandedScreenIds = new Set();
let activeAssetId = null;
let activeInstancePath = [];
let viewingAssetTemplate = false;
let viewingTheme = false;
let viewingProject = false;
let viewingSpec = false;
let viewingPreviewState = false;
let activeSpecPath = null;
let activeSpecInstancePath = [];
let activeSpecOwner = "instance";
let assetEditorRestoreId = null;
let paletteAssetDropHandled = false;
let reviewedInSession = false;
let hasEdits = false;
let assetContextMenuTarget = null;
let pendingAssetDeletion = null;
let deleteDialogReturnFocus = null;
const pendingAssetCopies = [];
const dirtyFiles = new Map();
const invalidYamlFiles = new Map();
const createdScreenFiles = new Set();
const createdSpecFiles = new Set();
const createdSpecDrafts = new Map();
let editVersion = 0;
let isSaving = false;
let assetPreviewTimer = null;
let assetPreviewVersion = 0;
let editorFieldId = 0;
let assetStyleScopeId = 0;

if (isRenderOnly) document.body.classList.add("render-only");

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function getScreenPreviewStates(screen) {
  return sharedValidation.getPreviewStates(screen);
}

function getActivePreviewStateId(screen = screens[activeScreenIndex]?.data) {
  if (!screen) return "default";
  const states = getScreenPreviewStates(screen);
  const activeId = activePreviewStateIds.get(screens[activeScreenIndex]?.id);
  return states.some((state) => state.id === activeId)
    ? activeId
    : "default";
}

function isInstanceVisible(instance, stateId = getActivePreviewStateId()) {
  return instance.visibility?.[stateId] !== false;
}

function renderPreviewStateControls(screen) {
  const toolbar = byId("preview-state-toolbar");
  const select = byId("preview-state-select");
  const addButton = byId("add-preview-state");
  const states = getScreenPreviewStates(screen);
  const activeStateId = getActivePreviewStateId(screen);
  activePreviewStateIds.set(screens[activeScreenIndex].id, activeStateId);
  toolbar.hidden = isRenderOnly;
  select.replaceChildren();
  for (const state of states) {
    const option = element("option", "", state.name);
    option.value = state.id;
    select.append(option);
  }
  select.value = activeStateId;
  select.onchange = () => switchPreviewState(select.value).catch(showFatalError);
  addButton.onclick = () => addPreviewState().catch(showFatalError);
}

function hidePreviewStateControls() {
  byId("preview-state-toolbar").hidden = true;
}

function renamePreviewState(stateId, name) {
  const screen = screens[activeScreenIndex];
  const normalizedName = name.trim();
  if (!normalizedName) {
    showEditorMessage("Preview state needs a name", "Enter a name before leaving this field.");
    renderPreviewStateControls(screen.data);
    return;
  }
  const states = getScreenPreviewStates(screen.data);
  if (!screen.data["preview-states"]) {
    screen.data["preview-states"] = states.map((state) => ({ ...state }));
  }
  const state = screen.data["preview-states"].find((candidate) => candidate.id === stateId);
  if (!state || state.name === normalizedName) return;
  state.name = normalizedName;
  markEdited(screen.file);
  renderPreviewStateControls(screen.data);
  renderInspector();
}

function describePreviewState(stateId, description) {
  const screen = screens[activeScreenIndex];
  const states = screen.data["preview-states"];
  const state = states?.find((candidate) => candidate.id === stateId);
  if (!state || state.description === description) return;
  state.description = description;
  markEdited(screen.file);
}

async function switchPreviewState(stateId) {
  const screen = screens[activeScreenIndex];
  const states = getScreenPreviewStates(screen.data);
  if (!states.some((state) => state.id === stateId)) {
    throw new Error(`Unknown preview state "${stateId}".`);
  }
  const screenIndex = activeScreenIndex;
  activePreviewStateIds.set(screen.id, stateId);
  await renderScreen(screenIndex, { previewStateSelected: true });
}

async function addPreviewState() {
  const screen = screens[activeScreenIndex];
  const screenIndex = activeScreenIndex;
  const states = getScreenPreviewStates(screen.data);
  let number = 2;
  while (states.some((state) => state.id === `state-${number}`)) number += 1;
  if (!screen.data["preview-states"]) {
    screen.data["preview-states"] = states.map((state) => ({ ...state }));
  }
  const newState = { id: `state-${number}`, name: `State ${number}`, description: "" };
  screen.data["preview-states"].push(newState);
  activePreviewStateIds.set(screen.id, newState.id);
  markEdited(screen.file);
  await renderScreen(screenIndex, { previewStateSelected: true });
  byId("preview-state-description-detail")?.focus();
}

function removeStateVisibility(instance, stateId) {
  if (instance.visibility) {
    delete instance.visibility[stateId];
    if (Object.keys(instance.visibility).length === 0) delete instance.visibility;
  }
  for (const children of Object.values(instance.slots || {})) {
    if (Array.isArray(children)) children.forEach((child) => removeStateVisibility(child, stateId));
  }
}

function renderScreenInstanceTree(panel, instances, parentPath = [], depth = 0, stateId = "default") {
  if (!Array.isArray(instances)) return;
  instances.forEach((instance, index) => {
    const path = parentPath.length ? [...parentPath, index] : [index];
    const template = assets.get(instance["asset-template"]);
    const label = instance.name || template?.data.name || instance["asset-template"];
    const visible = path.length === 1 || isInstanceVisible(instance, stateId);
    const button = element(
      "button",
      "instance-tree-button",
      `${label} · ${visible ? "Visible" : "Hidden"}`
    );
    button.type = "button";
    button.style.paddingLeft = `${10 + depth * 14}px`;
    button.setAttribute("aria-label", `Select ${label}; ${visible ? "visible" : "hidden"} in this preview state`);
    button.addEventListener("click", () => selectInstance(path, instance["asset-template"]));
    panel.append(button);
    for (const [slotId, children] of Object.entries(instance.slots || {})) {
      if (!Array.isArray(children)) continue;
      renderScreenInstanceTree(panel, children, [...path, slotId], depth + 1, stateId);
    }
  });
}

async function deletePreviewState(stateId) {
  if (stateId === "default") return;
  const screen = screens[activeScreenIndex];
  const states = getScreenPreviewStates(screen.data);
  const state = states.find((candidate) => candidate.id === stateId);
  if (!state || !window.confirm(`Delete the "${state.name}" preview state and its visibility settings?`)) return;
  const instancePath = [...activeInstancePath];
  const keepPreviewStateSelected = viewingPreviewState;
  const wasActive = activePreviewStateIds.get(screen.id) === stateId;
  screen.data["preview-states"] = states.filter((candidate) => candidate.id !== stateId);
  screen.data.assets.forEach((instance) => removeStateVisibility(instance, stateId));
  if (wasActive) {
    activePreviewStateIds.set(screen.id, "default");
  }
  markEdited(screen.file);
  await renderScreen(activeScreenIndex, { previewStateSelected: keepPreviewStateSelected });
  if (keepPreviewStateSelected) return;
  const instance = getInstanceAtPath(screen, instancePath);
  if (instance) selectInstance(instancePath, instance["asset-template"]);
}

function safeProjectUrl(path, base = appRoot) {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("\\")) {
    throw new Error(`Invalid project file path: ${String(path)}`);
  }
  if (path.split("/").includes("..")) {
    throw new Error(`Project paths cannot leave their directory: ${path}`);
  }
  const url = new URL(path, base);
  if (url.origin !== appRoot.origin || !url.pathname.startsWith(appRoot.pathname)) {
    throw new Error(`Project resource is outside the openux/ example project: ${path}`);
  }
  return url;
}

async function loadText(path, base = appRoot) {
  const response = await fetch(safeProjectUrl(path, base));
  if (!response.ok) {
    throw new Error(`Could not load ${path} (HTTP ${response.status}).`);
  }
  return response.text();
}

async function loadYaml(path) {
  const parsed = parseOpenuxYaml(await loadText(path));
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`${path} must contain a YAML mapping.`);
  }
  return parsed;
}

function collectInstanceSpecPaths(instance, paths = new Set()) {
  if (!instance || typeof instance !== "object" || Array.isArray(instance)) return paths;
  if (Object.hasOwn(instance, "interactions")) {
    throw new Error("Screen asset interactions are no longer supported; describe behavior in an instance-linked Markdown spec.");
  }
  if (instance.spec !== undefined) {
    sharedValidation.validateSpecPath(instance.spec);
    paths.add(instance.spec);
  }
  for (const children of Object.values(instance.slots || {})) {
    if (Array.isArray(children)) {
      for (const child of children) collectInstanceSpecPaths(child, paths);
    }
  }
  return paths;
}

function assetCategoryPath(template, source) {
  return sharedValidation.assetCategoryPath(template, source);
}

function validateAssetAttributes(template, source) {
  return sharedValidation.validateAssetAttributes(template, source);
}

function validateAssetSlots(template, source) {
  return sharedValidation.validateAssetSlots(template, source);
}

function validateAssetSlotMarkup(template, markup, source) {
  return sharedValidation.validateAssetSlotMarkup(template, markup, source);
}

function validateTheme(data, source) {
  return sharedValidation.validateTheme(data, source);
}

function getDefinedThemeModes() {
  const modes = theme?.modes;
  const definedModes = themeModeNames.filter((mode) =>
    modes && Object.hasOwn(modes, mode)
  );
  if (definedModes.length) return definedModes;
  return theme && Object.hasOwn(theme, "colors") ? ["light"] : [];
}

function getActiveThemeMode() {
  const modes = getDefinedThemeModes();
  const requestedMode = themeModePreference === "system" ? systemThemeMode : themeModePreference;
  return modes.includes(requestedMode) ? requestedMode : modes[0] || requestedMode;
}

function getThemeColors(mode = getActiveThemeMode()) {
  const modes = getDefinedThemeModes();
  const activeMode = modes.includes(mode) ? mode : modes[0];
  if (!activeMode) return {};
  if (!theme?.modes || !Object.hasOwn(theme.modes, activeMode)) return theme?.colors || {};

  const fallbackMode = activeMode === "light" ? "dark" : "light";
  return {
    ...(theme.modes[fallbackMode]?.colors || {}),
    ...(theme.modes[activeMode]?.colors || {})
  };
}

function themeModeLabel(mode) {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function isValidAttributeValue(definition, value) {
  return sharedValidation.isValidAttributeValue(definition, value);
}

async function loadProject(selectionToRestore = null) {
  clearTimeout(assetPreviewTimer);
  assetPreviewTimer = null;
  assetPreviewVersion += 1;
  for (const template of assets.values()) {
    clearTimeout(template.yamlTimer);
    template.yamlParseVersion += 1;
  }
  createdScreenFiles.clear();
  createdSpecFiles.clear();
  createdSpecDrafts.clear();
  pendingAssetCopies.length = 0;
  setPreviewMessage("loading", "Reading project files...");
  try {
    project = await loadYaml("project.yml");
    if (typeof project.openux !== "string" || !project.openux) {
      throw new Error("project.yml must specify the OpenUX version in openux.");
    }
    if (!Array.isArray(project.screens) || !Array.isArray(project.assets)) {
      throw new Error("project.yml must list screens and assets.");
    }
    if (Object.hasOwn(project, "workflows")) {
      throw new Error("project.yml workflows are no longer supported; use project.spec or an asset instance's spec.");
    }

    const [loadedScreens, loadedAssets, loadedTheme] = await Promise.all([
      Promise.all(project.screens.map(async (entry) => ({
        id: entry.id,
        file: entry.file,
        data: await loadYaml(entry.file)
      }))),
      Promise.all(project.assets.map(async (entry) => {
        const directory = entry.directory.replace(/\/+$/, "");
        const base = safeProjectUrl(`${directory}/`);
        const data = await loadYaml(`${directory}/asset.yml`);
        if (data.id !== entry.id) {
          throw new Error(`Asset id mismatch in ${directory}/asset.yml.`);
        }
        assetCategoryPath(data, `${directory}/asset.yml`);
        validateAssetAttributes(data, `${directory}/asset.yml`);
        validateAssetSlots(data, `${directory}/asset.yml`);
        const htmlPath = data.render?.source || "asset.html";
        const [html, yamlSource] = await Promise.all([
          loadText(htmlPath, base),
          loadText("asset.yml", base)
        ]);
        validateAssetSlotMarkup(data, html, `${directory}/${htmlPath}`);
        return {
          id: entry.id,
          screen: entry.screen,
          copiedFrom: entry["copied-from"],
          directory,
          base,
          data,
          htmlFile: `${directory}/${htmlPath}`,
          yamlSource,
          yamlSourceMode: "source",
          yamlParseVersion: 0,
          yamlSerializeVersion: 0,
          html
        };
      })),
      (async () => {
        const data = await loadYaml(project.theme);
        validateTheme(data, project.theme);
        const themeDirectory = project.theme.includes("/")
          ? project.theme.slice(0, project.theme.lastIndexOf("/") + 1)
          : "";
        const themeBase = themeDirectory ? safeProjectUrl(themeDirectory) : appRoot;
        if (data.styles === undefined) return { data, stylesheet: "", stylesheetBase: themeBase };
        if (typeof data.styles !== "string" || !data.styles) {
          throw new Error(`${project.theme} styles must be a relative CSS file path.`);
        }
        const stylesDirectory = data.styles.includes("/")
          ? data.styles.slice(0, data.styles.lastIndexOf("/") + 1)
          : "";
        return {
          data,
          stylesheet: await loadText(data.styles, themeBase),
          stylesheetBase: stylesDirectory ? safeProjectUrl(stylesDirectory, themeBase) : themeBase
        };
      })()
    ]);

    screens = loadedScreens;
    activePreviewStateIds.clear();
    assets = new Map(loadedAssets.map((asset) => [asset.id, asset]));
    for (const asset of loadedAssets) {
      if (asset.screen !== undefined && !screens.some((screen) => screen.id === asset.screen)) {
        throw new Error(`Asset "${asset.id}" references unknown Screen "${asset.screen}".`);
      }
    }
    const specPaths = new Set();
    for (const screen of screens) {
      if (screen.data.spec !== undefined) {
        sharedValidation.validateSpecPath(screen.data.spec);
        specPaths.add(screen.data.spec);
      }
      for (const instance of screen.data.assets || []) collectInstanceSpecPaths(instance, specPaths);
    }
    if (project.spec !== undefined) {
      sharedValidation.validateSpecPath(project.spec);
      specPaths.add(project.spec);
    }
    specSources = new Map(await Promise.all([...specPaths].map(async (filePath) =>
      [filePath, await loadText(filePath)]
    )));
    theme = loadedTheme.data;
    themeStylesheet = loadedTheme.stylesheet;
    themeStylesheetBase = loadedTheme.stylesheetBase;
    viewingTheme = false;
    viewingProject = false;
    viewingSpec = false;
    viewingPreviewState = false;
    activeSpecPath = null;
    activeSpecInstancePath = [];
    activeSpecOwner = "instance";
    hasEdits = false;
    dirtyFiles.clear();
    invalidYamlFiles.clear();
    byId("create-screen").disabled = false;
    byId("project-nav").disabled = false;
    updateSaveControls();
    reviewedInSession = false;
    applyTheme();
    renderNavigation();
    if (isRenderOnly) {
      const renderIndex = screens.findIndex((screen) => screen.id === renderRequestedScreen);
      if (renderIndex < 0) throw new Error(`Unknown Screen "${renderRequestedScreen}".`);
      if (renderRequestedState !== null) {
        const renderScreenData = screens[renderIndex].data;
        if (!getScreenPreviewStates(renderScreenData).some((state) => state.id === renderRequestedState)) {
          throw new Error(
            `Unknown preview state "${renderRequestedState}" for Screen "${renderRequestedScreen}".`
          );
        }
        activePreviewStateIds.set(screens[renderIndex].id, renderRequestedState);
      }
      await renderScreen(renderIndex);
      if (byId("screen-preview").classList.contains("error")) {
        throw new Error(byId("screen-preview").textContent.trim() || "Screen render failed.");
      }
      document.body.dataset.openuxRenderHeight = String(Math.ceil(Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
        byId("screen-preview").scrollHeight
      )));
      document.body.dataset.openuxRenderReady = "true";
      if (new URLSearchParams(window.location.search).get("format") === "html") {
        document.body.dataset.openuxRenderHtml = encodeBase64(standaloneScreenHtml());
      }
    } else if (selectionToRestore) {
      await restoreUiSelection(selectionToRestore);
    } else {
      await renderScreen(0);
    }
  } catch (error) {
    showFatalError(error);
  }
}

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function cloneRenderedNode(node) {
  if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
  if (node.nodeType !== Node.ELEMENT_NODE) return node.cloneNode(false);
  const copy = node.cloneNode(false);
  const children = node.shadowRoot ? node.shadowRoot.childNodes : node.childNodes;
  if (node.shadowRoot) {
    const shadowTemplate = document.createElement("template");
    shadowTemplate.setAttribute("shadowrootmode", "open");
    for (const child of children) shadowTemplate.content.append(cloneRenderedNode(child));
    copy.append(shadowTemplate);
  } else {
    for (const child of children) copy.append(cloneRenderedNode(child));
  }
  return copy;
}

function standaloneScreenHtml() {
  const outputDocument = document.implementation.createHTMLDocument("");
  outputDocument.documentElement.lang = "en";
  const rootStyle = document.documentElement.getAttribute("style") || "";
  if (rootStyle) outputDocument.documentElement.setAttribute("style", rootStyle);
  const themeBackground = getThemeColors().background;
  if (themeBackground !== undefined) outputDocument.body.style.backgroundColor = themeBackground;
  const charset = outputDocument.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  outputDocument.head.append(charset);
  for (const style of document.head.querySelectorAll("style")) {
    outputDocument.head.append(style.cloneNode(true));
  }
  outputDocument.body.append(cloneRenderedNode(byId("screen-preview")));
  return `<!doctype html>\n${outputDocument.documentElement.outerHTML}\n`;
}

function currentUiSelection() {
  const screen = screens[activeScreenIndex] || null;
  const screenContext = screen ? {
    id: screen.id,
    name: screen.data.name || screen.id,
    file: screen.file
  } : null;
  if (viewingProject) return { view: "project", screen: screenContext };
  if (viewingTheme) return { view: "theme", screen: screenContext, file: project?.theme || null };
  if (viewingSpec) {
    return {
      view: "spec",
      screen: activeSpecOwner === "project" ? null : screenContext,
      spec: activeSpecPath ? {
        file: activeSpecPath,
        owner: activeSpecOwner,
        ...(activeSpecOwner === "instance" ? { instancePath: activeSpecInstancePath } : {})
      } : null
    };
  }
  if (viewingAssetTemplate) {
    const template = assets.get(activeAssetId);
    return {
      view: "asset-template",
      screen: screenContext,
      asset: template ? {
        id: template.id,
        name: template.data.name || template.id,
        directory: template.directory,
        manifestFile: `${template.directory}/asset.yml`,
        htmlFile: template.htmlFile
      } : null
    };
  }
  const instance = screen && activeAssetId ? getInstanceAtPath(screen, activeInstancePath) : null;
  const template = activeAssetId ? assets.get(activeAssetId) : null;
  return {
    view: "screen",
    screen: screenContext,
    selectedAsset: instance && template ? {
      id: template.id,
      name: instance.name || template.data.name || template.id,
      instancePath: activeInstancePath,
      instance,
      template: {
        name: template.data.name || template.id,
        description: template.data.description || "",
        attributes: template.data.attributes || {},
        slots: template.data.slots || []
      }
    } : null
  };
}

async function restoreUiSelection(selection) {
  const screenIndex = screens.findIndex((screen) => screen.id === selection.screen?.id);
  activeScreenIndex = screenIndex >= 0 ? screenIndex : 0;
  if (selection.view === "project") {
    renderProjectOverview();
    return;
  }
  if (selection.view === "theme") {
    byId("theme-nav").click();
    return;
  }
  if (selection.view === "asset-template" && assets.has(selection.asset?.id)) {
    await renderAssetTemplate(selection.asset.id);
    return;
  }
  if (selection.view === "spec" && selection.spec?.owner === "project") {
    if (project.spec === selection.spec.file) {
      renderProjectOverview();
      await renderSpecEditor(selection.spec.file, [], "project");
    } else {
      renderProjectOverview();
    }
    return;
  }
  await renderScreen(activeScreenIndex);
  if (selection.view === "spec") {
    const screen = screens[activeScreenIndex];
    const instancePath = selection.spec?.instancePath;
    const instance = Array.isArray(instancePath) && screen
      ? getInstanceAtPath(screen, instancePath)
      : null;
    if (instance && typeof selection.spec?.file === "string" &&
        instance.spec === selection.spec.file) {
      await renderSpecEditor(selection.spec.file, instancePath);
      return;
    }
    if (instance) {
      selectInstance(instancePath, instance["asset-template"]);
      return;
    }
  }
  const instancePath = selection.selectedAsset?.instancePath;
  if (Array.isArray(instancePath)) {
    const screen = screens[activeScreenIndex];
    const instance = screen && getInstanceAtPath(screen, instancePath);
    if (instance) selectInstance(instancePath, instance["asset-template"]);
  }
}

function refreshFromExternalChanges() {
  if (hasEdits) {
    showEditorMessage(
      "Project files changed outside the editor",
      "Save or reset your editor changes before refreshing from disk."
    );
    return;
  }
  loadProject(currentUiSelection());
}

if (!isRenderOnly && typeof EventSource !== "undefined") {
  const projectEvents = new EventSource("/api/events");
  projectEvents.addEventListener("project-updated", refreshFromExternalChanges);
}

function applyTheme() {
  const colors = getThemeColors();
  const colorNames = new Set(Object.keys(colors));
  const themeRoot = byId("screen-preview");
  for (const name of appliedThemeTokens) {
    if (!colorNames.has(name)) themeRoot.style.removeProperty(`--theme-${name}`);
  }
  for (const [name, value] of Object.entries(colors)) {
    themeRoot.style.setProperty(`--theme-${name}`, value);
  }
  appliedThemeTokens = colorNames;
  byId("screen-preview").style.colorScheme = getActiveThemeMode();
  byId("theme-name").textContent = theme.name || "Theme";
}

function renderNavigation() {
  if (!viewingAssetTemplate && !viewingTheme && !viewingProject && !viewingSpec) {
    byId("breadcrumb").textContent = "Screens";
  }
  const screenNav = byId("screen-nav");
  const assetNav = byId("asset-nav");
  screenNav.replaceChildren();
  assetNav.replaceChildren();

  screens.forEach((screen, index) => {
    const screenName = screen.data.name || screen.id;
    const pageAssets = [...assets.values()].filter((asset) => asset.screen === screen.id);
    const group = element("div", "screen-nav-group");
    const row = element("div", "screen-nav-row");
    const button = element("button", "side-item screen-option");
    button.type = "button";
    button.dataset.screenIndex = String(index);
    button.dataset.openuxScreenId = screen.id;
    button.dataset.openuxScreenName = screenName;
    button.append(element("span", "side-icon", "S"));
    button.append(element("span", "screen-option-name", screenName));
    button.addEventListener("click", () => renderScreen(index));
    row.append(button);

    const expandButton = element("button", "screen-expand-button");
    expandButton.id = `screen-expand-${screen.id}`;
    expandButton.type = "button";
    expandButton.setAttribute("aria-expanded", String(expandedScreenIds.has(screen.id)));
    expandButton.setAttribute("aria-controls", `screen-assets-${screen.id}`);
    expandButton.setAttribute(
      "aria-label",
      `${expandedScreenIds.has(screen.id) ? "Hide" : "Show"} page-specific assets for ${screenName}`
    );
    expandButton.addEventListener("click", () =>
      setScreenExpanded(screen.id, !expandedScreenIds.has(screen.id))
    );
    row.append(expandButton);
    group.append(row);

    const pageAssetPanel = element("div", "screen-assets");
    pageAssetPanel.id = `screen-assets-${screen.id}`;
    pageAssetPanel.hidden = !expandedScreenIds.has(screen.id);
    pageAssetPanel.setAttribute("role", "group");
    pageAssetPanel.setAttribute("aria-label", `${screenName} page-specific assets`);
    if (pageAssets.length) {
      const library = element("div", "asset-library");
      library.append(...renderAssetCategories(pageAssets));
      pageAssetPanel.append(library);
    } else {
      pageAssetPanel.append(element("div", "asset-hint", "No page-specific templates."));
    }
    group.append(pageAssetPanel);
    screenNav.append(group);
  });

  const sharedAssets = [...assets.values()].filter((asset) => asset.screen === undefined);
  if (sharedAssets.length) {
    byId("asset-library-label").hidden = false;
    assetNav.hidden = false;
    assetNav.append(...renderAssetCategories(sharedAssets));
  } else {
    byId("asset-library-label").hidden = true;
    assetNav.hidden = true;
  }
  updateNavigationSelection();
}

function setScreenExpanded(screenId, expanded) {
  if (expanded) expandedScreenIds.add(screenId);
  else expandedScreenIds.delete(screenId);
  const button = byId(`screen-expand-${screenId}`);
  const panel = byId(`screen-assets-${screenId}`);
  if (!button || !panel) return;
  button.setAttribute("aria-expanded", String(expanded));
  button.setAttribute(
    "aria-label",
    `${expanded ? "Hide" : "Show"} page-specific assets for ${screens.find((screen) => screen.id === screenId)?.data.name || screenId}`
  );
  panel.hidden = !expanded;
}

function renderAssetCategories(assetEntries) {
  const categories = { children: new Map(), assets: [] };
  for (const asset of assetEntries) {
    let category = categories;
    for (const segment of assetCategoryPath(asset.data, `${asset.directory}/asset.yml`)) {
      if (!category.children.has(segment)) {
        category.children.set(segment, { children: new Map(), assets: [] });
      }
      category = category.children.get(segment);
    }
    category.assets.push(asset);
  }
  return [...categories.children]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, category]) => renderAssetCategory(name, category));
}

function renderAssetCategory(name, category) {
  const details = element("details", "asset-category");
  details.open = true;
  details.append(element("summary", "", name));
  const content = element("div", "asset-category-content");
  const categoryAssets = [...category.assets].sort((left, right) =>
    (left.data.name || left.id).localeCompare(right.data.name || right.id)
  );
  for (const asset of categoryAssets) {
    const button = element("button", "asset-row");
    const assetName = asset.data.name || asset.id;
    const targetScreen = screens[activeScreenIndex];
    const requiresRootLayout = targetScreen?.data.assets?.length === 0;
    const canDrag = Boolean(targetScreen) && (!requiresRootLayout || Boolean(asset.data.slots?.length));
    button.type = "button";
    button.dataset.assetId = asset.id;
    button.draggable = canDrag;
    button.setAttribute(
      "aria-label",
      canDrag
        ? `Edit ${assetName} template; drag to add to ${targetScreen?.data.name || "current Screen"}`
        : `Edit ${assetName} template; select a Screen to add it`
    );
    button.append(element("span", "asset-dot", assetName.slice(0, 1).toUpperCase()));
    button.append(element("span", "asset-name", assetName));
    if (asset.data.slots) button.append(element("span", "asset-kind-badge", "Layout"));
    button.addEventListener("click", () => renderAssetTemplate(asset.id).catch(showFatalError));
    button.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData(assetDragType, asset.id);
      event.dataTransfer.setData("text/plain", asset.id);
      event.dataTransfer.effectAllowed = "copy";
      assetEditorRestoreId = viewingAssetTemplate ? activeAssetId : null;
      paletteAssetDropHandled = false;
      if (assetEditorRestoreId !== null) {
        renderScreen(activeScreenIndex).catch(showFatalError);
      }
    });
    button.addEventListener("dragend", () => {
      const restoreAssetId = assetEditorRestoreId;
      const shouldRestoreEditor = restoreAssetId !== null && !paletteAssetDropHandled;
      assetEditorRestoreId = null;
      paletteAssetDropHandled = false;
      clearDropIndicators();
      if (shouldRestoreEditor) {
        renderAssetTemplate(restoreAssetId).catch(showFatalError);
      }
    });
    content.append(button);
  }
  for (const [childName, child] of [...category.children].sort(([left], [right]) => left.localeCompare(right))) {
    content.append(renderAssetCategory(childName, child));
  }
  details.append(content);
  return details;
}

async function createScreen() {
  const enteredName = window.prompt("Name for the new Screen:", "New Screen");
  if (enteredName === null) return;
  const name = enteredName.trim();
  if (!name) {
    showEditorMessage("Screen name required", "Enter a name before creating a Screen.");
    return;
  }
  const baseId = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "screen";
  let id;
  let file;
  for (let suffix = 1; ; suffix += 1) {
    id = suffix === 1 ? baseId : `${baseId}-${suffix}`;
    file = `screens/${id}.yml`;
    const alreadyListed = screens.some((screen) => screen.id === id || screen.file === file) ||
      project.screens.some((screen) => screen.id === id || screen.file === file);
    if (alreadyListed) continue;
    const response = await fetch(safeProjectUrl(file));
    if (response.status === 404) break;
    if (!response.ok) throw new Error(`Could not check Screen file "${file}" (HTTP ${response.status}).`);
  }

  const screen = {
    id,
    file,
    data: { name, description: "", assets: [] }
  };
  screens.push(screen);
  project.screens.push({ id, file });
  createdScreenFiles.add(file);
  markEdited(file);
  markEdited("project.yml");
  activeScreenIndex = screens.length - 1;
  renderNavigation();
  renderScreen(activeScreenIndex).catch(showFatalError);
}

function createAssetInstance(template, siblings) {
  const templateName = template.data.name || template.id;
  const sameTemplateCount = siblings.filter((instance) => instance["asset-template"] === template.id).length;
  const attributes = Object.fromEntries(
    Object.entries(template.data.attributes || {})
      .filter(([, definition]) =>
        definition.overridable === true && Object.hasOwn(definition, "default")
      )
      .map(([name, definition]) => [name, definition.default])
  );
  const instance = {
    "asset-template": template.id,
    name: sameTemplateCount === 0 ? templateName : `${templateName} ${sameTemplateCount + 1}`,
    description: template.data.description || "",
    attributes
  };
  if (template.data.slots) instance.slots = {};
  return instance;
}

async function ensureAssetOnScreen(template, screen) {
  if (!template.screen || template.screen === screen.id) return template;
  const existingEntry = project.assets.find((entry) =>
    entry.screen === screen.id && entry["copied-from"] === template.id
  );
  if (existingEntry) {
    const existingCopy = assets.get(existingEntry.id);
    if (!existingCopy) {
      throw new Error(`Copied asset "${existingEntry.id}" is not available in this project.`);
    }
    return existingCopy;
  }

  const baseId = `${screen.id}-${template.id}`;
  let id;
  let directory;
  for (let suffix = 1; ; suffix += 1) {
    id = suffix === 1 ? baseId : `${baseId}-${suffix}`;
    directory = `assets/${id}`;
    if (project.assets.some((entry) => entry.id === id || entry.directory === directory)) continue;
    const response = await fetch(safeProjectUrl(`${directory}/asset.yml`));
    if (response.status === 404) break;
    if (!response.ok) {
      throw new Error(`Could not check asset directory "${directory}" (HTTP ${response.status}).`);
    }
  }

  const data = JSON.parse(JSON.stringify(template.data));
  data.id = id;
  const yamlResponse = await fetch("/api/yaml/stringify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data })
  });
  const yamlResult = await yamlResponse.json();
  if (!yamlResponse.ok) {
    throw new Error(yamlResult.error || `Could not prepare copied asset YAML (HTTP ${yamlResponse.status}).`);
  }

  const relativeHtmlPath = template.htmlFile.slice(template.directory.length + 1);
  const copy = {
    ...template,
    id,
    screen: screen.id,
    copiedFrom: template.id,
    directory,
    base: safeProjectUrl(`${directory}/`),
    data,
    htmlFile: `${directory}/${relativeHtmlPath}`,
    yamlSource: yamlResult.source,
    yamlSourceMode: "source",
    yamlParseVersion: 0,
    yamlSerializeVersion: 0
  };
  const entry = {
    id,
    directory,
    screen: screen.id,
    "copied-from": template.id
  };
  assets.set(id, copy);
  project.assets.push(entry);
  pendingAssetCopies.push({
    sourceId: template.id,
    sourceDirectory: template.directory,
    targetId: id,
    targetDirectory: directory,
    targetScreen: screen.id
  });
  markEdited("project.yml");
  markEdited(`${directory}/asset.yml`);
  markEdited(copy.htmlFile);
  renderNavigation();
  return copy;
}

function getInstanceAtPath(screen, path) {
  if (!path.length) return null;
  let siblings = screen.data.assets;
  let instance = null;
  for (let part = 0; part < path.length; part++) {
    const index = path[part];
    if (!Number.isInteger(index) || !Array.isArray(siblings)) return null;
    instance = siblings[index];
    if (!instance) return null;
    if (part + 1 < path.length) {
      const slotId = path[++part];
      siblings = instance.slots?.[slotId];
    }
  }
  return instance;
}

function getSiblingList(screen, parentPath, slotId) {
  if (!parentPath.length) {
    if (slotId !== null) throw new Error("Top-level Screen assets do not have a layout slot.");
    if (screen.data.assets !== undefined && !Array.isArray(screen.data.assets)) {
      throw new Error(`Screen "${screen.id}" assets must be a list.`);
    }
    return screen.data.assets || (screen.data.assets = []);
  }
  if (slotId === null) throw new Error("Nested asset instances must belong to a layout slot.");
  const parent = getInstanceAtPath(screen, parentPath);
  const parentTemplate = parent && assets.get(parent["asset-template"]);
  const slot = parentTemplate?.data.slots?.find((candidate) => candidate.id === slotId);
  if (!parent || !slot) throw new Error(`Layout slot "${slotId}" is no longer available.`);
  if (parent.slots !== undefined &&
      (!parent.slots || Array.isArray(parent.slots) || typeof parent.slots !== "object")) {
    throw new Error(`Asset instance "${parent.name || parent["asset-template"]}" slots must be a mapping.`);
  }
  parent.slots ||= {};
  if (parent.slots[slotId] !== undefined && !Array.isArray(parent.slots[slotId])) {
    throw new Error(`Layout slot "${slotId}" contents must be a list.`);
  }
  return parent.slots[slotId] || (parent.slots[slotId] = []);
}

function getInstanceLocation(screen, path) {
  const parentPath = path.length === 1 ? [] : path.slice(0, -2);
  const slotId = path.length === 1 ? null : path[path.length - 2];
  const siblings = getSiblingList(screen, parentPath, slotId);
  const index = path[path.length - 1];
  if (!Number.isInteger(index) || index < 0 || index >= siblings.length) {
    throw new Error("The asset instance is no longer available.");
  }
  return { parentPath, slotId, siblings, index };
}

function instancePathFor(parentPath, slotId, index) {
  return slotId === null ? [...parentPath, index] : [...parentPath, slotId, index];
}

async function addAssetToContainer(assetId, parentPath, slotId, requestedIndex = null) {
  const screen = screens[activeScreenIndex];
  const sourceTemplate = assets.get(assetId);
  if (!screen) throw new Error("Select a Screen before adding an asset.");
  if (!sourceTemplate) throw new Error(`Asset template "${assetId}" is not available.`);
  if (!parentPath.length && (!sourceTemplate.data.slots || slotId !== null)) {
    throw new Error("A Screen's single root asset must be a layout. Drop content assets into its named slot.");
  }
  const instances = getSiblingList(screen, parentPath, slotId);
  if (!parentPath.length && instances.length > 0) {
    throw new Error("A Screen can contain only one root layout asset.");
  }
  const template = await ensureAssetOnScreen(sourceTemplate, screen);
  const index = requestedIndex === null
    ? instances.length
    : Math.max(0, Math.min(requestedIndex, instances.length));
  instances.splice(index, 0, createAssetInstance(template, instances));

  markEdited(screens[activeScreenIndex].file);
  await renderScreen(activeScreenIndex);
  const addedPath = instancePathFor(parentPath, slotId, index);
  selectInstance(addedPath, template.id);
  const addedInstance = findAssetInstances(byId("screen-preview"))
    .find((node) => node.dataset.instancePath === JSON.stringify(addedPath));
  addedInstance?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function addAssetToScreen(assetId) {
  const screen = screens[activeScreenIndex];
  const sourceTemplate = assets.get(assetId);
  if (!screen) throw new Error("Select a Screen before adding an asset.");
  if (!sourceTemplate) throw new Error(`Asset template "${assetId}" is not available.`);
  const rootAssets = screen.data.assets;
  if (!Array.isArray(rootAssets)) throw new Error(`Screen "${screen.id}" assets must be a list.`);

  if (sourceTemplate.data.slots) {
    if (rootAssets.length === 0) {
      return addAssetToContainer(assetId, [], null);
    }
    if (rootAssets.length !== 1) {
      throw new Error("Fix this Screen so it has exactly one root layout before changing its layout.");
    }
    const hasChildren = Object.values(rootAssets[0].slots || {})
      .some((children) => !Array.isArray(children) || children.length > 0);
    if (hasChildren) {
      throw new Error("Move or delete the current layout's content before replacing its root layout.");
    }
    const template = await ensureAssetOnScreen(sourceTemplate, screen);
    if (rootAssets[0]["asset-template"] === template.id) return;
    rootAssets[0] = createAssetInstance(template, []);
    rootAssets[0].slots = Object.fromEntries(template.data.slots.map((slot) => [slot.id, []]));
    markEdited(screen.file);
    await renderScreen(activeScreenIndex);
    selectInstance([0], template.id);
    return;
  }

  if (rootAssets.length !== 1) {
    throw new Error("Add a layout as this Screen's root asset before adding content.");
  }
  const rootTemplate = assets.get(rootAssets[0]["asset-template"]);
  const slots = rootTemplate?.data.slots || [];
  if (slots.length !== 1) {
    throw new Error(`Drag ${sourceTemplate.data.name || assetId} into the intended named slot.`);
  }
  return addAssetToContainer(assetId, [0], slots[0].id);
}

function addAssetToSlot(parentPath, slotId, assetId) {
  return addAssetToContainer(assetId, parentPath, slotId);
}

function pathStartsWith(path, prefix) {
  return prefix.length <= path.length && prefix.every((part, index) => path[index] === part);
}

function findInstancePathByReference(screen, target) {
  function search(siblings, parentPath) {
    for (const [index, instance] of siblings.entries()) {
      const path = [...parentPath, index];
      if (instance === target) return path;
      for (const [slotId, children] of Object.entries(instance.slots || {})) {
        if (!Array.isArray(children)) continue;
        const nestedPath = search(children, [...path, slotId]);
        if (nestedPath) return nestedPath;
      }
    }
    return null;
  }
  return search(screen.data.assets || [], []);
}

async function moveAssetInstance(sourcePath, parentPath, slotId, requestedIndex = null) {
  const screen = screens[activeScreenIndex];
  const source = getInstanceAtPath(screen, sourcePath);
  if (!source) throw new Error("The dragged asset instance is no longer available.");
  if (!parentPath.length && sourcePath.length !== 1) {
    throw new Error("A Screen has one root layout; move content between named layout slots instead.");
  }
  if (pathStartsWith(parentPath, sourcePath)) {
    throw new Error("A layout cannot be moved into one of its own drop zones.");
  }
  const sourceLocation = getInstanceLocation(screen, sourcePath);
  const destination = getSiblingList(screen, parentPath, slotId);
  const destinationParent = parentPath.length ? getInstanceAtPath(screen, parentPath) : null;
  let insertionIndex = requestedIndex === null ? destination.length : requestedIndex;
  insertionIndex = Math.max(0, Math.min(insertionIndex, destination.length));
  if (sourceLocation.siblings === destination && sourceLocation.index < insertionIndex) {
    insertionIndex--;
  }
  if (sourceLocation.siblings === destination && sourceLocation.index === insertionIndex) return;

  sourceLocation.siblings.splice(sourceLocation.index, 1);
  destination.splice(insertionIndex, 0, source);
  markEdited(screens[activeScreenIndex].file);
  await renderScreen(activeScreenIndex);
  const currentParentPath = destinationParent
    ? findInstancePathByReference(screen, destinationParent)
    : [];
  if (!currentParentPath) throw new Error("The layout drop zone moved while the asset was being placed.");
  const movedPath = instancePathFor(currentParentPath, slotId, insertionIndex);
  selectInstance(movedPath, source["asset-template"]);
  const movedInstance = findAssetInstances(byId("screen-preview"))
    .find((node) => node.dataset.instancePath === JSON.stringify(movedPath));
  movedInstance?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function deleteAssetInstance(path) {
  const screen = screens[activeScreenIndex];
  if (path.length === 1) {
    throw new Error("A Screen must keep its single root layout. Delete or move its content assets instead.");
  }
  const location = getInstanceLocation(screen, path);
  location.siblings.splice(location.index, 1);
  markEdited(screens[activeScreenIndex].file);
  await renderScreen(activeScreenIndex);
}

function readDraggedInstance(dataTransfer) {
  const payload = dataTransfer.getData(assetInstanceDragType);
  if (!payload) return null;
  let path;
  try {
    path = JSON.parse(payload);
  } catch {
    throw new Error("The dragged asset instance has an invalid position.");
  }
  if (!Array.isArray(path) || path.length === 0 || path.length % 2 !== 1 ||
      path.some((part, index) => index % 2 === 0
        ? !Number.isInteger(part) || part < 0
        : typeof part !== "string" || !part)) {
    throw new Error("The dragged asset instance has an invalid position.");
  }
  return path;
}

function clearDropIndicators() {
  screenStage.classList.remove("drop-target");
  for (const host of findAssetInstances(byId("screen-preview"))) {
    host.classList.remove("dragging", "drop-before", "drop-after");
    host.querySelectorAll(".openux-drop-slot.drop-target")
      .forEach((slot) => slot.classList.remove("drop-target"));
    host.shadowRoot?.querySelectorAll(".openux-drop-slot.drop-target")
      .forEach((slot) => slot.classList.remove("drop-target"));
  }
}

function findAssetInstances(root, instances = []) {
  for (const node of root.querySelectorAll(".asset-instance")) {
    instances.push(node);
    if (node.shadowRoot) findAssetInstances(node.shadowRoot, instances);
  }
  return instances;
}

const screenStage = byId("screen-stage");
screenStage.addEventListener("dragover", (event) => {
  const types = [...event.dataTransfer.types];
  if (!types.includes(assetDragType) && !types.includes(assetInstanceDragType)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = types.includes(assetInstanceDragType) ? "move" : "copy";
  screenStage.classList.add("drop-target");
});
screenStage.addEventListener("dragleave", (event) => {
  if (!screenStage.contains(event.relatedTarget)) screenStage.classList.remove("drop-target");
});
screenStage.addEventListener("drop", (event) => {
  const assetId = event.dataTransfer.getData(assetDragType);
  const sourcePath = readDraggedInstance(event.dataTransfer);
  if (!assetId && !sourcePath) return;
  event.preventDefault();
  event.stopPropagation();
  screenStage.classList.remove("drop-target");
  if (sourcePath) {
    moveAssetInstance(sourcePath, [], null).catch(showAddAssetError);
  } else if (!assets.has(assetId)) {
    showEditorMessage("Could not add asset", `Asset template "${assetId}" is not available in this project.`);
  } else {
    paletteAssetDropHandled = true;
    addAssetToScreen(assetId).catch(showAddAssetError);
  }
});

function showAddAssetError(error) {
  showEditorMessage("Could not add asset", error.message || String(error));
}

async function renderScreen(index, options = {}) {
  const selected = screens[index];
  if (!selected) return;
  closeAssetContextMenu();
  clearTimeout(assetPreviewTimer);
  assetPreviewTimer = null;
  assetPreviewVersion += 1;
  byId("main").classList.remove("asset-editing");
  byId("main").classList.remove("spec-editing");
  byId("asset-html-editor-panel").hidden = true;
  byId("asset-html-source").oninput = null;
  byId("asset-yaml-editor-panel").hidden = true;
  byId("asset-yaml-source").oninput = null;
  byId("spec-editor-panel").hidden = true;
  byId("spec-source").oninput = null;
  activeScreenIndex = index;
  viewingAssetTemplate = false;
  viewingTheme = false;
  viewingProject = false;
  viewingSpec = false;
  viewingPreviewState = options.previewStateSelected === true;
  activeSpecPath = null;
  activeSpecInstancePath = [];
  activeAssetId = null;
  activeInstancePath = [];
  hideEditorMessage();
  updateNavigationSelection();
  updateScreenDomContext(selected);
  byId("screen-heading").textContent = selected.data.name || selected.id;
  byId("breadcrumb").textContent = "Screens";
  renderPreviewStateControls(selected.data);

  const preview = byId("screen-preview");
  preview.className = "screen-preview";
  preview.setAttribute("aria-label", `${selected.data.name || selected.id} Screen preview`);
  preview.replaceChildren();
  const content = element("div", "form-content");
  setScreenDomContext(content, selected);
  preview.append(content);

  try {
    if (!Array.isArray(selected.data.assets)) {
      throw new Error(`Screen "${selected.id}" assets must be a list.`);
    }
    if (selected.data.assets.length === 0) {
      byId("screen-stage").setAttribute("aria-label", "Empty Screen preview; drop a layout asset here");
      const dropZone = element("div", "empty-screen-drop-zone", "Drop a layout asset here");
      dropZone.setAttribute("role", "group");
      dropZone.setAttribute("aria-label", "Drop a layout asset here to create the Screen root");
      content.append(dropZone);
      renderInspector();
      return;
    }
    byId("screen-stage").setAttribute("aria-label", "Rendered Screen preview; drop an asset here to add it");
    if (selected.data.assets.length !== 1) {
      throw new Error(`Screen "${selected.id}" must contain exactly one root layout asset.`);
    }
    const instance = selected.data.assets[0];
    const template = assets.get(instance["asset-template"]);
    if (!template) {
      throw new Error(`Screen references unknown asset template "${instance["asset-template"]}".`);
    }
    if (!template.data.slots?.length) {
      throw new Error(`Screen "${selected.id}" root asset "${template.id}" must define at least one named slot.`);
    }
    const host = await renderInstance(
      instance,
      template,
      [0],
      selected.id,
      selected.data.name || selected.id
    );
    content.append(host);
    renderInspector();
  } catch (error) {
    setPreviewMessage("error", error.message);
    renderInspector();
  }
}

async function renderSpecEditor(filePath, instancePath = activeInstancePath, owner = "instance") {
  hidePreviewStateControls();
  sharedValidation.validateSpecPath(filePath);
  const screen = screens[activeScreenIndex];
  const draft = createdSpecDrafts.get(filePath);
  const isProjectSpec = owner === "project";
  const isScreenSpec = owner === "screen";
  const isScreenDraft = isScreenSpec && draft?.owner === "screen" && draft.screenFile === screen?.file;
  const instance = !isProjectSpec && !isScreenSpec && screen
    ? getInstanceAtPath(screen, instancePath)
    : null;
  if (isProjectSpec) {
    if (project.spec !== filePath && draft?.owner !== "project") {
      throw new Error(`Behavior spec "${filePath}" is not attached to the project.`);
    }
  } else if (isScreenSpec) {
    if (!screen || (screen.data.spec !== filePath && !isScreenDraft)) {
      throw new Error(`Behavior spec "${filePath}" is not attached to the selected Screen.`);
    }
  } else if (!instance || (instance.spec !== filePath && draft?.owner !== "instance")) {
    throw new Error(`Behavior spec "${filePath}" is not attached to the selected asset instance.`);
  }
  if (!specSources.has(filePath)) specSources.set(filePath, await loadText(filePath));

  byId("main").classList.remove("asset-editing");
  byId("main").classList.add("spec-editing");
  byId("asset-html-editor-panel").hidden = true;
  byId("asset-html-source").oninput = null;
  byId("asset-yaml-editor-panel").hidden = true;
  byId("asset-yaml-source").oninput = null;
  byId("spec-editor-panel").hidden = false;
  viewingAssetTemplate = false;
  viewingTheme = false;
  viewingProject = false;
  viewingPreviewState = false;
  viewingSpec = true;
  activeSpecPath = filePath;
  activeSpecOwner = owner;
  activeSpecInstancePath = isProjectSpec || isScreenSpec ? [] : [...instancePath];
  activeAssetId = instance?.["asset-template"] || null;
  activeInstancePath = isProjectSpec || isScreenSpec ? [] : [...instancePath];
  hideEditorMessage();
  updateNavigationSelection();
  byId("screen-stage").setAttribute(
    "aria-label",
    isProjectSpec
      ? "Project overview linked to its behavior spec"
      : isScreenSpec
        ? "Screen preview linked to its behavior spec"
        : "Screen preview linked to the selected asset behavior spec"
  );
  byId("screen-heading").textContent = `Spec: ${filePath}`;
  byId("breadcrumb").textContent = "Behavior spec";
  byId("spec-editor-heading").textContent = filePath;
  const editor = byId("spec-source");
  editor.setAttribute("aria-label", `Markdown source for ${filePath}`);
  editor.value = specSources.get(filePath);
  editor.disabled = isSaving;
  byId("spec-status").textContent = draft
    ? createdSpecFiles.has(filePath)
      ? "Example edited; unsaved changes."
      : "Example draft; it will not be saved unless edited."
    : "";
  byId("spec-status").classList.remove("error");
  editor.oninput = () => {
    const source = editor.value;
    specSources.set(filePath, source);
    const pendingDraft = createdSpecDrafts.get(filePath);
    if (pendingDraft) {
      const draftScreen = screens.find((entry) => entry.file === pendingDraft.screenFile);
      const draftInstance = draftScreen && pendingDraft.owner === "instance"
        ? getInstanceAtPath(draftScreen, pendingDraft.instancePath)
        : null;
      if (source === pendingDraft.initialContent) {
        if (pendingDraft.owner === "project") {
          if (project.spec === filePath) delete project.spec;
        } else if (pendingDraft.owner === "screen") {
          if (draftScreen?.data.spec === filePath) delete draftScreen.data.spec;
        } else if (draftInstance?.spec === filePath) {
          delete draftInstance.spec;
        }
        createdSpecFiles.delete(filePath);
        clearEdited(filePath);
        byId("spec-status").textContent = "Example unchanged; no spec file will be saved.";
        return;
      }
      if (pendingDraft.owner === "project") project.spec = filePath;
      else if (pendingDraft.owner === "screen" && draftScreen) draftScreen.data.spec = filePath;
      else if (draftInstance) draftInstance.spec = filePath;
      createdSpecFiles.add(filePath);
    }
    markEdited(filePath);
    byId("spec-status").textContent = pendingDraft
      ? "Example edited; unsaved changes."
      : "Unsaved Markdown changes.";
  };
  renderInspector();
}

async function createSpecForInstance(instancePath) {
  const screen = screens[activeScreenIndex];
  const instance = screen && getInstanceAtPath(screen, instancePath);
  const template = instance && assets.get(instance["asset-template"]);
  if (!screen || !instance || !template) throw new Error("The selected asset instance is no longer available.");
  if (instance.spec) {
    await renderSpecEditor(instance.spec, instancePath);
    return;
  }
  const pendingDraft = [...createdSpecDrafts.entries()].find(([, draft]) =>
    draft.screenFile === screen.file && sameInstancePath(draft.instancePath, instancePath)
  );
  if (pendingDraft) {
    await renderSpecEditor(pendingDraft[0], instancePath);
    return;
  }
  const pathSegment = instancePath.map((part) =>
    typeof part === "number" ? String(part) : part
  ).join("-");
  const baseName = `${screen.id}-${pathSegment}-${template.id}`;
  let filePath;
  for (let suffix = 1; ; suffix += 1) {
    const name = suffix === 1 ? baseName : `${baseName}-${suffix}`;
    filePath = `specs/${name}.md`;
    sharedValidation.validateSpecPath(filePath);
    if (specSources.has(filePath)) continue;
    const response = await fetch(safeProjectUrl(filePath));
    if (response.status === 404) break;
    if (!response.ok) {
      throw new Error(`Could not check whether behavior spec "${filePath}" already exists (HTTP ${response.status}).`);
    }
  }
  const heading = (instance.name || template.data.name || template.id)
    .replace(/\r?\n/g, " ")
    .trim() || template.id;
  const source = `# ${heading}\n\n## Purpose\n\nDescribe the behavior this asset instance is responsible for.\n\n## Requirements\n\n### Requirement: Perform the intended action\nThe system SHALL perform the intended behavior for this asset instance.\n\n#### Scenario: User interacts with this instance\n- **WHEN** the user interacts with this instance\n- **THEN** describe the expected observable outcome.\n`;
  specSources.set(filePath, source);
  createdSpecDrafts.set(filePath, {
    owner: "instance",
    initialContent: source,
    screenFile: screen.file,
    instancePath: [...instancePath]
  });
  await renderSpecEditor(filePath, instancePath);
}

async function createProjectSpec() {
  if (project.spec) {
    await renderSpecEditor(project.spec, [], "project");
    return;
  }
  const pendingDraft = [...createdSpecDrafts.entries()].find(([, draft]) => draft.owner === "project");
  if (pendingDraft) {
    await renderSpecEditor(pendingDraft[0], [], "project");
    return;
  }

  let filePath;
  for (let suffix = 1; ; suffix += 1) {
    const name = suffix === 1 ? "project-behavior" : `project-behavior-${suffix}`;
    filePath = `specs/${name}.md`;
    sharedValidation.validateSpecPath(filePath);
    if (specSources.has(filePath)) continue;
    const response = await fetch(safeProjectUrl(filePath));
    if (response.status === 404) break;
    if (!response.ok) {
      throw new Error(`Could not check whether behavior spec "${filePath}" already exists (HTTP ${response.status}).`);
    }
  }
  const heading = (typeof project.name === "string" && project.name.trim())
    ? project.name.replace(/\r?\n/g, " ").trim()
    : "Project behavior";
  const source = `# ${heading}\n\n## Purpose\n\nDescribe the behavior and constraints shared across this project.\n\n## Requirements\n\n### Requirement: Follow project-wide behavior\nThe system SHALL follow the behavior specified for this project.\n\n#### Scenario: A project-wide behavior applies\n- **WHEN** a user action is covered by this requirement\n- **THEN** the application follows the specified project-wide behavior.\n`;
  specSources.set(filePath, source);
  createdSpecDrafts.set(filePath, {
    owner: "project",
    initialContent: source,
    projectFile: "project.yml"
  });
  await renderSpecEditor(filePath, [], "project");
}

async function createSpecForScreen() {
  const screen = screens[activeScreenIndex];
  if (!screen) throw new Error("The selected Screen is no longer available.");
  if (screen.data.spec) {
    await renderSpecEditor(screen.data.spec, [], "screen");
    return;
  }
  const pendingDraft = [...createdSpecDrafts.entries()].find(([, draft]) =>
    draft.owner === "screen" && draft.screenFile === screen.file
  );
  if (pendingDraft) {
    await renderSpecEditor(pendingDraft[0], [], "screen");
    return;
  }

  const baseName = `${screen.id}-behavior`;
  let filePath;
  for (let suffix = 1; ; suffix += 1) {
    const name = suffix === 1 ? baseName : `${baseName}-${suffix}`;
    filePath = `specs/${name}.md`;
    sharedValidation.validateSpecPath(filePath);
    if (specSources.has(filePath)) continue;
    const response = await fetch(safeProjectUrl(filePath));
    if (response.status === 404) break;
    if (!response.ok) {
      throw new Error(`Could not check whether behavior spec "${filePath}" already exists (HTTP ${response.status}).`);
    }
  }
  const heading = (screen.data.name || screen.id).replace(/\r?\n/g, " ").trim();
  const states = getScreenPreviewStates(screen.data).filter((state) => state.id !== "default");
  const scenarios = states.length ? states.map((state) => [
    `#### Scenario: ${state.name.replace(/\r?\n/g, " ").trim() || state.id} is active`,
    `- **WHEN** the condition for ${state.id} occurs`,
    "- **THEN** the Screen reflects that condition.",
    `- **SHOW** ${state.id}`
  ].join("\n")).join("\n\n") : [
    "#### Scenario: The Screen is displayed",
    "- **WHEN** the user navigates to this Screen",
    "- **THEN** the Screen is displayed."
  ].join("\n");
  const source = `# ${heading} behavior\n\n## Purpose\n\nDescribe when this Screen's named visual states become active.\n\n## Requirements\n\n### Requirement: Show the matching preview state\nThe Screen SHALL show each named preview state when its activation condition is met.\n\n${scenarios}\n`;
  specSources.set(filePath, source);
  createdSpecDrafts.set(filePath, {
    owner: "screen",
    initialContent: source,
    screenFile: screen.file
  });
  await renderSpecEditor(filePath, [], "screen");
}

function renderProjectOverview() {
  if (!project) return;
  hidePreviewStateControls();
  closeAssetContextMenu();
  clearTimeout(assetPreviewTimer);
  assetPreviewTimer = null;
  assetPreviewVersion += 1;
  byId("main").classList.remove("asset-editing");
  byId("main").classList.remove("spec-editing");
  byId("asset-html-editor-panel").hidden = true;
  byId("asset-html-source").oninput = null;
  byId("asset-yaml-editor-panel").hidden = true;
  byId("asset-yaml-source").oninput = null;
  byId("spec-editor-panel").hidden = true;
  byId("spec-source").oninput = null;
  viewingAssetTemplate = false;
  viewingTheme = false;
  viewingProject = true;
  viewingSpec = false;
  viewingPreviewState = false;
  activeSpecPath = null;
  activeSpecInstancePath = [];
  activeAssetId = null;
  activeInstancePath = [];
  hideEditorMessage();
  updateNavigationSelection();
  updateScreenDomContext(null);
  byId("screen-stage").setAttribute("aria-label", "Project overview");
  byId("screen-heading").textContent = "Overview";
  byId("breadcrumb").textContent = "Project";
  const preview = byId("screen-preview");
  preview.className = "screen-preview project-overview-preview";
  preview.setAttribute("aria-label", "Project overview");
  preview.replaceChildren();

  const content = element("div", "project-overview-content");
  const hero = element("section", "project-overview-hero");
  hero.append(
    element("div", "project-overview-eyebrow", "PROJECT OVERVIEW"),
    element("h2", "project-overview-title", project.name || "Untitled project"),
    element("p", "project-overview-description", project.description || "No project description has been provided.")
  );
  content.append(hero);

  const stats = element("div", "project-overview-stats");
  for (const [label, value] of [
    ["Screens", screens.length],
    ["Asset templates", assets.size],
    ["Behavior specs", specSources.size]
  ]) {
    const stat = element("div", "project-overview-stat");
    stat.append(element("span", "project-overview-stat-label", label));
    stat.append(element("strong", "project-overview-stat-value", String(value)));
    stats.append(stat);
  }
  content.append(stats);

  const sections = element("div", "project-overview-sections");
  const screenSection = element("section", "project-overview-panel");
  screenSection.append(element("h3", "project-overview-section-title", "Screens"));
  if (screens.length) {
    const screenList = element("div", "project-overview-screen-list");
    screens.forEach((screen, index) => {
      const name = screen.data.name || screen.id;
      const screenButton = element("button", "project-overview-screen");
      screenButton.type = "button";
      screenButton.setAttribute("aria-label", `Open Screen ${name}`);
      screenButton.append(element("span", "project-overview-screen-name", name));
      screenButton.append(element("span", "project-overview-screen-id", screen.id));
      screenButton.append(element(
        "span",
        "project-overview-screen-description",
        screen.data.description || "No description provided."
      ));
      screenButton.addEventListener("click", () => renderScreen(index));
      screenList.append(screenButton);
    });
    screenSection.append(screenList);
  } else {
    screenSection.append(element("p", "project-overview-empty", "No Screens are defined in this project."));
  }
  sections.append(screenSection);

  const configuration = element("section", "project-overview-panel");
  configuration.append(element("h3", "project-overview-section-title", "Project configuration"));
  configuration.append(element("div", "project-overview-config-label", "Theme"));
  configuration.append(element("div", "project-overview-config-value", theme?.name || "Not configured"));
  configuration.append(element("div", "project-overview-config-label", "Behavior specs"));
  configuration.append(element("div", "project-overview-config-value", `${specSources.size} attached`));
  configuration.append(element("div", "project-overview-config-label", "Project manifest"));
  configuration.append(element("div", "project-overview-config-value", "openux/project.yml"));
  configuration.append(element("div", "project-overview-config-label", "Source of truth"));
  configuration.append(element(
    "p",
    "project-overview-config-note",
    "Project-wide specs cover behavior shared across Screens. Use a Screen-level spec for page behavior and preview-state activation, and asset-instance specs for individual controls or components."
  ));
  sections.append(configuration);
  content.append(sections);
  preview.append(content);
  renderInspector();
}

async function renderAssetTemplate(assetId) {
  const template = assets.get(assetId);
  if (!template) return;
  hidePreviewStateControls();
  closeAssetContextMenu();
  updateScreenDomContext(null);
  clearTimeout(assetPreviewTimer);
  assetPreviewTimer = null;
  viewingTheme = false;
  viewingProject = false;
  viewingSpec = false;
  viewingPreviewState = false;
  activeSpecPath = null;
  activeSpecInstancePath = [];
  activeAssetId = assetId;
  activeInstancePath = [];
  viewingAssetTemplate = true;
  byId("main").classList.remove("spec-editing");
  byId("spec-editor-panel").hidden = true;
  byId("spec-source").oninput = null;
  hideEditorMessage();
  updateNavigationSelection();
  byId("screen-heading").textContent = `${template.data.name || assetId} template`;
  byId("screen-stage").setAttribute("aria-label", `${template.data.name || assetId} template preview`);
  byId("breadcrumb").textContent = "Asset templates";
  byId("main").classList.add("asset-editing");
  byId("asset-html-editor-panel").hidden = false;
  byId("asset-yaml-editor-panel").hidden = false;
  const htmlEditor = byId("asset-html-source");
  htmlEditor.value = template.html;
  htmlEditor.setAttribute("aria-label", `HTML source for ${template.data.name || assetId}`);
  htmlEditor.oninput = () => {
    template.html = htmlEditor.value;
    markEdited(template.htmlFile);
    clearTimeout(assetPreviewTimer);
    assetPreviewTimer = setTimeout(() => {
      renderAssetTemplatePreview(template).catch((error) => setPreviewMessage("error", error.message));
    }, 180);
  };
  const yamlEditor = byId("asset-yaml-source");
  yamlEditor.value = template.yamlSource;
  yamlEditor.setAttribute("aria-label", `YAML source for ${template.data.name || assetId}`);
  yamlEditor.oninput = () => {
    const source = yamlEditor.value;
    const filePath = `${template.directory}/asset.yml`;
    template.yamlSource = source;
    template.yamlSourceMode = "source";
    const version = ++template.yamlParseVersion;
    invalidYamlFiles.set(filePath, "Validating YAML...");
    setAssetYamlStatus(template, "Validating YAML...");
    markEdited(filePath);
    clearTimeout(template.yamlTimer);
    template.yamlTimer = setTimeout(() => {
      parseAssetYaml(template, source, version).catch((error) => {
        if (version !== template.yamlParseVersion) return;
        invalidYamlFiles.set(filePath, error.message || String(error));
        setAssetYamlStatus(template, `Invalid asset YAML: ${error.message || String(error)}`, true);
        updateSaveControls();
      });
    }, 250);
  };
  const yamlError = invalidYamlFiles.get(`${template.directory}/asset.yml`);
  if (yamlError) setAssetYamlStatus(template, `Invalid asset YAML: ${yamlError}`, true);
  else setAssetYamlStatus(template, template.yamlStatus?.message || "");
  await renderAssetTemplatePreview(template);
  renderInspector();
}

async function parseAssetYaml(template, source, version) {
  const filePath = `${template.directory}/asset.yml`;
  const response = await fetch("/api/yaml/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `YAML parsing failed (HTTP ${response.status}).`);
  if (version !== template.yamlParseVersion) return;
  const data = result.data;
  if (data.id !== template.id) {
    throw new Error(`Asset id must remain "${template.id}".`);
  }
  assetCategoryPath(data, filePath);
  validateAssetAttributes(data, filePath);
  validateAssetSlots(data, filePath);
  validateAssetSlotMarkup(data, template.html, template.htmlFile);
  template.data = data;
  template.yamlSource = source;
  template.yamlSourceMode = "source";
  invalidYamlFiles.delete(filePath);
  setAssetYamlStatus(template, "YAML is valid.");
  renderNavigation();
  updateSaveControls();
  if (viewingAssetTemplate && activeAssetId === template.id) {
    byId("screen-heading").textContent = `${template.data.name || template.id} template`;
    byId("asset-yaml-source").setAttribute(
      "aria-label",
      `YAML source for ${template.data.name || template.id}`
    );
    renderInspector();
    await renderAssetTemplatePreview(template);
  }
}

function setAssetYamlStatus(template, message, isError = false) {
  template.yamlStatus = { message, isError };
  if (!viewingAssetTemplate || activeAssetId !== template.id) return;
  const status = byId("asset-yaml-status");
  status.textContent = message;
  status.classList.toggle("error", isError);
}

async function renderAssetTemplatePreview(template) {
  const previewVersion = ++assetPreviewVersion;
  const preview = byId("screen-preview");
  preview.className = "screen-preview";
  preview.setAttribute("aria-label", `${template.data.name || template.id} asset template preview`);
  preview.replaceChildren();
  const content = element("div", "form-content");
  preview.append(content);
  const sample = createSampleInstance(template);
  try {
    validateAssetSlotMarkup(template.data, template.html, template.htmlFile);
    const host = await renderInstance(sample, template, []);
    if (previewVersion !== assetPreviewVersion || !viewingAssetTemplate || activeAssetId !== template.id) return;
    content.append(host);
  } catch (error) {
    if (previewVersion === assetPreviewVersion && viewingAssetTemplate && activeAssetId === template.id) {
      setPreviewMessage("error", error.message || String(error));
    }
  }
}

function createSampleInstance(template) {
  const instance = {
    name: `${template.data.name || template.id} preview`,
    description: template.data.description || "",
    attributes: {}
  };
  if (template.data.slots) instance.slots = {};
  return instance;
}

async function renderInstance(instance, template, instancePath, screenId = "", screenName = "") {
  for (const name of Object.keys(instance.attributes || {})) {
    const definition = template.data.attributes?.[name];
    if (!definition) {
      throw new Error(`Asset "${template.id}" does not define the "${name}" attribute used by this Screen.`);
    }
    if (definition.overridable !== true) {
      throw new Error(`Asset attribute "${name}" in "${template.id}" is not marked overridable.`);
    }
    if (!isValidAttributeValue(definition, instance.attributes[name])) {
      throw new Error(`Screen value for "${template.id}.${name}" does not match its declared type.`);
    }
  }

  const host = element("div", "asset-instance");
  host.dataset.instancePath = JSON.stringify(instancePath);
  const isScreenRootLayout = screenId && instancePath.length === 1;
  host.hidden = Boolean(screenId && !isScreenRootLayout && !isInstanceVisible(instance));
  if (!isScreenRootLayout) {
    host.dataset.openuxScreenId = screenId;
    host.dataset.openuxScreenName = screenName;
    host.dataset.openuxAssetId = template.id;
    host.dataset.openuxInstanceName = typeof instance.name === "string" ? instance.name : "";
    host.dataset.openuxInstancePath = JSON.stringify(instancePath);
  }
  if (instancePath.length === 1) host.dataset.instanceIndex = String(instancePath[0]);
  host.draggable = instancePath.length > 0;
  host.tabIndex = 0;
  host.setAttribute("role", "group");
  host.setAttribute("aria-label", instance.name || template.data.name || "Asset instance");
  if (sameInstancePath(activeInstancePath, instancePath)) {
    host.classList.add("selected");
  }

  const usesLightDom = Boolean(template.data.slots);
  if (usesLightDom) host.id = `openux-asset-scope-${++assetStyleScopeId}`;
  const root = usesLightDom ? host : host.attachShadow({ mode: "open" });
  mountAssetMarkup(root, template.html, template.base, instance, template);
  if (instancePath.length) {
    host.addEventListener("dragstart", (event) => {
      event.stopPropagation();
      event.dataTransfer.setData(assetInstanceDragType, JSON.stringify(instancePath));
      event.dataTransfer.setData("text/plain", instance.name || template.data.name || template.id);
      event.dataTransfer.effectAllowed = "move";
      host.classList.add("dragging");
    });
    host.addEventListener("dragend", clearDropIndicators);
    host.addEventListener("dragover", (event) => {
      const types = [...event.dataTransfer.types];
      if (!types.includes(assetDragType) && !types.includes(assetInstanceDragType)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = types.includes(assetInstanceDragType) ? "move" : "copy";
      const rect = host.getBoundingClientRect();
      const insertBefore = event.clientY < rect.top + rect.height / 2;
      host.classList.toggle("drop-before", insertBefore);
      host.classList.toggle("drop-after", !insertBefore);
    });
    host.addEventListener("dragleave", (event) => {
      if (!host.contains(event.relatedTarget)) host.classList.remove("drop-before", "drop-after");
    });
    host.addEventListener("drop", (event) => {
      const sourcePath = readDraggedInstance(event.dataTransfer);
      const assetId = event.dataTransfer.getData(assetDragType);
      if (!sourcePath && !assetId) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = host.getBoundingClientRect();
      const insertAfter = event.clientY >= rect.top + rect.height / 2;
      host.classList.remove("drop-before", "drop-after");
      const parentPath = instancePath.length === 1 ? [] : instancePath.slice(0, -2);
      const slotId = instancePath.length === 1 ? null : instancePath[instancePath.length - 2];
      const insertionIndex = instancePath[instancePath.length - 1] + (insertAfter ? 1 : 0);
      if (sourcePath) {
        moveAssetInstance(sourcePath, parentPath, slotId, insertionIndex).catch(showAddAssetError);
      } else if (!assets.has(assetId)) {
        showEditorMessage("Could not add asset", `Asset template "${assetId}" is not available in this project.`);
      } else {
        paletteAssetDropHandled = true;
        if (instancePath.length === 1) {
          addAssetToScreen(assetId).catch(showAddAssetError);
        } else {
          addAssetToContainer(assetId, parentPath, slotId, insertionIndex).catch(showAddAssetError);
        }
      }
    });
    host.addEventListener("click", (event) => {
      const clickedInstance = getEventInstance(event);
      if (clickedInstance === host) selectInstance(instancePath, template.id);
    });
    host.addEventListener("dblclick", (event) => {
      if (!screenId || getEventInstance(event) !== host) return;
      event.preventDefault();
      event.stopPropagation();
      selectInstance(instancePath, template.id);
      const selected = getInstanceAtPath(screens[activeScreenIndex], instancePath);
      if (!selected?.spec) {
        createSpecForInstance(instancePath).catch((error) =>
          showEditorMessage("Could not create behavior spec", error.message || String(error))
        );
        return;
      }
      renderSpecEditor(selected.spec, instancePath).catch((error) =>
        showEditorMessage("Could not open behavior spec", error.message || String(error))
      );
    });
    host.addEventListener("contextmenu", (event) => {
      if (!screenId) return;
      event.preventDefault();
      event.stopPropagation();
      selectInstance(instancePath, template.id);
      openAssetContextMenu(event, host, instancePath, template.id);
    });
    host.addEventListener("focus", (event) => {
      if (getEventInstance(event) === host) selectInstance(instancePath, template.id);
    });
    host.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && event.target === host) {
        event.preventDefault();
        if (getEventInstance(event) === host) selectInstance(instancePath, template.id);
      }
    });
  }

  await renderInstanceSlots(root, instance, template, instancePath, screenId, screenName);
  return host;
}

function getEventInstance(event) {
  return event.composedPath().find((node) =>
    node instanceof HTMLElement && node.classList.contains("asset-instance")
  );
}

function openAssetContextMenu(event, host, instancePath, assetId) {
  const menu = byId("asset-context-menu");
  assetContextMenuTarget = {
    screenIndex: activeScreenIndex,
    instancePath: [...instancePath],
    assetId,
    host
  };
  const deleteButton = byId("asset-context-delete");
  deleteButton.disabled = false;
  deleteButton.title = instancePath.length === 1
    ? "A Screen's root layout cannot be deleted."
    : "";
  menu.hidden = false;

  const bounds = menu.getBoundingClientRect();
  const hostBounds = host.getBoundingClientRect();
  const keyboardPosition = event.clientX === 0 && event.clientY === 0;
  const x = keyboardPosition ? hostBounds.left : event.clientX;
  const y = keyboardPosition ? hostBounds.bottom : event.clientY;
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8))}px`;
  menu.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
}

function closeAssetContextMenu(restoreFocus = false) {
  const menu = byId("asset-context-menu");
  if (!menu || menu.hidden) {
    assetContextMenuTarget = null;
    return;
  }
  const target = assetContextMenuTarget;
  menu.hidden = true;
  assetContextMenuTarget = null;
  if (restoreFocus && target?.screenIndex === activeScreenIndex) target.host.focus();
}

function resolveAssetContextTarget(target) {
  if (!target || target.screenIndex !== activeScreenIndex) {
    throw new Error("The selected asset is no longer available on this Screen.");
  }
  const screen = screens[target.screenIndex];
  const instance = screen && getInstanceAtPath(screen, target.instancePath);
  const template = instance && assets.get(instance["asset-template"]);
  if (!screen || !instance || !template) {
    throw new Error("The selected asset is no longer available.");
  }
  return { screen, instance, template };
}

async function copyAssetDetails(target) {
  try {
    const { screen, instance, template } = resolveAssetContextTarget(target);
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard access is unavailable in this browser.");
    }
    const details = {
      screen: {
        id: screen.id,
        name: screen.data.name || screen.id
      },
      selectedAsset: {
        instancePath: target.instancePath,
        template: {
          id: template.id,
          name: template.data.name || template.id,
          description: template.data.description || "",
          category: template.data.category || "",
          attributes: template.data.attributes || {},
          slots: template.data.slots || []
        },
        instance
      }
    };
    const clipboardText = `OpenUX asset details:\n\`\`\`json\n${JSON.stringify(details, null, 2)}\n\`\`\``;
    await navigator.clipboard.writeText(clipboardText);
    showEditorMessage("Asset details copied", "Paste the OpenUX context into your prompt.");
  } catch (error) {
    showEditorMessage("Could not copy asset details", error.message || String(error));
  }
}

function confirmDeleteAsset(target) {
  try {
    const { screen, instance, template } = resolveAssetContextTarget(target);
    if (target.instancePath.length === 1) {
      showEditorMessage("Cannot delete root layout", "A Screen must keep its root layout. Delete or move its content assets instead.");
      return;
    }
    const instanceName = instance.name || template.data.name || template.id;
    const screenName = screen.data.name || screen.id;
    const hasNestedAssets = Object.values(instance.slots || {}).some(
      (children) => Array.isArray(children) && children.length > 0
    );
    const nestedWarning = hasNestedAssets ? " Assets inside its slots will also be deleted." : "";
    pendingAssetDeletion = { ...target, instancePath: [...target.instancePath] };
    deleteDialogReturnFocus = document.activeElement;
    byId("asset-delete-message").textContent =
      `Delete "${instanceName}" from the "${screenName}" Screen?${nestedWarning}`;
    byId("asset-delete-dialog").showModal();
    byId("asset-delete-cancel").focus();
  } catch (error) {
    showEditorMessage("Could not delete asset", error.message || String(error));
  }
}

function closeAssetDeleteDialog(restoreFocus = false) {
  const dialog = byId("asset-delete-dialog");
  if (dialog.open) dialog.close();
  const returnFocus = deleteDialogReturnFocus;
  pendingAssetDeletion = null;
  deleteDialogReturnFocus = null;
  if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
}

function sameInstancePath(left, right) {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

async function renderInstanceSlots(root, instance, template, instancePath, screenId, screenName) {
  if (!template.data.slots) {
    if (instance.slots !== undefined) {
      throw new Error(`Asset "${template.id}" does not define layout slots.`);
    }
    return;
  }
  if (instance.slots !== undefined &&
      (!instance.slots || Array.isArray(instance.slots) || typeof instance.slots !== "object")) {
    throw new Error(`Asset instance "${instance.name || template.id}" slots must be a mapping.`);
  }
  const slots = instance.slots || {};
  const declaredSlots = new Set(template.data.slots.map((slot) => slot.id));
  for (const id of Object.keys(slots)) {
    if (!declaredSlots.has(id)) {
      throw new Error(`Asset "${template.id}" does not define the "${id}" layout slot.`);
    }
  }
  const slotTargets = [...root.querySelectorAll("[data-openux-slot]")];
  for (const slot of template.data.slots) {
    const target = slotTargets.find((node) => node.getAttribute("data-openux-slot") === slot.id);
    target.classList.add("openux-drop-slot");
    target.setAttribute("role", "group");
    target.setAttribute("aria-label", `Drop zone: ${slot.name || slot.id}`);
    target.setAttribute("data-placeholder", `Drop assets into ${slot.name || slot.id}`);
    if (instancePath.length) {
      target.addEventListener("dragover", (event) => {
        const types = [...event.dataTransfer.types];
        if (!types.includes(assetDragType) && !types.includes(assetInstanceDragType)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = types.includes(assetInstanceDragType) ? "move" : "copy";
        target.classList.add("drop-target");
      });
      target.addEventListener("dragleave", (event) => {
        if (!target.contains(event.relatedTarget)) target.classList.remove("drop-target");
      });
      target.addEventListener("drop", (event) => {
        const assetId = event.dataTransfer.getData(assetDragType);
        const sourcePath = readDraggedInstance(event.dataTransfer);
        if (!assetId && !sourcePath) return;
        event.preventDefault();
        event.stopPropagation();
        target.classList.remove("drop-target");
        if (sourcePath) {
          moveAssetInstance(sourcePath, instancePath, slot.id).catch(showAddAssetError);
        } else if (!assets.has(assetId)) {
          showEditorMessage("Could not add asset", `Asset template "${assetId}" is not available in this project.`);
        } else {
          paletteAssetDropHandled = true;
          addAssetToSlot(instancePath, slot.id, assetId).catch(showAddAssetError);
        }
      });
    }

    const children = slots[slot.id] || [];
    if (!Array.isArray(children)) {
      throw new Error(`Layout slot "${slot.id}" contents must be a list.`);
    }
    for (const [childIndex, child] of children.entries()) {
      const childTemplate = assets.get(child["asset-template"]);
      if (!childTemplate) {
        throw new Error(`Layout slot "${slot.id}" references unknown asset template "${child["asset-template"]}".`);
      }
      const childHost = await renderInstance(
        child,
        childTemplate,
        [...instancePath, slot.id, childIndex],
        screenId,
        screenName
      );
      target.append(childHost);
    }
  }
}

function setScreenDomContext(node, screen) {
  if (!node) return;
  if (!screen) {
    node.removeAttribute("data-openux-screen-id");
    node.removeAttribute("data-openux-screen-name");
    return;
  }
  node.dataset.openuxScreenId = screen.id;
  node.dataset.openuxScreenName = screen.data.name || screen.id;
}

function updateScreenDomContext(screen) {
  [
    byId("workspace-context"),
    byId("main"),
    byId("screen-stage"),
    byId("screen-preview")
  ].forEach((node) => setScreenDomContext(node, screen));
}

function mountAssetMarkup(root, markup, assetBase, instance, template) {
  const scopeCss = (css) => {
    if (!(root instanceof HTMLElement)) return css;
    const scopedCss = css
      .replace(/:host\(([^()]*)\)/g, ":scope$1")
      .replace(/:host(?![-\w])/g, ":scope");
    return `@scope (#${root.id}) {\n${scopedCss}\n}`;
  };
  const parsed = new DOMParser().parseFromString(markup, "text/html");
  applyAssetPlaceholders(parsed, instance, template);
  parsed.querySelectorAll("script, iframe, object, embed, form, base, link").forEach((node) => node.remove());
  parsed.querySelectorAll("*").forEach((node) => {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on")) {
        node.removeAttribute(attribute.name);
      } else if (name === "style") {
        node.setAttribute(attribute.name, rewriteAssetCss(attribute.value, assetBase));
      } else if (name === "src" || name === "href") {
        const safeUrl = safeAssetResource(attribute.value, assetBase);
        if (safeUrl) node.setAttribute(attribute.name, safeUrl);
        else node.removeAttribute(attribute.name);
      }
    }
  });

  if (template.data.slots) {
    const editorStyle = document.createElement("style");
    editorStyle.textContent = `
      .openux-drop-slot {
        display: flex;
        flex-direction: column;
        gap: 14px;
        min-height: 48px;
        border-radius: 8px;
      }
      .openux-drop-slot > .asset-instance {
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
      }
      .openux-drop-slot.drop-target {
        outline: 2px dashed var(--studio-primary);
        outline-offset: 3px;
        background: color-mix(in srgb, var(--studio-primary) 7%, transparent);
      }
      .openux-drop-slot:empty::before {
        content: attr(data-placeholder);
        padding: 12px;
        border: 1px dashed var(--studio-border);
        border-radius: 8px;
        color: var(--studio-muted);
        font: 12px Inter, "Segoe UI", Arial, sans-serif;
        text-align: center;
      }
      .asset-instance {
        position: relative;
        margin: 0;
        padding: 6px;
        border: 1px solid transparent;
        border-radius: 9px;
        cursor: pointer;
      }
      .asset-instance:hover { border-color: var(--studio-border); }
      .asset-instance.selected {
        border-color: var(--studio-focus);
        background: color-mix(in srgb, var(--studio-primary) 4%, transparent);
      }
      .asset-instance.dragging { opacity: .45; }
      .asset-instance.drop-before::before, .asset-instance.drop-after::after {
        position: absolute;
        right: 0;
        left: 0;
        height: 3px;
        border-radius: 3px;
        background: var(--studio-primary);
        content: "";
        pointer-events: none;
      }
      .asset-instance.drop-before::before { top: -3px; }
      .asset-instance.drop-after::after { bottom: -3px; }
      .asset-instance:focus-visible {
        outline: 2px solid var(--studio-focus);
        outline-offset: 2px;
      }
    `;
    editorStyle.textContent = scopeCss(editorStyle.textContent);
    root.append(editorStyle);
  }

  parsed.querySelectorAll("style").forEach((style) => {
    const scopedStyle = document.createElement("style");
    scopedStyle.textContent = scopeCss(rewriteAssetCss(style.textContent, assetBase));
    root.append(scopedStyle);
    style.remove();
  });
  if (themeStylesheet) {
    const style = document.createElement("style");
    style.textContent = scopeCss(rewriteAssetCss(themeStylesheet, themeStylesheetBase));
    root.append(style);
  }
  for (const child of [...parsed.body.childNodes]) {
    root.append(document.importNode(child, true));
  }
}

function applyAssetPlaceholders(parsed, instance, template) {
  for (const node of parsed.querySelectorAll("*")) {
    for (const attribute of [...node.attributes]) {
      if (!attribute.value.includes("${")) continue;
      const exactMatch = /^\$\{([a-zA-Z_][a-zA-Z0-9_.-]*)\}$/.exec(attribute.value);
      if (exactMatch && booleanHtmlAttributes.has(attribute.name.toLowerCase())) {
        const value = getPlaceholderValue(instance, template, exactMatch[1]);
        if (value === true) node.setAttribute(attribute.name, "");
        else node.removeAttribute(attribute.name);
        continue;
      }
      node.setAttribute(attribute.name, interpolatePlaceholders(attribute.value, instance, template));
    }
  }

  const walker = document.createTreeWalker(parsed, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode();
  while (textNode) {
    if (textNode.nodeValue.includes("${")) {
      textNode.nodeValue = interpolatePlaceholders(textNode.nodeValue, instance, template);
    }
    textNode = walker.nextNode();
  }
}

function interpolatePlaceholders(text, instance, template) {
  return text.replace(/\$\{([a-zA-Z_][a-zA-Z0-9_.-]*)\}/g, (_, path) =>
    String(getPlaceholderValue(instance, template, path) ?? "")
  );
}

function getPlaceholderValue(instance, template, path) {
  const value = getInstanceValue(instance, template, path);
  const attributePath = path.startsWith("attributes.") ? path.slice("attributes.".length) : null;
  if (value === undefined && attributePath && !template.data.attributes?.[attributePath]) {
    throw new Error(`Asset "${template.id}" references undefined attribute "${attributePath}".`);
  }
  return value;
}

function safeAssetResource(path, assetBase) {
  if (!path || path.startsWith("#") || path.startsWith("data:image/")) return path;
  if (path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) return null;
  const url = new URL(path, assetBase);
  if (url.origin !== appRoot.origin || !url.pathname.startsWith(assetBase.pathname)) return null;
  return url.href;
}

function rewriteAssetCss(css, assetBase) {
  return css
    .replace(/@import[^;]+;/gi, "")
    .replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi, (match, doubleQuoted, singleQuoted, bare) => {
      const resource = doubleQuoted ?? singleQuoted ?? bare.trim();
      const safeUrl = safeAssetResource(resource, assetBase);
      return safeUrl ? `url("${safeUrl}")` : "none";
    });
}

function getInstanceValue(instance, template, path) {
  const normalized = path.startsWith("attributes.") ? path.slice("attributes.".length) : path;
  if (normalized.startsWith("attributes.")) return undefined;
  const definition = template.data.attributes?.[normalized];
  if (definition) {
    if (definition.overridable === true && Object.hasOwn(instance.attributes || {}, normalized)) {
      return instance.attributes[normalized];
    }
    return Object.hasOwn(definition, "default")
      ? definition.default
      : definition.type === "boolean" ? false : undefined;
  }
  return instance[normalized];
}

function selectInstance(path, assetId) {
  activeAssetId = assetId;
  activeInstancePath = path;
  viewingAssetTemplate = false;
  viewingTheme = false;
  viewingProject = false;
  viewingSpec = false;
  viewingPreviewState = false;
  activeSpecPath = null;
  activeSpecInstancePath = [];
  byId("main").classList.remove("spec-editing");
  byId("spec-editor-panel").hidden = true;
  byId("spec-source").oninput = null;
  findAssetInstances(byId("screen-preview")).forEach((node) => {
    node.classList.toggle("selected", node.dataset.instancePath === JSON.stringify(path));
  });
  updateNavigationSelection();
  renderInspector();
}

function updateNavigationSelection() {
  document.querySelectorAll(".screen-option").forEach((button) => {
    const selected = Number(button.dataset.screenIndex) === activeScreenIndex &&
      !viewingTheme && !viewingProject && !viewingAssetTemplate &&
      !(viewingSpec && activeSpecOwner === "project");
    button.classList.toggle("selected", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  document.querySelectorAll(".asset-row").forEach((button) => {
    button.classList.toggle("selected", viewingAssetTemplate && button.dataset.assetId === activeAssetId);
    const asset = assets.get(button.dataset.assetId);
    if (asset) {
      const targetScreen = screens[activeScreenIndex];
      const requiresRootLayout = targetScreen?.data.assets?.length === 0;
      const canDrag = Boolean(targetScreen) && (!requiresRootLayout || Boolean(asset.data.slots?.length));
      button.draggable = canDrag;
      button.setAttribute(
        "aria-label",
        canDrag
          ? `Edit ${asset.data.name || asset.id} template; drag to add to ${targetScreen.data.name || "current Screen"}`
          : `Edit ${asset.data.name || asset.id} template`
      );
    }
  });
  const themeButton = byId("theme-nav");
  themeButton.classList.toggle("selected", viewingTheme);
  if (viewingTheme) themeButton.setAttribute("aria-current", "page");
  else themeButton.removeAttribute("aria-current");
  const projectButton = byId("project-nav");
  const projectSelected = viewingProject || (viewingSpec && activeSpecOwner === "project");
  projectButton.classList.toggle("selected", projectSelected);
  if (projectSelected) projectButton.setAttribute("aria-current", "page");
  else projectButton.removeAttribute("aria-current");
  publishSelection();
}

function publishSelection() {
  if (isRenderOnly) return;
  fetch("/api/selection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selection: currentUiSelection() })
  }).catch((error) => console.warn("Could not publish the current OpenUX selection.", error));
}

function renderInspector() {
  const panel = byId("inspector-content");
  panel.replaceChildren(element("h2", "panel-heading", "Details"));

  if (viewingPreviewState) {
    renderPreviewStateDetails(panel);
  } else if (viewingProject) {
    renderProjectDetails(panel);
  } else if (viewingTheme) {
    renderThemeDetails(panel);
  } else if (viewingSpec) {
    renderSpecDetails(panel);
  } else if (viewingAssetTemplate) {
    renderTemplateDetails(panel, assets.get(activeAssetId));
  } else {
    const screen = screens[activeScreenIndex]?.data;
    if (!screen) return;
    const instance = getInstanceAtPath({ data: screen }, activeInstancePath);
    const template = instance && assets.get(instance["asset-template"]);
    if (instance && template) {
      renderInstanceDetails(panel, instance, template);
    } else {
      renderScreenDetails(panel, screen);
      renderReviewControls(panel);
    }
  }
}

function renderPreviewStateDetails(panel) {
  const screen = screens[activeScreenIndex];
  const stateId = getActivePreviewStateId(screen.data);
  const state = getScreenPreviewStates(screen.data).find((candidate) => candidate.id === stateId);
  if (!state) return;
  appendSection(panel, "Preview state");
  appendEditableField(panel, "State name", state.name, (value) => renamePreviewState(stateId, value), {
    id: "preview-state-name-detail"
  });
  if (stateId !== "default") {
    appendEditableField(
      panel,
      "Description (required)",
      state.description || "",
      (value) => describePreviewState(stateId, value),
      { id: "preview-state-description-detail", multiline: true, required: true }
    );
  }
  appendDetail(panel, "State ID", state.id);
  if (stateId !== "default") {
    const deleteButton = element("button", "spec-action-button", `Delete ${state.name}`);
    deleteButton.type = "button";
    deleteButton.addEventListener("click", () => deletePreviewState(stateId).catch(showFatalError));
    panel.append(deleteButton);
  }
  appendSection(panel, "Asset visibility");
  let visibleInstances = 0;
  function renderInstanceVisibility(instance, instancePath, depth) {
    const template = assets.get(instance["asset-template"]);
    const label = instance.name || template?.data.name || instance["asset-template"];
    if (instancePath.length > 1) {
      visibleInstances += 1;
      appendEditableField(
        panel,
        `${"— ".repeat(depth)}${label}`,
        isInstanceVisible(instance, stateId),
        (visible) => {
          instance.visibility ||= {};
          if (visible) delete instance.visibility[stateId];
          else instance.visibility[stateId] = false;
          if (Object.keys(instance.visibility).length === 0) delete instance.visibility;
          markEdited(screen.file);
          renderScreen(activeScreenIndex, { previewStateSelected: true }).catch(showFatalError);
        },
        { checkbox: true }
      );
    }
    for (const [slotId, children] of Object.entries(instance.slots || {})) {
      if (!Array.isArray(children)) continue;
      children.forEach((child, index) =>
        renderInstanceVisibility(child, [...instancePath, slotId, index], depth + 1)
      );
    }
  }
  (screen.data.assets || []).forEach((instance, index) =>
    renderInstanceVisibility(instance, [index], 0)
  );
  if (visibleInstances === 0) {
    appendDetail(panel, "Assets", "This Screen has no nested asset instances.");
  }
}

function renderProjectDetails(panel) {
  appendSection(panel, "Project");
  appendDetail(panel, "Name", project.name || "Untitled project");
  appendDetail(panel, "Description", project.description || "No project description has been provided.");
  appendDetail(panel, "Screens", screens.length);
  appendDetail(panel, "Asset templates", assets.size);
  appendDetail(panel, "Behavior specs", specSources.size);
  appendDetail(panel, "Theme", theme?.name || "Not configured");
  appendDetail(panel, "Project manifest", "openux/project.yml");
  appendSection(panel, "Project-wide behavior spec");
  const pendingDraft = [...createdSpecDrafts.entries()].find(([, draft]) => draft.owner === "project");
  const filePath = project.spec || pendingDraft?.[0];
  if (filePath) {
    appendDetail(panel, "File", filePath);
    const openSpec = element(
      "button",
      "spec-action-button",
      project.spec ? "Open project-wide behavior spec" : "Open project-wide behavior spec draft"
    );
    openSpec.type = "button";
    openSpec.addEventListener("click", () =>
      renderSpecEditor(filePath, [], "project").catch((error) =>
        showEditorMessage("Could not open project behavior spec", error.message || String(error))
      )
    );
    panel.append(openSpec);
  } else {
    appendDetail(panel, "File", "No project-wide behavior spec attached.");
    const createSpec = element("button", "spec-action-button", "Create project-wide behavior spec");
    createSpec.type = "button";
    createSpec.addEventListener("click", () =>
      createProjectSpec().catch((error) =>
        showEditorMessage("Could not create project behavior spec", error.message || String(error))
      )
    );
    panel.append(createSpec);
  }
}

function renderSpecDetails(panel) {
  if (activeSpecOwner === "project") {
    appendSection(panel, "Project-wide behavior spec");
    appendDetail(panel, "File", activeSpecPath || "Unavailable");
    appendDetail(panel, "Project", project.name || "Untitled project");
    appendDetail(panel, "Format", "OpenSpec behavior contract; not executable.");
    return;
  }
  const screen = screens[activeScreenIndex];
  if (activeSpecOwner === "screen") {
    appendSection(panel, "Screen behavior spec");
    appendDetail(panel, "File", activeSpecPath || "Unavailable");
    appendDetail(panel, "Screen", screen?.data.name || screen?.id || "Unavailable");
    appendDetail(panel, "Format", "OpenSpec behavior contract; use SHOW <state-id> after THEN for preview states.");
    return;
  }
  const instance = screen && getInstanceAtPath(screen, activeSpecInstancePath);
  const template = instance && assets.get(instance["asset-template"]);
  appendSection(panel, "Behavior spec");
  appendDetail(panel, "File", activeSpecPath || "Unavailable");
  appendDetail(panel, "Screen", screen?.data.name || screen?.id || "Unavailable");
  appendDetail(panel, "Asset instance", instance?.name || template?.data.name || template?.id || "Unavailable");
  appendDetail(panel, "Format", "Markdown behavior guidance; not executable.");
}

function renderScreenDetails(panel, screen) {
  appendSection(panel, "Screen");
  appendEditableField(panel, "Name", screen.name, (value) => {
    screen.name = value;
    renderNavigation();
    markEdited(screens[activeScreenIndex].file);
    refreshActiveView();
  });
  appendEditableField(panel, "Description", screen.description, (value) => {
    screen.description = value;
    markEdited(screens[activeScreenIndex].file);
    refreshActiveView();
  }, { multiline: true });
  appendEditableField(panel, "AI note (optional)", screen.note || "", (value) => {
    if (value) screen.note = value;
    else delete screen.note;
    markEdited(screens[activeScreenIndex].file);
    refreshActiveView();
  }, { multiline: true });
  appendSection(panel, "Screen behavior spec");
  const pendingSpec = [...createdSpecDrafts.entries()].find(([, draft]) =>
    draft.owner === "screen" && draft.screenFile === screens[activeScreenIndex].file
  );
  const screenSpecPath = screen.spec || pendingSpec?.[0];
  if (screenSpecPath) {
    appendDetail(panel, "File", screenSpecPath);
    const openSpec = element(
      "button",
      "spec-action-button",
      screen.spec ? "Open Screen behavior spec" : "Open Screen behavior spec draft"
    );
    openSpec.type = "button";
    openSpec.addEventListener("click", () =>
      renderSpecEditor(screenSpecPath, [], "screen").catch((error) =>
        showEditorMessage("Could not open Screen behavior spec", error.message || String(error))
      )
    );
    panel.append(openSpec);
  } else {
    appendDetail(panel, "File", "No Screen behavior spec attached.");
    const createSpec = element("button", "spec-action-button", "Create Screen behavior spec");
    createSpec.type = "button";
    createSpec.addEventListener("click", () =>
      createSpecForScreen().catch((error) =>
        showEditorMessage("Could not create Screen behavior spec", error.message || String(error))
      )
    );
    panel.append(createSpec);
  }
  appendSection(panel, "Other preview states");
  const activeStateId = getActivePreviewStateId(screen);
  const states = getScreenPreviewStates(screen);
  for (const state of states) {
    if (state.id === "default" || state.id === activeStateId) continue;
    const deleteButton = element("button", "spec-action-button", `Delete ${state.name}`);
    deleteButton.type = "button";
    deleteButton.addEventListener("click", () => deletePreviewState(state.id).catch(showFatalError));
    panel.append(deleteButton);
  }
  appendSection(panel, "Assets in Screen");
  renderScreenInstanceTree(panel, screen.assets || [], [], 0, activeStateId);
}

function renderThemeDetails(panel) {
  appendSection(panel, "Theme");
  appendEditableField(panel, "Name", theme.name || "Theme", (value) => {
    theme.name = value;
    applyTheme();
    if (viewingTheme) byId("screen-heading").textContent = value || "Theme";
    markEdited(project.theme);
  });
  const definedModes = getDefinedThemeModes();
  appendSection(panel, "Appearance");
  const modeControls = element("div", "theme-mode-controls");
  const systemButton = element("button", "theme-mode-button", "System");
  systemButton.type = "button";
  systemButton.setAttribute("aria-pressed", String(themeModePreference === "system"));
  systemButton.addEventListener("click", () => {
    themeModePreference = "system";
    applyTheme();
    renderInspector();
  });
  modeControls.append(systemButton);
  for (const mode of themeModeNames) {
    if (definedModes.includes(mode)) {
      const button = element("button", "theme-mode-button", themeModeLabel(mode));
      button.type = "button";
      button.setAttribute("aria-pressed", String(themeModePreference === mode));
      button.addEventListener("click", () => {
        themeModePreference = mode;
        applyTheme();
        renderInspector();
      });
      modeControls.append(button);
    } else {
      const button = element("button", "theme-mode-button theme-mode-add", `Add ${themeModeLabel(mode)}`);
      button.type = "button";
      button.addEventListener("click", () => addThemeMode(mode));
      modeControls.append(button);
    }
  }
  panel.append(modeControls);
  const activeMode = getActiveThemeMode();
  if (themeModePreference === "system" && definedModes.length &&
      !definedModes.includes(systemThemeMode)) {
    panel.append(element(
      "div",
      "theme-mode-note",
      `System prefers ${themeModeLabel(systemThemeMode)}, but only ${themeModeLabel(activeMode)} is defined; using ${themeModeLabel(activeMode)}.`
    ));
  } else if (themeModePreference === "system") {
    panel.append(element(
      "div",
      "theme-mode-note",
      `Using ${themeModeLabel(activeMode)} based on the system color scheme.`
    ));
  } else if (definedModes.length === 1) {
    panel.append(element(
      "div",
      "theme-mode-note",
      `Only ${themeModeLabel(activeMode)} is defined; it is used when either appearance is requested.`
    ));
  } else {
    panel.append(element(
      "div",
      "theme-mode-note",
      `Showing ${themeModeLabel(activeMode)} in the Screen preview.`
    ));
  }

  const mode = activeMode;
  appendSection(panel, `${themeModeLabel(mode)} colors`);
  const colors = getThemeColors(mode);
  for (const [name, value] of Object.entries(colors)) {
    appendEditableField(panel, name, value, (updated) => {
      if (theme.modes?.[mode]) {
        theme.modes[mode].colors ||= {};
        theme.modes[mode].colors[name] = updated;
      } else {
        theme.colors[name] = updated;
      }
      applyTheme();
      markEdited(project.theme);
    }, { color: true });
  }
  if (!Object.keys(colors).length) {
    panel.append(element("div", "theme-mode-note", "No color tokens are defined for this appearance."));
  }
}

function addThemeMode(mode) {
  const sourceColors = { ...getThemeColors() };
  theme.modes ||= {};
  if (Object.hasOwn(theme, "colors")) {
    const lightMode = theme.modes.light || {};
    theme.modes.light = {
      ...lightMode,
      colors: { ...theme.colors, ...(lightMode.colors || {}) }
    };
    delete theme.colors;
  }
  theme.modes[mode] = { colors: sourceColors };
  themeModePreference = mode;
  applyTheme();
  markEdited(project.theme);
  renderInspector();
}

function renderReviewControls(panel) {
  const review = element("div", "readonly-label");
  const reviewMessage = element("div", "", reviewedInSession ? "Reviewed in this session; not saved." : "Review the rendered preview before accepting the design.");
  reviewMessage.id = "review-message";
  review.append(reviewMessage);
  const reviewButton = element("button", "review-action", reviewedInSession ? "Clear review mark" : "Mark reviewed");
  reviewButton.type = "button";
  reviewButton.id = "review-toggle";
  reviewButton.addEventListener("click", () => {
    reviewedInSession = !reviewedInSession;
    renderInspector();
  });
  review.append(reviewButton);
  panel.append(review);
}

function renderInstanceDetails(panel, instance, template) {
  appendSection(panel, "Selected asset");
  appendEditableField(panel, "Name", instance.name, (value) => {
    instance.name = value;
    markEdited(screens[activeScreenIndex].file);
    refreshActiveView();
  });
  appendEditableField(panel, "Description", instance.description, (value) => {
    instance.description = value;
    markEdited(screens[activeScreenIndex].file);
    refreshActiveView();
  }, { multiline: true   });
  panel.append(element("span", "template-tag", `${template.data.name || template.id} template`));
  if (activeInstancePath.length > 1) {
    const screen = screens[activeScreenIndex];
    const stateId = getActivePreviewStateId(screen.data);
    const state = getScreenPreviewStates(screen.data).find((candidate) => candidate.id === stateId);
    appendSection(panel, `Visibility · ${state?.name || "Default"}`);
    appendEditableField(
      panel,
      `Visible in ${state?.name || "Default"}`,
      isInstanceVisible(instance, stateId),
      (visible) => {
        instance.visibility ||= {};
        if (visible) delete instance.visibility[stateId];
        else instance.visibility[stateId] = false;
        if (Object.keys(instance.visibility).length === 0) delete instance.visibility;
        markEdited(screen.file);
        refreshActiveView();
      },
      { checkbox: true }
    );
  }
  if (template.data.slots) {
    appendSection(panel, "Drop zones");
    for (const slot of template.data.slots) {
      appendDetail(panel, slot.name || slot.id, "Drag assets into this zone.");
    }
  }
  for (const [name, definition] of Object.entries(template.data.attributes || {})) {
    const value = Object.hasOwn(instance.attributes || {}, name)
      ? instance.attributes[name]
      : definition.default;
    const fieldLabel = definition.type === "number"
      ? `${name} (${definition.format || "decimal"})`
      : name;
    if (definition.overridable === true) {
      appendEditableField(panel, fieldLabel, value, (updated) => {
        instance.attributes ||= {};
        if (updated === undefined) delete instance.attributes[name];
        else instance.attributes[name] = updated;
        markEdited(screens[activeScreenIndex].file);
        refreshActiveView();
      }, attributeInputOptions(definition));
    } else {
      appendDetail(panel, fieldLabel, value);
    }
  }
  appendEditableField(panel, "AI note (optional)", instance.note || "", (value) => {
    if (value) instance.note = value;
    else delete instance.note;
    markEdited(screens[activeScreenIndex].file);
  }, { multiline: true });
  appendSection(panel, "Behavior spec");
  if (instance.spec) {
    appendDetail(panel, "File", instance.spec);
    const openSpec = element("button", "spec-action-button", "Open behavior spec");
    openSpec.type = "button";
    openSpec.addEventListener("click", () =>
      renderSpecEditor(instance.spec, activeInstancePath).catch(showFatalError)
    );
    panel.append(openSpec);
  } else {
    appendDetail(panel, "File", "No behavior spec attached.");
    const createSpec = element("button", "spec-action-button", "Create behavior spec");
    createSpec.type = "button";
    createSpec.addEventListener("click", () =>
      createSpecForInstance([...activeInstancePath]).catch((error) =>
        showEditorMessage("Could not create behavior spec", error.message || String(error))
      )
    );
    panel.append(createSpec);
  }
  const deleteButton = element("button", "delete-instance-button", "Delete asset instance");
  deleteButton.type = "button";
  deleteButton.title = activeInstancePath.length === 1
    ? "A Screen's root layout cannot be deleted."
    : "";
  deleteButton.addEventListener("click", () => confirmDeleteAsset({
    screenIndex: activeScreenIndex,
    instancePath: [...activeInstancePath],
    assetId: template.id
  }));
  panel.append(deleteButton);
}

function renderTemplateDetails(panel, template) {
  if (!template) return;
  appendSection(panel, "Asset template");
  appendEditableField(panel, "Name", template.data.name, (value) => {
    template.data.name = value;
    renderNavigation();
    markAssetTemplateEdited(template);
    refreshActiveView();
  });
  appendEditableField(panel, "Description", template.data.description, (value) => {
    template.data.description = value;
    markAssetTemplateEdited(template);
    refreshActiveView();
  }, { multiline: true });
  if (template.data.slots) {
    appendSection(panel, "Drop zones");
    for (const slot of template.data.slots) {
      appendDetail(panel, slot.name || slot.id, `Named slot: ${slot.id}`);
    }
  }
  for (const [name, definition] of Object.entries(template.data.attributes || {})) {
    appendEditableField(panel, `${name} type`, definition.type, (value) => {
      definition.type = value;
      delete definition.format;
      delete definition.options;
      if (value === "string") {
        if (definition.default !== undefined) definition.default = String(definition.default);
      } else if (value === "boolean") {
        if (typeof definition.default !== "boolean") definition.default = false;
      } else if (value === "number") {
        definition.format = "decimal";
        if (definition.default !== undefined) {
          const parsed = Number(definition.default);
          if (String(definition.default).trim() && Number.isFinite(parsed)) definition.default = parsed;
          else delete definition.default;
        }
      } else if (value === "list") {
        definition.options = [];
        if (definition.default !== undefined) delete definition.default;
      }
      markAssetTemplateEdited(template);
      refreshActiveView();
    }, { selectOptions: attributeTypes });
    appendEditableField(panel, `${name} default`, definition.default, (value) => {
      if (value === undefined) delete definition.default;
      else definition.default = value;
      markAssetTemplateEdited(template);
      refreshActiveView();
    }, attributeInputOptions(definition));
    if (definition.type === "number") {
      appendEditableField(panel, `${name} number format`, definition.format || "decimal", (value) => {
        definition.format = value;
        markAssetTemplateEdited(template);
        refreshActiveView();
      }, { selectOptions: numberFormats });
    }
    if (definition.type === "list") {
      appendEditableField(panel, `${name} options (one per line)`, (definition.options || []).join("\n"), (value) => {
        definition.options = [...new Set(value.split(/\r?\n/).map((option) => option.trim()).filter(Boolean))];
        if (definition.default !== undefined && !definition.options.includes(definition.default)) {
          delete definition.default;
        }
        markAssetTemplateEdited(template);
        refreshActiveView();
      }, { multiline: true });
    }
    appendEditableField(panel, `${name} overridable`, definition.overridable === true, (value) => {
      definition.overridable = value;
      markAssetTemplateEdited(template);
      refreshActiveView();
    }, { checkbox: true });
  }
  if (template.data.note) appendNote(panel, "Template note", template.data.note);
}

function appendSection(parent, title) {
  parent.append(element("div", "section-title", title));
}

function appendDetail(parent, label, value) {
  if (value === undefined || value === null || value === "") return;
  parent.append(element("div", "detail-label", label));
  parent.append(element("div", "detail-value", String(value)));
}

function appendNote(parent, label, text) {
  parent.append(element("div", "detail-label", label));
  parent.append(element("div", "note-box", text));
}

function attributeInputOptions(definition) {
  if (definition.type === "boolean") return { checkbox: true };
  if (definition.type === "list") return { selectOptions: definition.options || [] };
  if (definition.type === "number") return { numberFormat: definition.format || "decimal" };
  return {};
}

function appendEditableField(parent, label, value, onChange, options = {}) {
  const wrapper = element("div", options.checkbox ? "editor-field checkbox" : "editor-field");
  const input = element(options.multiline ? "textarea" : options.selectOptions ? "select" : "input");
  const inputId = options.id || `editor-field-${editorFieldId++}`;
  input.id = inputId;
  if (options.required) input.required = true;

  if (options.checkbox) {
    input.type = "checkbox";
    input.checked = Boolean(value);
    const fieldLabel = element("label", "", label);
    fieldLabel.htmlFor = inputId;
    wrapper.append(input, fieldLabel);
  } else {
    if (options.selectOptions) {
      const placeholder = element("option", "", "Select an option");
      placeholder.value = "";
      placeholder.disabled = true;
      input.append(placeholder);
      for (const optionValue of options.selectOptions) {
        const option = element("option", "", String(optionValue));
        option.value = String(optionValue);
        input.append(option);
      }
      input.value = value === undefined || value === null ? "" : String(value);
    } else if (options.color) {
      input.type = "color";
      input.value = /^#[0-9a-f]{6}$/i.test(String(value)) ? value : "#4569e8";
    } else {
      if (options.numberFormat && input instanceof HTMLInputElement) {
        input.type = "number";
        input.step = options.numberFormat === "integer"
          ? "1"
          : options.numberFormat === "decimal" ? "any" : "0.01";
      } else if (input instanceof HTMLInputElement) {
        input.type = "text";
      }
      input.value = value === undefined || value === null ? "" : String(value);
    }
    const fieldLabel = element("label", "", label);
    fieldLabel.htmlFor = inputId;
    wrapper.append(fieldLabel, input);
  }

  input.addEventListener("change", () => {
    let updated;
    if (options.checkbox) updated = input.checked;
    else if (options.numberFormat) {
      if (input.value === "") updated = undefined;
      else if (!input.checkValidity() || !Number.isFinite(input.valueAsNumber)) {
        input.reportValidity();
        return;
      } else updated = input.valueAsNumber;
    } else updated = input.value;
    onChange(updated);
  });
  parent.append(wrapper);
}

function markEdited(filePath) {
  if (typeof filePath !== "string" || !filePath) {
    throw new Error("Edited project data must be associated with its source file.");
  }
  dirtyFiles.set(filePath, ++editVersion);
  hasEdits = true;
  reviewedInSession = false;
  updateSaveControls();
  const message = byId("review-message");
  const button = byId("review-toggle");
  if (message) message.textContent = "Changes require another review.";
  if (button) button.textContent = "Mark reviewed";
}

function clearEdited(filePath) {
  if (!dirtyFiles.delete(filePath)) return;
  hasEdits = dirtyFiles.size > 0;
  updateSaveControls();
}

function markAssetTemplateEdited(template) {
  const filePath = `${template.directory}/asset.yml`;
  template.yamlParseVersion += 1;
  clearTimeout(template.yamlTimer);
  invalidYamlFiles.delete(filePath);
  template.yamlSourceMode = "data";
  setAssetYamlStatus(template, "Updating YAML source...");
  markEdited(filePath);
  const version = ++template.yamlSerializeVersion;
  fetch("/api/yaml/stringify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: template.data })
  }).then(async (response) => {
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `YAML serialization failed (HTTP ${response.status}).`);
    if (version !== template.yamlSerializeVersion || template.yamlSourceMode !== "data") return;
    template.yamlSource = result.source;
    template.yamlSourceMode = "source";
    setAssetYamlStatus(template, "YAML source updated.");
    if (viewingAssetTemplate && activeAssetId === template.id) {
      byId("asset-yaml-source").value = result.source;
    }
  }).catch((error) => {
    if (version !== template.yamlSerializeVersion) return;
    setAssetYamlStatus(template, `Could not update YAML source: ${error.message || String(error)}`, true);
  });
}

function updateSaveControls() {
  const saveButton = byId("save-project");
  if (!saveButton) return;
  const invalidYamlMessage = invalidYamlFiles.values().next().value;
  saveButton.disabled = isSaving || dirtyFiles.size === 0 || invalidYamlFiles.size > 0;
  saveButton.textContent = isSaving
    ? "Saving..."
    : dirtyFiles.size > 0
      ? `Save (${dirtyFiles.size})`
      : "Save";
  saveButton.title = invalidYamlMessage
    ? `Fix invalid YAML before saving: ${invalidYamlMessage}`
    : "";
}

function getProjectFileData(filePath) {
  if (filePath === "project.yml") return project;
  const screen = screens.find((entry) => entry.file === filePath);
  if (screen) return screen.data;
  const asset = [...assets.values()].find((entry) => `${entry.directory}/asset.yml` === filePath);
  if (asset) return asset.data;
  if (project.theme === filePath) return theme;
  throw new Error(`Edited project file "${filePath}" is not available to save.`);
}

function getProjectFileSaveEntry(filePath) {
  const assetHtml = [...assets.values()].find((entry) => entry.htmlFile === filePath);
  if (assetHtml) return { path: filePath, content: assetHtml.html };
  if (specSources.has(filePath)) {
    return {
      path: filePath,
      ...(createdSpecFiles.has(filePath) ? { create: true } : {}),
      content: specSources.get(filePath)
    };
  }
  const assetYaml = [...assets.values()].find((entry) => `${entry.directory}/asset.yml` === filePath);
  if (assetYaml?.yamlSourceMode === "source") {
    return { path: filePath, content: assetYaml.yamlSource };
  }
  if (createdScreenFiles.has(filePath)) {
    return {
      path: filePath,
      create: true,
      data: JSON.parse(JSON.stringify(getProjectFileData(filePath)))
    };
  }
  return {
    path: filePath,
    data: JSON.parse(JSON.stringify(getProjectFileData(filePath)))
  };
}

async function saveProjectChanges() {
  if (isSaving || dirtyFiles.size === 0) return;
  if (invalidYamlFiles.size > 0) {
    updateSaveControls();
    return;
  }
  for (const [filePath, draft] of createdSpecDrafts) {
    if (specSources.get(filePath) === draft.initialContent) continue;
    if (draft.owner === "project") {
      project.spec = filePath;
      createdSpecFiles.add(filePath);
      continue;
    }
    const screen = screens.find((entry) => entry.file === draft.screenFile);
    if (draft.owner === "screen" && screen) {
      screen.data.spec = filePath;
      createdSpecFiles.add(filePath);
      continue;
    }
    const instance = screen && getInstanceAtPath(screen, draft.instancePath);
    if (!instance) {
      createdSpecDrafts.delete(filePath);
      createdSpecFiles.delete(filePath);
      specSources.delete(filePath);
      clearEdited(filePath);
      continue;
    }
    instance.spec = filePath;
    createdSpecFiles.add(filePath);
  }
  for (const screen of screens) {
    try {
      const states = sharedValidation.validatePreviewStates(screen.data, screen.file);
      const linkedSpecPaths = new Set();
      if (screen.data.spec) {
        sharedValidation.validateSpecPath(screen.data.spec);
        linkedSpecPaths.add(screen.data.spec);
      }
      for (const instance of screen.data.assets || []) {
        collectInstanceSpecPaths(instance, linkedSpecPaths);
      }
      const linkedSpecs = [];
      for (const specPath of linkedSpecPaths) {
        const content = specSources.get(specPath);
        if (content === undefined) {
          throw new Error(`${screen.file}: linked behavior spec "${specPath}" is not loaded.`);
        }
        sharedValidation.validateSpecContent(content);
        linkedSpecs.push({ path: specPath, content });
      }
      sharedValidation.validateScreenSpecStateReferences(linkedSpecs, states, screen.file);
    } catch (error) {
      showEditorMessage("Could not save changes", error.message || String(error));
      return;
    }
  }
  if (dirtyFiles.size === 0) return;
  const saveEntries = new Map([...dirtyFiles].map(([filePath, version]) => [
    filePath,
    { version, ...getProjectFileSaveEntry(filePath) }
  ]));
  for (const [filePath, draft] of createdSpecDrafts) {
    const linkFile = draft.owner === "project" ? "project.yml" : draft.screenFile;
    if (specSources.get(filePath) === draft.initialContent || saveEntries.has(linkFile)) continue;
    saveEntries.set(linkFile, {
      version: dirtyFiles.get(linkFile) ?? null,
      ...getProjectFileSaveEntry(linkFile)
    });
  }
  const savePriority = (file) => file.create && file.path.endsWith(".md")
    ? 0
    : file.create
      ? 1
      : 2;
  const snapshot = [...saveEntries.values()].sort((left, right) =>
    savePriority(left) - savePriority(right)
  );
  const copySnapshot = pendingAssetCopies.slice();
  isSaving = true;
  byId("spec-source").disabled = true;
  byId("reset-project").disabled = true;
  updateSaveControls();
  try {
    const response = await fetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        files: snapshot.map(({ version, ...file }) => file),
        ...(copySnapshot.length ? { assetCopies: copySnapshot } : {})
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Save failed (HTTP ${response.status}).`);
    for (const file of snapshot) {
      if (file.create) createdScreenFiles.delete(file.path);
      if (file.create) createdSpecFiles.delete(file.path);
      if (file.create && createdSpecDrafts.has(file.path)) {
        const draft = createdSpecDrafts.get(file.path);
        if (draft.owner === "project") {
          project.spec = file.path;
        } else {
          const screen = screens.find((entry) => entry.file === draft.screenFile);
          if (draft.owner === "screen") {
            if (screen) screen.data.spec = file.path;
          } else {
            const instance = screen && getInstanceAtPath(screen, draft.instancePath);
            if (instance) instance.spec = file.path;
          }
        }
        createdSpecDrafts.delete(file.path);
        if (activeSpecPath === file.path) byId("spec-status").textContent = "Saved.";
      }
      if (dirtyFiles.get(file.path) === file.version) dirtyFiles.delete(file.path);
    }
    const savedCopyIds = new Set(copySnapshot.map((copy) => copy.targetId));
    for (let index = pendingAssetCopies.length - 1; index >= 0; index -= 1) {
      if (savedCopyIds.has(pendingAssetCopies[index].targetId)) {
        pendingAssetCopies.splice(index, 1);
      }
    }
    hasEdits = dirtyFiles.size > 0;
    updateSaveControls();
    if (!hasEdits) {
      showEditorMessage("Changes saved", `${result.saved.length} project file${result.saved.length === 1 ? "" : "s"} saved to openux/.`);
    }
  } catch (error) {
    showEditorMessage("Could not save changes", error.message || String(error));
  } finally {
    isSaving = false;
    byId("spec-source").disabled = false;
    updateSaveControls();
    byId("reset-project").disabled = false;
  }
}

async function refreshActiveView() {
  try {
    if (viewingAssetTemplate) {
      await renderAssetTemplate(activeAssetId);
      return;
    }
    const screenIndex = activeScreenIndex;
    const instancePath = [...activeInstancePath];
    await renderScreen(screenIndex);
    const instance = getInstanceAtPath(screens[screenIndex], instancePath);
    if (instance) selectInstance(instancePath, instance["asset-template"]);
  } catch (error) {
    showFatalError(error);
  }
}

byId("reset-project").addEventListener("click", async () => {
  if (hasEdits && !window.confirm("Discard unsaved changes and reload project files?")) return;
  const button = byId("reset-project");
  button.disabled = true;
  button.textContent = "Reloading...";
  await loadProject();
  button.disabled = false;
  button.textContent = "Reset from files";
});

byId("create-screen").addEventListener("click", () =>
  createScreen().catch((error) => showEditorMessage("Could not create Screen", error.message || String(error)))
);
byId("project-nav").addEventListener("click", renderProjectOverview);
byId("save-project").addEventListener("click", () => saveProjectChanges());

byId("theme-nav").addEventListener("click", () => {
  if (!theme) return;
  hidePreviewStateControls();
  clearTimeout(assetPreviewTimer);
  assetPreviewTimer = null;
  assetPreviewVersion += 1;
  byId("main").classList.remove("asset-editing");
  byId("main").classList.remove("spec-editing");
  byId("asset-html-editor-panel").hidden = true;
  byId("asset-html-source").oninput = null;
  byId("asset-yaml-editor-panel").hidden = true;
  byId("asset-yaml-source").oninput = null;
  byId("spec-editor-panel").hidden = true;
  byId("spec-source").oninput = null;
  viewingAssetTemplate = false;
  viewingProject = false;
  viewingSpec = false;
  viewingPreviewState = false;
  activeSpecPath = null;
  activeSpecInstancePath = [];
  activeAssetId = null;
  activeInstancePath = [];
  viewingTheme = true;
  byId("breadcrumb").textContent = "Project theme";
  byId("screen-heading").textContent = theme.name || "Theme";
  hideEditorMessage();
  updateNavigationSelection();
  renderInspector();
});

byId("asset-context-edit-template").addEventListener("click", () => {
  const target = assetContextMenuTarget;
  closeAssetContextMenu();
  if (!target || target.screenIndex !== activeScreenIndex) return;
  renderAssetTemplate(target.assetId).catch(showFatalError);
});
byId("asset-context-copy-details").addEventListener("click", () => {
  const target = assetContextMenuTarget;
  closeAssetContextMenu();
  if (target) copyAssetDetails(target);
});
byId("asset-context-delete").addEventListener("click", () => {
  const target = assetContextMenuTarget;
  closeAssetContextMenu(true);
  if (target) confirmDeleteAsset(target);
});
byId("asset-delete-cancel").addEventListener("click", () => closeAssetDeleteDialog(true));
byId("asset-delete-dialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  closeAssetDeleteDialog(true);
});
byId("asset-delete-confirm").addEventListener("click", () => {
  const target = pendingAssetDeletion;
  closeAssetDeleteDialog(false);
  if (!target) return;
  deleteAssetInstance([...target.instancePath]).catch((error) =>
    showEditorMessage("Could not delete asset", error.message || String(error))
  );
});

const assetContextMenu = byId("asset-context-menu");
document.addEventListener("pointerdown", (event) => {
  if (!assetContextMenu.hidden && !assetContextMenu.contains(event.target)) {
    closeAssetContextMenu();
  }
}, true);
document.addEventListener("keydown", (event) => {
  if (assetContextMenu.hidden) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeAssetContextMenu(true);
    return;
  }
  if (event.key === "Tab") {
    closeAssetContextMenu(true);
    return;
  }
  const items = [...assetContextMenu.querySelectorAll("button:not(:disabled)")];
  if (!items.length) return;
  const currentIndex = items.indexOf(document.activeElement);
  let nextIndex = null;
  if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % items.length;
  else if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + items.length) % items.length;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = items.length - 1;
  if (nextIndex !== null) {
    event.preventDefault();
    items[nextIndex].focus();
  }
});
window.addEventListener("resize", () => closeAssetContextMenu());
window.addEventListener("scroll", () => closeAssetContextMenu(), true);

function showEditorMessage(title, message) {
  const output = byId("editor-message");
  output.replaceChildren(element("strong", "", title), element("div", "", message));
  output.classList.add("visible");
}

function hideEditorMessage() {
  const output = byId("editor-message");
  output.classList.remove("visible");
  output.replaceChildren();
}

function setPreviewMessage(state, message) {
  const preview = byId("screen-preview");
  preview.className = `screen-preview ${state}`;
  preview.replaceChildren(element("div", state === "error" ? "error-message" : "loading-message", message));
}

function showFatalError(error) {
  setPreviewMessage("error", error.message || String(error));
  byId("screen-heading").textContent = "Could not load project";
  byId("inspector-content").replaceChildren(
    element("h2", "panel-heading", "Project load error"),
    element("div", "error-message", error.message || String(error)),
    element("div", "readonly-label", "Serve the repository root over HTTP so the editor can fetch the openux/ example project.")
  );
}

function handleSystemThemeChange(event) {
  systemThemeMode = event.matches ? "dark" : "light";
  if (!theme || themeModePreference !== "system") return;
  applyTheme();
  if (viewingTheme) renderInspector();
}

if (typeof systemThemeQuery?.addEventListener === "function") {
  systemThemeQuery.addEventListener("change", handleSystemThemeChange);
} else {
  systemThemeQuery?.addListener?.(handleSystemThemeChange);
}

loadProject();
