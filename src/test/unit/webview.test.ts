import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, it } from "node:test";

class Element {
  readonly attributes: Record<string, string> = {};
  readonly children: Element[] = [];
  readonly dataset: Record<string, string> = {};
  readonly listeners: Record<string, Array<(event: MockEvent) => void>> = {};
  className = "";
  disabled = false;
  hidden = false;
  open = false;
  textContent = "";
  title = "";
  type = "";
  value = "";

  constructor(readonly tagName: string) {}

  addEventListener(type: string, listener: (event: MockEvent) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  dispatch(type: string): void {
    const event: MockEvent = {
      preventDefault: () => undefined,
      stopPropagation: () => undefined
    };
    for (const listener of this.listeners[type] ?? []) {
      listener(event);
    }
  }

  append(...children: Element[]): void {
    this.children.push(...children);
  }

  replaceChildren(...children: Element[]): void {
    this.children.splice(0, this.children.length, ...children);
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
}

describe("webview renderer", () => {
  it("renders every task exactly once in direct, nested, and ungrouped folders", () => {
    const content = new Element("main");
    const elements: Record<string, Element> = {
      content,
      status: new Element("div"),
      search: new Element("input"),
      trust: new Element("div"),
      "manage-trust": new Element("button")
    };
    let receiveMessage: ((event: { data: unknown }) => void) | undefined;
    const postedMessages: unknown[] = [];
    const source = readFileSync(path.resolve(__dirname, "../../../media/main.js"), "utf8");

    vm.runInNewContext(source, {
      acquireVsCodeApi: () => ({
        getState: () => ({}),
        postMessage: (message: unknown) => postedMessages.push(message),
        setState: () => undefined
      }),
      document: {
        createElement: (tagName: string) => new Element(tagName),
        getElementById: (id: string) => elements[id],
        querySelectorAll: () => []
      },
      setInterval: () => 0,
      window: {
        addEventListener: (type: string, listener: (event: { data: unknown }) => void) => {
          if (type === "message") {
            receiveMessage = listener;
          }
        }
      }
    });

    assert.ok(receiveMessage);
    const tasks = [
      task("serve-html", "Serve HTML", ["Serve"], { running: true }),
      task("serve-docs", "Serve Documentation", ["Serve"], {
        available: false,
        disabledReason: "Could not resolve"
      }),
      task("build-customization", "Build HTML Customization", ["Build", "HTML"]),
      task("build-ignored", "Build Ignored", ["Build", "HTML"], {
        available: false,
        disabledReason: "Ignored",
        skipFolderRun: true
      }),
      task("deep-task", "Deep Task", ["One", "Two", "Three"]),
      task("ordinary", "Ordinary", ["Ungrouped"])
    ];
    receiveMessage({
      data: {
        type: "model",
        model: {
          ready: false,
          trusted: true,
          multiRoot: false,
          folderRunBlocked: false,
          tasks,
          issues: []
        }
      }
    });

    let rendered = descendants(content);
    assert.equal(rendered.filter((element) => hasClass(element, "skeleton-card")).length, tasks.length);
    assert.equal(rendered.filter((element) => element.tagName === "h3").length, 0);
    const loadingSections = rendered
      .filter((element) => element.tagName === "summary")
      .map((element) => element.textContent);
    assert.deepEqual(loadingSections, ["Serve", "Build", "HTML", "One", "Two", "Three", "Ungrouped"]);
    const loadingFolderButtons = rendered.filter((element) => hasClass(element, "folder-run"));
    assert.equal(loadingFolderButtons.length, 7);
    assert.ok(loadingFolderButtons.every((button) => button.attributes["aria-disabled"] === "true"));
    assert.equal(content.attributes["aria-busy"], "true");
    assert.equal(elements.search.disabled, true);
    assert.equal(elements.status.textContent, "Loading tasks");

    receiveMessage({
      data: {
        type: "model",
        model: {
          ready: true,
          trusted: true,
          multiRoot: false,
          folderRunBlocked: false,
          tasks,
          issues: []
        }
      }
    });

    const renderedLabels = descendants(content)
      .filter((element) => element.tagName === "h3")
      .map((element) => element.textContent)
      .sort();
    assert.deepEqual(renderedLabels, tasks.map((task) => task.label).sort());
    rendered = descendants(content);
    assert.equal(rendered.filter((element) => hasClass(element, "skeleton-card")).length, 0);
    assert.deepEqual(
      rendered.filter((element) => element.tagName === "summary").map((element) => element.textContent),
      loadingSections
    );
    assert.equal(content.attributes["aria-busy"], "false");
    assert.equal(elements.search.disabled, false);
    assert.equal(elements.status.textContent, "6 tasks shown");
    assert.equal(rendered.filter((element) => hasClass(element, "card-footer")).length, 0);
    assert.equal(rendered.filter((element) => hasClass(element, "status")).length, 0);
    assert.equal(rendered.filter((element) => hasClass(element, "stop")).length, 1);
    assert.ok(rendered.some((element) => hasClass(element, "sr-only") && element.textContent === "Running"));
    assert.equal(
      rendered.find((element) => hasClass(element, "running"))?.attributes["aria-busy"],
      "true"
    );
    assert.ok(!rendered.some((element) => element.tagName === "summary" && element.textContent === "Favorites"));

    const runSurface = rendered.find(
      (element) => hasClass(element, "card-run-surface") && element.attributes["aria-disabled"] === "false"
    );
    assert.ok(runSurface);
    runSurface.dispatch("click");
    assert.equal(runSurface.disabled, true);
    assert.match(JSON.stringify(postedMessages[postedMessages.length - 1]), /"type":"run"/);

    const folderButtons = rendered.filter((element) => hasClass(element, "folder-run"));
    assert.equal(folderButtons.length, loadingFolderButtons.length);
    const serve = rendered.find(
      (element) => element.tagName === "summary" && element.textContent === "Serve"
    );
    assert.ok(serve);
    const runServe = descendants(serve).find((element) => hasClass(element, "folder-run"));
    assert.ok(runServe);
    const serveHtml = cardFor(rendered, "Serve HTML");
    const serveDocs = cardFor(rendered, "Serve Documentation");
    runServe.dispatch("mouseenter");
    assert.ok(!hasClass(serveHtml, "folder-run-preview"));
    assert.ok(!hasClass(serveDocs, "folder-run-preview"));
    runServe.dispatch("focus");
    assert.ok(!hasClass(serveHtml, "folder-run-preview"));

    const build = rendered.find(
      (element) => element.tagName === "summary" && element.textContent === "Build"
    );
    assert.ok(build);
    const runBuild = descendants(build).find((element) => hasClass(element, "folder-run"));
    assert.ok(runBuild);
    assert.equal(runBuild.attributes["aria-disabled"], "false");
    const buildCustomization = cardFor(rendered, "Build HTML Customization");
    const buildIgnored = cardFor(rendered, "Build Ignored");
    runBuild.dispatch("mouseenter");
    assertFolderRunOrder(buildCustomization, "1");
    assert.ok(!hasClass(buildIgnored, "folder-run-preview"));
    runBuild.dispatch("mouseleave");
    assert.ok(!hasClass(buildCustomization, "folder-run-preview"));
    runBuild.dispatch("focus");
    assertFolderRunOrder(buildCustomization, "1");
    runBuild.dispatch("blur");
    assert.ok(!hasClass(buildCustomization, "folder-run-preview"));
    runBuild.dispatch("mouseenter");
    runBuild.dispatch("click");
    assert.ok(!hasClass(buildCustomization, "folder-run-preview"));
    assert.equal(
      JSON.stringify(postedMessages[postedMessages.length - 1]),
      JSON.stringify({
        type: "runFolder",
        workspaceId: "workspace",
        folderSegments: ["Build"]
      })
    );
  });

  it("supports VS Code's reduced-motion body class", () => {
    const styles = readFileSync(path.resolve(__dirname, "../../../media/styles.css"), "utf8");
    assert.match(styles, /body\.vscode-reduce-motion \.card\.running/);
    assert.match(styles, /body\.vscode-reduce-motion \.skeleton-card::after/);
    assert.match(styles, /--task-card-folder-run: var\(--vscode-testing-iconPassed/);
    assert.match(styles, /\.card\.folder-run-preview \{\s*animation: none;\s*box-shadow:/);
  });
});

interface MockEvent {
  preventDefault(): void;
  stopPropagation(): void;
}

function task(
  key: string,
  label: string,
  folderSegments: string[],
  overrides: Record<string, unknown> = {}
) {
  return {
    key,
    label,
    folderSegments,
    workspaceId: "workspace",
    workspaceName: "Example",
    searchText: label.toLocaleLowerCase(),
    available: true,
    running: false,
    skipFolderRun: false,
    confirm: false,
    ...overrides
  };
}

function descendants(root: Element): Element[] {
  return [root, ...root.children.flatMap(descendants)];
}

function hasClass(element: Element, className: string): boolean {
  return element.className.split(" ").includes(className);
}

function cardFor(elements: Element[], label: string): Element {
  const card = elements.find((element) =>
    element.tagName === "article"
    && descendants(element).some((child) => child.tagName === "h3" && child.textContent === label)
  );
  assert.ok(card);
  return card;
}

function assertFolderRunOrder(card: Element, order: string): void {
  assert.ok(hasClass(card, "folder-run-preview"));
  const badge = descendants(card).find((element) => hasClass(element, "folder-run-order"));
  assert.ok(badge);
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, order);
}
