export class ProjectRepository {
  constructor({ appRoot, fetcher, parseYaml, validation, templateFileExtension }) {
    this.appRoot = appRoot;
    this.fetcher = fetcher;
    this.parseYaml = parseYaml;
    this.validation = validation;
    this.templateFileExtension = templateFileExtension;
  }

  safeProjectUrl(filePath, base = this.appRoot) {
    if (typeof filePath !== "string" || !filePath ||
        filePath.startsWith("/") || filePath.includes("\\")) {
      throw new Error(`Invalid project file path: ${String(filePath)}`);
    }
    if (filePath.split("/").includes("..")) {
      throw new Error(`Project paths cannot leave their directory: ${filePath}`);
    }
    const url = new URL(filePath, base);
    if (url.origin !== this.appRoot.origin || !url.pathname.startsWith(this.appRoot.pathname)) {
      throw new Error(`Project resource is outside the openux/ example project: ${filePath}`);
    }
    return url;
  }

  async loadText(filePath, base = this.appRoot) {
    const response = await this.fetcher(this.safeProjectUrl(filePath, base));
    if (!response.ok) {
      throw new Error(`Could not load ${filePath} (HTTP ${response.status}).`);
    }
    return response.text();
  }

  async loadYaml(filePath) {
    return this.parseYamlMapping(await this.loadText(filePath), filePath);
  }

  async parseYamlSource(source, context) {
    const response = await this.fetcher("/api/yaml/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source })
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(`${context}: ${result.error || `YAML parsing failed (HTTP ${response.status}).`}`);
    }
    return result.data;
  }

  parseYamlMapping(source, filePath) {
    const parsed = this.parseYaml(source);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error(`${filePath} must contain a YAML mapping.`);
    }
    return parsed;
  }

  async loadProjectFilePaths() {
    const response = await this.fetcher("/api/files");
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `Could not list project files (HTTP ${response.status}).`);
    }
    if (!Array.isArray(result.files) || result.files.some((filePath) =>
      typeof filePath !== "string" || !filePath || filePath.startsWith("/") ||
      filePath.includes("\\") || filePath.split("/").some((segment) =>
        !segment || segment === "." || segment === ".." || segment.startsWith(".")
      )
    )) {
      throw new Error("The project file listing is invalid.");
    }
    return result.files;
  }

  validateScreenAssetIds(screen) {
    const ids = new Set();
    const visit = (instances, parentPath = []) => {
      for (let index = 0; index < instances.length; index += 1) {
        const instance = instances[index];
        const location = `${screen.file} elements${parentPath
          .map((part) => typeof part === "number" ? `[${part}]` : `.${part}`)
          .join("")}[${index}]`;
        if (!instance || typeof instance !== "object" || Array.isArray(instance)) {
          throw new Error(`${location}: Element must be a mapping.`);
        }
        this.validation.validateElementId(instance.id, location);
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
    };
    if (Array.isArray(screen.data.elements)) visit(screen.data.elements);
  }

  findInstancePathById(instances, elementId, parentPath = []) {
    for (let index = 0; index < instances.length; index += 1) {
      const instance = instances[index];
      const instancePath = [...parentPath, index];
      if (instance.id === elementId) return instancePath;
      for (const [slotId, children] of Object.entries(instance.slots || {})) {
        if (!Array.isArray(children)) continue;
        const childPath = this.findInstancePathById(children, elementId, [...instancePath, slotId]);
        if (childPath) return childPath;
      }
    }
    return null;
  }

  refreshAssetSpecOwner(filePath, source, screens, assetSpecOwners) {
    assetSpecOwners.delete(filePath);
    const screen = screens.find((entry) =>
      filePath.startsWith(`screens/${entry.id}/specs/element-`)
    );
    if (!screen) return null;
    const elementId = this.validation.validateElementSpecHeader(source, filePath);
    this.validation.validateElementSpecPath(filePath, elementId);
    const instancePath = this.findInstancePathById(screen.data.elements || [], elementId);
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

  async load() {
    const project = await this.loadYaml("project.yml");
    if (typeof project.openux !== "string" || !project.openux) {
      throw new Error("project.yml must specify the OpenUX version in openux.");
    }
    if (!Array.isArray(project.screens)) {
      throw new Error("project.yml must list screens.");
    }
    if (Object.hasOwn(project, "workflows")) {
      throw new Error("project.yml workflows are no longer supported; use project.spec, a Screen spec, or an Asset's spec.");
    }

    const projectFilePaths = await this.loadProjectFilePaths();
    const assetFiles = new Map(projectFilePaths
      .filter((filePath) => /^(?:assets|screens\/[a-z][a-z0-9-]*\/assets)\//.test(filePath))
      .map((filePath) => {
        const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
        const type = extension === this.templateFileExtension
          ? "template"
          : [".avif", ".bmp", ".gif", ".ico", ".jpeg", ".jpg", ".png", ".svg", ".webp"].includes(extension)
            ? "image"
            : "resource";
        return [filePath, type];
      }));

    const [screens, loadedAssets, loadedTheme] = await Promise.all([
      Promise.all(project.screens.map(async (entry) => {
        const yamlSource = await this.loadText(entry.file);
        return {
          id: entry.id,
          file: entry.file,
          data: this.parseYamlMapping(yamlSource, entry.file),
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
          const base = this.safeProjectUrl(`${directory}/`);
          const documentSource = await this.loadText(templateFile);
          const { header, body } = this.validation.splitAssetDocument(documentSource, templateFile);
          const data = await this.parseYamlSource(header, `${templateFile} front matter`);
          this.validation.validateAssetTemplateHeader(data, templateFile);
          const fileId = templateFile.slice(
            templateFile.lastIndexOf("/") + 1,
            -this.templateFileExtension.length
          );
          if (data.id !== fileId) {
            throw new Error(`Asset id must match the filename in ${templateFile}.`);
          }
          this.validation.assetCategoryPath(data, `${templateFile} front matter`);
          this.validation.validateAssetAttributes(data, `${templateFile} front matter`);
          this.validation.validateAssetSlots(data, `${templateFile} front matter`);
          this.validation.validateAssetSlotMarkup(data, body, templateFile);
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
      this.loadTheme(project.theme)
    ]);

    for (const screen of screens) this.validateScreenAssetIds(screen);
    const specPaths = new Set();
    const elementSpecPaths = [];
    for (const screen of screens) {
      if (screen.data.spec !== undefined) {
        this.validation.validateSpecPath(screen.data.spec);
        specPaths.add(screen.data.spec);
      }
      const prefix = `screens/${screen.id}/specs/element-`;
      for (const filePath of projectFilePaths) {
        if (!filePath.startsWith(prefix) || !filePath.endsWith(".md")) continue;
        this.validation.validateSpecPath(filePath);
        elementSpecPaths.push(filePath);
        specPaths.add(filePath);
      }
    }
    if (project.spec !== undefined) {
      this.validation.validateSpecPath(project.spec);
      specPaths.add(project.spec);
    }

    const specSources = new Map(await Promise.all([...specPaths].map(async (filePath) =>
      [filePath, await this.loadText(filePath)]
    )));
    const assetSpecOwners = new Map();
    for (const filePath of elementSpecPaths) {
      this.refreshAssetSpecOwner(filePath, specSources.get(filePath), screens, assetSpecOwners);
    }
    const assets = new Map(loadedAssets.map((asset) => [asset.id, asset]));
    if (assets.size !== loadedAssets.length) throw new Error("Discovered template ids must be unique.");

    return {
      project,
      projectFilePaths,
      assetFiles,
      screens,
      assets,
      specSources,
      assetSpecOwners,
      theme: loadedTheme.data,
      themeStylesheet: loadedTheme.stylesheet,
      themeStylesheetBase: loadedTheme.stylesheetBase
    };
  }

  async loadTheme(themePath) {
    const data = await this.loadYaml(themePath);
    this.validation.validateTheme(data, themePath);
    const themeDirectory = themePath.includes("/")
      ? themePath.slice(0, themePath.lastIndexOf("/") + 1)
      : "";
    const themeBase = themeDirectory ? this.safeProjectUrl(themeDirectory) : this.appRoot;
    if (data.styles === undefined) return { data, stylesheet: "", stylesheetBase: themeBase };
    if (typeof data.styles !== "string" || !data.styles) {
      throw new Error(`${themePath} styles must be a relative CSS file path.`);
    }
    const stylesDirectory = data.styles.includes("/")
      ? data.styles.slice(0, data.styles.lastIndexOf("/") + 1)
      : "";
    return {
      data,
      stylesheet: await this.loadText(data.styles, themeBase),
      stylesheetBase: stylesDirectory ? this.safeProjectUrl(stylesDirectory, themeBase) : themeBase
    };
  }
}
