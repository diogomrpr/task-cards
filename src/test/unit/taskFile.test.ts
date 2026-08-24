import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createTaskKey,
  normalizeFolder,
  parseTaskFile,
  taskSearchText
} from "../../taskFile";

describe("taskFile", () => {
  it("parses JSONC, nested folders, icon, confirmation, and exact label ranges", () => {
    const text = `{
      // comments and trailing commas are valid
      "version": "2.0.0",
      "tasks": [{
        "label": "Deploy",
        "type": "task-card",
        "command": "npm",
        "folder": " Deploy // Production ",
        "icon": "🚀",
        "confirm": "Continue?",
      }],
    }`;
    const result = parseTaskFile(text, "workspace", "Example", "file:///tasks.json");

    assert.equal(result.issues.length, 0);
    assert.equal(result.tasks.length, 1);
    assert.deepEqual(result.tasks[0].folderSegments, ["Deploy", "Production"]);
    assert.equal(result.tasks[0].icon, "🚀");
    assert.equal(result.tasks[0].confirm, "Continue?");
    assert.deepEqual(result.tasks[0].taskCardDefinition, {
      label: "Deploy",
      command: "npm",
      folder: " Deploy // Production ",
      icon: "🚀",
      confirm: "Continue?"
    });
    assert.equal(
      text.slice(result.tasks[0].labelOffset, result.tasks[0].labelOffset + result.tasks[0].labelLength),
      "Deploy"
    );
  });

  it("keeps ordinary tasks ungrouped and ignores custom card metadata", () => {
    const result = parseTaskFile(`{
      "version": "2.0.0",
      "tasks": [{
        "label": "Build",
        "type": "shell",
        "command": "npm run build",
        "folder": "Ignored",
        "icon": "🔨",
        "confirm": true
      }]
    }`, "workspace", "Example", "file:///tasks.json");

    assert.deepEqual(result.tasks[0].folderSegments, []);
    assert.equal(result.tasks[0].icon, undefined);
    assert.equal(result.tasks[0].confirm, false);
  });

  it("reports syntax errors and duplicate labels as disabled tasks", () => {
    const result = parseTaskFile(`{
      "version": "2.0.0",
      "tasks": [
        { "label": "Same", "type": "shell", "command": "one" },
        { "label": "Same", "type": "shell", "command": "two" },
      ]
    }`, "workspace", "Example", "file:///tasks.json");

    assert.match(result.tasks[0].error ?? "", /Duplicate task label/);
    assert.match(result.tasks[1].error ?? "", /Duplicate task label/);
  });

  it("reports invalid JSON without throwing", () => {
    const result = parseTaskFile("{ tasks: [", "workspace", "Example", "file:///tasks.json");
    assert.equal(result.hasSyntaxErrors, true);
    assert.ok(result.issues.length > 0);
  });

  it("keeps identical commands distinct when labels differ", () => {
    const result = parseTaskFile(`{
      "version": "2.0.0",
      "tasks": [
        { "label": "First", "type": "task-card", "command": "echo same" },
        { "label": "Second", "type": "task-card", "command": "echo same" }
      ]
    }`, "workspace", "Example", "file:///tasks.json");

    assert.equal(result.tasks.length, 2);
    assert.ok(result.tasks.every((task) => !task.error));
    assert.notEqual(result.tasks[0].key, result.tasks[1].key);
  });

  it("preserves explicitly supplied task-definition defaults", () => {
    const result = parseTaskFile(`{
      "version": "2.0.0",
      "tasks": [{
        "label": "Explicit defaults",
        "type": "task-card",
        "command": "echo",
        "args": [],
        "execution": "shell",
        "folder": "",
        "icon": "",
        "confirm": false
      }]
    }`, "workspace", "Example", "file:///tasks.json");

    assert.deepEqual(result.tasks[0].taskCardDefinition, {
      label: "Explicit defaults",
      command: "echo",
      args: [],
      execution: "shell",
      folder: "",
      icon: "",
      confirm: false
    });
  });

  it("normalizes folders, creates multi-root identities, and filters search text", () => {
    assert.deepEqual(normalizeFolder(" /Deploy// Production/ "), ["Deploy", "Production"]);
    const key = createTaskKey("workspace", "task-card", "Deploy");
    assert.equal(key, '["workspace","task-card","Deploy"]');
    assert.notEqual(
      createTaskKey("file:///root-a", "task-card", "Deploy"),
      createTaskKey("file:///root-b", "task-card", "Deploy")
    );
    assert.match(taskSearchText({
      label: "Deploy",
      detail: "Production",
      type: "task-card",
      folderSegments: ["Release"],
      workspaceName: "App"
    }), /deploy production task-card release app/);
  });
});
