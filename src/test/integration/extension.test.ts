import assert from "node:assert/strict";
import * as vscode from "vscode";
import { CatalogSnapshot } from "../../catalog";

interface ViewTask {
  key: string;
  label: string;
  icon?: string;
  workspaceId: string;
  available: boolean;
  running: boolean;
  folderSegments: string[];
  disabledReason?: string;
}

interface ExtensionSnapshot extends CatalogSnapshot {
  view: {
    ready: boolean;
    trusted: boolean;
    folderRunBlocked: boolean;
    tasks: ViewTask[];
  };
}

suite("Task Cards integration", () => {
  suiteSetup(async () => {
    if (process.env.TASK_CARDS_EXPECT_UNTRUSTED === "1") {
      assert.equal(vscode.workspace.isTrusted, false, "test host must be in Restricted Mode");
    }
    const extension = vscode.extensions.all.find((candidate) =>
      candidate.packageJSON.name === "task-cards"
    );
    assert.ok(extension, "Task Cards extension was not found");
    await extension.activate();
    await waitForSnapshot((snapshot) => snapshot.ready && snapshot.view.ready);
  });

  test("catalog contains only explicit workspace-folder tasks", async () => {
    const snapshot = await getSnapshot();
    assert.equal(snapshot.ready, true);
    assert.equal(snapshot.view.ready, true);
    const labels = snapshot.tasks.map((task) => task.label);
    assert.ok(labels.includes("Ordinary shell"));
    assert.ok(labels.includes("Card process"));
    assert.ok(!labels.includes("auto-only"));
    assert.ok(!labels.includes("Workspace-file-only"));
  });

  test("Restricted Mode remains read-only", async function () {
    if (vscode.workspace.isTrusted) {
      this.skip();
    }
    const snapshot = await getSnapshot();
    assert.equal(snapshot.trusted, false);
    assert.ok(snapshot.view.tasks.every((task) => !task.available));
  });

  test("task-card provider resolves both shell forms and process executions", async function () {
    if (!vscode.workspace.isTrusted) {
      this.skip();
    }
    const tasks = await vscode.tasks.fetchTasks();
    const shell = findTask(tasks, "Card shell");
    const shellLine = findTask(tasks, "Card shell line");
    const process = findTask(tasks, "Card process");
    assert.ok(shell.execution instanceof vscode.ShellExecution);
    assert.equal(shell.execution.commandLine, undefined);
    assert.equal(shell.execution.args.length, 1);
    assert.ok(shellLine.execution instanceof vscode.ShellExecution);
    assert.equal(shellLine.execution.commandLine, 'node -e "process.exit(0)"');
    assert.ok(process.execution instanceof vscode.ProcessExecution);
    assert.equal(process.presentationOptions.reveal, vscode.TaskRevealKind.Never);
    assert.equal(process.presentationOptions.panel, vscode.TaskPanelKind.Dedicated);
    if (!vscode.version.startsWith("1.96.")) {
      assert.equal(process.runOptions.reevaluateOnRerun, false);
    }
    assert.equal(await executeAndWait(shellLine), 0);
    assert.equal(await executeAndWait(process), 0);

    const snapshot = await getSnapshot();
    assert.equal(snapshot.view.tasks.find((task) => task.label === "Card shell")?.icon, "🧪");
  });

  test("identical commands with different labels remain distinct", async function () {
    if (!vscode.workspace.isTrusted) {
      this.skip();
    }
    const tasks = await vscode.tasks.fetchTasks();
    const first = tasks.filter((task) => task.definition.type === "task-card" && task.name === "Identity first");
    const second = tasks.filter((task) => task.definition.type === "task-card" && task.name === "Identity second");
    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.equal(first[0].definition.label, "Identity first");
    assert.equal(second[0].definition.label, "Identity second");
  });

  test("invalid task-card definitions remain unavailable", async function () {
    if (!vscode.workspace.isTrusted) {
      this.skip();
    }
    const snapshot = await getSnapshot();
    const invalid = snapshot.view.tasks.find((task) => task.label === "Invalid card");
    assert.match(invalid?.disabledReason ?? "", /args/);
    assert.equal(invalid?.available, false);
    const discovered = (await vscode.tasks.fetchTasks()).find((task) => task.name === "Invalid card");
    assert.equal(discovered?.execution, undefined);
  });

  test("active task state is tracked and executions can be terminated", async function () {
    if (!vscode.workspace.isTrusted) {
      this.skip();
    }
    const task = findTask(await vscode.tasks.fetchTasks(), "Card long running");
    await vscode.tasks.executeTask(task);

    const running = await waitForSnapshot((snapshot) =>
      snapshot.view.tasks.some((candidate) => candidate.label === task.name && candidate.running)
    );
    const runningTask = running.view.tasks.find((candidate) => candidate.label === task.name);
    assert.equal(runningTask?.running, true);
    assert.ok(runningTask);
    await vscode.commands.executeCommand("taskCards.stopTaskForTests", runningTask.key);

    const stopped = await waitForSnapshot((snapshot) =>
      snapshot.view.tasks.some((candidate) => candidate.key === runningTask.key && !candidate.running)
    );
    assert.equal(stopped.view.tasks.find((candidate) => candidate.label === task.name)?.running, false);
  });

  test("rapid launches start a task only once", async function () {
    if (!vscode.workspace.isTrusted) {
      this.skip();
    }
    const snapshot = await getSnapshot();
    const task = snapshot.view.tasks.find((candidate) => candidate.label === "Double launch guard");
    assert.ok(task);
    let starts = 0;
    const ended = waitForTaskEnd(task.label);
    const disposable = vscode.tasks.onDidStartTask((event) => {
      if (event.execution.task.name === task.label) {
        starts += 1;
      }
    });
    try {
      await Promise.all([
        vscode.commands.executeCommand("taskCards.runTaskForTests", task.key),
        vscode.commands.executeCommand("taskCards.runTaskForTests", task.key)
      ]);
      await ended;
    } finally {
      disposable.dispose();
    }
    assert.equal(starts, 1);
  });

  test("folder tasks run in source order, reject overlapping launches, and stop after a failure", async function () {
    if (!vscode.workspace.isTrusted) {
      this.skip();
    }

    const snapshot = await getSnapshot();
    const first = snapshot.view.tasks.find((task) => task.label === "Sequence first");
    assert.ok(first);
    const configured = snapshot.tasks.find((task) => task.label === first.label);
    assert.equal(configured?.resolved, true, configured?.error);
    assert.equal(first.available, true);
    const sequenceLabels = new Set(["Sequence first", "Sequence failure", "Sequence skipped"]);
    const started: string[] = [];
    const disposable = vscode.tasks.onDidStartTask((event) => {
      if (sequenceLabels.has(event.execution.task.name)) {
        started.push(event.execution.task.name);
      }
    });
    try {
      const folderRun = vscode.commands.executeCommand(
        "taskCards.runFolderForTests",
        first.workspaceId,
        ["Development", "Sequence"]
      );
      await waitForSnapshot((current) => current.view.folderRunBlocked);
      await Promise.all([
        vscode.commands.executeCommand(
          "taskCards.runFolderForTests",
          first.workspaceId,
          ["Development", "Sequence", "Nested"]
        ),
        vscode.commands.executeCommand("taskCards.runTaskForTests", first.key)
      ]);
      await folderRun;
    } finally {
      disposable.dispose();
    }

    assert.deepEqual(started, ["Sequence first", "Sequence failure"]);
  });

  test("folder execution completes when a running task is removed from tasks.json", async function () {
    if (!vscode.workspace.isTrusted) {
      this.skip();
    }

    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    const fileUri = vscode.Uri.joinPath(folder.uri, ".vscode", "tasks.json");
    const original = await vscode.workspace.fs.readFile(fileUri);
    const originalText = new TextDecoder().decode(original);
    const snapshot = await getSnapshot();
    const first = snapshot.view.tasks.find((task) => task.label === "Removal first");
    assert.ok(first);
    const started: string[] = [];
    const disposable = vscode.tasks.onDidStartTask((event) => {
      if (event.execution.task.name.startsWith("Removal ")) {
        started.push(event.execution.task.name);
      }
    });

    try {
      const folderRun = vscode.commands.executeCommand(
        "taskCards.runFolderForTests",
        first.workspaceId,
        ["Development", "Removal"]
      );
      await waitForSnapshot((current) =>
        current.view.tasks.some((task) => task.label === "Removal first" && task.running)
      );
      await vscode.workspace.fs.writeFile(
        fileUri,
        new TextEncoder().encode(taskFileWithout(originalText, "Removal first"))
      );
      await waitForSnapshot((current) => current.ready && !hasTask(current, "Removal first"));
      await Promise.race([
        folderRun,
        new Promise((_, reject) => setTimeout(
          () => reject(new Error("Folder run did not finish after its task was removed")),
          15000
        ))
      ]);
      assert.deepEqual(started, ["Removal first", "Removal second"]);
    } finally {
      disposable.dispose();
      await vscode.workspace.fs.writeFile(fileUri, original);
      await vscode.commands.executeCommand("taskCards.refresh");
      await waitForSnapshot((current) => current.ready && hasTask(current, "Removal first"));
    }
  });

  test("task cards refresh automatically when tasks.json changes", async function () {
    if (!vscode.workspace.isTrusted) {
      this.skip();
    }

    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    const fileUri = vscode.Uri.joinPath(folder.uri, ".vscode", "tasks.json");
    const original = await vscode.workspace.fs.readFile(fileUri);
    const originalText = new TextDecoder().decode(original);
    let document: vscode.TextDocument | undefined;

    try {
      await vscode.workspace.fs.writeFile(
        fileUri,
        new TextEncoder().encode(taskFileWith(originalText, "External refresh"))
      );
      await waitForSnapshot((snapshot) => snapshot.ready && hasTask(snapshot, "External refresh"));

      await vscode.workspace.fs.delete(fileUri);
      await waitForSnapshot((snapshot) => snapshot.ready && snapshot.tasks.length === 0);

      await vscode.workspace.fs.writeFile(fileUri, original);
      await waitForSnapshot((snapshot) => snapshot.ready && hasTask(snapshot, "Card process"));

      document = await vscode.workspace.openTextDocument(fileUri);
      await replaceAndSave(document, taskFileWith(originalText, "Saved refresh"));
      const added = await waitForSnapshot((snapshot) =>
        hasTask(snapshot, "Saved refresh")
        && snapshot.view.tasks.some((task) => task.label === "Saved refresh" && task.available)
      );
      assert.equal(added.tasks.find((task) => task.label === "Saved refresh")?.resolved, true);
      await executeAndWait(findTask(await vscode.tasks.fetchTasks(), "Saved refresh"));

      await replaceAndSave(document, taskFileWith(originalText, "Stale refresh"));
      await replaceAndSave(document, taskFileWith(originalText, "Latest refresh"));
      await waitForSnapshot((snapshot) =>
        snapshot.ready && hasTask(snapshot, "Latest refresh") && !hasTask(snapshot, "Stale refresh")
      );

      await replaceAndSave(document, originalText);
      await waitForSnapshot((snapshot) => snapshot.ready && !hasTask(snapshot, "Latest refresh"));
    } finally {
      if (document) {
        await replaceAndSave(document, originalText);
      } else {
        await vscode.workspace.fs.writeFile(fileUri, original);
      }
      await vscode.commands.executeCommand("taskCards.refresh");
    }
  });
});

async function getSnapshot(): Promise<ExtensionSnapshot> {
  const snapshot = await vscode.commands.executeCommand<ExtensionSnapshot>("taskCards.getSnapshot");
  assert.ok(snapshot);
  return snapshot;
}

async function waitForSnapshot(
  predicate: (snapshot: ExtensionSnapshot) => boolean
): Promise<ExtensionSnapshot> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const snapshot = await getSnapshot();
    if (predicate(snapshot)) {
      return snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("Task Cards did not refresh within five seconds");
}

function hasTask(snapshot: ExtensionSnapshot, label: string): boolean {
  return snapshot.tasks.some((task) => task.label === label);
}

function taskFileWith(originalText: string, label: string): string {
  const taskFile = JSON.parse(originalText) as {
    version: string;
    tasks: Array<Record<string, unknown>>;
  };
  taskFile.tasks.push({
    label,
    type: "task-card",
    command: "git",
    args: ["-c", `taskcards.label=${label}`, "--version"],
    execution: "process",
    confirm: false,
    problemMatcher: []
  });
  return `${JSON.stringify(taskFile, null, 2)}\n`;
}

function taskFileWithout(originalText: string, label: string): string {
  const taskFile = JSON.parse(originalText) as {
    version: string;
    tasks: Array<Record<string, unknown>>;
  };
  taskFile.tasks = taskFile.tasks.filter((task) => task.label !== label);
  return `${JSON.stringify(taskFile, null, 2)}\n`;
}

async function replaceAndSave(document: vscode.TextDocument, text: string): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
    text
  );
  assert.equal(await vscode.workspace.applyEdit(edit), true);
  assert.equal(await document.save(), true);
}

function findTask(tasks: readonly vscode.Task[], label: string): vscode.Task {
  const task = tasks.find((candidate) =>
    candidate.definition.type === "task-card"
    && candidate.name === label
  );
  assert.ok(task, `${label} was not discovered`);
  return task;
}

async function executeAndWait(task: vscode.Task): Promise<number | undefined> {
  const ended = new Promise<number | undefined>((resolve) => {
    const disposable = vscode.tasks.onDidEndTaskProcess((event) => {
      if (event.execution.task.name === task.name) {
        disposable.dispose();
        resolve(event.exitCode);
      }
    });
  });
  await vscode.tasks.executeTask(task);
  return ended;
}

function waitForTaskEnd(label: string): Promise<void> {
  return new Promise((resolve) => {
    const disposable = vscode.tasks.onDidEndTask((event) => {
      if (event.execution.task.name === label) {
        disposable.dispose();
        resolve();
      }
    });
  });
}
