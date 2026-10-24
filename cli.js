#!/usr/bin/env node

const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const YAML = require("yaml");
const { createServer } = require("./server");
const { OPENUX_VERSION, isWithin, resolveProjectPath, validateProject } = require("./project");

const studioRoot = __dirname;
const schemaFiles = new Map([
  ["project", "project.md"],
  ["screen", "screen.md"],
  ["asset", "asset.md"],
  ["theme", "theme.md"],
  ["spec", "spec.md"],
  ["reference", "reference.md"]
]);

function usage() {
  return [
    "OpenUX CLI",
    "",
    "Usage:",
    "  openux server start [--port <port>] [--project <directory>]",
    "  openux server status [--port <port>]",
    "  openux server selected [--port <port>]",
    "  openux server update [--port <port>]",
    "  openux init [--project <directory>]",
    "  openux validate [--project <directory>]",
    "  openux version",
    "  openux schema [project|screen|asset|theme|spec|reference]",
    "  openux render <screen> --format <html|image> [--output <file>] [--project <directory>]",
    "  openux prune [--apply] [--project <directory>]"
  ].join("\n");
}

function parseOptions(args, allowedFlags) {
  const positional = [];
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) {
      positional.push(argument);
      continue;
    }
    if (!allowedFlags.has(argument)) throw new Error(`Unknown option "${argument}".`);
    if (argument === "--apply") {
      options.apply = true;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Option "${argument}" requires a value.`);
    index += 1;
    if (argument === "--port") {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`Invalid port "${value}". Use a number from 0 to 65535.`);
      }
      options.port = port;
    } else if (argument === "--format") {
      if (!["html", "image"].includes(value)) {
        throw new Error(`Unsupported render format "${value}". Use "html" or "image".`);
      }
      options.format = value;
    } else if (argument === "--project") {
      options.project = value;
    } else if (argument === "--output") {
      options.output = value;
    }
  }
  return { positional, options };
}

async function isFile(filePath) {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}

async function locateProjectRoot(startDirectory = process.cwd(), projectOption) {
  if (projectOption) {
    const selected = path.resolve(startDirectory, projectOption);
    if (await isFile(path.join(selected, "project.yml"))) return selected;
    if (await isFile(path.join(selected, "openux", "project.yml"))) return path.join(selected, "openux");
    throw new Error(`No project.yml found in "${selected}" or its openux/ subdirectory.`);
  }

  let directory = path.resolve(startDirectory);
  while (true) {
    if (await isFile(path.join(directory, "project.yml"))) return directory;
    if (await isFile(path.join(directory, "openux", "project.yml"))) return path.join(directory, "openux");
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  if (isWithin(studioRoot, path.resolve(startDirectory)) &&
      await isFile(path.join(studioRoot, "openux", "project.yml"))) {
    return path.join(studioRoot, "openux");
  }
  throw new Error("Could not find project.yml. Run this command inside an OpenUX project or use --project <directory>.");
}

function printValidationResult(result) {
  if (!result.errors.length) {
    console.log("OpenUX project is valid.");
    return 0;
  }
  console.error(`Found ${result.errors.length} validation error${result.errors.length === 1 ? "" : "s"}:`);
  for (const error of result.errors) console.error(`- ${error}`);
  return 1;
}

function resolveServerPort(options) {
  const port = options.port ?? Number(process.env.OPENUX_PORT || process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid server port "${port}".`);
  }
  return port;
}

async function startServer(options) {
  const projectRoot = await locateProjectRoot(process.cwd(), options.project);
  const port = resolveServerPort(options);
  const server = createServer({ rootDirectory: studioRoot, projectRoot });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  console.log(`OpenUX editor available at http://127.0.0.1:${address.port}/`);
  console.log("Press Ctrl+C to stop the server.");
  process.once("SIGINT", () => {
    server.closeAllConnections?.();
    server.close(() => process.exit(0));
  });
}

async function requestServer(port, pathname, options = {}) {
  const url = `http://127.0.0.1:${port}${pathname}`;
  let response;
  try {
    response = await fetch(url, {
      method: options.method || "GET",
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(2000)
    });
  } catch (error) {
    throw new Error(`Could not reach the OpenUX server at http://127.0.0.1:${port}/. Run "openux server start" first.`, {
      cause: error
    });
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `OpenUX server returned HTTP ${response.status}.`);
  return body;
}

async function runServerCommand(command, args) {
  const allowedFlags = command === "start"
    ? new Set(["--port", "--project"])
    : new Set(["--port"]);
  const { positional, options } = parseOptions(args, allowedFlags);
  if (positional.length) throw new Error(`Unexpected argument "${positional[0]}".`);
  if (command === "start") return startServer(options);
  const port = resolveServerPort(options);
  if (command === "status") {
    try {
      const status = await requestServer(port, "/api/status");
      console.log(JSON.stringify(status, null, 2));
      return;
    } catch (error) {
      console.error(`OpenUX server is not reachable at http://127.0.0.1:${port}/.`);
      return 1;
    }
  }
  if (command === "selected") {
    const selection = await requestServer(port, "/api/selection");
    console.log(JSON.stringify(selection, null, 2));
    return;
  }
  if (command === "update") {
    const result = await requestServer(port, "/api/update", { method: "POST", body: {} });
    const count = result.notifiedBrowsers;
    console.log(`Notified ${count} connected browser${count === 1 ? "" : "s"}.`);
    return;
  }
  throw new Error(`Unknown server command "${command}".`);
}

async function runSchemaCommand(args) {
  if (args.length > 1) throw new Error("Usage: openux schema [project|screen|asset|theme|spec|reference]");
  const type = args[0];
  const docs = type ? [schemaFiles.get(type)] : [...schemaFiles.values()];
  if (type && !docs[0]) {
    throw new Error(`Unknown schema type "${type}". Use project, screen, asset, theme, spec, or reference.`);
  }
  const content = await Promise.all(docs.map((file) =>
    fs.readFile(path.join(studioRoot, "schema", file), "utf8")
  ));
  process.stdout.write(content.join("\n\n---\n\n"));
}

function runVersionCommand(args) {
  if (args.length) throw new Error("Usage: openux version");
  console.log(OPENUX_VERSION);
}

async function runValidateCommand(args) {
  const { positional, options } = parseOptions(args, new Set(["--project"]));
  if (positional.length) throw new Error(`Unexpected argument "${positional[0]}".`);
  const projectRoot = await locateProjectRoot(process.cwd(), options.project);
  const result = await validateProject(projectRoot);
  return printValidationResult(result);
}

async function runInitCommand(args) {
  const { positional, options } = parseOptions(args, new Set(["--project"]));
  if (positional.length) throw new Error(`Unexpected argument "${positional[0]}".`);

  const workingDirectory = path.resolve(process.cwd(), options.project || ".");
  const projectDirectory = path.join(workingDirectory, "openux");
  const files = [
    ["project.yml", YAML.stringify({
      name: "OpenUX Project",
      openux: OPENUX_VERSION,
      screens: [{ id: "home", file: "screens/home.yml" }],
      assets: [{ id: "page-layout", directory: "assets/page-layout" }],
      theme: "theme/theme.yml"
    })],
    ["screens/home.yml", YAML.stringify({
      name: "Home",
      description: "Starter Screen for the OpenUX project.",
      assets: [{
        "asset-template": "page-layout",
        name: "Page layout",
        slots: { content: [] }
      }]
    })],
    ["assets/page-layout/asset.yml", YAML.stringify({
      id: "page-layout",
      name: "Page Layout",
      description: "A simple page layout with a content slot.",
      slots: [{ id: "content", name: "Content" }],
      render: { type: "html-reference" }
    })],
    ["assets/page-layout/asset.html", [
      '<main class="page-layout">',
      "  <h1>Welcome to OpenUX</h1>",
      '  <div data-openux-slot="content"></div>',
      "</main>",
      "",
      "<style>",
      "  .page-layout {",
      "    box-sizing: border-box;",
      "    min-height: 100vh;",
      "    padding: 3rem;",
      "    color: var(--theme-ink, #1e293b);",
      "    background: var(--theme-background, #f3f6fa);",
      "    font-family: system-ui, sans-serif;",
      "  }",
      "</style>",
      ""
    ].join("\n")],
    ["theme/theme.yml", YAML.stringify({
      name: "Default",
      colors: {
        primary: "#4569e8",
        ink: "#1e293b",
        background: "#f3f6fa"
      }
    })]
  ];

  const conflicts = [];
  for (const [relativePath] of files) {
    const target = path.join(projectDirectory, relativePath);
    try {
      await fs.lstat(target);
      conflicts.push(relativePath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (conflicts.length) {
    throw new Error(
      `Cannot initialize OpenUX because these files already exist in "${projectDirectory}": ${conflicts.join(", ")}.`
    );
  }

  const createdFiles = [];
  try {
    for (const [relativePath, content] of files) {
      const target = path.join(projectDirectory, relativePath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, { flag: "wx" });
      createdFiles.push(target);
    }
  } catch (error) {
    const cleanupErrors = [];
    for (const target of createdFiles) {
      try {
        await fs.rm(target);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (cleanupErrors.length) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "OpenUX initialization failed and some created files could not be removed."
      );
    }
    throw error;
  }

  console.log(`Created OpenUX starter project in "${projectDirectory}".`);
  console.log('Run "openux validate" to check the new project.');
}

function findBrowserExecutable() {
  const candidates = [
    process.env.OPENUX_BROWSER,
    process.env.CHROME_PATH,
    process.env.EDGE_PATH,
    process.platform === "win32" && process.env.ProgramFiles
      ? path.join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe")
      : null,
    process.platform === "win32" && process.env["ProgramFiles(x86)"]
      ? path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe")
      : null,
    process.platform === "win32" && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
      : null,
    process.platform === "win32" && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe")
      : null,
    process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : null,
    process.platform === "darwin"
      ? "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
      : null,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/microsoft-edge"
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (require("node:fs").statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  const lookup = process.platform === "win32" ? "where.exe" : "which";
  for (const name of process.platform === "win32"
    ? ["chrome.exe", "msedge.exe"]
    : ["chromium", "chromium-browser", "google-chrome", "microsoft-edge"]) {
    const result = spawnSync(lookup, [name], { encoding: "utf8", windowsHide: true });
    const found = result.status === 0 ? result.stdout.split(/\r?\n/)[0].trim() : "";
    if (found) return found;
  }
  return null;
}

function runBrowser(executable, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let timedOut = false;
    let settled = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    const collect = (chunks, chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > 32 * 1024 * 1024) {
        child.kill();
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error("Browser renderer output exceeded the 32 MB limit."));
        }
        return;
      }
      chunks.push(chunk);
    };
    child.stdout.on("data", (chunk) => collect(stdout, chunk));
    child.stderr.on("data", (chunk) => collect(stderr, chunk));
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`Could not run the browser renderer: ${error.message}`));
    });
    child.once("close", (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const result = {
        status,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      };
      if (timedOut) {
        const details = (result.stderr || result.stdout).trim().split(/\r?\n/).slice(-8).join("\n");
        reject(new Error(`Browser renderer timed out after ${timeoutMs} ms.${details ? `\n${details}` : ""}`));
      } else {
        resolve(result);
      }
    });
  });
}

function createBrowserArgs(url, temporaryDirectory, viewportHeight, screenshotPath) {
  const args = [
    "--headless",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    `--window-size=1440,${viewportHeight}`,
    "--virtual-time-budget=10000",
    `--user-data-dir=${path.join(temporaryDirectory, "profile")}`
  ];
  if (process.platform !== "win32" && typeof process.getuid === "function" && process.getuid() === 0) {
    args.push("--no-sandbox");
  }
  if (screenshotPath) args.push(`--screenshot=${screenshotPath}`);
  else args.push("--dump-dom");
  args.push(url.href);
  return args;
}

function browserFailure(result) {
  const details = (result.stderr || result.stdout || "").trim().split(/\r?\n/).slice(-8).join("\n");
  return new Error(`Browser rendering failed${details ? `:\n${details}` : "."}`);
}

async function inlineProjectResources(html, origin, projectRoot) {
  const urls = new Set();
  const prefix = `${origin}/openux/`;
  for (const match of html.matchAll(/https?:\/\/[^"'()<>\s]+/g)) {
    if (match[0].startsWith(prefix)) urls.add(match[0]);
  }

  const contentTypes = new Map([
    [".css", "text/css"],
    [".avif", "image/avif"],
    [".bmp", "image/bmp"],
    [".gif", "image/gif"],
    [".ico", "image/x-icon"],
    [".jpeg", "image/jpeg"],
    [".jpg", "image/jpeg"],
    [".otf", "font/otf"],
    [".png", "image/png"],
    [".svg", "image/svg+xml"],
    [".ttf", "font/ttf"],
    [".webp", "image/webp"],
    [".woff", "font/woff"],
    [".woff2", "font/woff2"]
  ]);
  for (const resourceUrl of urls) {
    const encodedPath = resourceUrl.slice(prefix.length).split(/[?#]/, 1)[0];
    const relativePath = decodeURIComponent(encodedPath);
    const filePath = await resolveProjectPath(projectRoot, relativePath, "file");
    const content = await fs.readFile(filePath);
    const contentType = contentTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
    html = html.replaceAll(resourceUrl, `data:${contentType};base64,${content.toString("base64")}`);
  }
  return html;
}

async function closeServer(server) {
  await new Promise((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve())
  );
}

async function runRenderCommand(args) {
  const { positional, options } = parseOptions(
    args,
    new Set(["--format", "--output", "--project"])
  );
  if (positional.length !== 1 || !options.format) {
    throw new Error("Usage: openux render <screen> --format <html|image> [--output <file>] [--project <directory>]");
  }
  if (options.format === "image" && !options.output) {
    throw new Error("Image rendering requires --output <file>.");
  }

  const projectRoot = await locateProjectRoot(process.cwd(), options.project);
  const validationResult = await validateProject(projectRoot);
  if (validationResult.errors.length) {
    printValidationResult(validationResult);
    return 1;
  }
  const screen = validationResult.project.screens.find((entry) => entry.id === positional[0]);
  if (!screen) throw new Error(`Unknown Screen "${positional[0]}".`);

  const browser = findBrowserExecutable();
  if (!browser) {
    throw new Error("A Chromium-based browser is required. Set OPENUX_BROWSER to its executable path.");
  }

  const server = createServer({ rootDirectory: studioRoot, projectRoot });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const temporaryDirectory = await fs.mkdtemp(path.join(require("node:os").tmpdir(), "openux-render-"));
  const outputPath = options.output ? path.resolve(options.output) : null;
  try {
    if (outputPath) await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const address = server.address();
    const url = new URL("/", `http://127.0.0.1:${address.port}`);
    url.searchParams.set("render", positional[0]);
    url.searchParams.set("format", options.format);
    const timeoutMs = Number(process.env.OPENUX_RENDER_TIMEOUT_MS) || 60000;
    let result;
    if (options.format === "image") {
      const measureArgs = createBrowserArgs(url, temporaryDirectory, 1000);
      if (process.env.OPENUX_DEBUG_RENDER) {
        console.error(`Using browser: ${browser}`);
        console.error(`Browser arguments: ${measureArgs.join(" ")}`);
      }
      const measurement = await runBrowser(browser, measureArgs, timeoutMs);
      if (measurement.status !== 0) throw browserFailure(measurement);
      const heightMatch = /data-openux-render-height="(\d+)"/.exec(measurement.stdout);
      const viewportHeight = heightMatch ? Number(heightMatch[1]) : 0;
      if (!Number.isSafeInteger(viewportHeight) || viewportHeight < 1 || viewportHeight > 16384) {
        throw new Error(
          heightMatch
            ? `Rendered Screen height ${viewportHeight}px exceeds the 16384px image limit.`
            : "The browser could not measure the rendered Screen height."
        );
      }
      const screenshotArgs = createBrowserArgs(url, temporaryDirectory, viewportHeight, outputPath);
      if (process.env.OPENUX_DEBUG_RENDER) {
        console.error(`Browser arguments: ${screenshotArgs.join(" ")}`);
      }
      result = await runBrowser(browser, screenshotArgs, timeoutMs);
    } else {
      const browserArgs = createBrowserArgs(url, temporaryDirectory, 1000);
      if (process.env.OPENUX_DEBUG_RENDER) {
        console.error(`Using browser: ${browser}`);
        console.error(`Browser arguments: ${browserArgs.join(" ")}`);
      }
      result = await runBrowser(browser, browserArgs, timeoutMs);
    }
    if (result.status !== 0) throw browserFailure(result);
    if (options.format === "image") {
      const image = await fs.readFile(outputPath);
      if (image.length < 8 || !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        throw new Error("The browser did not produce a valid PNG image.");
      }
      console.log(`Rendered Screen "${screen.id}" to ${outputPath}`);
      return;
    }
    const match = /data-openux-render-ready="true"[^>]*data-openux-render-html="([A-Za-z0-9+/=]+)"/.exec(result.stdout) ||
      /data-openux-render-html="([A-Za-z0-9+/=]+)"[^>]*data-openux-render-ready="true"/.exec(result.stdout);
    const encodedHtml = match && (match[1] || match[2]);
    if (!encodedHtml) throw new Error("The browser could not render that Screen as HTML.");
    const renderedHtml = Buffer.from(encodedHtml, "base64").toString("utf8");
    const html = await inlineProjectResources(renderedHtml, url.origin, projectRoot);
    if (outputPath) {
      await fs.writeFile(outputPath, html, "utf8");
      console.log(`Rendered Screen "${screen.id}" to ${outputPath}`);
    } else {
      process.stdout.write(html);
    }
  } finally {
    try {
      await closeServer(server);
    } finally {
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

function pruneCandidates(result) {
  return result.project.assets
    .filter((asset) => !result.usedAssetIds.has(asset.id))
    .map((asset) => ({
      type: "asset",
      id: asset.id,
      path: asset.directory,
      reason: "No Screen instance, including nested instances, uses this asset."
    }));
}

function nodeValue(node, key) {
  return node?.get(key, true)?.toJSON();
}

async function applyPrune(projectRoot, result, candidates) {
  if (!candidates.length) return;
  const removeAssetIds = new Set(candidates.filter((candidate) => candidate.type === "asset").map((entry) => entry.id));
  const manifestPath = await resolveProjectPath(projectRoot, "project.yml", "file");
  const source = await fs.readFile(manifestPath, "utf8");
  const document = YAML.parseDocument(source);
  if (document.errors.length) throw new Error(`Could not safely update project.yml: ${document.errors[0].message}`);
  const assetSequence = document.get("assets", true);
  if (assetSequence && Array.isArray(assetSequence.items)) {
    assetSequence.items = assetSequence.items.filter((entry) => !removeAssetIds.has(nodeValue(entry, "id")));
  }

  const quarantine = path.join(projectRoot, `.openux-prune-${randomUUID()}`);
  const manifestTemp = path.join(projectRoot, `.project-${randomUUID()}.yml.tmp`);
  const manifestBackup = path.join(projectRoot, `.project-${randomUUID()}.yml.backup`);
  const moved = [];
  let backupCreated = false;
  let manifestCommitted = false;
  await fs.mkdir(quarantine);
  try {
    await fs.writeFile(manifestTemp, document.toString(), { encoding: "utf8", flag: "wx" });
    const stagedCandidates = [];
    for (const candidate of candidates) {
      const target = await resolveProjectPath(
        projectRoot,
        candidate.path,
        candidate.type === "asset" ? "directory" : "file"
      );
      if (target === path.resolve(projectRoot)) {
        throw new Error(`Refusing to remove the project root for ${candidate.type} "${candidate.id}".`);
      }
      stagedCandidates.push({ candidate, target });
    }
    stagedCandidates.sort((left, right) => right.target.length - left.target.length);
    for (const [index, entry] of stagedCandidates.entries()) {
      const stagedPath = path.join(quarantine, String(index));
      await fs.rename(entry.target, stagedPath);
      moved.push({ originalPath: entry.target, stagedPath });
    }
    await fs.rename(manifestPath, manifestBackup);
    backupCreated = true;
    await fs.rename(manifestTemp, manifestPath);
    manifestCommitted = true;
  } catch (error) {
    const rollbackErrors = [];
    if (backupCreated && !manifestCommitted) {
      try {
        await fs.rename(manifestBackup, manifestPath);
        backupCreated = false;
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError.message);
      }
    }
    for (const entry of moved.reverse()) {
      try {
        await fs.rename(entry.stagedPath, entry.originalPath);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError.message);
      }
    }
    await fs.rm(manifestTemp, { force: true });
    if (rollbackErrors.length) {
      throw new Error(
        `Prune failed: ${error.message}. Rollback was incomplete: ${rollbackErrors.join("; ")}. ` +
        `Staged resources were retained in "${quarantine}".`
      );
    }
    await fs.rm(quarantine, { recursive: true, force: true });
    throw error;
  }

  await fs.rm(manifestBackup, { force: true });
  await fs.rm(quarantine, { recursive: true, force: true });
}

async function runPruneCommand(args) {
  const { positional, options } = parseOptions(args, new Set(["--apply", "--project"]));
  if (positional.length) throw new Error(`Unexpected argument "${positional[0]}".`);
  const projectRoot = await locateProjectRoot(process.cwd(), options.project);
  const result = await validateProject(projectRoot);
  if (result.errors.length) {
    printValidationResult(result);
    return 1;
  }
  const candidates = pruneCandidates(result);
  if (!candidates.length) {
    console.log("No unused assets found.");
    return;
  }
  for (const candidate of candidates) {
    console.log(`${candidate.type} ${candidate.id} (${candidate.path})`);
    console.log(`  ${candidate.reason}`);
  }
  if (!options.apply) {
    console.log('\nNo files were removed. Re-run with "--apply" to prune these resources.');
    return;
  }
  await applyPrune(projectRoot, result, candidates);
  console.log(`\nRemoved ${candidates.length} unused resource${candidates.length === 1 ? "" : "s"}.`);
}

async function main(args = process.argv.slice(2)) {
  if (!args.length || args[0] === "--help" || args[0] === "-h") {
    console.log(usage());
    return;
  }
  const [command, ...rest] = args;
  if (command === "server") {
    const [subcommand, ...subArgs] = rest;
    if (!subcommand) throw new Error("Usage: openux server <start|status|selected|update>");
    return runServerCommand(subcommand, subArgs);
  }
  if (command === "init") return runInitCommand(rest);
  if (command === "version") return runVersionCommand(rest);
  if (command === "--version" || command === "-v") return runVersionCommand(rest);
  if (command === "schema") return runSchemaCommand(rest);
  if (command === "validate") return runValidateCommand(rest);
  if (command === "render") return runRenderCommand(rest);
  if (command === "prune") return runPruneCommand(rest);
  throw new Error(`Unknown command "${command}".\n\n${usage()}`);
}

if (require.main === module) {
  main().then((exitCode) => {
    if (typeof exitCode === "number") process.exitCode = exitCode;
  }).catch((error) => {
    console.error(error.message || String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  inlineProjectResources,
  locateProjectRoot,
  pruneCandidates,
  runInitCommand,
  runPruneCommand
};
