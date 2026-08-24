import * as vscode from "vscode";
import { TaskCatalog } from "./catalog";
import { TaskCardTaskProvider } from "./taskProvider";
import { TaskCardsViewProvider } from "./viewProvider";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const catalog = new TaskCatalog();
  context.subscriptions.push(catalog);

  await catalog.loadRaw();
  context.subscriptions.push(
    vscode.tasks.registerTaskProvider("task-card", new TaskCardTaskProvider(catalog))
  );

  const viewProvider = new TaskCardsViewProvider(context, catalog);
  context.subscriptions.push(
    viewProvider,
    vscode.window.registerWebviewViewProvider(
      "taskCards.view",
      viewProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    ),
    vscode.commands.registerCommand("taskCards.refresh", () => catalog.refresh()),
    vscode.workspace.onDidGrantWorkspaceTrust(() => catalog.refresh())
  );

  if (context.extensionMode === vscode.ExtensionMode.Test) {
    context.subscriptions.push(
      vscode.commands.registerCommand("taskCards.getSnapshot", () => ({
        ...catalog.snapshot(),
        view: viewProvider.getModelForTests()
      })),
      vscode.commands.registerCommand(
        "taskCards.runTaskForTests",
        (key: string) => viewProvider.runTaskForTests(key)
      ),
      vscode.commands.registerCommand(
        "taskCards.stopTaskForTests",
        (key: string) => viewProvider.stopTaskForTests(key)
      ),
      vscode.commands.registerCommand(
        "taskCards.runFolderForTests",
        (workspaceId: string, folderSegments: string[]) =>
          viewProvider.runFolderForTests(workspaceId, folderSegments)
      )
    );
  }

  catalog.startWatching(context);

  // fetchTasks waits for task-provider activation, including this extension.
  // Defer discovery until this activation promise has returned to avoid a cycle.
  const initialResolve = setTimeout(() => {
    void catalog.refresh();
  }, 0);
  context.subscriptions.push({
    dispose: () => clearTimeout(initialResolve)
  });
}
