import * as vscode from "vscode";
import {
  ParsedTask,
  ParsedTaskFile,
  parseTaskFile,
  TaskFileIssue
} from "./taskFile";

export interface CatalogTask extends ParsedTask {
  workspaceFolder: vscode.WorkspaceFolder;
  fileUriObject: vscode.Uri;
  resolvedTask?: vscode.Task;
  disabledReason?: string;
}

export interface CatalogSnapshot {
  ready: boolean;
  trusted: boolean;
  tasks: Array<{
    key: string;
    label: string;
    type: string;
    workspaceName: string;
    resolved: boolean;
    error?: string;
  }>;
  issues: TaskFileIssue[];
}

export class TaskCatalog implements vscode.Disposable {
  private readonly changedEmitter = new vscode.EventEmitter<void>();
  private readonly watchers: vscode.FileSystemWatcher[] = [];
  private tasksValue: CatalogTask[] = [];
  private issuesValue: TaskFileIssue[] = [];
  private refreshTimer: NodeJS.Timeout | undefined;
  private refreshPromise: Promise<void> | undefined;
  private refreshRequested = false;
  private readyValue = false;
  private disposed = false;

  readonly onDidChange = this.changedEmitter.event;

  get tasks(): readonly CatalogTask[] {
    return this.tasksValue;
  }

  get issues(): readonly TaskFileIssue[] {
    return this.issuesValue;
  }

  get ready(): boolean {
    return this.readyValue;
  }

  async loadRaw(): Promise<void> {
    const tasks: CatalogTask[] = [];
    const issues: TaskFileIssue[] = [];

    for (const workspaceFolder of vscode.workspace.workspaceFolders ?? []) {
      const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, ".vscode", "tasks.json");
      let bytes: Uint8Array;
      try {
        bytes = await vscode.workspace.fs.readFile(fileUri);
      } catch (error) {
        if (isFileNotFound(error)) {
          continue;
        }
        issues.push({
          fileUri: fileUri.toString(),
          workspaceName: workspaceFolder.name,
          message: `Unable to read tasks.json: ${errorMessage(error)}`,
          offset: 0,
          length: 0
        });
        continue;
      }

      const parsed: ParsedTaskFile = parseTaskFile(
        new TextDecoder().decode(bytes),
        workspaceFolder.uri.toString(),
        workspaceFolder.name,
        fileUri.toString()
      );
      issues.push(...parsed.issues);
      for (const task of parsed.tasks) {
        tasks.push({
          ...task,
          workspaceFolder,
          fileUriObject: fileUri,
          disabledReason: task.error
        });
      }
    }

    this.tasksValue = tasks;
    this.issuesValue = issues;
  }

  async resolveTasks(): Promise<void> {
    this.readyValue = false;
    this.changedEmitter.fire();

    try {
      for (const task of this.tasksValue) {
        task.resolvedTask = undefined;
        task.disabledReason = task.error;
      }

      if (!vscode.workspace.isTrusted) {
        return;
      }

      let availableTasks: vscode.Task[];
      try {
        availableTasks = await vscode.tasks.fetchTasks();
      } catch (error) {
        const reason = `Unable to load tasks from VS Code: ${errorMessage(error)}`;
        for (const task of this.tasksValue) {
          task.disabledReason ??= reason;
        }
        return;
      }

      for (const configured of this.tasksValue) {
        if (configured.disabledReason) {
          continue;
        }

        const matches = availableTasks.filter((candidate) =>
          candidate.name === configured.label
          && candidate.definition.type === configured.type
          && taskWorkspaceId(candidate) === configured.workspaceId
        );

        if (matches.length === 1) {
          configured.resolvedTask = matches[0];
        } else if (matches.length === 0) {
          configured.disabledReason = "VS Code could not resolve this configured task.";
        } else {
          configured.disabledReason = "More than one VS Code task matches this definition.";
        }
      }
    } finally {
      this.readyValue = true;
      this.changedEmitter.fire();
    }
  }

  refresh(): Promise<void> {
    this.refreshRequested = true;
    this.refreshPromise ??= this.runRefreshes();
    return this.refreshPromise;
  }

  startWatching(context: vscode.ExtensionContext): void {
    this.resetWatchers();
    context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.resetWatchers();
        this.scheduleRefresh();
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (this.isTaskFile(document.uri)) {
          this.scheduleRefresh();
        }
      })
    );
  }

  get(key: string): CatalogTask | undefined {
    return this.tasksValue.find((task) => task.key === key);
  }

  findConfiguredTask(task: vscode.Task): CatalogTask | undefined {
    const workspaceId = taskWorkspaceId(task);
    return this.tasksValue.find((candidate) =>
      candidate.workspaceId === workspaceId
      && candidate.label === task.name
      && candidate.type === task.definition.type
    );
  }

  keyForTask(task: vscode.Task): string | undefined {
    return this.findConfiguredTask(task)?.key;
  }

  snapshot(): CatalogSnapshot {
    return {
      ready: this.readyValue,
      trusted: vscode.workspace.isTrusted,
      tasks: this.tasksValue.map((task) => ({
        key: task.key,
        label: task.label,
        type: task.type,
        workspaceName: task.workspaceName,
        resolved: Boolean(task.resolvedTask),
        error: task.disabledReason
      })),
      issues: [...this.issuesValue]
    };
  }

  dispose(): void {
    this.disposed = true;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshRequested = false;
    this.resetWatchers();
    this.changedEmitter.dispose();
  }

  private async runRefreshes(): Promise<void> {
    try {
      while (this.refreshRequested && !this.disposed) {
        this.refreshRequested = false;
        await this.loadRaw();
        await this.resolveTasks();
      }
    } finally {
      this.refreshPromise = undefined;
    }
  }

  private isTaskFile(uri: vscode.Uri): boolean {
    return (vscode.workspace.workspaceFolders ?? []).some((folder) =>
      vscode.Uri.joinPath(folder.uri, ".vscode", "tasks.json").toString() === uri.toString()
    );
  }

  private resetWatchers(): void {
    while (this.watchers.length > 0) {
      this.watchers.pop()!.dispose();
    }
    if (this.disposed) {
      return;
    }

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, ".vscode/tasks.json")
      );
      watcher.onDidCreate(() => this.scheduleRefresh());
      watcher.onDidChange(() => this.scheduleRefresh());
      watcher.onDidDelete(() => this.scheduleRefresh());
      this.watchers.push(watcher);
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh();
    }, 100);
  }
}

function taskWorkspaceId(task: vscode.Task): string | undefined {
  return typeof task.scope === "object" ? task.scope.uri.toString() : undefined;
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: string }).code === "FileNotFound";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
