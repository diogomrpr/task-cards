import * as vscode from "vscode";
import { CatalogTask, TaskCatalog } from "./catalog";
import { TaskCommandOptions } from "./taskFile";

interface TaskCardDefinition extends vscode.TaskDefinition {
  label?: string;
  command?: string;
  args?: string[];
  execution?: "shell" | "process";
  folder?: string;
  icon?: string;
  skipFolderRun?: boolean;
  confirm?: string;
}

export class TaskCardTaskProvider implements vscode.TaskProvider {
  constructor(private readonly catalog: TaskCatalog) {}

  provideTasks(): vscode.Task[] {
    if (!vscode.workspace.isTrusted) {
      return [];
    }
    return this.catalog.tasks
      .filter((task) => task.type === "task-card" && !task.error && task.command)
      .map((task) => this.createTask(task));
  }

  resolveTask(task: vscode.Task): vscode.Task | undefined {
    if (!vscode.workspace.isTrusted) {
      return undefined;
    }
    const definition = task.definition as TaskCardDefinition;
    const configured = this.catalog.findConfiguredTask(task);
    if (configured?.error) {
      return undefined;
    }
    const command = configured?.command ?? definition.command;
    if (!command) {
      return undefined;
    }

    task.execution = createExecution(
      command,
      configured?.args ?? definition.args ?? [],
      configured?.execution ?? definition.execution ?? "shell",
      configured?.options
    );
    return task;
  }

  private createTask(configured: CatalogTask): vscode.Task {
    const definition: TaskCardDefinition = {
      type: "task-card",
      ...configured.taskCardDefinition
    };
    const task = new vscode.Task(
      definition,
      configured.workspaceFolder,
      configured.label,
      "Task Cards",
      createExecution(
        configured.command!,
        configured.args,
        configured.execution,
        configured.options
      )
    );
    task.detail = configured.detail;
    return task;
  }
}

function createExecution(
  command: string,
  args: string[],
  execution: "shell" | "process",
  options: TaskCommandOptions | undefined
): vscode.ShellExecution | vscode.ProcessExecution {
  return execution === "process"
    ? new vscode.ProcessExecution(command, args, processOptions(options))
    : args.length === 0
      ? new vscode.ShellExecution(command, shellOptions(options))
      : new vscode.ShellExecution(command, args, shellOptions(options));
}

function processOptions(options: TaskCommandOptions | undefined): vscode.ProcessExecutionOptions {
  return {
    cwd: options?.cwd,
    env: options?.env
  };
}

function shellOptions(options: TaskCommandOptions | undefined): vscode.ShellExecutionOptions {
  return {
    cwd: options?.cwd,
    env: options?.env,
    executable: options?.shell?.executable,
    shellArgs: options?.shell?.args
  };
}
