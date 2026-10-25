import "./yaml.js";
import "./validation.js";
import { AssetEditor } from "./browser/AssetEditor.mjs";
import { BrowserHistory } from "./browser/BrowserHistory.mjs";
import { EditorNavigation } from "./browser/EditorNavigation.mjs";
import { EditorEventController } from "./browser/EditorEventController.mjs";
import { InspectorRenderer } from "./browser/InspectorRenderer.mjs";
import { ProjectFileTree } from "./browser/ProjectFileTree.mjs";
import { ProjectFileNavigator } from "./browser/ProjectFileNavigator.mjs";
import { ResizablePanels } from "./browser/ResizablePanels.mjs";
import { ProjectPersistence } from "./browser/ProjectPersistence.mjs";
import { ProjectRepository } from "./browser/ProjectRepository.mjs";
import { PreviewStateController } from "./browser/PreviewStateController.mjs";
import { ScreenElementController } from "./browser/ScreenElementController.mjs";
import { ScreenYamlEditor } from "./browser/ScreenYamlEditor.mjs";
import { ScreenInstanceRenderer } from "./browser/ScreenInstanceRenderer.mjs";
import { SpecEditor } from "./browser/SpecEditor.mjs";
import { ThemeEditor } from "./browser/ThemeEditor.mjs";
import { TemplateMarkupRenderer } from "./browser/TemplateMarkupRenderer.mjs";
import { WorkspaceViewRenderer } from "./browser/WorkspaceViewRenderer.mjs";

const appRoot = new URL("./openux/", window.location.href);
const sharedValidation = globalThis.OpenuxValidation;
const parseOpenuxYaml = globalThis.OpenuxYamlParser;
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
const activePreviewStateIds = new Map();
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
let assetPreviewTimer = null;
let assetPreviewVersion = 0;
let editorFieldId = 0;
let assetStyleScopeId = 0;
const browserHistory = new BrowserHistory({
  windowObject: window,
  getCurrentSelection: currentUiSelection,
  getSelectionFilePath,
  isRenderOnly: () => isRenderOnly,
  isUpdatesSuppressed: () => historyUpdateSuppressed
});
const templateMarkupRenderer = new TemplateMarkupRenderer({
  appRoot,
  getThemeStylesheet: () => themeStylesheet,
  getThemeStylesheetBase: () => themeStylesheetBase
});
const projectRepository = new ProjectRepository({
  appRoot,
  fetcher: (url, options) => fetch(url, options),
  parseYaml: parseOpenuxYaml,
  validation: sharedValidation,
  templateFileExtension: TEMPLATE_FILE_EXTENSION
});
const projectFileTree = new ProjectFileTree({
  container: byId("project-file-tree"),
  createElement: element,
  getFilePaths: getProjectTreeFilePaths,
  renderFile: renderProjectFile
});
const screenYamlEditor = new ScreenYamlEditor({
  documentObject: document,
  fetcher: (url, options) => fetch(url, options),
  getActiveScreen: () => screens[activeScreenIndex],
  getActiveScreenIndex: () => activeScreenIndex,
  getScreenIndex: (screen) => screens.indexOf(screen),
  invalidYamlFiles,
  markEdited,
  renderNavigation,
  renderScreen,
  updateSaveControls,
  validatePreviewStates: sharedValidation.validatePreviewStates
});
const specEditor = new SpecEditor({
  state: {
    get project() { return project; },
    get screens() { return screens; },
    get activeScreenIndex() { return activeScreenIndex; },
    get activeProjectFilePath() { return activeProjectFilePath; },
    set activeProjectFilePath(value) { activeProjectFilePath = value; },
    get createdSpecDrafts() { return createdSpecDrafts; },
    get assetSpecOwners() { return assetSpecOwners; },
    get specSources() { return specSources; },
    get viewingSpec() { return viewingSpec; },
    set viewingSpec(value) { viewingSpec = value; },
    get viewingAssetTemplate() { return viewingAssetTemplate; },
    set viewingAssetTemplate(value) { viewingAssetTemplate = value; },
    get viewingTheme() { return viewingTheme; },
    set viewingTheme(value) { viewingTheme = value; },
    get viewingProject() { return viewingProject; },
    set viewingProject(value) { viewingProject = value; },
    get viewingPreviewState() { return viewingPreviewState; },
    set viewingPreviewState(value) { viewingPreviewState = value; },
    get activeSpecPath() { return activeSpecPath; },
    set activeSpecPath(value) { activeSpecPath = value; },
    get activeSpecOwner() { return activeSpecOwner; },
    set activeSpecOwner(value) { activeSpecOwner = value; },
    get activeSpecInstancePath() { return activeSpecInstancePath; },
    set activeSpecInstancePath(value) { activeSpecInstancePath = value; },
    get activeAssetId() { return activeAssetId; },
    set activeAssetId(value) { activeAssetId = value; },
    get activeInstancePath() { return activeInstancePath; },
    set activeInstancePath(value) { activeInstancePath = value; },
    get createdSpecFiles() { return createdSpecFiles; },
    get isSaving() { return isSaving; }
  },
  services: {
    validation: sharedValidation,
    byId,
    hidePreviewStateControls,
    getInstanceAtPath,
    sameInstancePath,
    loadText,
    hideEditorMessage,
    updateNavigationSelection,
    refreshAssetSpecOwner,
    clearEdited,
    renderNavigation,
    markEdited,
    renderInspector,
    revealInstanceInPreview,
    getElementLabel,
    getTemplateByPath,
    getAssetSpecPath,
    safeProjectUrl,
    fetcher: (url, options) => fetch(url, options),
    projectFileTree,
    getScreenPreviewStates
  }
});
const projectPersistence = new ProjectPersistence({
  state: {
    get project() { return project; },
    get screens() { return screens; },
    get assets() { return assets; },
    get theme() { return theme; },
    get activeAssetId() { return activeAssetId; },
    get viewingAssetTemplate() { return viewingAssetTemplate; },
    get isSaving() { return isSaving; },
    set isSaving(value) { isSaving = value; },
    get dirtyFiles() { return dirtyFiles; },
    get invalidYamlFiles() { return invalidYamlFiles; },
    get editVersion() { return editVersion; },
    set editVersion(value) { editVersion = value; },
    get hasEdits() { return hasEdits; },
    set hasEdits(value) { hasEdits = value; },
    set reviewedInSession(value) { reviewedInSession = value; },
    get pendingAssetSerializations() { return pendingAssetSerializations; },
    get specSources() { return specSources; },
    get createdSpecFiles() { return createdSpecFiles; },
    get createdScreenFiles() { return createdScreenFiles; },
    get createdSpecDrafts() { return createdSpecDrafts; },
    get assetSpecOwners() { return assetSpecOwners; },
    get pendingAssetCopies() { return pendingAssetCopies; },
    get projectFilePaths() { return projectFilePaths; },
    set projectFilePaths(value) { projectFilePaths = value; },
    get activeSpecPath() { return activeSpecPath; }
  },
  services: {
    byId,
    fetcher: (url, options) => fetch(url, options),
    validation: sharedValidation,
    setAssetDocumentStatus,
    setScreenYamlStatus,
    getInstanceAtPath,
    findInstancePathById,
    validateScreenAssetIds,
    showEditorMessage,
    renderNavigation
  }
});
const previewStateController = new PreviewStateController({
  state: {
    get screens() { return screens; },
    get activeScreenIndex() { return activeScreenIndex; },
    get activePreviewStateIds() { return activePreviewStateIds; },
    get activeInstancePath() { return activeInstancePath; },
    get viewingPreviewState() { return viewingPreviewState; },
    get isRenderOnly() { return isRenderOnly; }
  },
  services: {
    byId,
    element,
    getScreenPreviewStates,
    getElementLabel,
    showEditorMessage,
    markEdited,
    renderScreen,
    renderInspector,
    selectInstance,
    getInstanceAtPath,
    showFatalError,
    confirm: (message) => window.confirm(message),
    switchPreviewState: (...args) => switchPreviewState(...args),
    addPreviewState: (...args) => addPreviewState(...args)
  }
});
const screenInstanceRenderer = new ScreenInstanceRenderer({
  state: {
    get activeInstancePath() { return activeInstancePath; },
    get assetStyleScopeId() { return assetStyleScopeId; },
    set assetStyleScopeId(value) { assetStyleScopeId = value; },
    get assetInstanceDragType() { return assetInstanceDragType; },
    get assetDragType() { return assetDragType; },
    get viewingSpec() { return viewingSpec; },
    get screens() { return screens; },
    get activeScreenIndex() { return activeScreenIndex; },
    get assetFiles() { return assetFiles; },
    get paletteAssetDropHandled() { return paletteAssetDropHandled; },
    set paletteAssetDropHandled(value) { paletteAssetDropHandled = value; }
  },
  services: {
    element,
    isInstanceVisible,
    isValidAttributeValue,
    sameInstancePath,
    getElementLabel,
    templateMarkupRenderer,
    safeProjectUrl,
    clearDropIndicators,
    readDraggedInstance,
    moveAssetInstance,
    showAddAssetError,
    showEditorMessage,
    addAssetToContainer,
    getEventInstance,
    selectInstance,
    getInstanceAtPath,
    getAssetSpecPath,
    createSpecForInstance,
    renderSpecEditor,
    openAssetContextMenu,
    addAssetToSlot,
    getTemplateByPath
  }
});
const screenElementController = new ScreenElementController({
  state: {
    get project() { return project; },
    get screens() { return screens; },
    get activeScreenIndex() { return activeScreenIndex; },
    set activeScreenIndex(value) { activeScreenIndex = value; },
    get assets() { return assets; },
    get assetFiles() { return assetFiles; },
    get createdScreenFiles() { return createdScreenFiles; },
    get pendingAssetCopies() { return pendingAssetCopies; },
    get templateFileExtension() { return TEMPLATE_FILE_EXTENSION; }
  },
  services: {
    prompt: (message, defaultValue) => window.prompt(message, defaultValue),
    fetcher: (url, options) => fetch(url, options),
    safeProjectUrl,
    showEditorMessage,
    projectFileTree,
    markEdited,
    renderScreenSelector,
    renderNavigation,
    renderScreen,
    showFatalError,
    validation: sharedValidation,
    getTemplateByPath,
    getElementLabel,
    selectInstance,
    findAssetInstances,
    byId
  }
});
const themeEditor = new ThemeEditor({
  state: {
    get theme() { return theme; },
    get project() { return project; },
    get themeModeNames() { return themeModeNames; },
    get themeModePreference() { return themeModePreference; },
    set themeModePreference(value) { themeModePreference = value; },
    get systemThemeMode() { return systemThemeMode; },
    get viewingTheme() { return viewingTheme; },
    set viewingTheme(value) { viewingTheme = value; },
    get activeProjectFilePath() { return activeProjectFilePath; },
    set activeProjectFilePath(value) { activeProjectFilePath = value; },
    get assetPreviewTimer() { return assetPreviewTimer; },
    set assetPreviewTimer(value) { assetPreviewTimer = value; },
    get assetPreviewVersion() { return assetPreviewVersion; },
    set assetPreviewVersion(value) { assetPreviewVersion = value; },
    set viewingAssetTemplate(value) { viewingAssetTemplate = value; },
    set viewingProject(value) { viewingProject = value; },
    set viewingSpec(value) { viewingSpec = value; },
    set viewingPreviewState(value) { viewingPreviewState = value; },
    set activeSpecPath(value) { activeSpecPath = value; },
    set activeSpecInstancePath(value) { activeSpecInstancePath = value; },
    set activeAssetId(value) { activeAssetId = value; },
    set activeInstancePath(value) { activeInstancePath = value; }
  },
  services: {
    appendSection,
    appendEditableField,
    element,
    byId,
    applyTheme,
    markEdited,
    renderInspector,
    discardUneditedActiveSpecDraft,
    hidePreviewStateControls,
    hideEditorMessage,
    updateNavigationSelection
  }
});
const assetEditor = new AssetEditor({
  state: {
    get project() { return project; },
    get screens() { return screens; },
    get assets() { return assets; },
    get activeScreenIndex() { return activeScreenIndex; },
    get activeAssetId() { return activeAssetId; },
    set activeAssetId(value) { activeAssetId = value; },
    get activeInstancePath() { return activeInstancePath; },
    set activeInstancePath(value) { activeInstancePath = value; },
    get viewingAssetTemplate() { return viewingAssetTemplate; },
    set viewingAssetTemplate(value) { viewingAssetTemplate = value; },
    set viewingTheme(value) { viewingTheme = value; },
    set viewingProject(value) { viewingProject = value; },
    set viewingSpec(value) { viewingSpec = value; },
    set viewingPreviewState(value) { viewingPreviewState = value; },
    set activeSpecPath(value) { activeSpecPath = value; },
    set activeSpecInstancePath(value) { activeSpecInstancePath = value; },
    get activeProjectFilePath() { return activeProjectFilePath; },
    set activeProjectFilePath(value) { activeProjectFilePath = value; },
    get invalidYamlFiles() { return invalidYamlFiles; },
    get pendingAssetSerializations() { return pendingAssetSerializations; },
    get assetPreviewTimer() { return assetPreviewTimer; },
    set assetPreviewTimer(value) { assetPreviewTimer = value; },
    get assetPreviewVersion() { return assetPreviewVersion; },
    set assetPreviewVersion(value) { assetPreviewVersion = value; },
    get assetContextMenuTarget() { return assetContextMenuTarget; },
    set assetContextMenuTarget(value) { assetContextMenuTarget = value; },
    get pendingAssetDeletion() { return pendingAssetDeletion; },
    set pendingAssetDeletion(value) { pendingAssetDeletion = value; },
    get deleteDialogReturnFocus() { return deleteDialogReturnFocus; },
    set deleteDialogReturnFocus(value) { deleteDialogReturnFocus = value; }
  },
  services: {
    byId,
    element,
    window,
    document,
    clipboard: navigator.clipboard,
    validation: sharedValidation,
    parseYamlSource,
    validateAssetCategory: assetCategoryPath,
    validateAssetAttributes,
    validateAssetSlots,
    validateAssetSlotMarkup,
    hidePreviewStateControls,
    discardUneditedActiveSpecDraft,
    updateScreenDomContext,
    hideEditorMessage,
    updateNavigationSelection,
    renderNavigation,
    updateSaveControls,
    renderInspector,
    markEdited,
    setPreviewMessage,
    renderInstance,
    getInstanceAtPath,
    getTemplateByPath,
    getElementLabel,
    showEditorMessage
  }
});
const editorNavigation = new EditorNavigation({
  state: {
    get project() { return project; },
    get screens() { return screens; },
    get assets() { return assets; },
    get activeScreenIndex() { return activeScreenIndex; },
    set activeScreenIndex(value) { activeScreenIndex = value; },
    get activeAssetId() { return activeAssetId; },
    get activeProjectFilePath() { return activeProjectFilePath; },
    get viewingProject() { return viewingProject; },
    get viewingTheme() { return viewingTheme; },
    get viewingSpec() { return viewingSpec; },
    get activeSpecOwner() { return activeSpecOwner; },
    get activeSpecPath() { return activeSpecPath; },
    get activeSpecInstancePath() { return activeSpecInstancePath; },
    get viewingAssetTemplate() { return viewingAssetTemplate; },
    get activeInstancePath() { return activeInstancePath; },
    get createdSpecDrafts() { return createdSpecDrafts; },
    get assetSpecOwners() { return assetSpecOwners; },
    get hasEdits() { return hasEdits; }
  },
  services: {
    getInstanceAtPath,
    getTemplateByPath,
    getElementLabel,
    getProjectFileAction,
    openProjectFile,
    selectInstance,
    renderScreen,
    renderProjectOverview,
    createProjectSpec,
    createSpecForScreen,
    createSpecForInstance,
    renderSpecEditor,
    renderThemeView,
    renderAssetTemplate,
    sameInstancePath,
    showEditorMessage,
    loadProject
  },
  browserHistory
});
const projectFileNavigator = new ProjectFileNavigator({
  state: {
    get project() { return project; },
    get screens() { return screens; },
    get activeScreenIndex() { return activeScreenIndex; },
    set activeScreenIndex(value) { activeScreenIndex = value; },
    get projectFilePaths() { return projectFilePaths; },
    get theme() { return theme; },
    get viewingAssetTemplate() { return viewingAssetTemplate; },
    get viewingTheme() { return viewingTheme; },
    get viewingProject() { return viewingProject; },
    get viewingSpec() { return viewingSpec; },
    get activeProjectFilePath() { return activeProjectFilePath; },
    get activeSpecPath() { return activeSpecPath; },
    get activeAssetId() { return activeAssetId; },
    get assets() { return assets; },
    get specSources() { return specSources; },
    get createdSpecDrafts() { return createdSpecDrafts; },
    get createdScreenFiles() { return createdScreenFiles; },
    get createdSpecFiles() { return createdSpecFiles; },
    get pendingAssetCopies() { return pendingAssetCopies; },
    get assetFiles() { return assetFiles; },
    get assetSpecOwners() { return assetSpecOwners; },
    get historyUpdateSuppressed() { return historyUpdateSuppressed; },
    set historyUpdateSuppressed(value) { historyUpdateSuppressed = value; },
    get activeSpecOwner() { return activeSpecOwner; },
    get assetDragType() { return assetDragType; },
    get assetEditorRestoreId() { return assetEditorRestoreId; },
    set assetEditorRestoreId(value) { assetEditorRestoreId = value; },
    get paletteAssetDropHandled() { return paletteAssetDropHandled; },
    set paletteAssetDropHandled(value) { paletteAssetDropHandled = value; }
  },
  services: {
    byId,
    element,
    updateNavigationSelection,
    renderScreen,
    showFatalError,
    renderProjectOverview,
    renderThemeView,
    renderAssetTemplate,
    renderSpecEditor,
    syncBrowserHistory,
    clearDropIndicators,
    showEditorMessage
  },
  projectFileTree
});
const workspaceViewRenderer = new WorkspaceViewRenderer({
  state: {
    get project() { return project; },
    get screens() { return screens; },
    get activeScreenIndex() { return activeScreenIndex; },
    set activeScreenIndex(value) { activeScreenIndex = value; },
    get activeProjectFilePath() { return activeProjectFilePath; },
    set activeProjectFilePath(value) { activeProjectFilePath = value; },
    get assetPreviewTimer() { return assetPreviewTimer; },
    set assetPreviewTimer(value) { assetPreviewTimer = value; },
    get assetPreviewVersion() { return assetPreviewVersion; },
    set assetPreviewVersion(value) { assetPreviewVersion = value; },
    set viewingAssetTemplate(value) { viewingAssetTemplate = value; },
    set viewingTheme(value) { viewingTheme = value; },
    set viewingProject(value) { viewingProject = value; },
    set viewingSpec(value) { viewingSpec = value; },
    set viewingPreviewState(value) { viewingPreviewState = value; },
    set activeSpecPath(value) { activeSpecPath = value; },
    set activeSpecInstancePath(value) { activeSpecInstancePath = value; },
    set activeAssetId(value) { activeAssetId = value; },
    set activeInstancePath(value) { activeInstancePath = value; },
    get assets() { return assets; },
    get theme() { return theme; },
    get specSources() { return specSources; }
  },
  services: {
    byId,
    element,
    discardUneditedActiveSpecDraft,
    closeAssetContextMenu,
    renderScreenSelector,
    projectFileTree,
    hideEditorMessage,
    updateNavigationSelection,
    updateScreenDomContext,
    renderPreviewStateControls,
    configureScreenYamlEditor,
    syncScreenViewMode,
    setScreenDomContext,
    renderInstance,
    getTemplateByPath,
    renderInspector,
    setPreviewMessage,
    hidePreviewStateControls
  }
});
const inspectorRenderer = new InspectorRenderer({
  state: {
    get project() { return project; },
    get screens() { return screens; },
    get assets() { return assets; },
    get theme() { return theme; },
    get specSources() { return specSources; },
    get createdSpecDrafts() { return createdSpecDrafts; },
    get activeScreenIndex() { return activeScreenIndex; },
    get activeAssetId() { return activeAssetId; },
    get activeInstancePath() { return activeInstancePath; },
    get activeSpecOwner() { return activeSpecOwner; },
    get activeSpecPath() { return activeSpecPath; },
    get activeSpecInstancePath() { return activeSpecInstancePath; },
    get viewingPreviewState() { return viewingPreviewState; },
    get viewingProject() { return viewingProject; },
    get viewingTheme() { return viewingTheme; },
    get viewingSpec() { return viewingSpec; },
    get viewingAssetTemplate() { return viewingAssetTemplate; },
    get reviewedInSession() { return reviewedInSession; },
    set reviewedInSession(value) { reviewedInSession = value; }
  },
  services: {
    byId,
    element,
    getInstanceAtPath,
    getTemplateByPath,
    getActivePreviewStateId,
    getScreenPreviewStates,
    appendEditableField,
    renamePreviewState,
    describePreviewState,
    deletePreviewState,
    showFatalError,
    getElementLabel,
    isInstanceVisible,
    markEdited,
    renderScreen,
    showEditorMessage,
    renderSpecEditor,
    createProjectSpec,
    createSpecForScreen,
    renderScreenInstanceTree,
    renderNavigation,
    refreshActiveView,
    getAssetSpecPath,
    confirmDeleteAsset,
    markAssetTemplateEdited,
    attributeTypes,
    numberFormats,
    themeEditor,
    createSpecForInstance,
    renderInspector: () => renderInspector()
  }
});

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

function getActivePreviewStateId(screen) {
  return previewStateController.getActiveId(screen);
}

function isInstanceVisible(instance, stateId) {
  return previewStateController.isInstanceVisible(instance, stateId);
}

function getTemplateByPath(filePath) {
  return [...assets.values()].find((template) => template.templateFile === filePath) || null;
}

function getElementLabel(instance) {
  const template = instance.type === "template" ? getTemplateByPath(instance.src) : null;
  return instance.name || template?.data.name || instance.id || instance.type || "Element";
}

function renderPreviewStateControls(screen) {
  previewStateController.renderControls(screen);
}

function hidePreviewStateControls() {
  screenYamlEditor.hideControls();
}

function setScreenYamlStatus(screen, message, isError = false) {
  screenYamlEditor.setStatus(screen, message, isError);
}

function syncScreenViewMode() {
  screenYamlEditor.syncViewMode();
}

async function setScreenViewMode(mode) {
  screenYamlEditor.setViewMode(mode);
}

async function prepareScreenYamlSource(screen) {
  return screenYamlEditor.prepareSource(screen);
}

function configureScreenYamlEditor(screen) {
  screenYamlEditor.configure(screen);
}

async function parseScreenYaml(screen, source, version) {
  return screenYamlEditor.parse(screen, source, version);
}

function renamePreviewState(stateId, name) {
  previewStateController.rename(stateId, name);
}

function describePreviewState(stateId, description) {
  previewStateController.describe(stateId, description);
}

async function switchPreviewState(stateId) {
  return previewStateController.switchTo(stateId);
}

async function addPreviewState() {
  return previewStateController.add();
}

function renderScreenInstanceTree(panel, instances, parentPath = [], depth = 0, stateId = "default") {
  previewStateController.renderInstanceTree(panel, instances, parentPath, depth, stateId);
}

async function deletePreviewState(stateId) {
  return previewStateController.delete(stateId);
}

function safeProjectUrl(filePath, base = appRoot) {
  return projectRepository.safeProjectUrl(filePath, base);
}

function loadText(filePath, base = appRoot) {
  return projectRepository.loadText(filePath, base);
}

function loadYaml(filePath) {
  return projectRepository.loadYaml(filePath);
}

function parseYamlSource(source, context) {
  return projectRepository.parseYamlSource(source, context);
}

function validateScreenAssetIds(screen) {
  projectRepository.validateScreenAssetIds(screen);
}

function findInstancePathById(instances, assetId, parentPath = []) {
  return projectRepository.findInstancePathById(instances, assetId, parentPath);
}

function refreshAssetSpecOwner(filePath, source) {
  return projectRepository.refreshAssetSpecOwner(filePath, source, screens, assetSpecOwners);
}

function getAssetSpecPath(screen, instance) {
  for (const [filePath, owner] of assetSpecOwners) {
    if (owner.screenFile === screen.file && owner.elementId === instance.id) return filePath;
  }
  return null;
}

function assetCategoryPath(template, source) {
  return projectRepository.validation.assetCategoryPath(template, source);
}

function validateAssetAttributes(template, source) {
  return projectRepository.validation.validateAssetAttributes(template, source);
}

function validateAssetSlots(template, source) {
  return projectRepository.validation.validateAssetSlots(template, source);
}

function validateAssetSlotMarkup(template, markup, source) {
  return projectRepository.validation.validateAssetSlotMarkup(template, markup, source);
}

function getDefinedThemeModes() {
  return themeEditor.getDefinedModes();
}

function getActiveThemeMode() {
  return themeEditor.getActiveMode();
}

function getThemeColors(mode) {
  return themeEditor.getColors(mode);
}

function themeModeLabel(mode) {
  return themeEditor.modeLabel(mode);
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
  screenYamlEditor.resetViewMode();
  createdScreenFiles.clear();
  createdSpecFiles.clear();
  createdSpecDrafts.clear();
  assetSpecOwners.clear();
  activeProjectFilePath = null;
  pendingAssetCopies.length = 0;
  setPreviewMessage("loading", "Reading project files...");
  try {
    const loaded = await projectRepository.load();
    project = loaded.project;
    projectFilePaths = loaded.projectFilePaths;
    assetFiles = loaded.assetFiles;
    screens = loaded.screens;
    activePreviewStateIds.clear();
    assets = loaded.assets;
    specSources = loaded.specSources;
    assetSpecOwners.clear();
    for (const [filePath, owner] of loaded.assetSpecOwners) {
      assetSpecOwners.set(filePath, owner);
    }
    theme = loaded.theme;
    themeStylesheet = loaded.themeStylesheet;
    themeStylesheetBase = loaded.themeStylesheetBase;
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
        document.body.dataset.openuxRenderHtml = encodeBase64(await standaloneScreenHtml());
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

async function standaloneScreenHtml() {
  const outputDocument = document.implementation.createHTMLDocument("");
  outputDocument.documentElement.lang = "en";
  const rootStyle = document.documentElement.getAttribute("style") || "";
  if (rootStyle) outputDocument.documentElement.setAttribute("style", rootStyle);
  const themeBackground = getThemeColors().background;
  if (themeBackground !== undefined) outputDocument.body.style.backgroundColor = themeBackground;
  const charset = outputDocument.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  outputDocument.head.append(charset);
  const stylesheetLink = document.querySelector('link[rel="stylesheet"]');
  if (!stylesheetLink) throw new Error("The Studio stylesheet link is missing.");
  const stylesheetResponse = await fetch(stylesheetLink.href);
  if (!stylesheetResponse.ok) {
    throw new Error(`Could not load standalone stylesheet (HTTP ${stylesheetResponse.status}).`);
  }
  const globalStyles = outputDocument.createElement("style");
  globalStyles.textContent = await stylesheetResponse.text();
  outputDocument.head.append(globalStyles);
  for (const style of document.head.querySelectorAll("style")) {
    outputDocument.head.append(style.cloneNode(true));
  }
  outputDocument.body.append(cloneRenderedNode(byId("screen-preview")));
  return `<!doctype html>\n${outputDocument.documentElement.outerHTML}\n`;
}

function currentUiSelection() {
  return editorNavigation.currentSelection();
}

function getSelectionFilePath(selection) {
  return editorNavigation.getSelectionFilePath(selection);
}

function selectionFromLocation() {
  return editorNavigation.selectionFromLocation();
}

function syncBrowserHistory(forceReplace = false) {
  editorNavigation.syncHistory(forceReplace);
}

async function restoreUiSelection(selection) {
  return editorNavigation.restoreSelection(selection);
}

function refreshFromExternalChanges() {
  return editorNavigation.refreshFromExternalChanges();
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
  return projectFileNavigator.renderNavigation();
}

function renderScreenSelector() {
  return projectFileNavigator.renderScreenSelector();
}

function setScreenSelectorOpen(open, restoreFocus = false) {
  return projectFileNavigator.setScreenSelectorOpen(open, restoreFocus);
}

function getProjectTreeFilePaths() {
  return projectFileNavigator.getProjectTreeFilePaths();
}

function renderProjectFile(file) {
  return projectFileNavigator.renderProjectFile(file);
}

function getProjectFileAction(filePath) {
  return projectFileNavigator.getProjectFileAction(filePath);
}

async function openProjectFile(filePath) {
  return projectFileNavigator.openProjectFile(filePath);
}

function updateAssetTemplateTreeFile(button, asset) {
  return projectFileNavigator.updateAssetTemplateTreeFile(button, asset);
}

async function createScreen() {
  return screenElementController.createScreen();
}

function createAssetInstanceId(screen, name, fallback) {
  return screenElementController.createInstanceId(screen, name, fallback);
}

function createTemplateElement(template, siblings, screen) {
  return screenElementController.createTemplateElement(template, siblings, screen);
}

async function ensureAssetOnScreen(template, screen) {
  return screenElementController.ensureAssetOnScreen(template, screen);
}

function getInstanceAtPath(screen, path) {
  return screenElementController.getInstanceAtPath(screen, path);
}

function getSiblingList(screen, parentPath, slotId) {
  return screenElementController.getSiblingList(screen, parentPath, slotId);
}

function getInstanceLocation(screen, path) {
  return screenElementController.getInstanceLocation(screen, path);
}

function instancePathFor(parentPath, slotId, index) {
  return screenElementController.instancePathFor(parentPath, slotId, index);
}

async function addAssetToContainer(assetPath, parentPath, slotId, requestedIndex = null) {
  return screenElementController.addToContainer(assetPath, parentPath, slotId, requestedIndex);
}

async function addAssetToScreen(assetPath) {
  return screenElementController.addToScreen(assetPath);
}

function addAssetToSlot(parentPath, slotId, assetPath) {
  return screenElementController.addToSlot(parentPath, slotId, assetPath);
}

function pathStartsWith(path, prefix) {
  return screenElementController.pathStartsWith(path, prefix);
}

function findInstancePathByReference(screen, target) {
  return screenElementController.findInstancePathByReference(screen, target);
}

async function moveAssetInstance(sourcePath, parentPath, slotId, requestedIndex = null) {
  return screenElementController.move(sourcePath, parentPath, slotId, requestedIndex);
}

async function deleteAssetInstance(path) {
  return screenElementController.delete(path);
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
  if (screenYamlEditor.mode !== "preview") return;
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
  if (screenYamlEditor.mode !== "preview") return;
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
  return workspaceViewRenderer.renderScreen(index, options);
}

async function renderSpecEditor(filePath, instancePath = activeInstancePath, owner = "instance") {
  return specEditor.render(filePath, instancePath, owner);
}

function discardUneditedActiveSpecDraft() {
  specEditor.discardUneditedActiveDraft();
}

async function createSpecForInstance(instancePath) {
  return specEditor.createForInstance(instancePath);
}

async function createProjectSpec() {
  return specEditor.createForProject();
}

async function createSpecForScreen() {
  return specEditor.createForScreen();
}
function renderProjectOverview() {
  return workspaceViewRenderer.renderProjectOverview();
}

async function renderAssetTemplate(assetId, filePath = null) {
  return assetEditor.renderTemplate(assetId, filePath);
}

function setAssetDocumentStatus(template, message, isError = false) {
  return assetEditor.setDocumentStatus(template, message, isError);
}

async function renderInstance(instance, template, instancePath, screenId = "", screenName = "") {
  return screenInstanceRenderer.render(instance, template, instancePath, screenId, screenName);
}

function getEventInstance(event) {
  return event.composedPath().find((node) =>
    node instanceof HTMLElement && node.classList.contains("asset-instance")
  );
}

function openAssetContextMenu(event, host, instancePath, assetId) {
  return assetEditor.openContextMenu(event, host, instancePath, assetId);
}

function closeAssetContextMenu(restoreFocus = false) {
  return assetEditor.closeContextMenu(restoreFocus);
}

async function copyAssetDetails(target) {
  return assetEditor.copyDetails(target);
}

function confirmDeleteAsset(target) {
  return assetEditor.confirmDelete(target);
}

function closeAssetDeleteDialog(restoreFocus = false) {
  return assetEditor.closeDeleteDialog(restoreFocus);
}

function sameInstancePath(left, right) {
  return left.length === right.length && left.every((part, index) => part === right[index]);
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
  inspectorRenderer.render();
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
  projectPersistence.markEdited(filePath, options);
}

function clearEdited(filePath) {
  projectPersistence.clearEdited(filePath);
}

function markAssetTemplateEdited(template) {
  projectPersistence.markAssetTemplateEdited(template);
}

function updateSaveControls() {
  projectPersistence.updateSaveControls();
}

async function saveProjectChanges() {
  return projectPersistence.save();
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

const editorEventController = new EditorEventController({
  state: {
    get hasEdits() { return hasEdits; },
    get activeScreenIndex() { return activeScreenIndex; },
    get assetContextMenuTarget() { return assetContextMenuTarget; },
    get pendingAssetDeletion() { return pendingAssetDeletion; },
    get historyUpdateSuppressed() { return historyUpdateSuppressed; },
    set historyUpdateSuppressed(value) { historyUpdateSuppressed = value; }
  },
  services: {
    byId,
    window,
    document,
    confirm: (message) => window.confirm(message),
    loadProject,
    createScreen,
    setScreenViewMode,
    setScreenSelectorOpen,
    renderScreenSelector,
    saveProjectChanges,
    closeAssetContextMenu,
    getTemplateByPath,
    renderAssetTemplate,
    showFatalError,
    copyAssetDetails,
    confirmDeleteAsset,
    closeAssetDeleteDialog,
    deleteAssetInstance,
    showEditorMessage,
    isRenderOnly,
    selectionFromLocation,
    restoreUiSelection,
    syncBrowserHistory
  }
});
editorEventController.bind();

function renderThemeView(filePath = project?.theme) {
  themeEditor.render(filePath);
}

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

const resizablePanels = new ResizablePanels({
  windowObject: window,
  documentObject: document,
  workspace: byId("workspace"),
  showMessage: showEditorMessage
});
resizablePanels.bind();

loadProject(selectionFromLocation());
