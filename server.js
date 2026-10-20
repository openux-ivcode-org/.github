const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const YAML = require("yaml");

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_FILES_PER_SAVE = 100;
const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".yml", "text/yaml; charset=utf-8"],
  [".yaml", "text/yaml; charset=utf-8"]
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

async function resolveProjectFile(projectRoot, relativePath, { create = false } = {}) {
  if (typeof relativePath !== "string" || !relativePath || relativePath.includes("\\") ||
      relativePath.startsWith("/") || relativePath.split("/").some((segment) =>
        !segment || segment === "." || segment === ".." || segment.startsWith(".")
      )) {
    throw requestError("Save paths must be relative paths inside the openux project.");
  }
  const extension = path.extname(relativePath).toLowerCase();
  if (![".yml", ".yaml", ".html"].includes(extension)) {
    throw requestError("The editor can only save YAML and asset HTML files.");
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
    if (!/^screens\/[a-z0-9]+(?:-[a-z0-9]+)*\.ya?ml$/.test(relativePath)) {
      throw requestError("New files can only be created as named Screen YAML files.", 400);
    }
    const realProjectRoot = await fs.realpath(projectRoot);
    const realScreensDirectory = await fs.realpath(path.join(projectRoot, "screens"));
    if (realScreensDirectory !== path.join(realProjectRoot, "screens")) {
      throw requestError("Screen files must be created inside the project screens directory.");
    }
    const newTarget = path.join(realScreensDirectory, path.basename(relativePath));
    try {
      await fs.lstat(newTarget);
      throw requestError(`Project file "${relativePath}" already exists.`, 409);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return newTarget;
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

async function saveProjectFiles(projectRoot, files) {
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
    const target = await resolveProjectFile(projectRoot, file.path, { create });
    const extension = path.extname(file.path).toLowerCase();
    if (extension === ".html") {
      if (typeof file.content !== "string" || Object.hasOwn(file, "data")) {
        throw requestError("Asset HTML save entries must contain text content.");
      }
      updates.push({ path: file.path, target, content: file.content, create });
    } else if (typeof file.content === "string" && !Object.hasOwn(file, "data")) {
      parseYamlMapping(file.content);
      updates.push({ path: file.path, target, content: file.content, create });
    } else {
      if (!Object.hasOwn(file, "data") || !file.data ||
          Array.isArray(file.data) || typeof file.data !== "object" ||
          Object.hasOwn(file, "content")) {
        throw requestError("YAML save entries must contain a mapping of data.");
      }
      updates.push({ path: file.path, target, content: YAML.stringify(file.data), create });
    }
  }

  const staged = [];
  try {
    for (const update of updates) {
      const temporaryPath = path.join(
        path.dirname(update.target),
        `.${path.basename(update.target)}.${randomUUID()}.tmp`
      );
      await fs.writeFile(temporaryPath, update.content, { encoding: "utf8", flag: "wx" });
      staged.push({ ...update, temporaryPath });
    }
    for (const update of staged) {
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
    throw error;
  }
  return updates.map(({ path: filePath }) => filePath);
}

async function serveStatic(rootDirectory, projectRoot, pathname, response) {
  let relativePath;
  if (pathname === "/") relativePath = "index.html";
  else if (pathname === "/index.html" || pathname === "/app.js" || pathname === "/yaml.js") {
    relativePath = pathname.slice(1);
  } else if (pathname.startsWith("/openux/")) {
    const projectPath = pathname.slice("/openux/".length);
    if (projectPath.split("/").some((segment) =>
      !segment || segment === "." || segment === ".." || segment.startsWith(".")
    )) {
      sendJson(response, 404, { error: "File not found." });
      return;
    }
    relativePath = path.join("openux", ...projectPath.split("/"));
  } else {
    sendJson(response, 404, { error: "File not found." });
    return;
  }

  const target = path.resolve(rootDirectory, relativePath);
  try {
    const realTarget = await fs.realpath(target);
    const allowedRoot = relativePath.startsWith(`openux${path.sep}`) ? projectRoot : rootDirectory;
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
  const projectRoot = path.join(rootDirectory, "openux");
  return http.createServer(async (request, response) => {
    let pathname;
    try {
      pathname = new URL(request.url, "http://localhost").pathname;
      if (request.method === "GET") {
        await serveStatic(rootDirectory, projectRoot, pathname, response);
        return;
      }
      if (request.method === "POST" && pathname === "/api/save") {
        const body = await readJsonBody(request);
        if (!body || Array.isArray(body) || typeof body !== "object") {
          throw requestError("Save request must be a JSON object.");
        }
        const saved = await saveProjectFiles(projectRoot, body.files);
        sendJson(response, 200, { saved });
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
}

if (require.main === module) {
  const server = createServer();
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, "127.0.0.1", () => {
    console.log(`OpenUX editor available at http://127.0.0.1:${port}/`);
  });
}

module.exports = { createServer, saveProjectFiles };
