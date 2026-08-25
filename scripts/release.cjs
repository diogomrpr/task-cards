"use strict";

const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const version = process.argv[2];

if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  stop("Usage: node scripts/release.cjs <major.minor.patch>");
}

const tag = `v${version}`;
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const changelog = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");

if (packageJson.version !== version) {
  stop(`package.json is version ${packageJson.version}; expected ${version}.`);
}
if (!new RegExp(`^## ${version.replaceAll(".", "\\.")}$`, "m").test(changelog)) {
  stop(`CHANGELOG.md has no ${version} release entry.`);
}
if (run("git", ["branch", "--show-current"], true) !== "main") {
  stop("Releases must be created from main.");
}
if (run("git", ["status", "--porcelain"], true)) {
  stop("Commit all release changes before running this command.");
}

run("git", ["fetch", "origin"]);
const [, behind] = run("git", ["rev-list", "--left-right", "--count", "HEAD...origin/main"], true)
  .split(/\s+/)
  .map(Number);
if (behind !== 0) {
  stop("origin/main has commits that are not local. Update main before releasing.");
}
if (run("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`], true)) {
  stop(`${tag} already exists on GitHub.`);
}

const localTag = run("git", ["tag", "--list", tag], true);
if (localTag && run("git", ["rev-list", "-n", "1", tag], true) !== run("git", ["rev-parse", "HEAD"], true)) {
  stop(`${tag} already points to a different commit.`);
}

const vsix = path.join(root, `task-cards-${version}.vsix`);
if (!existsSync(vsix)) {
  stop(`Build the release package first: ${vsix}`);
}
if (!localTag) {
  run("git", ["tag", tag]);
}
run("git", ["push", "--atomic", "origin", "main", tag]);

console.log(`\nReleased ${tag} to GitHub.`);
console.log(`Upload ${vsix} through the Marketplace management page.`);

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit"
  });
  if (result.error) {
    stop(result.error.message);
  }
  if (result.status !== 0) {
    const detail = capture ? result.stderr.trim() : "";
    stop(detail || `${command} ${args.join(" ")} failed.`);
  }
  return capture ? result.stdout.trim() : "";
}

function stop(message) {
  console.error(`Release stopped: ${message}`);
  process.exit(1);
}
