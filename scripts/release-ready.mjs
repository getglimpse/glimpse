import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";

function commandInvocation(name, args) {
  if (isWindows && name === "pnpm") {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "pnpm.cmd", ...args],
    };
  }

  return { command: resolveCommand(name), args };
}

function resolveCommand(name) {
  if (isWindows && name === "gitleaks") {
    const wingetPackagesDir = process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Packages")
      : null;

    if (wingetPackagesDir && existsSync(wingetPackagesDir)) {
      for (const entry of readdirSync(wingetPackagesDir, {
        withFileTypes: true,
      })) {
        if (!entry.isDirectory() || !entry.name.startsWith("Gitleaks.Gitleaks_")) {
          continue;
        }

        const candidate = join(wingetPackagesDir, entry.name, "gitleaks.exe");

        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }

  return name;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, options = {}) {
  const printable = [command, ...args].join(" ");
  const invocation = commandInvocation(command, args);
  console.log(`\n==> ${printable}`);

  const result = spawnSync(invocation.command, invocation.args, {
    cwd: repoRoot,
    env: { ...process.env, ...options.env },
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    fail(`Failed to run ${printable}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(`${printable} failed with exit code ${result.status}`);
  }
}

function probe(command, args = ["--version"]) {
  const invocation = commandInvocation(command, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: repoRoot,
    stdio: "ignore",
    shell: false,
  });

  return {
    ok: !result.error && result.status === 0,
    error: result.error,
    status: result.status,
  };
}

function requireCommand(command, installHint) {
  const result = probe(command);

  if (result.ok) {
    return;
  }

  if (result.error?.code === "EPERM") {
    fail(
      `Cannot execute required command: ${command}\nThe command exists, but this environment refused to run it. Try from a normal terminal or CI.`,
    );
  }

  if (result.error?.code === "ENOENT") {
    fail(`Missing required command: ${command}\n${installHint}`);
  }

  fail(
    `Required command failed: ${command}\n${installHint}`,
  );
}

function requireCleanWorktree() {
  const unstaged = spawnSync("git", ["diff", "--quiet", "--", "."], {
    cwd: repoRoot,
    stdio: "ignore",
    shell: false,
  });
  const staged = spawnSync("git", ["diff", "--cached", "--quiet", "--", "."], {
    cwd: repoRoot,
    stdio: "ignore",
    shell: false,
  });

  if (unstaged.status !== 0 || staged.status !== 0) {
    console.error(
      "Working tree has uncommitted changes. Commit or stash them before release.",
    );
    run("git", ["status", "--short"]);
    process.exit(1);
  }
}

requireCommand("git", "Install Git and ensure it is available on PATH.");
requireCommand("pnpm", "Install pnpm and run pnpm install --frozen-lockfile.");
requireCommand("cargo", "Install Rust and Cargo.");
requireCommand("gitleaks", "Install gitleaks before release secret scanning.");

const cargoAudit = probe("cargo", ["audit", "--version"]);

if (!cargoAudit.ok) {
  if (cargoAudit.error?.code === "EPERM") {
    fail(
      "Cannot execute required Cargo subcommand: cargo audit\nThe command exists, but this environment refused to run it. Try from a normal terminal or CI.",
    );
  }

  fail(
    "Missing required Cargo subcommand: cargo audit\nInstall it with: cargo install cargo-audit --locked",
  );
}

console.log(`Running Glimpse release readiness checks from ${repoRoot}`);

run("git", ["diff", "--check"]);
run("pnpm", ["audit", "--prod"], {
  env: {
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ""}--use-system-ca`,
  },
});
run("cargo", ["audit", "--file", "src-tauri/Cargo.lock"]);
run("gitleaks", ["detect", "--source", repoRoot, "--no-banner", "--redact"]);
run("pnpm", ["build"]);
run("cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml"]);

if (existsSync(resolve(repoRoot, ".plugins/scripts/validate-registry.mjs"))) {
  console.log("\n==> validate public plugin registry");
  const result = spawnSync("node", ["scripts/validate-registry.mjs"], {
    cwd: resolve(repoRoot, ".plugins"),
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    fail(`Failed to validate public plugin registry: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(`Public plugin registry validation failed with exit code ${result.status}`);
  }
}

requireCleanWorktree();

console.log("\nRelease readiness checks passed. It is OK to create the release.");
