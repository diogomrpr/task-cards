import {
  findNodeAtLocation,
  getNodeValue,
  Node as JsonNode,
  parseTree,
  ParseError,
  printParseErrorCode
} from "jsonc-parser";

export type Confirmation = boolean | string;
export type ExecutionKind = "shell" | "process";

export interface TaskCommandOptions {
  cwd?: string;
  env?: Record<string, string>;
  shell?: {
    executable?: string;
    args?: string[];
  };
}

export interface TaskCardDefinitionData {
  label: string;
  command?: string;
  args?: string[];
  execution?: ExecutionKind;
  folder?: string;
  icon?: string;
  confirm?: Confirmation;
}

export interface ParsedTask {
  key: string;
  workspaceId: string;
  workspaceName: string;
  label: string;
  type: string;
  command?: string;
  args: string[];
  execution: ExecutionKind;
  options?: TaskCommandOptions;
  folderSegments: string[];
  icon?: string;
  confirm: Confirmation;
  detail?: string;
  taskCardDefinition?: TaskCardDefinitionData;
  labelOffset: number;
  labelLength: number;
  error?: string;
}

export interface TaskFileIssue {
  fileUri: string;
  workspaceName: string;
  message: string;
  offset: number;
  length: number;
}

export interface ParsedTaskFile {
  tasks: ParsedTask[];
  issues: TaskFileIssue[];
  hasSyntaxErrors: boolean;
}

export function createTaskKey(workspaceId: string, type: string, label: string): string {
  return JSON.stringify([workspaceId, type, label]);
}

export function normalizeFolder(folder: unknown): string[] {
  if (typeof folder !== "string") {
    return [];
  }

  return folder
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function taskSearchText(task: Pick<ParsedTask, "label" | "detail" | "type" | "folderSegments" | "workspaceName">): string {
  return [
    task.label,
    task.detail ?? "",
    task.type,
    task.folderSegments.join("/"),
    task.workspaceName
  ].join(" ").toLocaleLowerCase();
}

export function parseTaskFile(
  text: string,
  workspaceId: string,
  workspaceName: string,
  fileUri: string
): ParsedTaskFile {
  const parseErrors: ParseError[] = [];
  const root = parseTree(text, parseErrors, {
    allowTrailingComma: true,
    disallowComments: false
  });
  const issues = parseErrors.map((error) => ({
    fileUri,
    workspaceName,
    message: `Invalid tasks.json: ${printParseErrorCode(error.error)}.`,
    offset: error.offset,
    length: Math.max(error.length, 1)
  }));
  const result: ParsedTaskFile = {
    tasks: [],
    issues,
    hasSyntaxErrors: parseErrors.length > 0
  };

  if (!root) {
    if (issues.length === 0) {
      issues.push({
        fileUri,
        workspaceName,
        message: "tasks.json is empty.",
        offset: 0,
        length: 0
      });
    }
    return result;
  }

  const tasksNode = findNodeAtLocation(root, ["tasks"]);
  if (!tasksNode || tasksNode.type !== "array") {
    issues.push({
      fileUri,
      workspaceName,
      message: 'tasks.json must contain a "tasks" array.',
      offset: root.offset,
      length: root.length
    });
    return result;
  }

  for (let index = 0; index < (tasksNode.children?.length ?? 0); index += 1) {
    const node = tasksNode.children![index];
    const raw = getNodeValue(node) as Record<string, unknown> | undefined;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      issues.push(issueForNode(fileUri, workspaceName, "Task entries must be objects.", node));
      continue;
    }

    if (typeof raw.label !== "string" || raw.label.trim() === "") {
      issues.push(issueForNode(fileUri, workspaceName, 'Each task must have a non-empty "label".', node));
      continue;
    }

    const label = raw.label;
    const type = typeof raw.type === "string" ? raw.type : "shell";
    const labelNode = findNodeAtLocation(root, ["tasks", index, "label"]);
    const labelRange = stringContentRange(labelNode ?? node);
    const task: ParsedTask = {
      key: createTaskKey(workspaceId, type, label),
      workspaceId,
      workspaceName,
      label,
      type,
      command: typeof raw.command === "string" ? raw.command : undefined,
      args: stringArray(raw.args),
      execution: raw.execution === "process" ? "process" : "shell",
      options: commandOptions(raw.options),
      folderSegments: type === "task-card" ? normalizeFolder(raw.folder) : [],
      icon: type === "task-card" && typeof raw.icon === "string" ? raw.icon : undefined,
      confirm: type === "task-card" && (typeof raw.confirm === "boolean" || typeof raw.confirm === "string")
        ? raw.confirm
        : false,
      detail: typeof raw.detail === "string" ? raw.detail : undefined,
      taskCardDefinition: type === "task-card" ? taskCardDefinition(raw, label) : undefined,
      labelOffset: labelRange.offset,
      labelLength: labelRange.length
    };

    if (type === "task-card") {
      if (!task.command?.trim()) {
        task.error = 'Task-card tasks require a non-empty string "command".';
      } else if (raw.args !== undefined && !isStringArray(raw.args)) {
        task.error = '"args" must be an array of strings.';
      } else if (raw.execution !== undefined && raw.execution !== "shell" && raw.execution !== "process") {
        task.error = '"execution" must be "shell" or "process".';
      } else if (raw.folder !== undefined && typeof raw.folder !== "string") {
        task.error = '"folder" must be a string.';
      } else if (raw.icon !== undefined && typeof raw.icon !== "string") {
        task.error = '"icon" must be a string.';
      } else if (raw.confirm !== undefined && typeof raw.confirm !== "boolean" && typeof raw.confirm !== "string") {
        task.error = '"confirm" must be a boolean or a string.';
      }
    }

    result.tasks.push(task);
  }

  const duplicates = new Map<string, ParsedTask[]>();
  for (const task of result.tasks) {
    const bucket = duplicates.get(task.key) ?? [];
    bucket.push(task);
    duplicates.set(task.key, bucket);
  }
  for (const tasks of duplicates.values()) {
    if (tasks.length > 1) {
      for (const task of tasks) {
        task.error ??= `Duplicate task label "${task.label}" for type "${task.type}".`;
      }
    }
  }

  if (result.hasSyntaxErrors) {
    for (const task of result.tasks) {
      task.error ??= "Fix the syntax errors in tasks.json before running this task.";
    }
  }

  return result;
}

function issueForNode(fileUri: string, workspaceName: string, message: string, node: JsonNode): TaskFileIssue {
  return {
    fileUri,
    workspaceName,
    message,
    offset: node.offset,
    length: Math.max(node.length, 1)
  };
}

function stringContentRange(node: JsonNode): { offset: number; length: number } {
  if (node.type === "string" && node.length >= 2) {
    return {
      offset: node.offset + 1,
      length: node.length - 2
    };
  }
  return {
    offset: node.offset,
    length: node.length
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function stringArray(value: unknown): string[] {
  return isStringArray(value) ? value : [];
}

function commandOptions(value: unknown): TaskCommandOptions | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  const options: TaskCommandOptions = {};
  if (typeof raw.cwd === "string") {
    options.cwd = raw.cwd;
  }
  if (raw.env && typeof raw.env === "object" && !Array.isArray(raw.env)) {
    options.env = Object.fromEntries(
      Object.entries(raw.env as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    );
  }
  if (raw.shell && typeof raw.shell === "object" && !Array.isArray(raw.shell)) {
    const shell = raw.shell as Record<string, unknown>;
    options.shell = {
      executable: typeof shell.executable === "string" ? shell.executable : undefined,
      args: stringArray(shell.args)
    };
  }

  return options;
}

function taskCardDefinition(
  raw: Record<string, unknown>,
  label: string
): TaskCardDefinitionData {
  const definition: TaskCardDefinitionData = { label };
  if (typeof raw.command === "string") {
    definition.command = raw.command;
  }
  if (isStringArray(raw.args)) {
    definition.args = raw.args;
  }
  if (raw.execution === "shell" || raw.execution === "process") {
    definition.execution = raw.execution;
  }
  if (typeof raw.folder === "string") {
    definition.folder = raw.folder;
  }
  if (typeof raw.icon === "string") {
    definition.icon = raw.icon;
  }
  if (typeof raw.confirm === "boolean" || typeof raw.confirm === "string") {
    definition.confirm = raw.confirm;
  }
  return definition;
}
