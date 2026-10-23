const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const YAML = require("yaml");
const validation = require("./validation");

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_FILES_PER_SAVE = 100;
const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
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
  [".md", "text/markdown; charset=utf-8"]
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
  const isSpecPath = /^specs\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(relativePath);
  if (![".yml", ".yaml", ".html"].includes(extension) && !(extension === ".md" && isSpecPath)) {
    throw requestError("The editor can only save project YAML, asset HTML, and behavior spec Markdown files.");
  }
  if (extension === ".html" &&
      (!relativePath.startsWith("assets/") || relativePath.split("/").length < 3)) {
    throw requestError("HTML saves are only allowed inside asset directories.");
  }

  const target = path.resolve(projectRoot, ...relativePath.split("/"));
  if (!isWithin(projectRoot, target)) {
    throw requestError("Save path is outside the openux project.");
  }

  if (create) {
    const isScreenFile = /^screens\/[a-z0-9]+(?:-[a-z0-9]+)*\.ya?ml$/.test(relativePath);
    if (!isScreenFile && !isSpecPath) {
      throw requestError("New files can only be created as named Screen YAML or behavior spec Markdown files.", 400);
    }
    const realProjectRoot = await fs.realpath(projectRoot);
    const directoryName = isScreenFile ? "screens" : "specs";
    const targetDirectory = path.join(projectRoot, directoryName);
    if (isSpecPath) await fs.mkdir(targetDirectory, { recursive: true });
    const realTargetDirectory = await fs.realpath(targetDirectory);
    if (realTargetDirectory !== path.join(realProjectRoot, directoryName)) {
      throw requestError(`New files must be created inside the project ${directoryName} directory.`);
    }
    const newTarget = path.join(realTargetDirectory, path.basename(relativePath));
    try {
      await fs.lstat(newTarget);
      throw requestError(`Project file "${relativePath}" already exists.`, 409);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return newTarget;
  }

  const stagedCopy = stagedCopies.find((copy) =>
    relativePath.startsWith(`${copy.targetDirectory}/`)
  );
  if (stagedCopy) {
    const copyRelativePath = relativePath.slice(stagedCopy.targetDirectory.length + 1);
    const stagedTarget = path.resolve(stagedCopy.stagedDirectory, ...copyRelativePath.split("/"));
    if (!isWithin(stagedCopy.stagedDirectory, stagedTarget)) {
      throw requestError("Save path resolves outside the copied asset directory.");
    }
    let realTarget;
    try {
      realTarget = await fs.realpath(stagedTarget);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw requestError(`Project file "${relativePath}" does not exist in the copied asset.`);
      }
      throw error;
    }
    if (!isWithin(stagedCopy.stagedDirectory, realTarget)) {
      throw requestError("Save path resolves outside the copied asset directory.");
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

function validateAssetDirectoryPath(relativePath) {
  if (typeof relativePath !== "string" || !relativePath.startsWith("assets/") ||
      relativePath.includes("\\") || relativePath.includes("\0") ||
      relativePath.split("/").some((segment) =>
        !segment || segment === "." || segment === ".." || segment.startsWith(".")
      )) {
    throw requestError("Asset copies must use normal relative directories under assets/.");
  }
}

async function resolveAssetDirectory(projectRoot, relativePath) {
  validateAssetDirectoryPath(relativePath);
  const realProjectRoot = await fs.realpath(projectRoot);
  const assetsPath = path.join(realProjectRoot, "assets");
  let assetsDetails;
  try {
    assetsDetails = await fs.lstat(assetsPath);
  } catch (error) {
    if (error.code === "ENOENT") throw requestError("Asset copies require an assets directory.");
    throw error;
  }
  if (assetsDetails.isSymbolicLink() || !assetsDetails.isDirectory()) {
    throw requestError("Asset copies require a real assets directory.");
  }
  const realAssetsPath = await fs.realpath(assetsPath);
  const target = path.resolve(realProjectRoot, ...relativePath.split("/"));
  if (!isWithin(realAssetsPath, target)) {
    throw requestError("Asset copy path resolves outside the assets directory.");
  }
  let current = realProjectRoot;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    let details;
    try {
      details = await fs.lstat(current);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw requestError(`Asset copy source "${relativePath}" does not exist.`);
      }
      throw error;
    }
    if (details.isSymbolicLink()) {
      throw requestError("Asset copies cannot follow symbolic links.");
    }
    if (current !== target && !details.isDirectory()) {
      throw requestError("Asset copy source path must contain only directories.");
    }
  }
  if (!(await fs.stat(target)).isDirectory()) {
    throw requestError(`Asset copy source "${relativePath}" is not a directory.`);
  }
  return { assetsPath: realAssetsPath, directoryPath: target };
}

async function copyDirectory(source, target) {
  await fs.mkdir(target);
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    const details = await fs.lstat(sourcePath);
    if (details.isSymbolicLink()) {
      throw requestError("Asset copies cannot contain symbolic links.");
    }
    if (details.isDirectory()) {
      await copyDirectory(sourcePath, targetPath);
    } else if (details.isFile()) {
      await fs.copyFile(sourcePath, targetPath);
    } else {
      throw requestError("Asset copies can contain only regular files and directories.");
    }
  }
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
  if (!Array.isArray(projectData.assets) || !Array.isArray(projectData.screens)) {
    throw requestError("Asset copies require project.yml to list assets and Screens.");
  }

  const existingProject = parseYamlMapping(await fs.readFile(path.join(projectRoot, "project.yml"), "utf8"));
  if (!Array.isArray(existingProject.assets) || !Array.isArray(existingProject.screens)) {
    throw requestError("Asset copies require the current project.yml to list assets and Screens.");
  }
  const seenTargets = new Set();
  const plans = [];
  try {
    for (const request of assetCopies) {
      if (!request || Array.isArray(request) || typeof request !== "object" ||
          !/^[a-z][a-z0-9-]*$/.test(request.sourceId || "") ||
          !/^[a-z][a-z0-9-]*$/.test(request.targetId || "") ||
          !/^[a-z][a-z0-9-]*$/.test(request.targetScreen || "") ||
          typeof request.sourceDirectory !== "string" ||
          request.targetDirectory !== `assets/${request.targetId}`) {
        throw requestError("Each asset copy must identify valid source and target assets and a destination Screen.");
      }
      if (seenTargets.has(request.targetId)) {
        throw requestError(`Asset "${request.targetId}" is copied more than once in one save.`);
      }
      seenTargets.add(request.targetId);
      const source = existingProject.assets?.find((entry) => entry.id === request.sourceId);
      if (!source || source.directory !== request.sourceDirectory || !source.screen ||
          source.screen === request.targetScreen) {
        throw requestError(`Asset "${request.sourceId}" is not a page-specific source for this copy.`);
      }
      if (!projectData.screens.some((entry) => entry.id === request.targetScreen)) {
        throw requestError(`Destination Screen "${request.targetScreen}" does not exist.`);
      }
      if (existingProject.assets.some((entry) =>
        entry.id === request.targetId || entry.directory === request.targetDirectory
      )) {
        throw requestError(`Asset "${request.targetId}" already exists.`);
      }
      const targetEntry = projectData.assets.find((entry) => entry.id === request.targetId);
      if (!targetEntry || targetEntry.directory !== request.targetDirectory ||
          targetEntry.screen !== request.targetScreen ||
          targetEntry["copied-from"] !== request.sourceId) {
        throw requestError(`project.yml must list copied asset "${request.targetId}" under its destination Screen.`);
      }

      const { assetsPath, directoryPath } = await resolveAssetDirectory(projectRoot, request.sourceDirectory);
      const targetPath = path.resolve(assetsPath, request.targetId);
      if (!isWithin(assetsPath, targetPath)) {
        throw requestError("Asset copy destination resolves outside the assets directory.");
      }
      try {
        await fs.lstat(targetPath);
        throw requestError(`Asset copy destination "${request.targetDirectory}" already exists.`, 409);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const stagedDirectory = path.join(assetsPath, `.${request.targetId}.${randomUUID()}.tmp`);
      const plan = {
        ...request,
        sourcePath: directoryPath,
        targetPath,
        stagedDirectory
      };
      plans.push(plan);
      await copyDirectory(directoryPath, stagedDirectory);
      const assetManifestPath = path.join(stagedDirectory, "asset.yml");
      const assetManifest = parseYamlMapping(await fs.readFile(assetManifestPath, "utf8"));
      if (assetManifest.id !== request.sourceId) {
        throw requestError(`Source asset "${request.sourceId}" has a mismatched asset.yml id.`);
      }
      assetManifest.id = request.targetId;
      await fs.writeFile(assetManifestPath, YAML.stringify(assetManifest), "utf8");
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
      } catch (error) {
        throw requestError(`${file.path}: ${error.message || String(error)}`);
      }
      updates.push({ path: file.path, content: file.content, create });
    } else if (extension === ".html") {
      if (typeof file.content !== "string" || Object.hasOwn(file, "data")) {
        throw requestError("Asset HTML save entries must contain text content.");
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
  const committedCopies = [];
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
      await fs.rename(copy.stagedDirectory, copy.targetPath);
      committedCopies.push(copy.targetPath);
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
    await Promise.all(committedCopies.map((targetPath) =>
      fs.rm(targetPath, { recursive: true, force: true })
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
  else if (pathname === "/index.html" || pathname === "/app.js" ||
      pathname === "/yaml.js" || pathname === "/validation.js") {
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
  let server;
  server = http.createServer(async (request, response) => {
    let pathname;
    try {
      pathname = new URL(request.url, "http://localhost").pathname;
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
        if (pathname === "/api/selection") {
          sendJson(response, 200, selectionState);
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
        selectionState.selection = body.selection;
        selectionState.updatedAt = new Date().toISOString();
        sendJson(response, 200, { updated: true });
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
        const message = `event: project-updated\ndata: ${JSON.stringify({ timestamp })}\n\n`;
        for (const client of eventClients) client.write(message);
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
