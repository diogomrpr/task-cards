(function () {
  const vscode = acquireVsCodeApi();
  const content = document.getElementById("content");
  const status = document.getElementById("status");
  const search = document.getElementById("search");
  const trust = document.getElementById("trust");
  const manageTrust = document.getElementById("manage-trust");
  const saved = vscode.getState() || {};
  let model = { ready: false, trusted: false, multiRoot: false, tasks: [], issues: [] };
  let collapsed = saved.collapsed || {};
  const renderedCards = new Map();

  search.value = saved.query || "";
  search.addEventListener("input", () => {
    vscode.setState({ query: search.value, collapsed });
    render();
  });
  manageTrust.addEventListener("click", () => vscode.postMessage({ type: "manageTrust" }));

  window.addEventListener("message", (event) => {
    if (event.data?.type !== "model") {
      return;
    }
    model = event.data.model;
    render();
  });

  vscode.postMessage({ type: "ready" });

  function render() {
    renderedCards.clear();
    content.replaceChildren();
    content.setAttribute("aria-busy", String(!model.ready));
    search.disabled = !model.ready;
    const query = search.value.trim().toLocaleLowerCase();

    if (!model.ready) {
      trust.hidden = true;
      status.textContent = "Loading tasks";
      content.append(...loadingSkeleton(query));
      return;
    }

    trust.hidden = model.trusted;
    const tasks = model.tasks.filter((task) => !query || task.searchText.includes(query));
    status.textContent = `${tasks.length} task${tasks.length === 1 ? "" : "s"} shown`;

    if (model.issues.length > 0) {
      content.append(section("Configuration issues", "issues", model.issues.map(issueCard), true));
    }

    content.append(...taskSections(tasks, query, card));

    if (tasks.length === 0 && model.issues.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = query
        ? "No tasks match your search."
        : "No tasks found in .vscode/tasks.json.";
      content.append(empty);
    }
  }

  function loadingSkeleton(query) {
    const children = [];
    if (model.issues.length > 0) {
      children.push(section("Configuration issues", "issues", model.issues.map(issueCard), true));
    }

    const tasks = model.tasks.filter((task) => !query || task.searchText.includes(query));
    children.push(...taskSections(tasks, query, skeletonCard));
    if (tasks.length === 0 && model.issues.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Loading tasks…";
      children.push(empty);
    }
    return children;
  }

  function taskSections(tasks, query, cardRenderer) {
    const children = [];
    const workspaces = groupBy(tasks, (task) => task.workspaceId);
    for (const [workspaceId, workspaceTasks] of workspaces) {
      const workspaceName = workspaceTasks[0].workspaceName;
      const workspaceKey = `workspace:${workspaceId}`;
      const folders = renderFolderChildren(
        folderTree(workspaceTasks),
        workspaceKey,
        query,
        cardRenderer,
        workspaceId
      );
      if (model.multiRoot) {
        children.push(section(workspaceName, workspaceKey, folders, true));
      } else {
        children.push(...folders);
      }
    }
    return children;
  }

  function skeletonCard(task) {
    const placeholder = document.createElement("article");
    placeholder.className = "card skeleton-card";
    placeholder.setAttribute("aria-hidden", "true");

    if (task.icon) {
      const icon = document.createElement("span");
      icon.className = "skeleton-block skeleton-icon";
      placeholder.append(icon);
    }

    const copy = document.createElement("span");
    copy.className = "skeleton-copy";
    const first = document.createElement("span");
    first.className = "skeleton-block skeleton-line";
    const second = document.createElement("span");
    second.className = "skeleton-block skeleton-line short";
    copy.append(first, second);
    placeholder.append(copy);

    if (task.confirm) {
      const confirmation = document.createElement("span");
      confirmation.className = "skeleton-block skeleton-action";
      placeholder.append(confirmation);
    }
    if (task.running) {
      const stop = document.createElement("span");
      stop.className = "skeleton-block skeleton-action skeleton-stop";
      placeholder.append(stop);
    }

    return placeholder;
  }

  function section(title, key, children, openByDefault, summaryAction) {
    const details = document.createElement("details");
    details.className = "section";
    details.open = isOpen(key, openByDefault);
    details.addEventListener("toggle", () => saveOpen(key, details.open));

    const summary = document.createElement("summary");
    summary.textContent = title;
    if (summaryAction) {
      summary.append(summaryAction);
    }
    details.append(summary);

    const body = document.createElement("div");
    body.className = "section-body";
    body.append(...children);
    details.append(body);
    return details;
  }

  function renderFolderChildren(
    node,
    path,
    query,
    cardRenderer,
    workspaceId,
    folderSegments = []
  ) {
    const children = [];
    for (const [name, child] of node.children) {
      const key = `${path}/${name}`;
      const childFolderSegments = [...folderSegments, name];
      children.push(section(
        name,
        key,
        renderFolderChildren(
          child,
          key,
          query,
          cardRenderer,
          workspaceId,
          childFolderSegments
        ),
        query ? true : name === "Ungrouped",
        folderRunButton(name, workspaceId, childFolderSegments)
      ));
    }
    children.push(...node.tasks.map(cardRenderer));
    return children;
  }

  function folderRunButton(name, workspaceId, folderSegments) {
    const tasks = model.tasks.filter((task) =>
      task.workspaceId === workspaceId
      && !task.skipFolderRun
      && folderSegments.every((segment, index) => task.folderSegments[index] === segment)
    );
    const canRun = model.ready
      && !model.folderRunBlocked
      && tasks.length > 0
      && tasks.every((task) => task.available && !task.disabledReason && !task.running);
    const label = `Run all tasks in ${name}`;
    const run = action("▶", label, (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (canRun) {
        run.disabled = true;
        run.setAttribute("aria-disabled", "true");
        clearFolderRunOrder();
        vscode.postMessage({ type: "runFolder", workspaceId, folderSegments });
      }
    });
    run.className += " folder-run";
    run.setAttribute("aria-disabled", String(!canRun));
    run.title = canRun ? `${label} in tasks.json order` : folderUnavailableReason(tasks);
    if (canRun) {
      run.addEventListener("mouseenter", () => showFolderRunOrder(tasks));
      run.addEventListener("mouseleave", clearFolderRunOrder);
      run.addEventListener("focus", () => showFolderRunOrder(tasks));
      run.addEventListener("blur", clearFolderRunOrder);
    }
    return run;
  }

  function showFolderRunOrder(tasks) {
    clearFolderRunOrder();
    tasks.forEach((task, index) => {
      const rendered = renderedCards.get(task.key);
      if (!rendered) {
        return;
      }
      rendered.article.className += " folder-run-preview";
      rendered.order.hidden = false;
      rendered.order.textContent = String(index + 1);
      rendered.order.setAttribute("aria-label", `Folder run order ${index + 1}`);
    });
  }

  function clearFolderRunOrder() {
    for (const rendered of renderedCards.values()) {
      rendered.article.className = rendered.article.className
        .split(" ")
        .filter((name) => name !== "folder-run-preview")
        .join(" ");
      rendered.order.hidden = true;
    }
  }

  function folderUnavailableReason(tasks) {
    if (!model.ready) {
      return "Tasks are still loading";
    }
    if (tasks.length === 0) {
      return "No tasks are included in this folder run";
    }
    if (!model.trusted) {
      return "Trust this workspace before running tasks";
    }
    if (model.folderRunBlocked) {
      return "Wait for the active task or folder run to finish";
    }
    const blocked = tasks.find((task) => task.running || task.disabledReason || !task.available);
    if (blocked?.running) {
      return `Wait for ${blocked.label} to finish`;
    }
    return blocked?.disabledReason || "One or more tasks are unavailable";
  }

  function card(task) {
    const canRun = task.available && !task.disabledReason && !task.running;
    const article = document.createElement("article");
    article.className = `card${canRun ? " clickable" : ""}${task.running ? " running" : ""}${task.disabledReason ? " disabled" : ""}`;
    article.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      vscode.postMessage({ type: "contextMenu", key: task.key });
    });

    if (!task.running) {
      const runSurface = document.createElement("button");
      runSurface.type = "button";
      runSurface.className = "card-run-surface";
      runSurface.setAttribute("aria-label", canRun ? `Run ${task.label}` : `${task.label} is unavailable`);
      runSurface.setAttribute("aria-disabled", String(!canRun));
      runSurface.title = canRun ? `Run ${task.label}` : (task.unavailableReason || "Task unavailable");
      if (canRun) {
        runSurface.addEventListener("click", () => {
          runSurface.disabled = true;
          runSurface.setAttribute("aria-disabled", "true");
          vscode.postMessage({ type: "run", key: task.key });
        });
      }
      article.append(runSurface);
    }

    const heading = document.createElement("div");
    heading.className = "card-heading";
    if (task.icon) {
      const icon = document.createElement("span");
      icon.className = "card-icon";
      icon.textContent = task.icon;
      icon.setAttribute("aria-hidden", "true");
      heading.append(icon);
    }
    const title = document.createElement("h3");
    title.textContent = task.label;
    title.title = task.label;
    heading.append(title);
    const order = document.createElement("span");
    order.className = "folder-run-order";
    order.hidden = true;
    heading.append(order);
    if (task.confirm) {
      const confirmation = document.createElement("span");
      confirmation.className = "confirmation-indicator";
      confirmation.textContent = "!";
      confirmation.title = "Confirmation required";
      confirmation.setAttribute("aria-label", "Confirmation required");
      heading.append(confirmation);
    }
    if (task.running) {
      article.setAttribute("aria-busy", "true");
      const runningStatus = document.createElement("span");
      runningStatus.className = "sr-only";
      runningStatus.textContent = "Running";
      heading.append(runningStatus);
      const stop = action("■", `Stop ${task.label}`, () => vscode.postMessage({ type: "stop", key: task.key }));
      stop.className += " stop";
      heading.append(stop);
    }
    article.append(heading);
    renderedCards.set(task.key, { article, order });
    return article;
  }

  function issueCard(issue) {
    const article = document.createElement("article");
    article.className = "card issue";
    const title = document.createElement("h3");
    title.textContent = issue.workspaceName;
    title.title = issue.workspaceName;
    const message = document.createElement("p");
    message.className = "error";
    message.textContent = issue.message;
    message.title = issue.message;
    const open = action("↗", "Open tasks.json", () => {
      vscode.postMessage({ type: "openIssue", issue: issue.index });
    });
    article.append(title, message, open);
    return article;
  }

  function action(text, label, listener) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-button";
    button.textContent = text;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.addEventListener("click", listener);
    return button;
  }

  function folderTree(tasks) {
    const root = { children: new Map(), tasks: [] };
    for (const task of tasks) {
      let current = root;
      for (const segment of task.folderSegments) {
        if (!current.children.has(segment)) {
          current.children.set(segment, { children: new Map(), tasks: [] });
        }
        current = current.children.get(segment);
      }
      current.tasks.push(task);
    }
    return root;
  }

  function groupBy(items, key) {
    const result = new Map();
    for (const item of items) {
      const value = key(item);
      const group = result.get(value) || [];
      group.push(item);
      result.set(value, group);
    }
    return result;
  }

  function isOpen(key, defaultValue) {
    return Object.prototype.hasOwnProperty.call(collapsed, key)
      ? !collapsed[key]
      : defaultValue;
  }

  function saveOpen(key, open) {
    collapsed[key] = !open;
    vscode.setState({ query: search.value, collapsed });
  }

})();
