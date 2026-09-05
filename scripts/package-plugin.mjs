import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const supportedApiVersion = "0.2.0";
const semverPattern = /^\d+\.\d+\.\d+$/;
const pluginIdPattern = /^[a-z0-9][a-z0-9._-]*$/;
const maxArchiveFileSize = 20 * 1024 * 1024;
const allowedAssetExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".txt",
  ".json",
]);

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;

  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }

  return value >>> 0;
});

function fail(message) {
  console.error(`Plugin package failed: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    pluginRoot: undefined,
    outDir: join(repoRoot, "dist", "plugins"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--out") {
      const value = argv[index + 1];

      if (!value) {
        fail("--out requires a directory");
      }

      args.outDir = resolve(repoRoot, value);
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    if (arg.startsWith("--")) {
      fail(`unknown option: ${arg}`);
    }

    if (args.pluginRoot) {
      fail("only one plugin directory can be packaged at a time");
    }

    args.pluginRoot = resolve(repoRoot, arg);
  }

  if (!args.pluginRoot) {
    printUsage();
    process.exit(1);
  }

  return args;
}

function printUsage() {
  console.log(`Usage: node scripts/package-plugin.mjs <plugin-directory> [--out <directory>]

Examples:
  node scripts/package-plugin.mjs .plugins/numeric-calculator-plugin
  node scripts/package-plugin.mjs .plugins/numeric-calculator-plugin --out dist/plugins`);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${relative(repoRoot, path)} is not valid JSON: ${error.message}`);
  }
}

function normalizeManifestPath(pathValue, fallback) {
  if (typeof pathValue !== "string" || !pathValue.trim()) {
    return fallback;
  }

  return pathValue.replace(/\\/g, "/").replace(/^\.\//, "");
}

function toArchivePath(path) {
  return path.split(sep).join("/");
}

function assertInside(root, path) {
  const relativePath = relative(root, path);

  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    fail(`${path} escapes ${root}`);
  }
}

function collectFiles(root) {
  const files = [];

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);

      if (entry.isSymbolicLink()) {
        fail(
          `${relative(root, path)}: symbolic links are not allowed in plugin packages`,
        );
      }

      if (entry.isDirectory()) {
        visit(path);
        continue;
      }

      if (entry.isFile()) {
        files.push(path);
      }
    }
  }

  visit(root);

  return files.sort((left, right) =>
    toArchivePath(relative(root, left)).localeCompare(
      toArchivePath(relative(root, right)),
    ),
  );
}

function isAllowedFile(relativePath, manifest) {
  const archivePath = toArchivePath(relativePath);
  const baseName = basename(archivePath);
  const mainPath = normalizeManifestPath(manifest.entrypoints?.main, "main.js");
  const pagePath = normalizeManifestPath(manifest.page, "page.json");
  const i18nPath =
    typeof manifest.i18n === "string"
      ? normalizeManifestPath(manifest.i18n, "i18n.json")
      : null;

  if (archivePath === "manifest.json") {
    return true;
  }

  if (
    archivePath === mainPath ||
    archivePath === pagePath ||
    archivePath === i18nPath
  ) {
    return true;
  }

  if (archivePath === "styles.css") {
    return true;
  }

  if (
    ["README.md", "CHANGELOG.md", "LICENSE"].includes(baseName) &&
    !archivePath.includes("/")
  ) {
    return true;
  }

  if (archivePath.startsWith("assets/")) {
    return true;
  }

  return false;
}

function hasExecutableSignature(buffer) {
  if (buffer.length >= 4) {
    const first4 = buffer.subarray(0, 4);

    if (
      first4[0] === 0x7f &&
      first4[1] === 0x45 &&
      first4[2] === 0x4c &&
      first4[3] === 0x46
    ) {
      return "ELF executable signature";
    }

    if (
      first4.equals(Buffer.from([0xfe, 0xed, 0xfa, 0xce])) ||
      first4.equals(Buffer.from([0xfe, 0xed, 0xfa, 0xcf])) ||
      first4.equals(Buffer.from([0xce, 0xfa, 0xed, 0xfe])) ||
      first4.equals(Buffer.from([0xcf, 0xfa, 0xed, 0xfe])) ||
      first4.equals(Buffer.from([0xca, 0xfe, 0xba, 0xbe]))
    ) {
      return "Mach-O executable signature";
    }
  }

  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) {
    return "PE executable signature";
  }

  if (buffer.length >= 2 && buffer[0] === 0x23 && buffer[1] === 0x21) {
    return "script shebang";
  }

  return null;
}

function validateTextFile(path, relativePath, buffer) {
  const extension = extname(relativePath).toLowerCase();
  const textExtensions = new Set([".js", ".json", ".css", ".md", ".txt"]);
  const textNames = new Set(["LICENSE"]);

  if (
    !textExtensions.has(extension) &&
    !textNames.has(basename(relativePath))
  ) {
    return;
  }

  const decoded = buffer.toString("utf8");

  if (decoded.includes("\uFFFD")) {
    fail(`${relativePath}: expected valid UTF-8 text`);
  }

  if (extension === ".json") {
    try {
      JSON.parse(decoded);
    } catch (error) {
      fail(`${relativePath}: invalid JSON: ${error.message}`);
    }
  }
}

function validateAssetFile(relativePath, buffer) {
  if (!relativePath.startsWith("assets/")) {
    return;
  }

  const extension = extname(relativePath).toLowerCase();

  if (!allowedAssetExtensions.has(extension)) {
    fail(`${relativePath}: asset extension is not allowed`);
  }

  if (extension === ".png") {
    if (
      buffer.length < 8 ||
      !buffer
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) {
      fail(`${relativePath}: PNG asset has an invalid signature`);
    }
  }

  if (extension === ".jpg" || extension === ".jpeg") {
    if (
      buffer.length < 3 ||
      buffer[0] !== 0xff ||
      buffer[1] !== 0xd8 ||
      buffer[2] !== 0xff
    ) {
      fail(`${relativePath}: JPEG asset has an invalid signature`);
    }
  }

  if (extension === ".webp") {
    if (
      buffer.length < 12 ||
      buffer.subarray(0, 4).toString("ascii") !== "RIFF" ||
      buffer.subarray(8, 12).toString("ascii") !== "WEBP"
    ) {
      fail(`${relativePath}: WebP asset has an invalid signature`);
    }
  }

  if (extension === ".gif") {
    const signature = buffer.subarray(0, 6).toString("ascii");

    if (signature !== "GIF87a" && signature !== "GIF89a") {
      fail(`${relativePath}: GIF asset has an invalid signature`);
    }
  }
}

function validatePackageFiles(pluginRoot, manifest, files) {
  const requiredPaths = [
    "manifest.json",
    normalizeManifestPath(manifest.entrypoints?.main, "main.js"),
    normalizeManifestPath(manifest.page, "page.json"),
  ];

  if (typeof manifest.i18n === "string") {
    requiredPaths.push(normalizeManifestPath(manifest.i18n, "i18n.json"));
  }

  const archivePaths = new Set(
    files.map((file) => toArchivePath(relative(pluginRoot, file))),
  );

  for (const requiredPath of requiredPaths) {
    if (!archivePaths.has(requiredPath)) {
      fail(`missing required file: ${requiredPath}`);
    }
  }

  for (const file of files) {
    assertInside(pluginRoot, file);

    const relativePath = toArchivePath(relative(pluginRoot, file));
    const extension = extname(relativePath).toLowerCase();
    const executableExtensions = new Set([
      ".dll",
      ".exe",
      ".bat",
      ".cmd",
      ".ps1",
      ".sh",
      ".so",
      ".dylib",
    ]);

    if (!isAllowedFile(relativePath, manifest)) {
      fail(`${relativePath}: file is not allowed in release packages`);
    }

    if (
      [".js", ".mjs", ".cjs", ".ts", ".tsx"].includes(extension) &&
      relativePath !==
        normalizeManifestPath(manifest.entrypoints?.main, "main.js")
    ) {
      fail(
        `${relativePath}: undeclared JavaScript or TypeScript files are not allowed`,
      );
    }

    if (executableExtensions.has(extension)) {
      fail(`${relativePath}: executable files are not allowed`);
    }

    const buffer = readFileSync(file);
    const executableSignature = hasExecutableSignature(buffer);

    if (executableSignature) {
      fail(
        `${relativePath}: executable content is not allowed (${executableSignature})`,
      );
    }

    validateAssetFile(relativePath, buffer);
    validateTextFile(file, relativePath, buffer);
  }
}

function validateManifest(pluginRoot, manifest) {
  const folderName = basename(pluginRoot);

  if (typeof manifest.id !== "string" || !pluginIdPattern.test(manifest.id)) {
    fail("manifest.id must be a lowercase plugin id");
  }

  if (manifest.id !== folderName) {
    fail(`manifest.id must match plugin folder name: ${folderName}`);
  }

  if (typeof manifest.name !== "string" || !manifest.name.trim()) {
    fail("manifest.name is required");
  }

  if (
    typeof manifest.version !== "string" ||
    !semverPattern.test(manifest.version)
  ) {
    fail("manifest.version must be a semantic version triplet");
  }

  if (manifest.apiVersion !== supportedApiVersion) {
    fail(`manifest.apiVersion must be ${supportedApiVersion}`);
  }

  if (normalizeManifestPath(manifest.entrypoints?.main, "") !== "main.js") {
    fail("manifest.entrypoints.main must be ./main.js");
  }

  if (normalizeManifestPath(manifest.page, "") !== "page.json") {
    fail("manifest.page must be ./page.json");
  }

  if (
    manifest.i18n &&
    normalizeManifestPath(manifest.i18n, "") !== "i18n.json"
  ) {
    fail("manifest.i18n must be ./i18n.json when present");
  }

  validateOptionalHttpsUrl(manifest.repositoryUrl, "manifest.repositoryUrl");
  validateOptionalHttpsUrl(manifest.homepageUrl, "manifest.homepageUrl");
  validateOptionalHttpsUrl(manifest.supportUrl, "manifest.supportUrl");
}

function validateOptionalHttpsUrl(value, label) {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "string" || !value.trim()) {
    fail(`${label} must be a non-empty string when present`);
  }

  try {
    const url = new URL(value);

    if (url.protocol !== "https:") {
      fail(`${label} must use https`);
    }
  } catch {
    fail(`${label} must be a valid URL`);
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();

  return { dosDate, dosTime };
}

function uint16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function createZip(entries) {
  const chunks = [];
  const centralDirectory = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, "utf8");
    const fileBuffer = entry.buffer;
    const checksum = crc32(fileBuffer);
    const { dosDate, dosTime } = dosDateTime(entry.modifiedAt);
    const localHeader = Buffer.concat([
      uint32(0x04034b50),
      uint16(20),
      uint16(0x0800),
      uint16(0),
      uint16(dosTime),
      uint16(dosDate),
      uint32(checksum),
      uint32(fileBuffer.length),
      uint32(fileBuffer.length),
      uint16(nameBuffer.length),
      uint16(0),
      nameBuffer,
    ]);

    chunks.push(localHeader, fileBuffer);
    centralDirectory.push(
      Buffer.concat([
        uint32(0x02014b50),
        uint16(20),
        uint16(20),
        uint16(0x0800),
        uint16(0),
        uint16(dosTime),
        uint16(dosDate),
        uint32(checksum),
        uint32(fileBuffer.length),
        uint32(fileBuffer.length),
        uint16(nameBuffer.length),
        uint16(0),
        uint16(0),
        uint16(0),
        uint16(0),
        uint32(0),
        uint32(offset),
        nameBuffer,
      ]),
    );

    offset += localHeader.length + fileBuffer.length;
  }

  const centralDirectoryStart = offset;
  const centralDirectoryBuffer = Buffer.concat(centralDirectory);
  const endOfCentralDirectory = Buffer.concat([
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(entries.length),
    uint16(entries.length),
    uint32(centralDirectoryBuffer.length),
    uint32(centralDirectoryStart),
    uint16(0),
  ]);
  const zipBuffer = Buffer.concat([
    ...chunks,
    centralDirectoryBuffer,
    endOfCentralDirectory,
  ]);

  if (zipBuffer.length > maxArchiveFileSize) {
    fail(
      `created archive is ${zipBuffer.length} bytes, which exceeds ${maxArchiveFileSize} bytes`,
    );
  }

  return zipBuffer;
}

function main() {
  const { pluginRoot, outDir } = parseArgs(process.argv.slice(2));
  const manifestPath = join(pluginRoot, "manifest.json");

  if (!existsSync(pluginRoot) || !statSync(pluginRoot).isDirectory()) {
    fail(`plugin directory not found: ${pluginRoot}`);
  }

  if (!existsSync(manifestPath)) {
    fail(`missing manifest.json in ${pluginRoot}`);
  }

  const manifest = readJson(manifestPath);
  validateManifest(pluginRoot, manifest);

  const files = collectFiles(pluginRoot);
  validatePackageFiles(pluginRoot, manifest, files);

  mkdirSync(outDir, { recursive: true });

  const fileName = `${manifest.id}-${manifest.version}.glimpse-plugin.zip`;
  const zipPath = join(outDir, fileName);
  const entries = files.map((file) => ({
    name: toArchivePath(relative(pluginRoot, file)),
    buffer: readFileSync(file),
    modifiedAt: statSync(file).mtime,
  }));
  const zipBuffer = createZip(entries);

  writeFileSync(zipPath, zipBuffer);

  const sha256 = createHash("sha256").update(zipBuffer).digest("hex");
  const metadata = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    apiVersion: manifest.apiVersion,
    description: manifest.description ?? "",
    releaseDate: manifest.releaseDate ?? new Date().toISOString().slice(0, 10),
    fileName,
    sha256,
    ...optionalMetadataField("repositoryUrl", manifest.repositoryUrl),
    ...optionalMetadataField("homepageUrl", manifest.homepageUrl),
    ...optionalMetadataField("supportUrl", manifest.supportUrl),
  };
  const metadataPath = join(
    outDir,
    `${manifest.id}-${manifest.version}.release.json`,
  );

  writeFileSync(`${zipPath}.sha256`, `${sha256}  ${fileName}\n`);
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

  console.log(`Created ${relative(repoRoot, zipPath)}`);
  console.log(`Created ${relative(repoRoot, `${zipPath}.sha256`)}`);
  console.log(`Created ${relative(repoRoot, metadataPath)}`);
}

main();

function optionalMetadataField(key, value) {
  if (typeof value !== "string" || !value.trim()) {
    return {};
  }

  return { [key]: value.trim() };
}
