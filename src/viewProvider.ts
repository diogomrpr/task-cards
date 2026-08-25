import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { CatalogTask, TaskCatalog } from "./catalog";
import { confirmationPrompt, taskSearchText } from "./taskFile";

interface WebviewMessage {
  type: "ready" | "run" | "runFolder" | "stop" | "contextMenu" | "openIssue" | "manageTrust";
  key?: string;
  workspaceId?: string;
  folderSegments?: string[];
  issue?: number;
}

export class TaskCardsViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private readonly running = new Map<string, vscode.TaskExecution[]>();
  private readonly starting = new Set<string>();
  private folderRunActive = false;
  private readonly stoppingExecutions = new WeakSet<vscode.TaskExecution>();
  private readonly endedExecutions = new WeakSet<vscode.TaskExecution>();
  private readonly completedExecutions = new WeakSet<vscode.TaskExecution>();
  private readonly executionResults = new WeakMap<vscode.TaskExecution, number | undefined>();
  private readonly executionWaiters = new WeakMap<
    vscode.TaskExecution,
    (exitCode: number | undefined) => void
  >();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly catalog: TaskCatalog
  ) {
    this.disposables.push(
      catalog.onDidChange(() => {
        this.syncExistingExecutions();
        this.render();
      }),
      vscode.tasks.onDidStartTask((event) => this.taskStarted(event.execution)),
      vscode.tasks.onDidEndTaskProcess((event) => {
        this.completeExecution(event.execution, event.exitCode);
      }),
      vscode.tasks.onDidEndTask((event) => this.taskEnded(event.execution))
    );
    this.syncExistingExecutions();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "media")
      ]
    };
    view.webview.html = this.html(view.webview);
    this.disposables.push(
      view.webview.onDidReceiveMessage((message: WebviewMessage) => this.handleMessage(message)),
      view.onDidDispose(() => {
        if (this.view === view) {
          this.view = undefined;
        }
      })
    );
    this.render();
  }

  getModelForTests(): ReturnType<TaskCardsViewProvider["model"]> {
    return this.model();
  }

  runTaskForTests(key: string): Promise<void> {
    return this.runTask(key);
  }

  stopTaskForTests(key: string): void {
    this.stopTask(key);
  }

  runFolderForTests(workspaceId: string, folderSegments: string[]): Promise<void> {
    return this.runFolder(workspaceId, folderSegments);
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case "ready":
        this.render();
        break;
      case "run":
        if (message.key) {
          await this.runTask(message.key);
        }
        break;
      case "runFolder":
        if (
          typeof message.workspaceId === "string"
          && Array.isArray(message.folderSegments)
          && message.folderSegments.every((segment) => typeof segment === "string")
        ) {
          await this.runFolder(message.workspaceId, message.folderSegments);
        }
        break;
      case "stop":
        if (message.key) {
          this.stopTask(message.key);
        }
        break;
      case "contextMenu":
        if (message.key) {
          await this.showTaskMenu(message.key);
        }
        break;
      case "openIssue":
        if (typeof message.issue === "number") {
          await this.openIssue(message.issue);
        }
        break;
      case "manageTrust":
        await vscode.commands.executeCommand("workbench.trust.manage");
        break;
    }
  }

  private async runTask(key: string): Promise<void> {
    const task = this.catalog.get(key);
    if (!task) {
      return;
    }
    await this.startTask(task);
  }

  private async runFolder(workspaceId: string, folderSegments: string[]): Promise<void> {
    if (this.folderRunActive || this.starting.size > 0 || this.hasRunningTasks()) {
      return;
    }

    const tasks = this.catalog.tasks.filter((task) =>
      task.workspaceId === workspaceId
      && !task.skipFolderRun
      && folderContains(folderSegments, task.folderSegments)
    );
    if (tasks.length === 0) {
      return;
    }

    if (!this.catalog.ready) {
      return;
    }
    if (!vscode.workspace.isTrusted) {
      const choice = await vscode.window.showWarningMessage(
        "Trust this workspace before running tasks.",
        "Manage Workspace Trust"
      );
      if (choice) {
        await vscode.commands.executeCommand("workbench.trust.manage");
      }
      return;
    }
    const blocked = tasks.find((task) => !task.resolvedTask || task.disabledReason);
    if (blocked) {
      void vscode.window.showErrorMessage(
        `Unable to run folder: "${blocked.label}" is unavailable. ${blocked.disabledReason ?? ""}`.trim()
      );
      return;
    }
    if (!await this.confirmTasks(tasks, "Run Folder", true)) {
      return;
    }

    this.folderRunActive = true;
    this.render();
    try {
      for (const task of tasks) {
        const execution = await this.startTask(task, true);
        if (!execution) {
          return;
        }
        const exitCode = await this.waitForExecution(execution);
        if (exitCode !== 0) {
          const reason = exitCode === undefined
            ? "did not complete successfully"
            : `failed with exit code ${exitCode}`;
          void vscode.window.showErrorMessage(
            `"${task.label}" ${reason}. Remaining folder tasks were not run.`
          );
          return;
        }
      }
    } finally {
      this.folderRunActive = false;
      this.render();
    }
  }

  private async startTask(
    task: CatalogTask,
    fromFolder = false
  ): Promise<vscode.TaskExecution | undefined> {
    if ((!fromFolder && this.folderRunActive) || this.starting.has(task.key)) {
      return undefined;
    }
    if ((this.running.get(task.key)?.length ?? 0) > 0) {
      return undefined;
    }

    this.starting.add(task.key);
    this.render();
    try {
      if (!this.catalog.ready) {
        return undefined;
      }
      if (!vscode.workspace.isTrusted) {
        const choice = await vscode.window.showWarningMessage(
          "Trust this workspace before running tasks.",
          "Manage Workspace Trust"
        );
        if (choice) {
          await vscode.commands.executeCommand("workbench.trust.manage");
        }
        return undefined;
      }
      if (!task.resolvedTask || task.disabledReason) {
        void vscode.window.showErrorMessage(task.disabledReason ?? "This task is not available.");
        return undefined;
      }

      if (!fromFolder && !await this.confirmTasks([task], "Run Task")) {
        return undefined;
      }

      try {
        const execution = await vscode.tasks.executeTask(task.resolvedTask);
        this.trackExecution(task.key, execution);
        return execution;
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Unable to run "${task.label}": ${error instanceof Error ? error.message : String(error)}`
        );
        return undefined;
      }
    } finally {
      this.starting.delete(task.key);
      this.render();
    }
  }

  private async confirmTasks(
    tasks: readonly CatalogTask[],
    action: "Run Task" | "Run Folder",
    list = false
  ): Promise<boolean> {
    const prompt = confirmationPrompt(tasks, list);
    if (!prompt) {
      return true;
    }
    const choice = await vscode.window.showWarningMessage(
      prompt.message,
      { modal: true, detail: prompt.detail },
      action
    );
    return choice === action;
  }

  private stopTask(key: string): void {
    const runningTasks = this.running.get(key) ?? [];
    for (const execution of runningTasks) {
      this.stoppingExecutions.add(execution);
      execution.terminate();
    }
    if (runningTasks.length > 0) {
      this.running.delete(key);
      this.render();
    }
  }

  private async showTaskMenu(key: string): Promise<void> {
    const task = this.catalog.get(key);
    if (!task) {
      return;
    }
    const choice = await vscode.window.showQuickPick(
      ["Open Task Definition"],
      { placeHolder: task.label }
    );
    if (choice) {
      await this.openTask(key);
    }
  }

  private async openTask(key: string): Promise<void> {
    const task = this.catalog.get(key);
    if (!task) {
      return;
    }
    await this.openLocation(task.fileUriObject, task.labelOffset, task.labelLength);
  }

  private async openIssue(index: number): Promise<void> {
    const issue = this.catalog.issues[index];
    if (!issue) {
      return;
    }
    await this.openLocation(vscode.Uri.parse(issue.fileUri), issue.offset, issue.length);
  }

  private async openLocation(uri: vscode.Uri, offset: number, length: number): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    const selection = new vscode.Selection(
      document.positionAt(offset),
      document.positionAt(offset + length)
    );
    editor.selection = selection;
    editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  private taskStarted(execution: vscode.TaskExecution): void {
    const key = this.catalog.keyForTask(execution.task);
    if (!key) {
      return;
    }
    if (this.trackExecution(key, execution)) {
      this.render();
    }
  }

  private taskEnded(execution: vscode.TaskExecution): void {
    this.endedExecutions.add(execution);
    setTimeout(() => this.completeExecution(execution, undefined), 250);
    if (this.removeExecution(execution)) {
      this.render();
    }
  }

  private completeExecution(
    execution: vscode.TaskExecution,
    exitCode: number | undefined
  ): void {
    if (this.completedExecutions.has(execution)) {
      return;
    }
    this.completedExecutions.add(execution);
    const resolve = this.executionWaiters.get(execution);
    if (resolve) {
      this.executionWaiters.delete(execution);
      resolve(exitCode);
    } else {
      this.executionResults.set(execution, exitCode);
    }
  }

  private waitForExecution(execution: vscode.TaskExecution): Promise<number | undefined> {
    if (this.completedExecutions.has(execution)) {
      const result = this.executionResults.get(execution);
      this.executionResults.delete(execution);
      return Promise.resolve(result);
    }
    return new Promise((resolve) => this.executionWaiters.set(execution, resolve));
  }

  private syncExistingExecutions(): void {
    for (const execution of vscode.tasks.taskExecutions) {
      const key = this.catalog.keyForTask(execution.task);
      if (!key) {
        continue;
      }
      this.trackExecution(key, execution);
    }
  }

  private trackExecution(key: string, execution: vscode.TaskExecution): boolean {
    if (this.stoppingExecutions.has(execution) || this.endedExecutions.has(execution)) {
      return false;
    }
    const running = this.running.get(key) ?? [];
    if (running.includes(execution)) {
      return false;
    }
    running.push(execution);
    this.running.set(key, running);
    return true;
  }

  private removeExecution(execution: vscode.TaskExecution): boolean {
    for (const [key, running] of this.running) {
      const remaining = running.filter((candidate) => candidate !== execution);
      if (remaining.length === running.length) {
        continue;
      }
      if (remaining.length > 0) {
        this.running.set(key, remaining);
      } else {
        this.running.delete(key);
      }
      return true;
    }
    return false;
  }

  private hasRunningTasks(): boolean {
    return [...this.running.values()].some((executions) => executions.length > 0);
  }

  private render(): void {
    void this.view?.webview.postMessage({
      type: "model",
      model: this.model()
    });
  }

  private model() {
    const tasks = this.catalog.tasks.map((task) => taskModel(
      task,
      (this.running.get(task.key)?.length ?? 0) > 0,
      this.starting.has(task.key),
      this.folderRunActive
    ));

    return {
      ready: this.catalog.ready,
      trusted: vscode.workspace.isTrusted,
      multiRoot: (vscode.workspace.workspaceFolders?.length ?? 0) > 1,
      folderRunBlocked: this.folderRunActive || this.starting.size > 0 || this.hasRunningTasks(),
      tasks,
      issues: this.catalog.issues.map((issue, index) => ({
        index,
        workspaceName: issue.workspaceName,
        message: issue.message
      }))
    };
  }

  private html(webview: vscode.Webview): string {
    const media = vscode.Uri.joinPath(this.context.extensionUri, "media");
    const styles = webview.asWebviewUri(vscode.Uri.joinPath(media, "styles.css"));
    const script = webview.asWebviewUri(vscode.Uri.joinPath(media, "main.js"));
    const nonce = randomBytes(16).toString("hex");

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styles}">
  <title>Task Cards</title>
</head>
<body>
  <main>
    <label class="search">
      <span class="sr-only">Search tasks</span>
      <input id="search" type="search" placeholder="Search tasks" autocomplete="off">
    </label>
    <div id="trust" class="notice" hidden>
      <span>Restricted Mode: trust this workspace to run tasks.</span>
      <button id="manage-trust" type="button">Manage Trust</button>
    </div>
    <div id="status" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
    <div id="content"></div>
  </main>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}

function taskModel(
  task: CatalogTask,
  running: boolean,
  starting: boolean,
  folderRunActive: boolean
) {
  const trusted = vscode.workspace.isTrusted;
  const unavailableReason = task.disabledReason
    ?? (!trusted
      ? "Trust this workspace before running tasks."
      : starting
        ? "This task is starting."
        : folderRunActive
          ? "A folder run is in progress."
          : !task.resolvedTask
            ? "This task is unavailable."
            : undefined);
  return {
    key: task.key,
    label: task.label,
    icon: task.icon,
    workspaceId: task.workspaceId,
    workspaceName: task.workspaceName,
    folderSegments: task.folderSegments.length > 0 ? task.folderSegments : ["Ungrouped"],
    skipFolderRun: task.skipFolderRun,
    confirm: typeof task.confirm === "string" && task.confirm.length > 0,
    running,
    disabledReason: task.disabledReason,
    unavailableReason,
    available: Boolean(task.resolvedTask) && trusted && !running && !starting && !folderRunActive,
    searchText: taskSearchText(task)
  };
}

function folderContains(folder: readonly string[], taskFolder: readonly string[]): boolean {
  const displayedTaskFolder = taskFolder.length > 0 ? taskFolder : ["Ungrouped"];
  return folder.every((segment, index) => displayedTaskFolder[index] === segment);
}
