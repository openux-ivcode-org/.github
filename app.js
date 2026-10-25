const appRoot = new URL("./openux/", window.location.href);
const booleanHtmlAttributes = new Set([
  "allowfullscreen", "async", "autofocus", "autoplay", "checked", "controls", "default",
  "defer", "disabled", "formnovalidate", "hidden", "inert", "ismap", "loop", "multiple",
  "muted", "nomodule", "novalidate", "open", "playsinline", "readonly", "required",
  "reversed", "selected"
]);
const sharedValidation = window.OpenuxValidation;
const { TEMPLATE_FILE_EXTENSION, attributeTypes, numberFormats, themeModeNames } = sharedValidation;
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
let screenViewMode = "preview";
const activePreviewStateIds = new Map();
const expandedFileDirectories = new Set();
let fileTreeInitialized = false;
let projectFilePaths = [];
let assetFiles = new Map();
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
let activeProjectFilePath = null;
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
const pendingAssetSerializations = new Set();
const createdScreenFiles = new Set();
const createdSpecFiles = new Set();
const createdSpecDrafts = new Map();
const assetSpecOwners = new Map();
let editVersion = 0;
let isSaving = false;
let historyUpdateSuppressed = false;
let browserHistoryInitialized = false;
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

function getTemplateByPath(filePath) {
  return [...assets.values()].find((template) => template.templateFile === filePath) || null;
}

function getElementLabel(instance) {
  const template = instance.type === "template" ? getTemplateByPath(instance.src) : null;
  return instance.name || template?.data.name || instance.id || instance.type || "Element";
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
  screenViewMode = "preview";
  byId("screen-view-preview").setAttribute("aria-pressed", "true");
  byId("screen-view-yaml").setAttribute("aria-pressed", "false");
  byId("preview-state-controls").hidden = false;
  byId("screen-preview").hidden = false;
  byId("screen-yaml-editor-panel").hidden = true;
  byId("screen-yaml-source").oninput = null;
}

function setScreenYamlStatus(screen, message, isError = false) {
  screen.yamlStatusMessage = message;
  screen.yamlStatusError = isError;
  if (screens[activeScreenIndex] !== screen) return;
  const status = byId("screen-yaml-status");
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function syncScreenViewMode() {
  const yamlSelected = screenViewMode === "yaml";
  byId("screen-view-preview").setAttribute("aria-pressed", String(!yamlSelected));
  byId("screen-view-yaml").setAttribute("aria-pressed", String(yamlSelected));
  byId("preview-state-controls").hidden = yamlSelected;
  byId("screen-preview").hidden = yamlSelected;
  byId("screen-yaml-editor-panel").hidden = !yamlSelected;
  const screen = screens[activeScreenIndex];
  const editor = byId("screen-yaml-source");
  if (!screen) {
    editor.value = "";
    return;
  }
  editor.value = screen.yamlSource || "";
  editor.setAttribute("aria-label", `YAML source for ${screen.data.name || screen.id}`);
  byId("screen-yaml-status").textContent = screen.yamlStatusMessage || "";
  byId("screen-yaml-status").classList.toggle("error", screen.yamlStatusError === true);
  if (yamlSelected && screen.yamlSourceMode === "data") {
    prepareScreenYamlSource(screen).catch((error) => {
      setScreenYamlStatus(screen, `Could not generate Screen YAML: ${error.message || String(error)}`, true);
    });
  }
}

async function setScreenViewMode(mode) {
  if (mode !== "preview" && mode !== "yaml") return;
  screenViewMode = mode;
  syncScreenViewMode();
}

async function prepareScreenYamlSource(screen) {
  const version = ++screen.yamlSerializeVersion;
  setScreenYamlStatus(screen, "Preparing YAML source...");
  const response = await fetch("/api/yaml/stringify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: screen.data })
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || `YAML serialization failed (HTTP ${response.status}).`);
  }
  if (version !== screen.yamlSerializeVersion || screen.yamlSourceMode !== "data") return;
  screen.yamlSource = result.source;
  screen.yamlSourceMode = "generated";
  setScreenYamlStatus(screen, "YAML source is ready.");
  if (screens[activeScreenIndex] === screen && screenViewMode === "yaml") {
    byId("screen-yaml-source").value = result.source;
  }
}

function configureScreenYamlEditor(screen) {
  const editor = byId("screen-yaml-source");
  editor.value = screen.yamlSource || "";
  editor.setAttribute("aria-label", `YAML source for ${screen.data.name || screen.id}`);
  editor.oninput = () => {
    const source = editor.value;
    screen.yamlSource = source;
    screen.yamlSourceMode = "source";
    const version = ++screen.yamlParseVersion;
    invalidYamlFiles.set(screen.file, "Validating Screen YAML...");
    setScreenYamlStatus(screen, "Validating YAML...");
    markEdited(screen.file, { yamlSource: true });
    clearTimeout(screen.yamlTimer);
    screen.yamlTimer = setTimeout(() => {
      parseScreenYaml(screen, source, version).catch((error) => {
        if (version !== screen.yamlParseVersion) return;
        const message = error.message || String(error);
        invalidYamlFiles.set(screen.file, message);
        setScreenYamlStatus(screen, `Invalid Screen YAML: ${message}`, true);
        updateSaveControls();
      });
    }, 250);
  };
}

async function parseScreenYaml(screen, source, version) {
  const response = await fetch("/api/yaml/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `YAML parsing failed (HTTP ${response.status}).`);
  if (version !== screen.yamlParseVersion) return;
  const data = result.data;
  if (!data || Array.isArray(data) || typeof data !== "object") {
    throw new Error(`${screen.file} must contain a YAML mapping.`);
  }
  sharedValidation.validatePreviewStates(data, screen.file);
  screen.data = data;
  screen.yamlSource = source;
  screen.yamlSourceMode = "source";
  invalidYamlFiles.delete(screen.file);
  setScreenYamlStatus(screen, "YAML is valid. Save to persist changes.");
  renderNavigation();
  updateSaveControls();
  const screenIndex = screens.indexOf(screen);
  if (screenIndex === activeScreenIndex) await renderScreen(screenIndex);
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
    const label = getElementLabel(instance);
    const visible = isInstanceVisible(instance, stateId);
    const button = element(
      "button",
      "instance-tree-button",
      `${label} · ${visible ? "Visible" : "Hidden"}`
    );
    button.type = "button";
    button.style.paddingLeft = `${10 + depth * 14}px`;
    button.setAttribute("aria-label", `Select ${label}; ${visible ? "visible" : "hidden"} in this preview state`);
    button.addEventListener("click", () => selectInstance(path, instance.src || null));
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
  screen.data.elements.forEach((instance) => removeStateVisibility(instance, stateId));
  if (wasActive) {
    activePreviewStateIds.set(screen.id, "default");
  }
  markEdited(screen.file);
  await renderScreen(activeScreenIndex, { previewStateSelected: keepPreviewStateSelected });
  if (keepPreviewStateSelected) return;
  const instance = getInstanceAtPath(screen, instancePath);
  if (instance) selectInstance(instancePath, instance.src || null);
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
  return parseYamlMapping(await loadText(path), path);
}

async function parseYamlSource(source, context) {
  const response = await fetch("/api/yaml/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${context}: ${result.error || `YAML parsing failed (HTTP ${response.status}).`}`);
  return result.data;
}

function parseYamlMapping(source, path) {
  const parsed = parseOpenuxYaml(source);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`${path} must contain a YAML mapping.`);
  }
  return parsed;
}

async function loadProjectFilePaths() {
  const response = await fetch("/api/files");
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || `Could not list project files (HTTP ${response.status}).`);
  }
  if (!Array.isArray(result.files) || result.files.some((filePath) =>
    typeof filePath !== "string" || !filePath || filePath.startsWith("/") || filePath.includes("\\") ||
    filePath.split("/").some((segment) =>
      !segment || segment === "." || segment === ".." || segment.startsWith(".")
    )
  )) {
    throw new Error("The project file listing is invalid.");
  }
  return result.files;
}

function validateScreenAssetIds(screen) {
  const ids = new Set();
  function visit(instances, parentPath = []) {
    for (let index = 0; index < instances.length; index += 1) {
      const instance = instances[index];
      const location = `${screen.file} elements${parentPath
        .map((part) => typeof part === "number" ? `[${part}]` : `.${part}`)
        .join("")}[${index}]`;
      if (!instance || typeof instance !== "object" || Array.isArray(instance)) {
        throw new Error(`${location}: Element must be a mapping.`);
      }
      sharedValidation.validateElementId(instance.id, location);
      if (ids.has(instance.id)) {
        throw new Error(`${location}: Element id "${instance.id}" is already used on this Screen.`);
      }
      ids.add(instance.id);
      if (Object.hasOwn(instance, "spec")) {
        throw new Error(`${location}: Element behavior specs are linked by Markdown front matter "element-id", not a Screen YAML spec property.`);
      }
      if (Object.hasOwn(instance, "interactions")) {
        throw new Error(`${location}: interactions are no longer supported; describe behavior in the Element's Markdown spec.`);
      }
      for (const [slotId, children] of Object.entries(instance.slots || {})) {
        if (Array.isArray(children)) visit(children, [...parentPath, index, slotId]);
      }
    }
  }
  if (Array.isArray(screen.data.elements)) visit(screen.data.elements);
}

function findInstancePathById(instances, assetId, parentPath = []) {
  for (let index = 0; index < instances.length; index += 1) {
    const instance = instances[index];
    const instancePath = [...parentPath, index];
    if (instance.id === assetId) return instancePath;
    for (const [slotId, children] of Object.entries(instance.slots || {})) {
      if (!Array.isArray(children)) continue;
      const childPath = findInstancePathById(children, assetId, [...instancePath, slotId]);
      if (childPath) return childPath;
    }
  }
  return null;
}

function refreshAssetSpecOwner(filePath, source) {
  assetSpecOwners.delete(filePath);
  const screen = screens.find((entry) =>
    filePath.startsWith(`screens/${entry.id}/specs/element-`)
  );
  if (!screen) return null;
  const elementId = sharedValidation.validateElementSpecHeader(source, filePath);
  sharedValidation.validateElementSpecPath(filePath, elementId);
  const instancePath = findInstancePathById(screen.data.elements || [], elementId);
  if (!instancePath) return null;
  for (const [otherPath, owner] of assetSpecOwners) {
    if (otherPath !== filePath && owner.screenFile === screen.file && owner.elementId === elementId) {
      throw new Error(`${filePath}: Element "${elementId}" already has behavior spec "${otherPath}".`);
    }
  }
  const owner = { screenFile: screen.file, elementId, instancePath };
  assetSpecOwners.set(filePath, owner);
  return owner;
}

function getAssetSpecPath(screen, instance) {
  for (const [filePath, owner] of assetSpecOwners) {
    if (owner.screenFile === screen.file && owner.elementId === instance.id) return filePath;
  }
  return null;
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
  for (const screen of screens) {
    clearTimeout(screen.yamlTimer);
    screen.yamlParseVersion += 1;
    screen.yamlSerializeVersion += 1;
  }
  screenViewMode = "preview";
  createdScreenFiles.clear();
  createdSpecFiles.clear();
  createdSpecDrafts.clear();
  assetSpecOwners.clear();
  activeProjectFilePath = null;
  pendingAssetCopies.length = 0;
  setPreviewMessage("loading", "Reading project files...");
  try {
    project = await loadYaml("project.yml");
    if (typeof project.openux !== "string" || !project.openux) {
      throw new Error("project.yml must specify the OpenUX version in openux.");
    }
    if (!Array.isArray(project.screens)) {
      throw new Error("project.yml must list screens.");
    }
    if (Object.hasOwn(project, "workflows")) {
      throw new Error("project.yml workflows are no longer supported; use project.spec, a Screen spec, or an Asset's spec.");
    }
    projectFilePaths = await loadProjectFilePaths();
    assetFiles = new Map(projectFilePaths
      .filter((filePath) => /^(?:assets|screens\/[a-z][a-z0-9-]*\/assets)\//.test(filePath))
      .map((filePath) => {
        const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
        const type = extension === TEMPLATE_FILE_EXTENSION
          ? "template"
          : [".avif", ".bmp", ".gif", ".ico", ".jpeg", ".jpg", ".png", ".svg", ".webp"].includes(extension)
            ? "image"
            : "resource";
        return [filePath, type];
      }));

    const [loadedScreens, loadedAssets, loadedTheme] = await Promise.all([
      Promise.all(project.screens.map(async (entry) => {
        const yamlSource = await loadText(entry.file);
        return {
          id: entry.id,
          file: entry.file,
          data: parseYamlMapping(yamlSource, entry.file),
          yamlSource,
          yamlSourceMode: "source",
          yamlParseVersion: 0,
          yamlSerializeVersion: 0,
          yamlTimer: null
        };
      })),
      Promise.all([...assetFiles]
        .filter(([, type]) => type === "template")
        .map(async ([templateFile]) => {
        const directory = templateFile.slice(0, templateFile.lastIndexOf("/"));
        const base = safeProjectUrl(`${directory}/`);
        const documentSource = await loadText(templateFile);
        const { header, body } = sharedValidation.splitAssetDocument(documentSource, templateFile);
        const data = await parseYamlSource(header, `${templateFile} front matter`);
        sharedValidation.validateAssetTemplateHeader(data, templateFile);
        const fileId = templateFile.slice(
          templateFile.lastIndexOf("/") + 1,
          -TEMPLATE_FILE_EXTENSION.length
        );
        if (data.id !== fileId) {
          throw new Error(`Asset id must match the filename in ${templateFile}.`);
        }
        assetCategoryPath(data, `${templateFile} front matter`);
        validateAssetAttributes(data, `${templateFile} front matter`);
        validateAssetSlots(data, `${templateFile} front matter`);
        validateAssetSlotMarkup(data, body, templateFile);
        return {
          id: data.id,
          screen: templateFile.match(/^screens\/([^/]+)\/assets\//)?.[1] || null,
          base,
          data,
          templateFile,
          documentSource,
          yamlSource: header,
          yamlSourceMode: "source",
          yamlParseVersion: 0,
          yamlSerializeVersion: 0,
          html: body
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
    if (assets.size !== loadedAssets.length) throw new Error("Discovered template ids must be unique.");
    const specPaths = new Set();
    const elementSpecPaths = [];
    for (const screen of screens) {
      validateScreenAssetIds(screen);
      if (screen.data.spec !== undefined) {
        sharedValidation.validateSpecPath(screen.data.spec);
        specPaths.add(screen.data.spec);
      }
      const elementSpecPrefix = `screens/${screen.id}/specs/element-`;
      for (const filePath of projectFilePaths) {
        if (!filePath.startsWith(elementSpecPrefix) || !filePath.endsWith(".md")) continue;
        sharedValidation.validateSpecPath(filePath);
        elementSpecPaths.push(filePath);
        specPaths.add(filePath);
      }
    }
    if (project.spec !== undefined) {
      sharedValidation.validateSpecPath(project.spec);
      specPaths.add(project.spec);
    }
    specSources = new Map(await Promise.all([...specPaths].map(async (filePath) =>
      [filePath, await loadText(filePath)]
    )));
    for (const filePath of elementSpecPaths) {
      refreshAssetSpecOwner(filePath, specSources.get(filePath));
    }
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
    pendingAssetSerializations.clear();
    byId("create-screen").disabled = false;
    updateSaveControls();
    reviewedInSession = false;
    applyTheme();
    renderNavigation();
    renderScreenSelector();
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
      const wasHistoryUpdateSuppressed = historyUpdateSuppressed;
      const restoringUrl = selectionToRestore.view === "url";
      if (restoringUrl) historyUpdateSuppressed = true;
      try {
        await restoreUiSelection(selectionToRestore);
      } finally {
        historyUpdateSuppressed = wasHistoryUpdateSuppressed;
        if (restoringUrl && !wasHistoryUpdateSuppressed) syncBrowserHistory(true);
      }
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
  if (viewingTheme) {
    return {
      view: "theme",
      screen: screenContext,
      file: activeProjectFilePath || project?.theme || null
    };
  }
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
        file: activeProjectFilePath || template.templateFile
      } : null
    };
  }
  const instance = screen && activeInstancePath.length
    ? getInstanceAtPath(screen, activeInstancePath)
    : null;
  const template = instance?.type === "template" ? getTemplateByPath(instance.src) : null;
  return {
    view: "screen",
    screen: screenContext,
    selectedAsset: instance ? {
      id: instance.id,
      name: getElementLabel(instance),
      instancePath: activeInstancePath,
      instance,
      ...(template ? { template: {
        name: template.data.name || template.id,
        description: template.data.description || "",
        attributes: template.data.attributes || {},
        slots: template.data.slots || []
      } } : {})
    } : null
  };
}

function getSelectionFilePath(selection) {
  if (selection.view === "project") return "project.yml";
  if (selection.view === "theme") return selection.file || project?.theme || null;
  if (selection.view === "spec") return selection.spec?.file || null;
  if (selection.view === "asset-template") {
    return selection.asset?.file || selection.asset?.templateFile || null;
  }
  return selection.screen?.file || screens[activeScreenIndex]?.file || null;
}

function createHistorySelection(selection) {
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

function selectionFromLocation() {
  const parameters = new URLSearchParams(window.location.search);
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

function syncBrowserHistory(forceReplace = false) {
  if (isRenderOnly || historyUpdateSuppressed) return;
  const selection = currentUiSelection();
  const filePath = getSelectionFilePath(selection);
  if (!filePath) return;

  const url = new URL(window.location.href);
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

  const state = history.state && typeof history.state === "object"
    ? { ...history.state }
    : {};
  state.openuxEditor = {
    file: filePath,
    selection: createHistorySelection(selection)
  };
  const previousFile = new URL(window.location.href).searchParams.get("file");
  if (!browserHistoryInitialized || forceReplace || previousFile === filePath) {
    history.replaceState(state, "", url);
  } else {
    history.pushState(state, "", url);
  }
  browserHistoryInitialized = true;
}

async function restoreUrlSelection(selection) {
  const action = getProjectFileAction(selection.file);
  if (action) {
    await openProjectFile(selection.file);
    if (action.kind === "screen" && Array.isArray(selection.instancePath)) {
      const screen = screens[action.screenIndex];
      const instance = screen && getInstanceAtPath(screen, selection.instancePath);
      if (instance) selectInstance(selection.instancePath, instance.src || null);
    }
    return;
  }
  if (selection.requestedView !== "spec") {
    await renderScreen(0);
    return;
  }
  if (selection.owner === "project") {
    renderProjectOverview();
    await createProjectSpec();
    return;
  }
  const screenIndex = screens.findIndex((screen) =>
    screen.id === selection.screen?.id
  );
  if (screenIndex < 0) {
    await renderScreen(0);
    return;
  }
  await renderScreen(screenIndex);
  if (selection.owner === "screen") {
    await createSpecForScreen();
    return;
  }
  const screen = screens[screenIndex];
  if (selection.owner === "instance" &&
      Array.isArray(selection.instancePath) &&
      getInstanceAtPath(screen, selection.instancePath)) {
    await createSpecForInstance(selection.instancePath);
    return;
  }
  await renderScreen(0);
}

async function restoreUiSelection(selection) {
  if (selection.view === "url") {
    await restoreUrlSelection(selection);
    return;
  }
  const screenIndex = screens.findIndex((screen) => screen.id === selection.screen?.id);
  activeScreenIndex = screenIndex >= 0 ? screenIndex : 0;
  if (selection.view === "project") {
    renderProjectOverview();
    return;
  }
  if (selection.view === "theme") {
    renderThemeView(selection.file || project?.theme);
    return;
  }
  if (selection.view === "asset-template" && assets.has(selection.asset?.id)) {
    await renderAssetTemplate(selection.asset.id, selection.asset.file);
    return;
  }
  if (selection.view === "spec" && selection.spec?.owner === "project") {
    renderProjectOverview();
    const draft = createdSpecDrafts.get(selection.spec.file);
    if (project.spec === selection.spec.file || draft?.owner === "project") {
      await renderSpecEditor(selection.spec.file, [], "project");
    } else {
      await createProjectSpec();
    }
    return;
  }
  await renderScreen(activeScreenIndex);
  if (selection.view === "spec") {
    const screen = screens[activeScreenIndex];
    if (!screen) return;
    const instancePath = selection.spec?.instancePath;
    if (selection.spec?.owner === "screen") {
      const draft = createdSpecDrafts.get(selection.spec.file);
      if (screen.data.spec === selection.spec.file ||
          (draft?.owner === "screen" && draft.screenFile === screen.file)) {
        await renderSpecEditor(selection.spec.file, [], "screen");
      } else {
        await createSpecForScreen();
      }
      return;
    }
    const instance = Array.isArray(instancePath) && screen
      ? getInstanceAtPath(screen, instancePath)
      : null;
    const assetSpecOwner = typeof selection.spec?.file === "string"
      ? assetSpecOwners.get(selection.spec.file)
      : null;
    const draft = createdSpecDrafts.get(selection.spec?.file);
    if (instance && typeof selection.spec?.file === "string" &&
        ((assetSpecOwner?.screenFile === screen.file &&
          sameInstancePath(assetSpecOwner.instancePath, instancePath)) ||
         (draft?.owner === "instance" && draft.screenFile === screen.file &&
          sameInstancePath(draft.instancePath, instancePath)))) {
      await renderSpecEditor(selection.spec.file, instancePath);
      return;
    }
    if (instance) {
      await createSpecForInstance(instancePath);
      return;
    }
  }
  const instancePath = selection.selectedAsset?.instancePath;
  if (Array.isArray(instancePath)) {
    const screen = screens[activeScreenIndex];
    const instance = screen && getInstanceAtPath(screen, instancePath);
    if (instance) selectInstance(instancePath, instance.src || null);
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
}

function renderNavigation() {
  if (!viewingAssetTemplate && !viewingTheme && !viewingProject && !viewingSpec) {
    byId("breadcrumb").textContent = "Screens";
  }
  const activeFilePath = activeProjectFilePath || (viewingSpec
    ? activeSpecPath
    : viewingTheme
      ? project?.theme
      : viewingProject
        ? "project.yml"
        : viewingAssetTemplate
          ? assets.get(activeAssetId)?.templateFile
          : screens[activeScreenIndex]?.file);
  if (activeFilePath) expandFilePath(activeFilePath);
  const tree = buildProjectFileTree(getProjectTreeFilePaths());
  if (!fileTreeInitialized) {
    addDefaultExpandedDirectories(tree, "", 0);
    fileTreeInitialized = true;
  }
  byId("project-file-tree").replaceChildren(...renderFileTreeContents(tree, ""));
  updateNavigationSelection();
}

function renderScreenSelector() {
  const toggle = byId("screen-selector-toggle");
  const optionsContainer = byId("screen-selector-options");
  const search = byId("screen-selector-search");
  const query = search.value.trim().toLocaleLowerCase();
  const matches = screens
    .map((screen, index) => ({ screen, index }))
    .filter(({ screen }) =>
      `${screen.data.name || screen.id} ${screen.id}`.toLocaleLowerCase().includes(query)
    );

  toggle.disabled = screens.length === 0;
  toggle.setAttribute(
    "aria-label",
    screens.length
      ? `Choose a Screen; current Screen: ${screens[activeScreenIndex]?.data.name || screens[activeScreenIndex]?.id}`
      : "No Screens available"
  );
  optionsContainer.replaceChildren(...matches.map(({ screen, index }) => {
    const name = screen.data.name || screen.id;
    const option = element("button", "screen-selector-option");
    option.type = "button";
    option.id = `screen-selector-option-${screen.id}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(index === activeScreenIndex));
    option.setAttribute("aria-label", `Open Screen ${name} (${screen.id})`);
    option.append(element("span", "screen-selector-option-name", name));
    option.append(element("span", "screen-selector-option-id", screen.id));
    option.addEventListener("click", () => {
      setScreenSelectorOpen(false, true);
      renderScreen(index).catch(showFatalError);
    });
    return option;
  }));
  byId("screen-selector-no-results").hidden = matches.length > 0;
}

function setScreenSelectorOpen(open, restoreFocus = false) {
  const toggle = byId("screen-selector-toggle");
  const panel = byId("screen-selector-panel");
  const search = byId("screen-selector-search");
  panel.hidden = !open;
  toggle.setAttribute("aria-expanded", String(open));
  search.value = "";
  renderScreenSelector();
  if (open) search.focus();
  else if (restoreFocus) toggle.focus();
}

function getProjectTreeFilePaths() {
  const filePaths = new Set(projectFilePaths);
  filePaths.add("project.yml");
  if (project?.theme) filePaths.add(project.theme);
  if (theme?.styles) {
    const themeDirectory = project.theme.includes("/")
      ? project.theme.slice(0, project.theme.lastIndexOf("/") + 1)
      : "";
    filePaths.add(`${themeDirectory}${theme.styles}`);
  }
  for (const screen of screens) filePaths.add(screen.file);
  for (const asset of assets.values()) {
    filePaths.add(asset.templateFile);
  }
  for (const filePath of specSources.keys()) filePaths.add(filePath);
  for (const filePath of createdSpecDrafts.keys()) filePaths.add(filePath);
  for (const filePath of createdScreenFiles) filePaths.add(filePath);
  for (const filePath of createdSpecFiles) filePaths.add(filePath);
  for (const copy of pendingAssetCopies) {
    const template = assets.get(copy.targetId);
    if (template) filePaths.add(template.templateFile);
  }
  return [...filePaths].filter((filePath) =>
    typeof filePath === "string" && filePath && !filePath.startsWith("/") && !filePath.includes("\\")
  ).sort((left, right) => left.localeCompare(right));
}

function buildProjectFileTree(filePaths) {
  const root = { directories: new Map(), files: [] };
  for (const filePath of filePaths) {
    const segments = filePath.split("/");
    const fileName = segments.pop();
    let directory = root;
    for (const segment of segments) {
      if (!directory.directories.has(segment)) {
        directory.directories.set(segment, { directories: new Map(), files: [] });
      }
      directory = directory.directories.get(segment);
    }
    directory.files.push({ name: fileName, path: filePath });
  }
  return root;
}

function addDefaultExpandedDirectories(directory, path, depth) {
  for (const [name, child] of directory.directories) {
    const childPath = path ? `${path}/${name}` : name;
    if (depth < 3) expandedFileDirectories.add(childPath);
    addDefaultExpandedDirectories(child, childPath, depth + 1);
  }
}

function expandFilePath(filePath) {
  const segments = filePath.split("/");
  for (let index = 1; index < segments.length; index += 1) {
    expandedFileDirectories.add(segments.slice(0, index).join("/"));
  }
}

function revealProjectFile(filePath) {
  expandFilePath(filePath);
  for (const folder of byId("project-file-tree").querySelectorAll(".file-tree-folder")) {
    if (expandedFileDirectories.has(folder.dataset.directoryPath)) folder.open = true;
  }
}

function renderFileTreeContents(directory, parentPath) {
  const nodes = [];
  for (const [name, child] of [...directory.directories].sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    const directoryPath = parentPath ? `${parentPath}/${name}` : name;
    const details = element("details", "file-tree-folder");
    details.dataset.directoryPath = directoryPath;
    details.open = expandedFileDirectories.has(directoryPath);
    const summary = element("summary", "", name);
    details.addEventListener("toggle", () => {
      if (details.open) expandedFileDirectories.add(directoryPath);
      else expandedFileDirectories.delete(directoryPath);
    });
    details.append(summary);
    const children = element("div", "file-tree-children");
    children.append(...renderFileTreeContents(child, directoryPath));
    details.append(children);
    nodes.push(details);
  }
  for (const file of [...directory.files].sort((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    nodes.push(renderProjectFile(file));
  }
  return nodes;
}

function renderProjectFile(file) {
  const action = getProjectFileAction(file.path);
  const button = element("button", "file-tree-file");
  button.type = "button";
  button.dataset.projectFile = file.path;
  button.disabled = !action;
  button.title = action ? `Open ${file.path}` : `${file.path} (not editable in Studio)`;
  const extension = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".") + 1) : "file";
  button.append(element("span", "file-tree-type", extension));
  button.append(element("span", "file-tree-name", file.name));
  if (action?.kind === "screen") {
    const screen = screens[action.screenIndex];
    button.dataset.openuxScreenId = screen.id;
    button.dataset.openuxScreenName = screen.data.name || screen.id;
    button.setAttribute("aria-label", `Open Screen ${screen.data.name || screen.id} (${file.path})`);
  }
  if (action?.kind === "asset") {
    button.dataset.assetId = action.asset.id;
    if (file.path === action.asset.templateFile) configureAssetTemplateDrag(button, action.asset);
    else updateAssetTemplateTreeFile(button, action.asset);
  } else if (action?.kind === "image") {
    configureAssetFileDrag(button, file.path);
  }
  if (action) {
    button.addEventListener("click", () =>
      openProjectFile(file.path).catch((error) => showEditorMessage("Could not open file", error.message || String(error)))
    );
  }
  return button;
}

function getProjectFileAction(filePath) {
  if (filePath === "project.yml") return { kind: "project" };
  const screenIndex = screens.findIndex((screen) => screen.file === filePath);
  if (screenIndex >= 0) return { kind: "screen", screenIndex };
  const themeStylesPath = theme?.styles
    ? `${project.theme.includes("/") ? project.theme.slice(0, project.theme.lastIndexOf("/") + 1) : ""}${theme.styles}`
    : null;
  if (filePath === project?.theme || filePath === themeStylesPath) return { kind: "theme" };
  for (const asset of assets.values()) {
    if (filePath === asset.templateFile) {
      return { kind: "asset", asset };
    }
  }
  if (assetFiles.get(filePath) === "image") return { kind: "image", file: filePath };
  const specAction = getSpecFileAction(filePath);
  return specAction ? { kind: "spec", ...specAction } : null;
}

function getSpecFileAction(filePath) {
  if (project?.spec === filePath || createdSpecDrafts.get(filePath)?.owner === "project") {
    return { owner: "project", instancePath: [] };
  }
  for (let screenIndex = 0; screenIndex < screens.length; screenIndex += 1) {
    const screen = screens[screenIndex];
    if (screen.data.spec === filePath) return { owner: "screen", screenIndex, instancePath: [] };
    const draft = createdSpecDrafts.get(filePath);
    if (draft?.owner === "screen" && draft.screenFile === screen.file) {
      return { owner: "screen", screenIndex, instancePath: [] };
    }
    const assetSpecOwner = assetSpecOwners.get(filePath);
    if (assetSpecOwner?.screenFile === screen.file) {
      return { owner: "instance", screenIndex, instancePath: assetSpecOwner.instancePath };
    }
    if (draft?.owner === "instance" && draft.screenFile === screen.file) {
      return { owner: "instance", screenIndex, instancePath: draft.instancePath };
    }
  }
  return null;
}

async function openProjectFile(filePath) {
  const action = getProjectFileAction(filePath);
  if (!action) return;
  const wasHistoryUpdateSuppressed = historyUpdateSuppressed;
  historyUpdateSuppressed = true;
  try {
    if (action.kind === "project") {
      renderProjectOverview();
    } else if (action.kind === "screen") {
      await renderScreen(action.screenIndex);
    } else if (action.kind === "theme") {
      renderThemeView(filePath);
    } else if (action.kind === "asset") {
      await renderAssetTemplate(action.asset.id, filePath);
    } else if (action.kind === "spec") {
      activeScreenIndex = action.screenIndex ?? activeScreenIndex;
      if (viewingSpec && activeSpecPath === filePath) {
        await renderSpecEditor(filePath, action.instancePath, action.owner);
      } else {
        if (action.owner === "project") renderProjectOverview();
        else await renderScreen(activeScreenIndex);
        await renderSpecEditor(filePath, action.instancePath, action.owner);
      }
    }
  } finally {
    historyUpdateSuppressed = wasHistoryUpdateSuppressed;
  }
  if (!wasHistoryUpdateSuppressed) syncBrowserHistory();
}

function configureAssetTemplateDrag(button, asset) {
  updateAssetTemplateTreeFile(button, asset);
  button.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData(assetDragType, asset.templateFile);
    event.dataTransfer.setData("text/plain", asset.data.name || asset.id);
    event.dataTransfer.effectAllowed = "copy";
    assetEditorRestoreId = viewingAssetTemplate ? activeAssetId : null;
    paletteAssetDropHandled = false;
    if (assetEditorRestoreId !== null) renderScreen(activeScreenIndex).catch(showFatalError);
  });
  button.addEventListener("dragend", () => {
    const restoreAssetId = assetEditorRestoreId;
    const shouldRestoreEditor = restoreAssetId !== null && !paletteAssetDropHandled;
    assetEditorRestoreId = null;
    paletteAssetDropHandled = false;
    clearDropIndicators();
    if (shouldRestoreEditor) renderAssetTemplate(restoreAssetId).catch(showFatalError);
  });
}

function configureAssetFileDrag(button, filePath) {
  const ownerScreen = filePath.match(/^screens\/([^/]+)\/assets\//)?.[1] || null;
  const targetScreen = screens[activeScreenIndex];
  const canDrag = Boolean(targetScreen) && (!ownerScreen || ownerScreen === targetScreen.id);
  button.draggable = canDrag;
  button.setAttribute(
    "aria-label",
    canDrag
      ? `${filePath.split("/").pop()} image; drag to add to ${targetScreen.data.name || "current Screen"}`
      : `Image ${filePath} belongs to another Screen`
  );
  button.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData(assetDragType, filePath);
    event.dataTransfer.setData("text/plain", filePath.split("/").pop());
    event.dataTransfer.effectAllowed = "copy";
  });
}

function updateAssetTemplateTreeFile(button, asset) {
  const assetName = asset.data.name || asset.id;
  const targetScreen = screens[activeScreenIndex];
  const canDrag = button.dataset.projectFile === asset.templateFile &&
    Boolean(targetScreen) && (!asset.screen || asset.screen === targetScreen.id);
  button.draggable = canDrag;
  button.setAttribute(
    "aria-label",
    canDrag
      ? `${assetName} template; drag to add to ${targetScreen?.data.name || "current Screen"}`
      : `Open ${assetName} template file ${button.dataset.projectFile.split("/").pop()}`
  );
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
    file = `screens/${id}/screen.yml`;
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
    data: { name, description: "", elements: [] },
    yamlSource: "",
    yamlSourceMode: "data",
    yamlParseVersion: 0,
    yamlSerializeVersion: 0,
    yamlTimer: null
  };
  screens.push(screen);
  project.screens.push({ id, file });
  createdScreenFiles.add(file);
  expandFilePath(file);
  markEdited(file);
  markEdited("project.yml");
  activeScreenIndex = screens.length - 1;
  renderScreenSelector();
  renderNavigation();
  renderScreen(activeScreenIndex).catch(showFatalError);
}

function createAssetInstanceId(screen, name, fallback) {
  const normalized = (name || fallback).toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
  const base = /^[a-z]/.test(normalized) ? normalized : `asset-${normalized}`;
  const usedIds = new Set();
  function collect(instances) {
    for (const instance of instances || []) {
      if (typeof instance.id === "string") usedIds.add(instance.id);
      for (const children of Object.values(instance.slots || {})) {
        if (Array.isArray(children)) collect(children);
      }
    }
  }
  collect(screen.data.elements);
  for (let suffix = 1; ; suffix += 1) {
    const id = suffix === 1 ? base : `${base}-${suffix}`;
    if (!usedIds.has(id)) return id;
  }
}

function createTemplateElement(template, siblings, screen) {
  const templateName = template.data.name || template.id;
  const sameTemplateCount = siblings.filter((instance) => instance.src === template.templateFile).length;
  const name = sameTemplateCount === 0 ? templateName : `${templateName} ${sameTemplateCount + 1}`;
  const attributes = Object.fromEntries(
    Object.entries(template.data.attributes || {})
      .filter(([, definition]) =>
        definition.overridable === true && Object.hasOwn(definition, "default")
      )
      .map(([name, definition]) => [name, definition.default])
  );
  const instance = {
    id: createAssetInstanceId(screen, name, template.id),
    type: "template",
    src: template.templateFile,
    name,
    description: template.data.description || "",
    attributes
  };
  if (template.data.slots) instance.slots = {};
  return instance;
}

async function ensureAssetOnScreen(template, screen) {
  if (!template.screen || template.screen === screen.id) return template;
  const existingCopy = [...assets.values()].find((asset) =>
    asset.screen === screen.id && asset.copiedFrom === template.templateFile
  );
  if (existingCopy) return existingCopy;

  const baseId = `${screen.id}-${template.id}`;
  let id;
  let file;
  for (let suffix = 1; ; suffix += 1) {
    id = suffix === 1 ? baseId : `${baseId}-${suffix}`;
    file = `screens/${screen.id}/assets/${id}${TEMPLATE_FILE_EXTENSION}`;
    if ([...assets.values()].some((entry) => entry.id === id || entry.templateFile === file)) continue;
    const response = await fetch(safeProjectUrl(file));
    if (response.status === 404) break;
    if (!response.ok) {
      throw new Error(`Could not check Asset template file "${file}" (HTTP ${response.status}).`);
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

  const documentSource = sharedValidation.formatAssetDocument(yamlResult.source, template.html);
  const copy = {
    ...template,
    id,
    screen: screen.id,
    copiedFrom: template.templateFile,
    base: safeProjectUrl(`${file.slice(0, file.lastIndexOf("/"))}/`),
    data,
    templateFile: file,
    documentSource,
    yamlSource: yamlResult.source,
    yamlSourceMode: "source",
    yamlParseVersion: 0,
    yamlSerializeVersion: 0
  };
  assets.set(id, copy);
  assetFiles.set(file, "template");
  pendingAssetCopies.push({
    sourceId: template.id,
    sourceFile: template.templateFile,
    sourceScreen: template.screen,
    targetId: id,
    targetFile: file,
    targetScreen: screen.id
  });
  expandFilePath(copy.templateFile);
  markEdited(copy.templateFile);
  renderNavigation();
  return copy;
}

function getInstanceAtPath(screen, path) {
  if (!path.length) return null;
  let siblings = screen.data.elements;
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
    if (slotId !== null) throw new Error("Top-level Screen elements do not have a layout slot.");
    if (screen.data.elements !== undefined && !Array.isArray(screen.data.elements)) {
      throw new Error(`Screen "${screen.id}" elements must be a list.`);
    }
    return screen.data.elements || (screen.data.elements = []);
  }
  if (slotId === null) throw new Error("Nested elements must belong to a template slot.");
  const parent = getInstanceAtPath(screen, parentPath);
  const parentTemplate = parent?.type === "template" ? getTemplateByPath(parent.src) : null;
  const slot = parentTemplate?.data.slots?.find((candidate) => candidate.id === slotId);
  if (!parent || !slot) throw new Error(`Layout slot "${slotId}" is no longer available.`);
  if (parent.slots !== undefined &&
      (!parent.slots || Array.isArray(parent.slots) || typeof parent.slots !== "object")) {
    throw new Error(`Element "${getElementLabel(parent)}" slots must be a mapping.`);
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
    throw new Error("The Element is no longer available.");
  }
  return { parentPath, slotId, siblings, index };
}

function instancePathFor(parentPath, slotId, index) {
  return slotId === null ? [...parentPath, index] : [...parentPath, slotId, index];
}

async function addAssetToContainer(assetPath, parentPath, slotId, requestedIndex = null) {
  const screen = screens[activeScreenIndex];
  const sourceTemplate = getTemplateByPath(assetPath);
  const fileType = assetFiles.get(assetPath);
  if (!screen) throw new Error("Select a Screen before adding an Element.");
  if (!sourceTemplate && fileType !== "image") {
    throw new Error(`Discovered image or template asset "${assetPath}" is not available.`);
  }
  const instances = getSiblingList(screen, parentPath, slotId);
  const template = sourceTemplate ? await ensureAssetOnScreen(sourceTemplate, screen) : null;
  const index = requestedIndex === null
    ? instances.length
    : Math.max(0, Math.min(requestedIndex, instances.length));
  const imageName = assetPath.slice(assetPath.lastIndexOf("/") + 1);
  const newElement = template
    ? createTemplateElement(template, instances, screen)
    : {
      id: createAssetInstanceId(screen, imageName, "image"),
      type: "image",
      src: assetPath,
      alt: "",
      name: imageName
    };
  instances.splice(index, 0, newElement);

  markEdited(screen.file);
  await renderScreen(activeScreenIndex);
  const addedPath = instancePathFor(parentPath, slotId, index);
  selectInstance(addedPath, newElement.src || null);
  const addedInstance = findAssetInstances(byId("screen-preview"))
    .find((node) => node.dataset.instancePath === JSON.stringify(addedPath));
  addedInstance?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function addAssetToScreen(assetPath) {
  return addAssetToContainer(assetPath, [], null);
}

async function addTextElement() {
  const screen = screens[activeScreenIndex];
  if (!screen) throw new Error("Select a Screen before adding an Element.");
  const elements = getSiblingList(screen, [], null);
  const instance = {
    id: createAssetInstanceId(screen, "Text", "text"),
    type: "text",
    name: "Text",
    content: "Text",
    tag: "p"
  };
  const index = elements.length;
  elements.push(instance);
  markEdited(screen.file);
  await renderScreen(activeScreenIndex);
  selectInstance([index], null);
}

function addAssetToSlot(parentPath, slotId, assetPath) {
  return addAssetToContainer(assetPath, parentPath, slotId);
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
  return search(screen.data.elements || [], []);
}

async function moveAssetInstance(sourcePath, parentPath, slotId, requestedIndex = null) {
  const screen = screens[activeScreenIndex];
  const source = getInstanceAtPath(screen, sourcePath);
  if (!source) throw new Error("The dragged Element is no longer available.");
  if (pathStartsWith(parentPath, sourcePath)) {
    throw new Error("An Element cannot be moved into one of its own slots.");
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
  if (!currentParentPath) throw new Error("The drop zone moved while the Element was being placed.");
  const movedPath = instancePathFor(currentParentPath, slotId, insertionIndex);
  selectInstance(movedPath, source.src || null);
  const movedInstance = findAssetInstances(byId("screen-preview"))
    .find((node) => node.dataset.instancePath === JSON.stringify(movedPath));
  movedInstance?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function deleteAssetInstance(path) {
  const screen = screens[activeScreenIndex];
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
    throw new Error("The dragged Element has an invalid position.");
  }
  if (!Array.isArray(path) || path.length === 0 || path.length % 2 !== 1 ||
      path.some((part, index) => index % 2 === 0
        ? !Number.isInteger(part) || part < 0
        : typeof part !== "string" || !part)) {
    throw new Error("The dragged Element has an invalid position.");
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

function revealInstanceInPreview(path) {
  const selectedPath = JSON.stringify(path);
  let selectedNode = null;
  for (const node of findAssetInstances(byId("screen-preview"))) {
    const selected = node.dataset.instancePath === selectedPath;
    node.classList.toggle("selected", selected);
    if (selected) selectedNode = node;
  }
  if (!selectedNode) return null;

  let scrollTarget = selectedNode;
  while (scrollTarget && scrollTarget.getClientRects().length === 0) {
    scrollTarget = scrollTarget.parentElement?.closest(".asset-instance") || null;
  }
  const preview = byId("screen-preview");
  const target = scrollTarget || selectedNode;
  const previewTop = preview.getBoundingClientRect().top;
  const targetRect = target.getBoundingClientRect();
  const targetTop = targetRect.top - previewTop + preview.scrollTop;
  const targetBottom = targetTop + targetRect.height;
  const visibleTop = preview.scrollTop;
  const visibleBottom = visibleTop + preview.clientHeight;
  let nextScrollTop = visibleTop;
  if (targetTop < visibleTop) nextScrollTop = targetTop;
  else if (targetBottom > visibleBottom) nextScrollTop = targetBottom - preview.clientHeight;
  if (nextScrollTop !== visibleTop) {
    preview.scrollTo({
      top: Math.max(0, Math.min(nextScrollTop, preview.scrollHeight - preview.clientHeight)),
      behavior: "smooth"
    });
  }
  return selectedNode;
}

const screenStage = byId("screen-stage");
screenStage.addEventListener("dragover", (event) => {
  if (screenViewMode !== "preview") return;
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
  if (screenViewMode !== "preview") return;
  const assetPath = event.dataTransfer.getData(assetDragType);
  const sourcePath = readDraggedInstance(event.dataTransfer);
  if (!assetPath && !sourcePath) return;
  event.preventDefault();
  event.stopPropagation();
  screenStage.classList.remove("drop-target");
  if (sourcePath) {
    moveAssetInstance(sourcePath, [], null).catch(showAddAssetError);
  } else if (!assetFiles.has(assetPath)) {
    showEditorMessage("Could not add asset", `Asset "${assetPath}" is not available in this project.`);
  } else {
    paletteAssetDropHandled = true;
    addAssetToScreen(assetPath).catch(showAddAssetError);
  }
});

function showAddAssetError(error) {
  showEditorMessage("Could not add asset", error.message || String(error));
}

async function renderScreen(index, options = {}) {
  const selected = screens[index];
  if (!selected) return;
  discardUneditedActiveSpecDraft();
  activeProjectFilePath = selected.file;
  closeAssetContextMenu();
  clearTimeout(assetPreviewTimer);
  assetPreviewTimer = null;
  assetPreviewVersion += 1;
  byId("main").classList.remove("asset-editing");
  byId("main").classList.remove("spec-editing");
  byId("asset-document-editor-panel").hidden = true;
  byId("asset-document-source").oninput = null;
  byId("spec-editor-panel").hidden = true;
  byId("spec-source").oninput = null;
  activeScreenIndex = index;
  renderScreenSelector();
  revealProjectFile(selected.file);
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
  configureScreenYamlEditor(selected);
  syncScreenViewMode();

  const preview = byId("screen-preview");
  preview.className = "screen-preview";
  preview.setAttribute("aria-label", `${selected.data.name || selected.id} Screen preview`);
  preview.replaceChildren();
  const content = element("div", "form-content");
  setScreenDomContext(content, selected);
  preview.append(content);

  try {
    if (!Array.isArray(selected.data.elements)) {
      throw new Error(`Screen "${selected.id}" elements must be a list.`);
    }
    if (selected.data.elements.length === 0) {
      byId("screen-stage").setAttribute("aria-label", "Empty Screen preview; add Elements here");
      const dropZone = element("div", "empty-screen-drop-zone", "Drop or add Elements here");
      dropZone.setAttribute("role", "group");
      dropZone.setAttribute("aria-label", "Drop an image or template asset here to add a Screen Element");
      content.append(dropZone);
      renderInspector();
      return;
    }
    byId("screen-stage").setAttribute("aria-label", "Rendered Screen preview; drop assets here to add Elements");
    for (const [index, instance] of selected.data.elements.entries()) {
      const host = await renderInstance(
        instance,
        instance.type === "template" ? getTemplateByPath(instance.src) : null,
        [index],
        selected.id,
        selected.data.name || selected.id
      );
      content.append(host);
    }
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
  activeProjectFilePath = filePath;
  const isScreenDraft = isScreenSpec && draft?.owner === "screen" && draft.screenFile === screen?.file;
  const instance = !isProjectSpec && !isScreenSpec && screen
    ? getInstanceAtPath(screen, instancePath)
    : null;
  const assetSpecOwner = assetSpecOwners.get(filePath);
  if (isProjectSpec) {
    if (project.spec !== filePath && draft?.owner !== "project") {
      throw new Error(`Behavior spec "${filePath}" is not attached to the project.`);
    }
  } else if (isScreenSpec) {
    if (!screen || (screen.data.spec !== filePath && !isScreenDraft)) {
      throw new Error(`Behavior spec "${filePath}" is not attached to the selected Screen.`);
    }
  } else if (!instance ||
      (draft?.owner !== "instance" &&
       (assetSpecOwner?.screenFile !== screen?.file ||
        !sameInstancePath(assetSpecOwner.instancePath, instancePath)))) {
    throw new Error(`Behavior spec "${filePath}" is not attached to the selected Element.`);
  }
  if (!specSources.has(filePath)) specSources.set(filePath, await loadText(filePath));
  if (viewingSpec && activeSpecPath !== filePath) {
    discardUneditedActiveSpecDraft();
  }

  byId("main").classList.remove("asset-editing");
  byId("main").classList.add("spec-editing");
  byId("asset-document-editor-panel").hidden = true;
  byId("asset-document-source").oninput = null;
  byId("spec-editor-panel").hidden = false;
  viewingAssetTemplate = false;
  viewingTheme = false;
  viewingProject = false;
  viewingPreviewState = false;
  viewingSpec = true;
  activeSpecPath = filePath;
  activeSpecOwner = owner;
  activeSpecInstancePath = isProjectSpec || isScreenSpec ? [] : [...instancePath];
  activeAssetId = instance?.src || null;
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
    let assetSpecError = "";
    if (screens.some((entry) => filePath.startsWith(`screens/${entry.id}/specs/element-`))) {
      try {
        refreshAssetSpecOwner(filePath, source);
      } catch (error) {
        assetSpecError = error.message || String(error);
      }
    }
    const pendingDraft = createdSpecDrafts.get(filePath);
    if (pendingDraft) {
      const draftScreen = screens.find((entry) => entry.file === pendingDraft.screenFile);
      if (source === pendingDraft.initialContent) {
        if (pendingDraft.owner === "project") {
          if (project.spec === filePath) delete project.spec;
        } else if (pendingDraft.owner === "screen") {
          if (draftScreen?.data.spec === filePath) delete draftScreen.data.spec;
        } else {
          assetSpecOwners.delete(filePath);
        }
        createdSpecFiles.delete(filePath);
        clearEdited(filePath);
        byId("spec-status").textContent = "Example unchanged; no spec file will be saved.";
        return;
      }
      if (pendingDraft.owner === "project") project.spec = filePath;
      else if (pendingDraft.owner === "screen" && draftScreen) draftScreen.data.spec = filePath;
      createdSpecFiles.add(filePath);
    }
    markEdited(filePath);
    byId("spec-status").textContent = assetSpecError || (pendingDraft
      ? "Example edited; unsaved changes."
      : "Unsaved Markdown changes.");
    byId("spec-status").classList.toggle("error", Boolean(assetSpecError));
  };
  renderInspector();
  if (instance) {
    requestAnimationFrame(() => {
      if (viewingSpec && activeSpecPath === filePath &&
          sameInstancePath(activeInstancePath, instancePath)) {
        revealInstanceInPreview(instancePath);
      }
    });
  }
}

function discardUneditedActiveSpecDraft() {
  if (!viewingSpec || !activeSpecPath) return;
  const filePath = activeSpecPath;
  const draft = createdSpecDrafts.get(filePath);
  if (!draft || createdSpecFiles.has(filePath) ||
      specSources.get(filePath) !== draft.initialContent) {
    return;
  }

  createdSpecDrafts.delete(filePath);
  createdSpecFiles.delete(filePath);
  specSources.delete(filePath);
  assetSpecOwners.delete(filePath);
  if (draft.owner === "project" && project.spec === filePath) {
    delete project.spec;
  } else if (draft.owner === "screen") {
    const screen = screens.find((entry) => entry.file === draft.screenFile);
    if (screen?.data.spec === filePath) delete screen.data.spec;
  }
  clearEdited(filePath);
  renderNavigation();
}

async function createSpecForInstance(instancePath) {
  const screen = screens[activeScreenIndex];
  const instance = screen && getInstanceAtPath(screen, instancePath);
  const template = instance?.type === "template" ? getTemplateByPath(instance.src) : null;
  if (!screen || !instance) throw new Error("The selected Element is no longer available.");
  const linkedSpecPath = getAssetSpecPath(screen, instance);
  if (linkedSpecPath) {
    await renderSpecEditor(linkedSpecPath, instancePath);
    return;
  }
  const pendingDraft = [...createdSpecDrafts.entries()].find(([, draft]) =>
    draft.screenFile === screen.file && sameInstancePath(draft.instancePath, instancePath)
  );
  if (pendingDraft) {
    await renderSpecEditor(pendingDraft[0], instancePath);
    return;
  }
  let filePath;
  filePath = `screens/${screen.id}/specs/element-${instance.id}.md`;
  sharedValidation.validateElementSpecPath(filePath, instance.id);
  if (specSources.has(filePath)) {
    throw new Error(`Behavior spec "${filePath}" already exists but is not linked to this Element.`);
  }
  const response = await fetch(safeProjectUrl(filePath));
  if (response.status !== 404) {
    if (!response.ok) {
      throw new Error(`Could not check whether behavior spec "${filePath}" already exists (HTTP ${response.status}).`);
    }
    throw new Error(`Behavior spec "${filePath}" already exists but is not loaded.`);
  }
  const heading = getElementLabel(instance)
    .replace(/\r?\n/g, " ")
    .trim() || template.id;
  const source = `---\nelement-id: ${instance.id}\n---\n\n# ${heading}\n\n## Purpose\n\nDescribe the behavior this Element is responsible for.\n\n## Requirements\n\n### Requirement: Perform the intended action\nThe system SHALL perform the intended behavior for this Element.\n\n#### Scenario: User interacts with this Element\n- **WHEN** the user interacts with this Element\n- **THEN** describe the expected observable outcome.\n`;
  specSources.set(filePath, source);
  createdSpecDrafts.set(filePath, {
    owner: "instance",
    initialContent: source,
    screenFile: screen.file,
    instancePath: [...instancePath]
  });
  expandFilePath(filePath);
  renderNavigation();
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
  expandFilePath(filePath);
  renderNavigation();
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

  const filePath = `screens/${screen.id}/specs/screen.md`;
  sharedValidation.validateSpecPath(filePath);
  if (specSources.has(filePath)) {
    throw new Error(`Behavior spec "${filePath}" already exists but is not linked to this Screen.`);
  }
  const existingResponse = await fetch(safeProjectUrl(filePath));
  if (existingResponse.status !== 404) {
    if (!existingResponse.ok) {
      throw new Error(`Could not check whether behavior spec "${filePath}" already exists (HTTP ${existingResponse.status}).`);
    }
    throw new Error(`Behavior spec "${filePath}" already exists but is not linked to this Screen.`);
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
  expandFilePath(filePath);
  renderNavigation();
  await renderSpecEditor(filePath, [], "screen");
}

function renderProjectOverview() {
  if (!project) return;
  discardUneditedActiveSpecDraft();
  activeProjectFilePath = "project.yml";
  hidePreviewStateControls();
  closeAssetContextMenu();
  clearTimeout(assetPreviewTimer);
  assetPreviewTimer = null;
  assetPreviewVersion += 1;
  byId("main").classList.remove("asset-editing");
  byId("main").classList.remove("spec-editing");
  byId("asset-document-editor-panel").hidden = true;
  byId("asset-document-source").oninput = null;
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
    "Project-wide specs cover behavior shared across Screens. Use a Screen-level spec for page behavior and preview-state activation, and Asset specs for individual controls or components."
  ));
  sections.append(configuration);
  content.append(sections);
  preview.append(content);
  renderInspector();
}

async function renderAssetTemplate(assetId, filePath = null) {
  const template = assets.get(assetId);
  if (!template) return;
  discardUneditedActiveSpecDraft();
  activeProjectFilePath = filePath || template.templateFile;
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
  byId("asset-document-editor-panel").hidden = false;
  byId("asset-document-editor-heading").textContent =
    `${template.data.name || assetId} — ${template.templateFile.split("/").pop()}`;
  const editor = byId("asset-document-source");
  editor.value = template.documentSource;
  editor.setAttribute("aria-label", `${template.data.name || assetId} Asset document source`);
  editor.oninput = () => {
    const source = editor.value;
    const filePath = template.templateFile;
    template.documentSource = source;
    template.yamlSourceMode = "source";
    template.yamlSerializeVersion += 1;
    pendingAssetSerializations.delete(template.id);
    const version = ++template.yamlParseVersion;
    invalidYamlFiles.set(filePath, "Validating YAML front matter...");
    setAssetDocumentStatus(template, "Validating YAML front matter...");
    markEdited(filePath);
    clearTimeout(template.yamlTimer);
    template.yamlTimer = setTimeout(() => {
      parseAssetDocument(template, source, version).catch((error) => {
        if (version !== template.yamlParseVersion) return;
        invalidYamlFiles.set(filePath, error.message || String(error));
        setAssetDocumentStatus(
          template,
          `Invalid Asset document: ${error.message || String(error)}`,
          true
        );
        updateSaveControls();
      });
    }, 250);
  };
  const documentError = invalidYamlFiles.get(template.templateFile);
  if (documentError) {
    setAssetDocumentStatus(template, `Invalid Asset document: ${documentError}`, true);
  } else {
    setAssetDocumentStatus(template, template.yamlStatus?.message || "");
  }
  await renderAssetTemplatePreview(template);
  renderInspector();
}

async function parseAssetDocument(template, source, version) {
  const filePath = template.templateFile;
  const { header, body } = sharedValidation.splitAssetDocument(source, filePath);
  const data = await parseYamlSource(header, `${filePath} front matter`);
  if (version !== template.yamlParseVersion) return;
  sharedValidation.validateAssetTemplateHeader(data, filePath);
  if (data.id !== template.id) {
    throw new Error(`Asset id must remain "${template.id}".`);
  }
  assetCategoryPath(data, `${filePath} front matter`);
  validateAssetAttributes(data, `${filePath} front matter`);
  validateAssetSlots(data, `${filePath} front matter`);
  validateAssetSlotMarkup(data, body, filePath);
  const attributeNames = new Set(Object.keys(data.attributes || {}));
  for (const match of body.matchAll(/\$\{attributes\.([^}]+)\}/g)) {
    if (!attributeNames.has(match[1])) {
      throw new Error(`references undeclared attribute "${match[1]}".`);
    }
  }
  template.data = data;
  template.html = body;
  template.documentSource = source;
  template.yamlSource = header;
  template.yamlSourceMode = "source";
  invalidYamlFiles.delete(filePath);
  setAssetDocumentStatus(template, "YAML front matter is valid.");
  renderNavigation();
  updateSaveControls();
  if (viewingAssetTemplate && activeAssetId === template.id) {
    byId("screen-heading").textContent = `${template.data.name || template.id} template`;
    byId("asset-document-editor-heading").textContent =
      `${template.data.name || template.id} — ${template.templateFile.split("/").pop()}`;
    byId("asset-document-source").setAttribute(
      "aria-label",
      `${template.data.name || template.id} Asset document source`
    );
    renderInspector();
    await renderAssetTemplatePreview(template);
  }
}

function setAssetDocumentStatus(template, message, isError = false) {
  template.yamlStatus = { message, isError };
  if (!viewingAssetTemplate || activeAssetId !== template.id) return;
  const status = byId("asset-document-status");
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
    validateAssetSlotMarkup(template.data, template.html, template.templateFile);
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
  const type = instance.type || "template";
  if (type === "template" && !template) {
    throw new Error(`Screen references undiscovered template asset "${instance.src}".`);
  }
  if (type === "template") {
    for (const name of Object.keys(instance.attributes || {})) {
      const definition = template.data.attributes?.[name];
      if (!definition) {
        throw new Error(`Template "${template.id}" does not define the "${name}" attribute used by this Element.`);
      }
      if (definition.overridable !== true) {
        throw new Error(`Template attribute "${name}" in "${template.id}" is not marked overridable.`);
      }
      if (!isValidAttributeValue(definition, instance.attributes[name])) {
        throw new Error(`Screen value for "${template.id}.${name}" does not match its declared type.`);
      }
    }
  }

  const host = element("div", "asset-instance");
  host.dataset.instancePath = JSON.stringify(instancePath);
  host.hidden = Boolean(screenId && !isInstanceVisible(instance));
  if (screenId) {
    host.dataset.openuxScreenId = screenId;
    host.dataset.openuxScreenName = screenName;
    host.dataset.openuxAssetId = template?.id || instance.src || type;
    host.dataset.openuxElementId = instance.id || "";
    host.dataset.openuxInstanceName = typeof instance.name === "string" ? instance.name : "";
    host.dataset.openuxInstancePath = JSON.stringify(instancePath);
  }
  if (instancePath.length === 1) host.dataset.instanceIndex = String(instancePath[0]);
  host.draggable = instancePath.length > 0;
  host.tabIndex = 0;
  host.setAttribute("role", "group");
  host.setAttribute("aria-label", getElementLabel(instance));
  if (sameInstancePath(activeInstancePath, instancePath)) {
    host.classList.add("selected");
  }

  const usesLightDom = type === "template" && Boolean(template.data.slots);
  if (usesLightDom) host.id = `openux-asset-scope-${++assetStyleScopeId}`;
  if (type === "template") {
    const root = usesLightDom ? host : host.attachShadow({ mode: "open" });
    mountAssetMarkup(root, template.html, template.base, instance, template);
  } else if (type === "image") {
    const image = element("img", "screen-image");
    image.src = safeProjectUrl(instance.src).href;
    image.alt = instance.alt;
    host.append(image);
  } else if (type === "text") {
    const text = element(instance.tag || "p", "screen-text", instance.content);
    host.append(text);
  } else {
    throw new Error(`Element "${instance.id}" has unsupported type "${type}".`);
  }
  if (instancePath.length) {
    host.addEventListener("dragstart", (event) => {
      event.stopPropagation();
      event.dataTransfer.setData(assetInstanceDragType, JSON.stringify(instancePath));
      event.dataTransfer.setData("text/plain", getElementLabel(instance));
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
      const assetPath = event.dataTransfer.getData(assetDragType);
      if (!sourcePath && !assetPath) return;
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
      } else if (!assetFiles.has(assetPath)) {
        showEditorMessage("Could not add asset", `Asset "${assetPath}" is not available in this project.`);
      } else {
        paletteAssetDropHandled = true;
        addAssetToContainer(assetPath, parentPath, slotId, insertionIndex)
          .catch(showAddAssetError);
      }
    });
    host.addEventListener("click", (event) => {
      const clickedInstance = getEventInstance(event);
      if (clickedInstance === host && !(viewingSpec && event.detail > 1)) {
        selectInstance(instancePath, instance.src || null);
      }
    });
    host.addEventListener("dblclick", (event) => {
      if (!screenId || getEventInstance(event) !== host) return;
      event.preventDefault();
      event.stopPropagation();
      if (viewingSpec) return;
      selectInstance(instancePath, instance.src || null);
      const selected = getInstanceAtPath(screens[activeScreenIndex], instancePath);
      const specPath = selected && getAssetSpecPath(screens[activeScreenIndex], selected);
      if (!specPath) {
        createSpecForInstance(instancePath).catch((error) =>
          showEditorMessage("Could not create behavior spec", error.message || String(error))
        );
        return;
      }
      renderSpecEditor(specPath, instancePath).catch((error) =>
        showEditorMessage("Could not open behavior spec", error.message || String(error))
      );
    });
    host.addEventListener("contextmenu", (event) => {
      if (!screenId) return;
      event.preventDefault();
      event.stopPropagation();
      selectInstance(instancePath, instance.src || null);
      openAssetContextMenu(event, host, instancePath, instance.src || null);
    });
    host.addEventListener("focus", (event) => {
      if (getEventInstance(event) === host) selectInstance(instancePath, instance.src || null);
    });
    host.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && event.target === host) {
        event.preventDefault();
        if (getEventInstance(event) === host) selectInstance(instancePath, instance.src || null);
      }
    });
  }

  if (type === "template") {
    const root = usesLightDom ? host : host.shadowRoot;
    await renderInstanceSlots(root, instance, template, instancePath, screenId, screenName);
  }
  return host;
}

function getEventInstance(event) {
  return event.composedPath().find((node) =>
    node instanceof HTMLElement && node.classList.contains("asset-instance")
  );
}

function openAssetContextMenu(event, host, instancePath, assetId) {
  const menu = byId("asset-context-menu");
  const instance = getInstanceAtPath(screens[activeScreenIndex], instancePath);
  const template = instance?.type === "template" ? getTemplateByPath(instance.src) : null;
  assetContextMenuTarget = {
    screenIndex: activeScreenIndex,
    instancePath: [...instancePath],
    assetId,
    host
  };
  const editTemplateButton = byId("asset-context-edit-template");
  editTemplateButton.disabled = !template;
  editTemplateButton.title = template
    ? "Open the reusable template asset"
    : "Only template Elements have editable HTML assets.";
  const deleteButton = byId("asset-context-delete");
  deleteButton.disabled = false;
  deleteButton.title = "";
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
  const template = instance?.type === "template" ? getTemplateByPath(instance.src) : null;
  if (!screen || !instance) {
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
      selectedElement: {
        instancePath: target.instancePath,
        type: instance.type,
        ...(template ? { template: {
          id: template.id,
          name: template.data.name || template.id,
          description: template.data.description || "",
          category: template.data.category || "",
          attributes: template.data.attributes || {},
          slots: template.data.slots || []
        } } : {}),
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
    const instanceName = getElementLabel(instance);
    const screenName = screen.data.name || screen.id;
    const hasNestedAssets = Object.values(instance.slots || {}).some(
      (children) => Array.isArray(children) && children.length > 0
    );
    const nestedWarning = hasNestedAssets ? " Elements inside its slots will also be deleted." : "";
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
    throw new Error(`Asset "${instance.name || template.id}" slots must be a mapping.`);
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
    target.setAttribute("data-placeholder", `Drop Elements into ${slot.name || slot.id}`);
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
        const assetPath = event.dataTransfer.getData(assetDragType);
        const sourcePath = readDraggedInstance(event.dataTransfer);
        if (!assetPath && !sourcePath) return;
        event.preventDefault();
        event.stopPropagation();
        target.classList.remove("drop-target");
        if (sourcePath) {
          moveAssetInstance(sourcePath, instancePath, slot.id).catch(showAddAssetError);
        } else if (!assetFiles.has(assetPath)) {
          showEditorMessage("Could not add asset", `Asset "${assetPath}" is not available in this project.`);
        } else {
          paletteAssetDropHandled = true;
          addAssetToSlot(instancePath, slot.id, assetPath).catch(showAddAssetError);
        }
      });
    }

    const children = slots[slot.id] || [];
    if (!Array.isArray(children)) {
      throw new Error(`Layout slot "${slot.id}" contents must be a list.`);
    }
    for (const [childIndex, child] of children.entries()) {
      const childHost = await renderInstance(
        child,
        child.type === "template" ? getTemplateByPath(child.src) : null,
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
  const keepSpecEditorOpen = viewingSpec;
  const isCurrentAssetSpec = keepSpecEditorOpen &&
    activeSpecOwner === "instance" &&
    sameInstancePath(activeSpecInstancePath, path);
  activeAssetId = assetId;
  activeInstancePath = path;
  if (keepSpecEditorOpen) {
    revealInstanceInPreview(path);
    if (isCurrentAssetSpec) return;
    createSpecForInstance([...path]).catch((error) =>
      showEditorMessage("Could not open behavior spec", error.message || String(error))
    );
    return;
  }
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
  revealInstanceInPreview(path);
  updateNavigationSelection();
  renderInspector();
}

function updateNavigationSelection() {
  document.querySelectorAll(".file-tree-file").forEach((button) => {
    const filePath = button.dataset.projectFile;
    const action = getProjectFileAction(filePath);
    const selected = activeProjectFilePath === filePath;
    button.classList.toggle("selected", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
    if (action?.kind === "asset") updateAssetTemplateTreeFile(button, action.asset);
  });
  syncBrowserHistory();
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
    const instance = activeInstancePath.length
      ? getInstanceAtPath({ data: screen }, activeInstancePath)
      : null;
    const template = instance?.type === "template" ? getTemplateByPath(instance.src) : null;
    if (instance) {
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
  appendSection(panel, "Element visibility");
  let visibleInstances = 0;
  function renderInstanceVisibility(instance, instancePath, depth) {
    const label = getElementLabel(instance);
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
    for (const [slotId, children] of Object.entries(instance.slots || {})) {
      if (!Array.isArray(children)) continue;
      children.forEach((child, index) =>
        renderInstanceVisibility(child, [...instancePath, slotId, index], depth + 1)
      );
    }
  }
  (screen.data.elements || []).forEach((instance, index) =>
    renderInstanceVisibility(instance, [index], 0)
  );
  if (visibleInstances === 0) {
    appendDetail(panel, "Elements", "This Screen has no Elements.");
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
  appendSection(panel, "Behavior spec");
  appendDetail(panel, "File", activeSpecPath || "Unavailable");
  appendDetail(panel, "Screen", screen?.data.name || screen?.id || "Unavailable");
  appendDetail(panel, "Element", instance ? getElementLabel(instance) : "Unavailable");
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
  appendSection(panel, "Elements in Screen");
  renderScreenInstanceTree(panel, screen.elements || [], [], 0, activeStateId);
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
  appendSection(panel, "Selected Element");
  appendDetail(panel, "Element ID", instance.id);
  appendDetail(panel, "Type", instance.type);
  appendEditableField(panel, "Name", instance.name, (value) => {
    instance.name = value;
    markEdited(screens[activeScreenIndex].file);
    refreshActiveView();
  });
  appendEditableField(panel, "Description", instance.description, (value) => {
    instance.description = value;
    markEdited(screens[activeScreenIndex].file);
    refreshActiveView();
  }, { multiline: true });
  if (instance.type === "template" && template) {
    panel.append(element("span", "template-tag", `${template.data.name || template.id} template`));
    appendDetail(panel, "Asset file", template.templateFile);
  } else if (instance.type === "image") {
    appendDetail(panel, "Asset file", instance.src);
    appendEditableField(panel, "Alt text", instance.alt || "", (value) => {
      instance.alt = value;
      markEdited(screens[activeScreenIndex].file);
      refreshActiveView();
    });
  } else if (instance.type === "text") {
    appendEditableField(panel, "Text", instance.content || "", (value) => {
      instance.content = value;
      markEdited(screens[activeScreenIndex].file);
      refreshActiveView();
    }, { multiline: true });
    appendDetail(panel, "HTML tag", instance.tag || "p");
  }
  if (activeInstancePath.length > 0) {
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
  if (template?.data.slots) {
    appendSection(panel, "Drop zones");
    for (const slot of template.data.slots) {
      appendDetail(panel, slot.name || slot.id, "Drag Elements into this zone.");
    }
  }
  appendEditableField(panel, "AI note (optional)", instance.note || "", (value) => {
    if (value) instance.note = value;
    else delete instance.note;
    markEdited(screens[activeScreenIndex].file);
  }, { multiline: true });
  for (const [name, definition] of Object.entries(template?.data.attributes || {})) {
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
  appendSection(panel, "Behavior spec");
  const specPath = getAssetSpecPath(screens[activeScreenIndex], instance);
  if (specPath) {
    appendDetail(panel, "File", specPath);
    const openSpec = element("button", "spec-action-button", "Open behavior spec");
    openSpec.type = "button";
    openSpec.addEventListener("click", () =>
      renderSpecEditor(specPath, activeInstancePath).catch(showFatalError)
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
  const deleteButton = element("button", "delete-instance-button", "Delete Element");
  deleteButton.type = "button";
  deleteButton.addEventListener("click", () => confirmDeleteAsset({
    screenIndex: activeScreenIndex,
    instancePath: [...activeInstancePath],
    assetId: instance.src || null
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

function markEdited(filePath, options = {}) {
  if (typeof filePath !== "string" || !filePath) {
    throw new Error("Edited project data must be associated with its source file.");
  }
  const screen = screens.find((entry) => entry.file === filePath);
  if (screen) {
    screen.yamlSerializeVersion += 1;
    if (options.yamlSource) screen.yamlSourceMode = "source";
    else if (!invalidYamlFiles.has(filePath)) screen.yamlSourceMode = "data";
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
  const filePath = template.templateFile;
  template.yamlParseVersion += 1;
  clearTimeout(template.yamlTimer);
  invalidYamlFiles.delete(filePath);
  template.yamlSourceMode = "data";
  pendingAssetSerializations.add(template.id);
  setAssetDocumentStatus(template, "Updating YAML front matter...");
  markEdited(filePath);
  updateSaveControls();
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
    template.documentSource = sharedValidation.formatAssetDocument(result.source, template.html);
    template.yamlSourceMode = "source";
    invalidYamlFiles.delete(filePath);
    setAssetDocumentStatus(template, "YAML front matter updated.");
    if (viewingAssetTemplate && activeAssetId === template.id) {
      byId("asset-document-source").value = template.documentSource;
    }
  }).catch((error) => {
    if (version !== template.yamlSerializeVersion) return;
    invalidYamlFiles.set(filePath, error.message || String(error));
    setAssetDocumentStatus(
      template,
      `Could not update YAML front matter: ${error.message || String(error)}`,
      true
    );
  }).finally(() => {
    if (version !== template.yamlSerializeVersion) return;
    pendingAssetSerializations.delete(template.id);
    updateSaveControls();
  });
}

function updateSaveControls() {
  const saveButton = byId("save-project");
  if (!saveButton) return;
  const invalidYamlMessage = invalidYamlFiles.values().next().value;
  const assetSerializationPending = pendingAssetSerializations.size > 0;
  saveButton.disabled = isSaving || dirtyFiles.size === 0 ||
    invalidYamlFiles.size > 0 || assetSerializationPending;
  saveButton.textContent = isSaving
    ? "Saving..."
    : dirtyFiles.size > 0
      ? `Save (${dirtyFiles.size})`
      : "Save";
  saveButton.title = invalidYamlMessage
    ? `Fix invalid YAML before saving: ${invalidYamlMessage}`
    : assetSerializationPending
      ? "Wait for Asset front matter to finish updating."
      : "";
}

function getProjectFileData(filePath) {
  if (filePath === "project.yml") return project;
  const screen = screens.find((entry) => entry.file === filePath);
  if (screen) return screen.data;
  const asset = [...assets.values()].find((entry) => entry.templateFile === filePath);
  if (asset) return asset.data;
  if (project.theme === filePath) return theme;
  throw new Error(`Edited project file "${filePath}" is not available to save.`);
}

function getProjectFileSaveEntry(filePath) {
  const assetHtml = [...assets.values()].find((entry) => entry.templateFile === filePath);
  if (assetHtml) return { path: filePath, content: assetHtml.documentSource };
  if (specSources.has(filePath)) {
    return {
      path: filePath,
      ...(createdSpecFiles.has(filePath) ? { create: true } : {}),
      content: specSources.get(filePath)
    };
  }
  const screen = screens.find((entry) => entry.file === filePath);
  if (screen?.yamlSourceMode === "source") {
    return {
      path: filePath,
      ...(createdScreenFiles.has(filePath) ? { create: true } : {}),
      content: screen.yamlSource
    };
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
  if (invalidYamlFiles.size > 0 || pendingAssetSerializations.size > 0) {
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
      assetSpecOwners.delete(filePath);
      clearEdited(filePath);
      continue;
    }
    createdSpecFiles.add(filePath);
  }
  for (const screen of screens) {
    try {
      validateScreenAssetIds(screen);
      const states = sharedValidation.validatePreviewStates(screen.data, screen.file);
      const linkedSpecPaths = new Set();
      if (screen.data.spec) {
        sharedValidation.validateSpecPath(screen.data.spec);
        linkedSpecPaths.add(screen.data.spec);
      }
      const elementSpecPrefix = `screens/${screen.id}/specs/element-`;
      const linkedElementIds = new Set();
      for (const [specPath, content] of specSources) {
        if (!specPath.startsWith(elementSpecPrefix)) continue;
        const elementId = sharedValidation.validateElementSpecHeader(content, specPath);
        sharedValidation.validateElementSpecPath(specPath, elementId);
        const instancePath = findInstancePathById(screen.data.elements || [], elementId);
        if (!instancePath) {
          assetSpecOwners.delete(specPath);
          continue;
        }
        if (linkedElementIds.has(elementId)) {
          throw new Error(`${specPath}: Element "${elementId}" has more than one behavior spec.`);
        }
        linkedElementIds.add(elementId);
        assetSpecOwners.set(specPath, { screenFile: screen.file, elementId, instancePath });
        linkedSpecPaths.add(specPath);
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
    if (draft.owner === "instance") continue;
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
          }
        }
        createdSpecDrafts.delete(file.path);
        if (activeSpecPath === file.path) byId("spec-status").textContent = "Saved.";
      }
      const savedCurrentVersion = dirtyFiles.get(file.path) === file.version;
      if (savedCurrentVersion) dirtyFiles.delete(file.path);
      const savedScreen = screens.find((entry) => entry.file === file.path);
      if (savedScreen && savedCurrentVersion) setScreenYamlStatus(savedScreen, "Saved.");
    }
    const savedCopyIds = new Set(copySnapshot.map((copy) => copy.targetId));
    const updatedFilePaths = new Set(projectFilePaths);
    for (const file of snapshot) updatedFilePaths.add(file.path);
    for (const copy of copySnapshot) {
      const template = assets.get(copy.targetId);
      if (template) updatedFilePaths.add(template.templateFile);
    }
    projectFilePaths = [...updatedFilePaths];
    for (let index = pendingAssetCopies.length - 1; index >= 0; index -= 1) {
      if (savedCopyIds.has(pendingAssetCopies[index].targetId)) {
        pendingAssetCopies.splice(index, 1);
      }
    }
    hasEdits = dirtyFiles.size > 0;
    renderNavigation();
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
    if (instance) selectInstance(instancePath, instance.src || null);
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
byId("screen-view-preview").addEventListener("click", () => setScreenViewMode("preview"));
byId("screen-view-yaml").addEventListener("click", () => setScreenViewMode("yaml"));
byId("screen-selector-toggle").addEventListener("click", () =>
  setScreenSelectorOpen(byId("screen-selector-panel").hidden)
);
byId("screen-selector-search").addEventListener("input", renderScreenSelector);
byId("screen-selector-search").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    setScreenSelectorOpen(false, true);
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    byId("screen-selector-options").querySelector("button")?.focus();
  } else if (event.key === "Enter") {
    const firstOption = byId("screen-selector-options").querySelector("button");
    if (firstOption) {
      event.preventDefault();
      firstOption.click();
    }
  }
});
byId("screen-selector-options").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    setScreenSelectorOpen(false, true);
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const options = [...byId("screen-selector-options").querySelectorAll("button")];
  if (!options.length) return;
  const currentIndex = options.indexOf(document.activeElement);
  if (event.key === "ArrowUp" && currentIndex === 0) {
    byId("screen-selector-search").focus();
    return;
  }
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? options.length - 1
      : Math.max(0, Math.min(options.length - 1, currentIndex + (event.key === "ArrowDown" ? 1 : -1)));
  options[nextIndex]?.focus();
});
document.addEventListener("pointerdown", (event) => {
  if (!byId("screen-quick-selector").contains(event.target) &&
      !byId("screen-selector-panel").hidden) {
    setScreenSelectorOpen(false);
  }
});
byId("save-project").addEventListener("click", () => saveProjectChanges());
byId("add-text-element").addEventListener("click", () =>
  addTextElement().catch((error) =>
    showEditorMessage("Could not add text Element", error.message || String(error))
  )
);

function renderThemeView(filePath = project?.theme) {
  if (!theme) return;
  discardUneditedActiveSpecDraft();
  activeProjectFilePath = filePath || project.theme;
  hidePreviewStateControls();
  clearTimeout(assetPreviewTimer);
  assetPreviewTimer = null;
  assetPreviewVersion += 1;
  byId("main").classList.remove("asset-editing");
  byId("main").classList.remove("spec-editing");
  byId("asset-document-editor-panel").hidden = true;
  byId("asset-document-source").oninput = null;
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
}

byId("asset-context-edit-template").addEventListener("click", () => {
  const target = assetContextMenuTarget;
  closeAssetContextMenu();
  if (!target || target.screenIndex !== activeScreenIndex) return;
  const template = getTemplateByPath(target.assetId);
  if (template) renderAssetTemplate(template.id).catch(showFatalError);
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
window.addEventListener("popstate", (event) => {
  if (isRenderOnly) return;
  const savedSelection = event.state?.openuxEditor?.selection;
  const selection = savedSelection && typeof savedSelection === "object"
    ? savedSelection
    : selectionFromLocation();
  const wasHistoryUpdateSuppressed = historyUpdateSuppressed;
  historyUpdateSuppressed = true;
  const restore = selection ? restoreUiSelection(selection) : loadProject();
  Promise.resolve(restore)
    .catch((error) => showEditorMessage("Could not restore browser history entry", error.message || String(error)))
    .finally(() => {
      historyUpdateSuppressed = wasHistoryUpdateSuppressed;
      if (!wasHistoryUpdateSuppressed) syncBrowserHistory(true);
    });
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

loadProject(selectionFromLocation());
