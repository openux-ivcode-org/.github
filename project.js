const fs = require("node:fs/promises");
const path = require("node:path");
const YAML = require("yaml");
const validation = require("./validation");

const OPENUX_VERSION = "0.1.0-SNAPSHOT";

function isWithin(directory, target) {
  const relative = path.relative(directory, target);
  return relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function safeRelativePath(relativePath) {
  if (typeof relativePath !== "string" || !relativePath || relativePath.includes("\\") ||
      path.posix.isAbsolute(relativePath) ||
      relativePath.split("/").some((part) => !part || part === "." || part === ".." || part.startsWith("."))) {
    throw new Error(`"${String(relativePath)}" must be a normal relative project path.`);
  }
  return relativePath.split("/");
}

async function resolveProjectPath(projectRoot, relativePath, expectedType) {
  const root = await fs.realpath(projectRoot);
  const target = path.resolve(root, ...safeRelativePath(relativePath));
  if (!isWithin(root, target)) throw new Error(`"${relativePath}" resolves outside the project.`);
  const realTarget = await fs.realpath(target);
  if (!isWithin(root, realTarget)) throw new Error(`"${relativePath}" resolves outside the project.`);
  const stats = await fs.stat(realTarget);
  if (expectedType === "file" && !stats.isFile()) throw new Error(`"${relativePath}" is not a file.`);
  if (expectedType === "directory" && !stats.isDirectory()) throw new Error(`"${relativePath}" is not a directory.`);
  return realTarget;
}

function pushError(errors, source, error) {
  errors.push(`${source}: ${error.message || String(error)}`);
}

async function validateProject(projectRoot) {
  const errors = [];
  const assets = new Map();
  const screens = [];
  const usedAssetIds = new Set();
  const referencedSpecPaths = new Set();
  let project;
  let theme;

  async function readYaml(relativePath) {
    try {
      const target = await resolveProjectPath(projectRoot, relativePath, "file");
      const source = await fs.readFile(target, "utf8");
      const document = YAML.parseDocument(source);
      if (document.errors.length) {
        throw new Error(document.errors.map((issue) => issue.message).join("; "));
      }
      const data = document.toJS();
      if (!validation.isMapping(data)) throw new Error("must contain a YAML mapping.");
      return data;
    } catch (error) {
      pushError(errors, relativePath, error);
      return null;
    }
  }

  async function checkFile(relativePath, source) {
    try {
      await resolveProjectPath(projectRoot, relativePath, "file");
      return true;
    } catch (error) {
      pushError(errors, source, error);
      return false;
    }
  }

  async function validateResources(sourceText, sourceFile, baseDirectory) {
    const references = [];
    const tags = /<([a-z][\w:-]*)\b([^>]*)>/gi;
    const attributes = /(?:^|\s)(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
    for (const tag of sourceText.matchAll(tags)) {
      for (const attribute of tag[2].matchAll(attributes)) {
        references.push(attribute[1] ?? attribute[2] ?? attribute[3]);
      }
    }
    const cssUrls = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
    for (const reference of sourceText.matchAll(cssUrls)) {
      references.push((reference[1] ?? reference[2] ?? reference[3]).trim());
    }
    for (const reference of new Set(references)) {
      if (!reference || reference.startsWith("#") || reference.startsWith("data:image/") ||
          reference.includes("${")) continue;
      const encodedPath = reference.split(/[?#]/, 1)[0];
      let resourcePath;
      try {
        resourcePath = decodeURIComponent(encodedPath);
      } catch {
        errors.push(`${sourceFile}: resource "${reference}" contains invalid URL escaping.`);
        continue;
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(reference) || reference.startsWith("//") ||
          resourcePath.startsWith("/") || resourcePath.includes("\\") ||
          resourcePath.split("/").includes("..")) {
        errors.push(`${sourceFile}: resource "${reference}" must stay inside the project.`);
        continue;
      }
      if (!resourcePath) continue;
      const relativePath = path.posix.join(baseDirectory, resourcePath);
      await checkFile(relativePath, `${sourceFile} resource "${reference}"`);
    }
  }

  project = await readYaml("project.yml");
  if (!project) {
    return { errors, project: null, assets, screens, usedAssetIds, referencedSpecPaths };
  }

  if (typeof project.openux !== "string" || !project.openux) {
    errors.push("project.yml: openux must specify the OpenUX version.");
  } else if (project.openux !== OPENUX_VERSION) {
    errors.push(`project.yml: OpenUX version "${project.openux}" is not supported by this CLI (expected "${OPENUX_VERSION}").`);
  }
  if (!Array.isArray(project.screens)) errors.push("project.yml: screens must be a list.");
  if (!Array.isArray(project.assets)) errors.push("project.yml: assets must be a list.");
  if (Object.hasOwn(project, "workflows")) {
    errors.push("project.yml: workflows are no longer supported; use project.spec or an asset instance's spec.");
  }
  if (project.spec !== undefined) {
    try {
      validation.validateSpecPath(project.spec);
      referencedSpecPaths.add(project.spec);
    } catch (error) {
      pushError(errors, "project.yml spec", error);
    }
  }
  if (typeof project.theme !== "string" || !project.theme) {
    errors.push("project.yml: theme must name a Theme YAML file.");
  }

  function indexEntries(entries, kind) {
    const ids = new Set();
    const files = new Set();
    const validEntries = [];
    for (const [index, entry] of (Array.isArray(entries) ? entries : []).entries()) {
      if (!validation.isMapping(entry)) {
        errors.push(`project.yml: ${kind}[${index}] must be a mapping.`);
        continue;
      }
      if (typeof entry.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(entry.id)) {
        errors.push(`project.yml: ${kind}[${index}] id must use lowercase letters, numbers, and hyphens.`);
        continue;
      }
      if (ids.has(entry.id)) errors.push(`project.yml: ${kind} defines id "${entry.id}" more than once.`);
      ids.add(entry.id);
      const locationKey = kind === "assets" ? "directory" : "file";
      if (typeof entry[locationKey] !== "string" || !entry[locationKey]) {
        errors.push(`project.yml: ${kind} "${entry.id}" must define ${locationKey}.`);
        continue;
      }
      if (files.has(entry[locationKey])) {
        errors.push(`project.yml: ${kind} references "${entry[locationKey]}" more than once.`);
      }
      files.add(entry[locationKey]);
      validEntries.push(entry);
    }
    return validEntries;
  }

  const assetEntries = indexEntries(project.assets, "assets");
  const screenEntries = indexEntries(project.screens, "screens");
  const screenIds = new Set(screenEntries.map((entry) => entry.id));
  for (const entry of assetEntries) {
    if (entry.screen === undefined) continue;
    if (typeof entry.screen !== "string" || !/^[a-z][a-z0-9-]*$/.test(entry.screen)) {
      errors.push(`project.yml: asset "${entry.id}" screen must be a Screen ID.`);
    } else if (!screenIds.has(entry.screen)) {
      errors.push(`project.yml: asset "${entry.id}" references unknown Screen "${entry.screen}".`);
    }
  }
  for (const entry of assetEntries) {
    if (entry["copied-from"] === undefined) continue;
    if (typeof entry["copied-from"] !== "string" ||
        !/^[a-z][a-z0-9-]*$/.test(entry["copied-from"]) ||
        entry["copied-from"] === entry.id) {
      errors.push(`project.yml: asset "${entry.id}" copied-from must be a different asset ID.`);
    }
    if (!entry.screen) {
      errors.push(`project.yml: copied asset "${entry.id}" must be assigned to a Screen.`);
    }
  }

  for (const entry of assetEntries) {
    const directory = entry.directory.replace(/\/+$/, "");
    try {
      await resolveProjectPath(projectRoot, directory, "directory");
    } catch (error) {
      pushError(errors, `assets/${entry.id}`, error);
      continue;
    }
    const manifestPath = `${directory}/asset.yml`;
    const data = await readYaml(manifestPath);
    if (!data) continue;
    if (Object.hasOwn(data, "spec")) {
      errors.push(`${manifestPath}: behavior specs cannot be attached to asset templates; attach the spec to an asset instance in a Screen file.`);
    }
    if (data.id !== entry.id) {
      errors.push(`${manifestPath}: id must match project.yml asset id "${entry.id}".`);
    }
    try {
      validation.assetCategoryPath(data, manifestPath);
      validation.validateAssetAttributes(data, manifestPath);
      validation.validateAssetSlots(data, manifestPath);
    } catch (error) {
      pushError(errors, manifestPath, error);
    }
    const htmlPath = data.render?.source || "asset.html";
    let resolvedHtmlPath;
    try {
      safeRelativePath(htmlPath);
      resolvedHtmlPath = `${directory}/${htmlPath}`;
      const htmlFile = await resolveProjectPath(projectRoot, resolvedHtmlPath, "file");
      const markup = await fs.readFile(htmlFile, "utf8");
      try {
        validation.validateAssetSlotMarkup(data, markup, resolvedHtmlPath);
      } catch (error) {
        pushError(errors, resolvedHtmlPath, error);
      }
      await validateResources(markup, resolvedHtmlPath, directory);
      const attributeNames = new Set(Object.keys(data.attributes || {}));
      for (const match of markup.matchAll(/\$\{attributes\.([^}]+)\}/g)) {
        if (!attributeNames.has(match[1])) {
          errors.push(`${resolvedHtmlPath}: references undeclared attribute "${match[1]}".`);
        }
      }
    } catch (error) {
      pushError(errors, `${manifestPath} render.source`, error);
    }
    assets.set(entry.id, { ...entry, directory, data, htmlPath: resolvedHtmlPath });
  }

  for (const entry of screenEntries) {
    const data = await readYaml(entry.file);
    if (data) screens.push({ id: entry.id, file: entry.file, data });
  }

  for (const screen of screens) {
    if (Object.hasOwn(screen.data, "spec")) {
      errors.push(`${screen.file}: Screen-level behavior specs are not supported; attach specs to the relevant asset instances.`);
    }
    let previewStateIds = new Set(["default"]);
    try {
      previewStateIds = new Set(
        validation.validatePreviewStates(screen.data, screen.file).map((state) => state.id)
      );
    } catch (error) {
      pushError(errors, screen.file, error);
    }
    if (!Array.isArray(screen.data.assets)) {
      errors.push(`${screen.file}: Screen "${screen.id}" assets must be a list.`);
      continue;
    }
    if (screen.data.assets.length === 0) continue;
    if (screen.data.assets.length !== 1) {
      errors.push(`${screen.file}: Screen "${screen.id}" must contain exactly one root layout asset.`);
      continue;
    }
    function validateInstance(instance, instancePath, depth = 0) {
      const location = `${screen.file} assets${instancePath}`;
      if (depth > 64) {
        errors.push(`${location}: asset nesting exceeds the maximum depth of 64.`);
        return;
      }
      if (!validation.isMapping(instance)) {
        errors.push(`${location}: asset instance must be a mapping.`);
        return;
      }
      const assetId = instance["asset-template"];
      if (typeof assetId !== "string") {
        errors.push(`${location}: asset-template must be an asset id.`);
        return;
      }
      usedAssetIds.add(assetId);
      const asset = assets.get(assetId);
      if (!asset) {
        errors.push(`${location}: references unknown asset "${assetId}".`);
        return;
      }
      if (asset.screen && asset.screen !== screen.id) {
        errors.push(
          `${location}: asset "${assetId}" belongs to Screen "${asset.screen}" and cannot be used on Screen "${screen.id}".`
        );
      }
      if (instance.spec !== undefined) {
        try {
          validation.validateSpecPath(instance.spec);
          referencedSpecPaths.add(instance.spec);
        } catch (error) {
          pushError(errors, `${location} spec`, error);
        }
      }
      if (Object.hasOwn(instance, "interactions")) {
        errors.push(`${location}: interactions are no longer supported; describe behavior in the instance's Markdown spec.`);
      }
      if (instance.visibility !== undefined) {
        if (depth === 0) {
          errors.push(`${location}: the root layout cannot have state-specific visibility.`);
        }
        if (!validation.isMapping(instance.visibility)) {
          errors.push(`${location}: visibility must be a mapping of preview state ids to booleans.`);
        } else {
          for (const [stateId, visible] of Object.entries(instance.visibility)) {
            if (!previewStateIds.has(stateId)) {
              errors.push(`${location}: visibility references unknown preview state "${stateId}".`);
            }
            if (typeof visible !== "boolean") {
              errors.push(`${location}: visibility for preview state "${stateId}" must be a boolean.`);
            }
          }
        }
      }
      const definitions = asset.data.attributes || {};
      const values = instance.attributes === undefined ? {} : instance.attributes;
      if (!validation.isMapping(values)) {
        errors.push(`${location}: attributes must be a mapping.`);
      } else {
        for (const [name, value] of Object.entries(values)) {
          const definition = definitions[name];
          if (!definition) {
            errors.push(`${location}: asset "${assetId}" does not define attribute "${name}".`);
          } else if (definition.overridable !== true) {
            errors.push(`${location}: asset attribute "${assetId}.${name}" is not overridable.`);
          } else if (!validation.isValidAttributeValue(definition, value)) {
            errors.push(`${location}: value for "${assetId}.${name}" does not match its declared type.`);
          }
        }
      }
      const declaredSlots = new Set(
        (Array.isArray(asset.data.slots) ? asset.data.slots : []).map((slot) => slot.id)
      );
      const instanceSlots = instance.slots === undefined ? {} : instance.slots;
      if (!validation.isMapping(instanceSlots)) {
        errors.push(`${location}: slots must be a mapping.`);
      } else {
        if (!asset.data.slots && instance.slots !== undefined) {
          errors.push(`${location}: asset "${assetId}" does not define slots.`);
        }
        for (const [slotId, children] of Object.entries(instanceSlots)) {
          if (!declaredSlots.has(slotId)) {
            errors.push(`${location}: asset "${assetId}" does not define slot "${slotId}".`);
          }
          if (!Array.isArray(children)) {
            errors.push(`${location}: slot "${slotId}" must contain a list of asset instances.`);
            continue;
          }
          children.forEach((child, index) =>
            validateInstance(child, `${instancePath}.${slotId}[${index}]`, depth + 1)
          );
        }
      }
      return asset;
    }

    const rootAsset = validateInstance(screen.data.assets[0], "[0]");
    if (rootAsset && !rootAsset.data.slots?.length) {
      errors.push(`${screen.file}: root asset "${rootAsset.id}" must define at least one named slot.`);
    }
  }

  for (const specPath of referencedSpecPaths) {
    try {
      const target = await resolveProjectPath(projectRoot, specPath, "file");
      validation.validateSpecContent(await fs.readFile(target, "utf8"));
    } catch (error) {
      pushError(errors, `Behavior spec "${specPath}"`, error);
    }
  }

  if (typeof project.theme === "string" && project.theme) {
    theme = await readYaml(project.theme);
    if (theme) {
      try {
        validation.validateTheme(theme, project.theme);
      } catch (error) {
        pushError(errors, project.theme, error);
      }
      if (theme.styles !== undefined) {
        if (typeof theme.styles !== "string" || !theme.styles) {
          errors.push(`${project.theme}: styles must be a relative CSS file path.`);
        } else {
          try {
            safeRelativePath(theme.styles);
            const themeDirectory = path.posix.dirname(project.theme);
            const stylesPath = path.posix.join(themeDirectory, theme.styles);
            const stylesheetPath = await resolveProjectPath(projectRoot, stylesPath, "file");
            await validateResources(
              await fs.readFile(stylesheetPath, "utf8"),
              stylesPath,
              path.posix.dirname(stylesPath)
            );
          } catch (error) {
            pushError(errors, `${project.theme} styles`, error);
          }
        }
      }
    }
  }

  return {
    errors,
    project,
    assets,
    screens,
    usedAssetIds,
    referencedSpecPaths
  };
}

module.exports = { OPENUX_VERSION, isWithin, resolveProjectPath, safeRelativePath, validateProject };
