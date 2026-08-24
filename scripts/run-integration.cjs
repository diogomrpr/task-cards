const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { downloadAndUnzipVSCode } = require("@vscode/test-electron");

const mode = process.argv[2];
if (!new Set(["trusted", "untrusted", "minimum"]).has(mode)) {
  throw new Error("Expected integration mode: trusted, untrusted, or minimum.");
}

async function main() {
  const root = path.resolve(__dirname, "..");
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "task-cards-test-"));
  const workspace = path.join(temporaryRoot, "workspace");
  const userData = path.join(temporaryRoot, "user-data");
  const extensions = path.join(temporaryRoot, "extensions");
  fs.cpSync(path.join(root, "test", "fixtures", "workspace"), workspace, { recursive: true });
  fs.mkdirSync(userData);
  fs.mkdirSync(extensions);

  try {
    const executable = await downloadAndUnzipVSCode({
      version: mode === "minimum" ? "1.96.0" : (process.env.VSCODE_TEST_VERSION || "stable"),
      extensionDevelopmentPath: root
    });
    const runner = path.join(path.dirname(require.resolve("@vscode/test-cli")), "runner.cjs");
    const testFile = path.join(root, "out", "test", "integration", "extension.test.js");
    const args = [
      workspace,
      "--no-sandbox",
      "--disable-gpu-sandbox",
      "--disable-updates",
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-extensions",
      `--user-data-dir=${userData}`,
      `--extensions-dir=${extensions}`,
      `--extensionDevelopmentPath=${root}`,
      `--extensionTestsPath=${runner}`
    ];
    if (mode !== "untrusted") {
      args.push("--disable-workspace-trust");
    }

    const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
    const env = {
      ...process.env,
      VSCODE_TEST_OPTIONS: JSON.stringify({
        mochaOpts: { timeout: 30000 },
        colorDefault: false,
        preload: [],
        files: [testFile]
      })
    };
    env[pathKey] = `${path.dirname(process.execPath)}${path.delimiter}${env[pathKey] ?? ""}`;
    delete env.ELECTRON_RUN_AS_NODE;
    if (mode === "untrusted") {
      env.TASK_CARDS_EXPECT_UNTRUSTED = "1";
    } else {
      delete env.TASK_CARDS_EXPECT_UNTRUSTED;
    }
    const child = spawn(executable, args, { env, stdio: "inherit" });
    const exitCode = await waitForExit(child, 120000);
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function waitForExit(child, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`VS Code integration test timed out after ${timeout / 1000} seconds.`));
    }, timeout);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
