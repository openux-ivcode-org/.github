const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

function snapshotPaths(projectRoot) {
  const absoluteRoot = path.resolve(projectRoot);
  const hashInput = process.platform === "win32" ? absoluteRoot.toLowerCase() : absoluteRoot;
  const projectKey = createHash("sha256").update(hashInput).digest("hex");
  const directory = path.join(os.tmpdir(), "openux-browser-snapshots", projectKey);
  return {
    directory,
    imagePath: path.join(directory, "latest.png"),
    metadataPath: path.join(directory, "latest.json")
  };
}

async function writeBrowserSnapshot(projectRoot, image, metadata) {
  const paths = snapshotPaths(projectRoot);
  const token = randomUUID();
  const temporaryImagePath = `${paths.imagePath}.${token}.tmp`;
  const temporaryMetadataPath = `${paths.metadataPath}.${token}.tmp`;
  const storedMetadata = {
    formatVersion: 1,
    ...metadata,
    imageSha256: createHash("sha256").update(image).digest("hex")
  };

  await fs.mkdir(paths.directory, { recursive: true });
  try {
    await fs.writeFile(temporaryImagePath, image, { flag: "wx" });
    await fs.writeFile(temporaryMetadataPath, JSON.stringify(storedMetadata), { flag: "wx" });
    await fs.rename(temporaryImagePath, paths.imagePath);
    await fs.rename(temporaryMetadataPath, paths.metadataPath);
  } finally {
    await Promise.all([
      fs.rm(temporaryImagePath, { force: true }),
      fs.rm(temporaryMetadataPath, { force: true })
    ]);
  }
}

async function readBrowserSnapshot(projectRoot) {
  const paths = snapshotPaths(projectRoot);
  let metadata;
  let image;
  try {
    [metadata, image] = await Promise.all([
      fs.readFile(paths.metadataPath, "utf8").then(JSON.parse),
      fs.readFile(paths.imagePath)
    ]);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (!metadata || Array.isArray(metadata) || typeof metadata !== "object" ||
      metadata.formatVersion !== 1 ||
      typeof metadata.screenId !== "string" ||
      !/^[a-z][a-z0-9-]*$/.test(metadata.screenId) ||
      typeof metadata.previewStateId !== "string" ||
      !metadata.previewSize ||
      !Number.isInteger(metadata.previewSize.width) ||
      metadata.previewSize.width < 1 ||
      !Number.isInteger(metadata.previewSize.height) ||
      metadata.previewSize.height < 1 ||
      typeof metadata.imageSha256 !== "string" ||
      createHash("sha256").update(image).digest("hex") !== metadata.imageSha256) {
    throw new Error("The cached browser snapshot is incomplete or corrupt. Capture it again from the editor.");
  }
  return { image, metadata };
}

async function clearBrowserSnapshot(projectRoot) {
  const paths = snapshotPaths(projectRoot);
  for (const filePath of [paths.imagePath, paths.metadataPath]) {
    try {
      await fs.rm(filePath, { force: true });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

module.exports = { clearBrowserSnapshot, readBrowserSnapshot, writeBrowserSnapshot };
