const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const YAML = require("yaml");
const validation = require("./validation");
const { clearBrowserSnapshot, writeBrowserSnapshot } = require("./browserSnapshotCache");

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_CAPTURE_BYTES = 32 * 1024 * 1024;
const MAX_FILES_PER_SAVE = 100;
const MAX_ANNOTATIONS_PER_SCREEN = 200;
const MAX_POINTS_PER_ANNOTATION = 2048;
const ANNOTATION_TOOLS = new Set(["pen", "circle", "rectangle", "arrow", "highlight", "note"]);
const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".gif", "image/gif"],
  [".ico", "image/x-icon"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".otf", "font/otf"],
  [".ttf", "font/ttf"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".yml", "text/yaml; charset=utf-8"],
  [".yaml", "text/yaml; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [validation.TEMPLATE_FILE_EXTENSION, "text/plain; charset=utf-8"]
]);

function requestError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isWithin(directory, target) {
  const relative = path.relative(directory, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

function validateAnnotationSet(body) {
  if (!body || Array.isArray(body) || typeof body !== "object" ||
      typeof body.screenId !== "string" || !/^[a-z][a-z0-9-]*$/.test(body.screenId) ||
      !Array.isArray(body.annotations) || body.annotations.length > MAX_ANNOTATIONS_PER_SCREEN) {
    throw requestError("Annotations must include a valid screenId and an annotations list.");
  }
  let previewSize;
  if (body.previewSize !== undefined) {
    const { width, height } = body.previewSize || {};
    if (!Number.isInteger(width) || width < 1 || width > 16384 ||
        !Number.isInteger(height) || height < 1 || height > 16384) {
      throw requestError("Annotation previewSize must include positive integer width and height values.");
    }
    previewSize = { width, height };
  }
  const ids = new Set();
  const annotations = body.annotations.map((annotation) => {
    if (!annotation || Array.isArray(annotation) || typeof annotation !== "object" ||
        typeof annotation.id !== "string" || !annotation.id || annotation.id.length > 100 ||
        ids.has(annotation.id) || !ANNOTATION_TOOLS.has(annotation.tool) ||
        !Array.isArray(annotation.points) || !annotation.points.length ||
        annotation.points.length > MAX_POINTS_PER_ANNOTATION) {
      throw requestError("Each annotation must have a unique id, supported tool, and valid points.");
    }
    ids.add(annotation.id);
    const points = annotation.points.map((point) => {
      if (!point || Array.isArray(point) || typeof point !== "object" ||
          !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
          point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
        throw requestError("Annotation points must use normalized x and y coordinates from 0 to 1.");
      }
      return { x: point.x, y: point.y };
    });
    const clean = {
      id: annotation.id,
      tool: annotation.tool,
      points
    };
    if (annotation.text !== undefined) {
      if (typeof annotation.text !== "string" || annotation.text.length > 500) {
        throw requestError("Annotation text must be at most 500 characters.");
      }
      clean.text = annotation.text;
    }
    if (annotation.target !== undefined) {
      const target = annotation.target;
      if (!target || Array.isArray(target) || typeof target !== "object" ||
          !Array.isArray(target.instancePath) ||
          target.instancePath.some((part) =>
            !(Number.isInteger(part) && part >= 0) &&
            !(typeof part === "string" && /^[a-z][a-z0-9-]*$/.test(part))
          )) {
        throw requestError("Annotation targets must include a valid Element instancePath.");
      }
      if (target.text !== undefined &&
          (typeof target.text !== "string" || target.text.length > 500)) {
        throw requestError("Annotation target text must be at most 500 characters.");
      }
      clean.target = {
        instancePath: target.instancePath,
        ...(typeof target.elementId === "string" ? { elementId: target.elementId } : {}),
        ...(typeof target.name === "string" ? { name: target.name } : {}),
        ...(typeof target.assetId === "string" ? { assetId: target.assetId } : {}),
        ...(target.text !== undefined ? { text: target.text } : {})
      };
    }
    return clean;
  });
  return {
    screenId: body.screenId,
    annotations,
    ...(previewSize ? { previewSize } : {})
  };
}

async function listProjectFiles(projectRoot) {
  const realProjectRoot = await fs.realpath(projectRoot);
  const files = [];

  async function visit(directory, relativeDirectory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath, relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }

  await visit(realProjectRoot, "");
  return files.sort((left, right) => left.localeCompare(right));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) {
      throw requestError("Request body exceeds the 2 MB limit.", 413);
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw requestError("Request body must be valid JSON.");
  }
}

async function readBinaryBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_CAPTURE_BYTES) {
      throw requestError("Captured image exceeds the 32 MB limit.", 413);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function validateCapturedPng(image) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (image.length < 24 || !image.subarray(0, 8).equals(signature)) {
    throw requestError("Browser capture must be a valid PNG image.");
  }
  const width = image.readUInt32BE(16);
  const height = image.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 16384 || height > 16384) {
    throw requestError("Captured image dimensions must be between 1 and 16384 pixels.");
  }
  return { width, height };
}

function isSpecPath(relativePath) {
  try {
    validation.validateSpecPath(relativePath);
    return true;
  } catch {
    return false;
  }
}

function isScreenFilePath(relativePath) {
  return /^screens\/[a-z][a-z0-9-]*\/screen\.yml$/.test(relativePath);
}

function isAssetTemplateBaseDirectoryPath(relativePath) {
  return relativePath === "assets" ||
    /^screens\/[a-z][a-z0-9-]*\/assets$/.test(relativePath);
}

function isAssetTemplatePath(relativePath) {
  return /^(?:assets|screens\/[a-z][a-z0-9-]*\/assets)\/[a-z][a-z0-9-]*\.stml$/
    .test(relativePath);
}

async function resolveProjectDirectory(projectRoot, relativePath, { create = false } = {}) {
  const realProjectRoot = await fs.realpath(projectRoot);
  let current = realProjectRoot;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    let details;
    try {
      details = await fs.lstat(current);
    } catch (error) {
      if (error.code !== "ENOENT" || !create) throw error;
      await fs.mkdir(current);
      details = await fs.lstat(current);
    }
    if (details.isSymbolicLink() || !details.isDirectory()) {
      throw requestError("Project directories must be real directories inside the openux project.");
    }
  }
  if (!isWithin(realProjectRoot, current)) {
    throw requestError("Project directory resolves outside the openux project.");
  }
  return current;
}

function parseYamlMapping(source) {
  if (typeof source !== "string") throw requestError("YAML source must be text.");
  let data;
  try {
    data = YAML.parse(source);
  } catch (error) {
    throw requestError(`Invalid YAML: ${error.message}`);
  }
  if (!data || Array.isArray(data) || typeof data !== "object") {
    throw requestError("YAML source must contain a mapping.");
  }
  return data;
}

async function resolveProjectFile(projectRoot, relativePath, { create = false, stagedCopies = [] } = {}) {
  if (typeof relativePath !== "string" || !relativePath || relativePath.includes("\\") ||
      relativePath.startsWith("/") || relativePath.split("/").some((segment) =>
        !segment || segment === "." || segment === ".." || segment.startsWith(".")
      )) {
    throw requestError("Save paths must be relative paths inside the openux project.");
  }
  const extension = path.extname(relativePath).toLowerCase();
  const specPath = isSpecPath(relativePath);
  if (![".yml", ".yaml", validation.TEMPLATE_FILE_EXTENSION].includes(extension) && !(extension === ".md" && specPath)) {
    throw requestError("The editor can only save project YAML, template STML, and behavior spec Markdown files.");
  }

  if (extension === validation.TEMPLATE_FILE_EXTENSION && !isAssetTemplatePath(relativePath)) {
    throw requestError("Template saves are only allowed as named STML files inside assets directories.");
  }

  const target = path.resolve(projectRoot, ...relativePath.split("/"));
  if (!isWithin(projectRoot, target)) {
    throw requestError("Save path is outside the openux project.");
  }

  if (create) {
    const screenFile = isScreenFilePath(relativePath);
    if (!screenFile && !specPath) {
      throw requestError("New files can only be created as named Screen YAML or behavior spec Markdown files.", 400);
    }
    const relativeDirectory = path.posix.dirname(relativePath);
    const realTargetDirectory = await resolveProjectDirectory(projectRoot, relativeDirectory, { create: true });
    const newTarget = path.join(realTargetDirectory, path.basename(relativePath));
    try {
      await fs.lstat(newTarget);
      throw requestError(`Project file "${relativePath}" already exists.`, 409);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return newTarget;
  }

  const stagedCopy = stagedCopies.find((copy) => relativePath === copy.targetFile);
  if (stagedCopy) {
    const stagedTarget = stagedCopy.stagedFile;
    if (!isWithin(stagedCopy.stagedDirectory, stagedTarget)) {
      throw requestError("Save path resolves outside the copied Asset template.");
    }
    let realTarget;
    try {
      realTarget = await fs.realpath(stagedTarget);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw requestError(`Project file "${relativePath}" does not exist in the copied Asset template.`);
      }
      throw error;
    }
    if (!isWithin(stagedCopy.stagedDirectory, realTarget)) {
      throw requestError("Save path resolves outside the copied Asset template.");
    }
    if (!(await fs.stat(realTarget)).isFile()) {
      throw requestError(`Project path "${relativePath}" is not a file.`);
    }
    return realTarget;
  }

  let realTarget;
  try {
    realTarget = await fs.realpath(target);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw requestError(`Project file "${relativePath}" does not exist.`);
    }
    throw error;
  }
  if (!isWithin(projectRoot, realTarget)) {
    throw requestError("Save path resolves outside the openux project.");
  }
  const details = await fs.stat(realTarget);
  if (!details.isFile()) throw requestError(`Project path "${relativePath}" is not a file.`);
  return realTarget;
}

function validateAssetTemplateBaseDirectoryPath(relativePath) {
  if (typeof relativePath !== "string" || !isAssetTemplateBaseDirectoryPath(relativePath) ||
      relativePath.includes("\\") || relativePath.includes("\0") ||
      relativePath.split("/").some((segment) =>
        !segment || segment === "." || segment === ".." || segment.startsWith(".")
      )) {
    throw requestError("Asset copies must use canonical assets directories.");
  }
}

async function resolveAssetTemplateBaseDirectory(projectRoot, relativePath, options) {
  validateAssetTemplateBaseDirectoryPath(relativePath);
  const directoryPath = await resolveProjectDirectory(projectRoot, relativePath, options);
  return directoryPath;
}

function getLocalAssetResourcePaths(source) {
  const references = [];
  const tags = /<([a-z][\w:-]*)\b([^>]*)>/gi;
  const attributes = /(?:^|\s)(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
  for (const tag of source.matchAll(tags)) {
    for (const attribute of tag[2].matchAll(attributes)) {
      references.push(attribute[1] ?? attribute[2] ?? attribute[3]);
    }
  }
  const cssUrls = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
  for (const reference of source.matchAll(cssUrls)) {
    references.push((reference[1] ?? reference[2] ?? reference[3]).trim());
  }
  return [...new Set(references)].flatMap((reference) => {
    if (!reference || reference.startsWith("#") || reference.startsWith("data:") ||
        reference.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(reference)) return [];
    const encodedPath = reference.split(/[?#]/, 1)[0];
    let resourcePath;
    try {
      resourcePath = decodeURIComponent(encodedPath);
    } catch {
      throw requestError(`Asset resource "${reference}" contains invalid URL escaping.`);
    }
    if (!resourcePath) return [];
    if (resourcePath.startsWith("/") || resourcePath.includes("\\") ||
        resourcePath.split("/").some((segment) =>
          segment === ".." || segment.startsWith(".")
        )) {
      throw requestError(`Asset resource "${reference}" must stay inside the project.`);
    }
    return [resourcePath];
  });
}

async function resolveAssetResourcePath(baseDirectory, resourcePath, { required = false } = {}) {
  const segments = resourcePath.split("/");
  let current = baseDirectory;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    let details;
    try {
      details = await fs.lstat(current);
    } catch (error) {
      if (error.code === "ENOENT" && !required) return null;
      if (error.code === "ENOENT") {
        throw requestError(`Asset resource "${resourcePath}" does not exist in the template folder.`);
      }
      throw error;
    }
    if (details.isSymbolicLink()) {
      throw requestError(`Asset resource "${resourcePath}" cannot use symbolic links.`);
    }
    if (index < segments.length - 1 && !details.isDirectory()) {
      throw requestError(`Asset resource "${resourcePath}" has a non-directory parent.`);
    }
    if (index === segments.length - 1 && !details.isFile()) {
      throw requestError(`Asset resource "${resourcePath}" must be a regular file.`);
    }
  }
  return current;
}

async function prepareAssetCopies(projectRoot, assetCopies, updates) {
  if (assetCopies === undefined) return [];
  if (!Array.isArray(assetCopies) || assetCopies.length > 20) {
    throw requestError("Asset copy requests must contain no more than 20 copies.");
  }
  if (assetCopies.length === 0) return [];

  let projectData;
  const projectUpdate = updates.find((update) => update.path === "project.yml");
  if (projectUpdate) {
    projectData = parseYamlMapping(projectUpdate.content);
  } else {
    projectData = parseYamlMapping(await fs.readFile(path.join(projectRoot, "project.yml"), "utf8"));
  }
  if (!Array.isArray(projectData.screens)) {
    throw requestError("Asset copies require project.yml to list Screens.");
  }

  const existingProject = parseYamlMapping(await fs.readFile(path.join(projectRoot, "project.yml"), "utf8"));
  if (!Array.isArray(existingProject.screens)) {
    throw requestError("Asset copies require the current project.yml to list Screens.");
  }
  const seenTargets = new Set();
  const plans = [];
  try {
    for (const request of assetCopies) {
      if (!request || Array.isArray(request) || typeof request !== "object" ||
          !/^[a-z][a-z0-9-]*$/.test(request.sourceId || "") ||
          !/^[a-z][a-z0-9-]*$/.test(request.targetId || "") ||
          !/^[a-z][a-z0-9-]*$/.test(request.sourceScreen || "") ||
          !/^[a-z][a-z0-9-]*$/.test(request.targetScreen || "") ||
          typeof request.sourceFile !== "string" ||
          request.sourceFile !== `screens/${request.sourceScreen}/assets/${request.sourceId}${validation.TEMPLATE_FILE_EXTENSION}` ||
          request.targetFile !== `screens/${request.targetScreen}/assets/${request.targetId}${validation.TEMPLATE_FILE_EXTENSION}`) {
        throw requestError("Each asset copy must identify valid source and target assets and a destination Screen.");
      }
      if (seenTargets.has(request.targetFile)) {
        throw requestError(`Asset file "${request.targetFile}" is copied more than once in one save.`);
      }
      seenTargets.add(request.targetFile);
      if (!existingProject.screens.some((entry) => entry.id === request.sourceScreen) ||
          request.sourceScreen === request.targetScreen) {
        throw requestError(`Asset "${request.sourceId}" is not a page-specific source for this copy.`);
      }
      if (!projectData.screens.some((entry) => entry.id === request.targetScreen)) {
        throw requestError(`Destination Screen "${request.targetScreen}" does not exist.`);
      }

      const sourceParent = path.posix.dirname(request.sourceFile);
      const targetParent = path.posix.dirname(request.targetFile);
      const sourceParentPath = await resolveAssetTemplateBaseDirectory(projectRoot, sourceParent);
      const targetParentPath = await resolveAssetTemplateBaseDirectory(projectRoot, targetParent, { create: true });
      const sourcePath = path.join(sourceParentPath, path.posix.basename(request.sourceFile));
      const targetPath = path.join(targetParentPath, path.posix.basename(request.targetFile));
      await resolveAssetResourcePath(
        sourceParentPath,
        path.posix.basename(request.sourceFile),
        { required: true }
      );
      try {
        await fs.lstat(targetPath);
        throw requestError(`Asset copy destination "${request.targetFile}" already exists.`, 409);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const stagedDirectory = path.join(targetParentPath, `.${request.targetId}.${randomUUID()}.tmp`);
      const stagedFile = path.join(stagedDirectory, path.posix.basename(request.targetFile));
      const plan = {
        ...request,
        sourcePath,
        targetPath,
        sourceParentPath,
        targetParentPath,
        stagedDirectory,
        stagedFile
      };
      plans.push(plan);
      await fs.mkdir(stagedDirectory);
      const assetSource = await fs.readFile(sourcePath, "utf8");
      const { header, body } = validation.splitAssetDocument(assetSource, "Source template asset");
      const assetDocument = parseYamlMapping(header);
      validation.validateAssetTemplateHeader(assetDocument, "Source template asset");
      if (assetDocument.id !== request.sourceId) {
        throw requestError(`Source asset "${request.sourceId}" has a mismatched ${path.posix.basename(request.sourceFile)} front matter id.`);
      }
      assetDocument.id = request.targetId;
      const targetSource = validation.formatAssetDocument(YAML.stringify(assetDocument), body);
      await fs.writeFile(stagedFile, targetSource, "utf8");
      const targetUpdate = updates.find((update) => update.path === request.targetFile);
      const resourceBody = targetUpdate
        ? validation.splitAssetDocument(targetUpdate.content, request.targetFile).body
        : body;
      for (const resourcePath of getLocalAssetResourcePaths(resourceBody)) {
        const sourceResource = path.resolve(sourceParentPath, ...resourcePath.split("/"));
        if (!isWithin(sourceParentPath, sourceResource)) {
          throw requestError(`Asset resource "${resourcePath}" resolves outside its template folder.`);
        }
        const targetResource = path.resolve(targetParentPath, ...resourcePath.split("/"));
        if (!isWithin(targetParentPath, targetResource) || targetResource === targetPath) {
          throw requestError(`Asset resource "${resourcePath}" conflicts with the copied template file.`);
        }
        await resolveAssetResourcePath(sourceParentPath, resourcePath, { required: true });
        const existingResourcePath = await resolveAssetResourcePath(targetParentPath, resourcePath);
        if (existingResourcePath) {
          const existingResource = await fs.readFile(existingResourcePath);
          const sourceContent = await fs.readFile(sourceResource);
          if (!existingResource.equals(sourceContent)) {
            throw requestError(`Asset resource "${resourcePath}" conflicts with a file in the destination template folder.`);
          }
        } else {
          const stagedResource = path.resolve(stagedDirectory, ...resourcePath.split("/"));
          await fs.mkdir(path.dirname(stagedResource), { recursive: true });
          await fs.copyFile(sourceResource, stagedResource);
        }
      }
    }
  } catch (error) {
    await Promise.all(plans.map(({ stagedDirectory }) => fs.rm(stagedDirectory, { recursive: true, force: true })));
    throw error;
  }
  return plans;
}

async function saveProjectFiles(projectRoot, files, assetCopies) {
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FILES_PER_SAVE) {
    throw requestError(`Save requests must contain between 1 and ${MAX_FILES_PER_SAVE} files.`);
  }
  const seen = new Set();
  const updates = [];
  for (const file of files) {
    if (!file || Array.isArray(file) || typeof file !== "object" || typeof file.path !== "string") {
      throw requestError("Each save entry must specify a project file path.");
    }
    if (Object.hasOwn(file, "create") && typeof file.create !== "boolean") {
      throw requestError("Save entry create flags must be booleans.");
    }
    if (seen.has(file.path)) throw requestError(`Save request contains "${file.path}" more than once.`);
    seen.add(file.path);
    const create = file.create === true;
    const extension = path.extname(file.path).toLowerCase();
    if (extension === ".md") {
      if (typeof file.content !== "string" || Object.hasOwn(file, "data")) {
        throw requestError("Behavior spec Markdown save entries must contain text content.");
      }
      try {
        validation.validateSpecContent(file.content);
        if (/^screens\/[^/]+\/specs\/element-/.test(file.path)) {
          const elementId = validation.validateElementSpecHeader(file.content, file.path);
          validation.validateElementSpecPath(file.path, elementId);
        }
      } catch (error) {
        throw requestError(`${file.path}: ${error.message || String(error)}`);
      }
      updates.push({ path: file.path, content: file.content, create });
    } else if (extension === validation.TEMPLATE_FILE_EXTENSION) {
      if (typeof file.content !== "string" || Object.hasOwn(file, "data")) {
        throw requestError("Asset document save entries must contain text content.");
      }
      try {
        const { header, body } = validation.splitAssetDocument(file.content, file.path);
        const assetDocument = parseYamlMapping(header);
        validation.validateAssetTemplateHeader(assetDocument, file.path);
        validation.assetCategoryPath(assetDocument, `${file.path} front matter`);
        validation.validateAssetAttributes(assetDocument, `${file.path} front matter`);
        validation.validateAssetSlots(assetDocument, `${file.path} front matter`);
        const expectedId = path.posix.basename(file.path, validation.TEMPLATE_FILE_EXTENSION);
        if (assetDocument.id !== expectedId) {
          throw new Error(`front matter id must match template file name "${expectedId}${validation.TEMPLATE_FILE_EXTENSION}".`);
        }
        validation.validateAssetSlotMarkup(assetDocument, body, file.path);
        const attributeNames = new Set(Object.keys(assetDocument.attributes || {}));
        for (const match of body.matchAll(/\$\{attributes\.([^}]+)\}/g)) {
          if (!attributeNames.has(match[1])) {
            throw new Error(`references undeclared attribute "${match[1]}".`);
          }
        }
      } catch (error) {
        throw requestError(`${file.path}: ${error.message || String(error)}`);
      }
      updates.push({ path: file.path, content: file.content, create });
    } else if (typeof file.content === "string" && !Object.hasOwn(file, "data")) {
      parseYamlMapping(file.content);
      updates.push({ path: file.path, content: file.content, create });
    } else {
      if (!Object.hasOwn(file, "data") || !file.data ||
          Array.isArray(file.data) || typeof file.data !== "object" ||
          Object.hasOwn(file, "content")) {
        throw requestError("YAML save entries must contain a mapping of data.");
      }
      updates.push({ path: file.path, content: YAML.stringify(file.data), create });
    }
  }

  const stagedCopies = await prepareAssetCopies(projectRoot, assetCopies, updates);
  const staged = [];
  const committedCopyFiles = [];
  try {
    for (const update of updates) {
      update.target = await resolveProjectFile(projectRoot, update.path, {
        create: update.create,
        stagedCopies
      });
      update.copyStage = stagedCopies.some((copy) =>
        isWithin(copy.stagedDirectory, update.target)
      );
    }
    for (const update of updates) {
      const temporaryPath = path.join(
        path.dirname(update.target),
        `.${path.basename(update.target)}.${randomUUID()}.tmp`
      );
      await fs.writeFile(temporaryPath, update.content, { encoding: "utf8", flag: "wx" });
      staged.push({ ...update, temporaryPath });
    }
    for (const update of staged.filter((entry) => entry.copyStage)) {
      if (update.create) {
        throw requestError("Copied asset files cannot be created during the same save.");
      }
      await fs.rename(update.temporaryPath, update.target);
    }
    for (const copy of stagedCopies) {
      async function commitStagedFiles(directory, relativeDirectory = "") {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
          const stagedPath = path.join(directory, entry.name);
          const relativePath = relativeDirectory
            ? path.join(relativeDirectory, entry.name)
            : entry.name;
          const targetPath = path.join(copy.targetParentPath, relativePath);
          if (entry.isDirectory()) {
            await fs.mkdir(targetPath, { recursive: true });
            await commitStagedFiles(stagedPath, relativePath);
          } else if (entry.isFile()) {
            await fs.link(stagedPath, targetPath);
            await fs.rm(stagedPath);
            committedCopyFiles.push(targetPath);
          } else {
            throw requestError("Copied Asset resources must be regular files or directories.");
          }
        }
      }
      await commitStagedFiles(copy.stagedDirectory);
      await fs.rm(copy.stagedDirectory, { recursive: true, force: true });
    }
    for (const update of staged.filter((entry) => !entry.copyStage)) {
      if (update.create) {
        try {
          await fs.link(update.temporaryPath, update.target);
        } catch (error) {
          if (error.code === "EEXIST") {
            throw requestError(`Project file "${update.path}" already exists.`, 409);
          }
          throw error;
        }
        await fs.rm(update.temporaryPath, { force: true });
      } else {
        await fs.rename(update.temporaryPath, update.target);
      }
    }
  } catch (error) {
    await Promise.all(staged.map(({ temporaryPath }) => fs.rm(temporaryPath, { force: true })));
    await Promise.all(stagedCopies.map(({ stagedDirectory }) =>
      fs.rm(stagedDirectory, { recursive: true, force: true })
    ));
    await Promise.all(committedCopyFiles.map((targetPath) =>
      fs.rm(targetPath, { force: true })
    ));
    throw error;
  }
  return {
    saved: updates.map(({ path: filePath }) => filePath),
    copied: stagedCopies.map(({ targetId }) => targetId)
  };
}

async function serveStatic(rootDirectory, projectRoot, pathname, response) {
  let relativePath;
  let allowedRoot = rootDirectory;
  if (pathname === "/") relativePath = "index.html";
  else if (pathname === "/vendor/html-to-image.js") {
    const bundlePath = path.resolve(__dirname, "node_modules", "html-to-image", "dist", "html-to-image.js");
    const content = await fs.readFile(bundlePath);
    response.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Length": content.length,
      "X-Content-Type-Options": "nosniff"
    });
    response.end(content);
    return;
  }
  else if ([
    "/index.html",
    "/app.mjs",
    "/browser/AssetEditor.mjs",
    "/browser/EditorEventController.mjs",
    "/yaml.js",
    "/validation.js",
    "/styles.css",
    "/browser/BrowserHistory.mjs",
    "/browser/EditorNavigation.mjs",
    "/browser/InspectorRenderer.mjs",
    "/browser/ProjectRepository.mjs",
    "/browser/ProjectFileNavigator.mjs",
    "/browser/ProjectFileTree.mjs",
    "/browser/ProjectPersistence.mjs",
    "/browser/ResizablePanels.mjs",
    "/browser/PreviewStateController.mjs",
    "/browser/ScreenAnnotationController.mjs",
    "/browser/ScreenYamlEditor.mjs",
    "/browser/ScreenInstanceRenderer.mjs",
    "/browser/ScreenElementController.mjs",
    "/browser/SpecEditor.mjs",
    "/browser/ThemeEditor.mjs",
    "/browser/TemplateMarkupRenderer.mjs",
    "/browser/WorkspaceViewRenderer.mjs"
  ].includes(pathname)) {
    relativePath = pathname.slice(1);
  } else if (pathname.startsWith("/openux/")) {
    let projectPath;
    try {
      projectPath = decodeURIComponent(pathname.slice("/openux/".length));
    } catch {
      sendJson(response, 404, { error: "File not found." });
      return;
    }
    if (projectPath.includes("\\") || projectPath.includes("\0") ||
        path.win32.isAbsolute(projectPath) || projectPath.split("/").some((segment) =>
      !segment || segment === "." || segment === ".." || segment.startsWith(".")
    )) {
      sendJson(response, 404, { error: "File not found." });
      return;
    }
    allowedRoot = projectRoot;
    relativePath = path.join(...projectPath.split("/"));
  } else {
    sendJson(response, 404, { error: "File not found." });
    return;
  }

  const target = path.resolve(allowedRoot, relativePath);
  try {
    const realTarget = await fs.realpath(target);
    if (!isWithin(allowedRoot, realTarget)) {
      sendJson(response, 404, { error: "File not found." });
      return;
    }
    const details = await fs.stat(realTarget);
    if (!details.isFile()) {
      sendJson(response, 404, { error: "File not found." });
      return;
    }
    const content = await fs.readFile(realTarget);
    response.writeHead(200, {
      "Content-Type": CONTENT_TYPES.get(path.extname(realTarget).toLowerCase()) || "application/octet-stream",
      "Cache-Control": "no-store",
      "Content-Length": content.length,
      "X-Content-Type-Options": "nosniff"
    });
    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
      sendJson(response, 404, { error: "File not found." });
      return;
    }
    throw error;
  }
}

function createServer(options = {}) {
  const rootDirectory = path.resolve(options.rootDirectory || __dirname);
  const projectRoot = path.resolve(options.projectRoot || path.join(rootDirectory, "openux"));
  const eventClients = new Set();
  const selectionState = { selection: null, updatedAt: null };
  const annotationsByScreen = new Map();
  let server;
  function publishEvent(name, data) {
    const message = `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of eventClients) client.write(message);
  }
  function annotationsFor(screenId) {
    const entry = screenId ? annotationsByScreen.get(screenId) : null;
    return {
      screenId: screenId || null,
      coordinateSpace: "normalized 0-1 coordinates relative to the Screen preview",
      annotations: entry?.annotations || [],
      ...(entry?.previewSize ? { previewSize: entry.previewSize } : {}),
      updatedAt: entry?.updatedAt || null
    };
  }
  server = http.createServer(async (request, response) => {
    let pathname;
    let requestUrl;
    try {
      requestUrl = new URL(request.url, "http://localhost");
      pathname = requestUrl.pathname;
      if (request.method === "GET") {
        if (pathname === "/api/status") {
          const address = server.address();
          sendJson(response, 200, {
            status: "ok",
            url: address && typeof address === "object"
              ? `http://127.0.0.1:${address.port}/`
              : null,
            connectedBrowsers: eventClients.size,
            selectionAvailable: selectionState.selection !== null
          });
          return;
        }
        if (pathname === "/api/files") {
          sendJson(response, 200, { files: await listProjectFiles(projectRoot) });
          return;
        }
        if (pathname === "/api/selection") {
          const screenId = selectionState.selection?.screen?.id;
          sendJson(response, 200, {
            ...selectionState,
            annotations: annotationsFor(screenId)
          });
          return;
        }
        if (pathname === "/api/annotations") {
          const screenId = requestUrl.searchParams.get("screenId") ||
            selectionState.selection?.screen?.id || null;
          sendJson(response, 200, annotationsFor(screenId));
          return;
        }
        if (pathname === "/api/events") {
          response.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no"
          });
          response.write(": connected\n\n");
          eventClients.add(response);
          response.on("close", () => eventClients.delete(response));
          return;
        }
        await serveStatic(rootDirectory, projectRoot, pathname, response);
        return;
      }
      if (request.method === "POST" && pathname === "/api/selection") {
        const body = await readJsonBody(request);
        if (!body || Array.isArray(body) || typeof body !== "object" ||
            !Object.hasOwn(body, "selection") ||
            (body.selection !== null && (Array.isArray(body.selection) || typeof body.selection !== "object"))) {
          throw requestError("Selection updates must contain an object or null.");
        }
        await clearBrowserSnapshot(projectRoot);
        selectionState.selection = body.selection;
        selectionState.updatedAt = new Date().toISOString();
        sendJson(response, 200, { updated: true });
        return;
      }
      if (request.method === "POST" && pathname === "/api/snapshots") {
        const screenId = requestUrl.searchParams.get("screenId");
        if (!screenId || !/^[a-z][a-z0-9-]*$/.test(screenId)) {
          throw requestError("A valid Screen id is required to save a browser snapshot.");
        }
        const selection = selectionState.selection;
        const annotations = annotationsByScreen.get(screenId);
        if (selection?.view !== "screen" || selection.screen?.id !== screenId) {
          throw requestError("The Screen must be selected before its browser snapshot can be saved.", 409);
        }
        if (request.headers["x-openux-selection-updated-at"] !== selectionState.updatedAt) {
          throw requestError("The selected Screen preview changed before its snapshot could be saved.", 409);
        }
        if (!annotations?.updatedAt ||
            request.headers["x-openux-annotation-updated-at"] !== annotations.updatedAt) {
          throw requestError("The annotations changed before the browser snapshot could be saved.", 409);
        }
        const contentType = String(request.headers["content-type"] || "").toLowerCase();
        if (!contentType.startsWith("image/png")) {
          throw requestError("Browser snapshots must be PNG images.", 415);
        }
        const image = await readBinaryBody(request);
        const previewSize = validateCapturedPng(image);
        if (selection.previewSize &&
            (selection.previewSize.width !== previewSize.width ||
             selection.previewSize.height !== previewSize.height)) {
          throw requestError("The browser snapshot dimensions do not match the selected preview.", 409);
        }
        await writeBrowserSnapshot(projectRoot, image, {
          screenId,
          selectionUpdatedAt: selectionState.updatedAt,
          annotationUpdatedAt: annotations.updatedAt,
          previewStateId: selection.previewStateId || "default",
          previewSize,
          capturedAt: new Date().toISOString()
        });
        sendJson(response, 200, { saved: true, previewSize });
        return;
      }
      if (request.method === "POST" && pathname === "/api/annotations") {
        const body = await readJsonBody(request);
        const annotationSet = validateAnnotationSet(body);
        await clearBrowserSnapshot(projectRoot);
        const updatedAt = new Date().toISOString();
        annotationsByScreen.set(annotationSet.screenId, {
          annotations: annotationSet.annotations,
          ...(annotationSet.previewSize ? { previewSize: annotationSet.previewSize } : {}),
          updatedAt
        });
        publishEvent("annotations-updated", {
          screenId: annotationSet.screenId,
          updatedAt
        });
        sendJson(response, 200, {
          screenId: annotationSet.screenId,
          saved: annotationSet.annotations.length,
          updatedAt
        });
        return;
      }
      if (request.method === "DELETE" && pathname === "/api/annotations") {
        const screenId = requestUrl.searchParams.get("screenId");
        if (screenId && !/^[a-z][a-z0-9-]*$/.test(screenId)) {
          throw requestError("Invalid Screen id for clearing annotations.");
        }
        await clearBrowserSnapshot(projectRoot);
        const clearedScreenIds = screenId
          ? (annotationsByScreen.has(screenId) ? [screenId] : [])
          : [...annotationsByScreen.keys()];
        if (screenId) annotationsByScreen.delete(screenId);
        else annotationsByScreen.clear();
        publishEvent("annotations-updated", {
          screenId: screenId || null,
          cleared: true,
          updatedAt: new Date().toISOString()
        });
        sendJson(response, 200, {
          cleared: clearedScreenIds.length,
          screenIds: clearedScreenIds
        });
        return;
      }
      if (request.method === "POST" && pathname === "/api/update") {
        const origin = request.headers.origin;
        if (origin) {
          let originUrl;
          try {
            originUrl = new URL(origin);
          } catch {
            throw requestError("Update requests must originate from the local editor.", 403);
          }
          if (!["localhost", "127.0.0.1", "[::1]"].includes(originUrl.hostname)) {
            throw requestError("Update requests must originate from the local editor.", 403);
          }
        }
        const timestamp = new Date().toISOString();
        publishEvent("project-updated", { timestamp });
        sendJson(response, 200, { notifiedBrowsers: eventClients.size });
        return;
      }
      if (request.method === "POST" && pathname === "/api/save") {
        const body = await readJsonBody(request);
        if (!body || Array.isArray(body) || typeof body !== "object") {
          throw requestError("Save request must be a JSON object.");
        }
        const result = await saveProjectFiles(projectRoot, body.files, body.assetCopies);
        sendJson(response, 200, result.copied.length ? result : { saved: result.saved });
        return;
      }
      if (request.method === "POST" && pathname === "/api/yaml/parse") {
        const body = await readJsonBody(request);
        if (!body || Array.isArray(body) || typeof body !== "object") {
          throw requestError("YAML parse request must be a JSON object.");
        }
        sendJson(response, 200, { data: parseYamlMapping(body.source) });
        return;
      }
      if (request.method === "POST" && pathname === "/api/yaml/stringify") {
        const body = await readJsonBody(request);
        if (!body || Array.isArray(body) || typeof body !== "object" ||
            !body.data || Array.isArray(body.data) || typeof body.data !== "object") {
          throw requestError("YAML stringify request must contain a mapping of data.");
        }
        sendJson(response, 200, { source: YAML.stringify(body.data) });
        return;
      }
      sendJson(response, 405, { error: "Method not allowed." });
    } catch (error) {
      sendJson(response, error.statusCode || 500, { error: error.message || "Request failed." });
    }
  });
  return server;
}

if (require.main === module) {
  const server = createServer();
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, "127.0.0.1", () => {
    console.log(`OpenUX editor available at http://127.0.0.1:${port}/`);
  });
}

module.exports = { createServer, saveProjectFiles };
