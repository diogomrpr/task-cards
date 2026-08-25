# Contributing to Task Cards

Thanks for helping improve Task Cards. Bug fixes, focused features, tests, documentation, and accessibility improvements are welcome.

## Project philosophy

Task Cards does one thing: it presents tasks explicitly declared in workspace-folder `.vscode/tasks.json` files and runs them through VS Code's task system.

Changes should preserve these principles:

- **Explicit over inferred.** The task file is the source of truth. Preserve its task and folder order; do not silently add auto-detected scripts, user tasks, or `.code-workspace`-only tasks.
- **VS Code-native.** Use the official task, workspace, trust, theme, and webview APIs. The extension must not become a separate task runner or spawn users' task commands itself.
- **Predictable and safe.** Keep task identity stable, preserve standard VS Code task behavior, stop folder sequences after failure, and retain the Restricted Mode execution boundary.
- **Local and private.** No telemetry, cloud service, external web request, or remotely loaded webview asset.
- **Small and dependency-light.** Prefer the existing TypeScript modules and plain HTML, CSS, and JavaScript. Add a runtime dependency or frontend framework only when a concrete requirement cannot be met cleanly with the platform or existing code.
- **Accessible and theme-aware.** Keep keyboard access, semantic controls, live status, reduced-motion support, and VS Code theme tokens working together.

These are design constraints, not a ban on larger ideas. Small fixes, tests, and documentation improvements can go directly to a pull request. Open a feature issue before implementing a change that broadens product scope, reorganizes the architecture, changes the trust or execution model, adds telemetry or network access, introduces a framework, or adds a runtime dependency. Explain the user need and why the existing design cannot meet it.

## Project structure

The runtime flow is intentionally direct:

```text
.vscode/tasks.json
  -> src/taskFile.ts
  -> src/catalog.ts
  -> src/taskProvider.ts and src/viewProvider.ts
  -> media/main.js and media/styles.css
```

| Path | Responsibility | Keep out of this layer |
| --- | --- | --- |
| `src/extension.ts` | Activation and lifecycle wiring. | Parsing, task execution logic, and UI rendering. |
| `src/taskFile.ts` | Pure JSONC parsing, validation, task identity, folder normalization, and search text. | VS Code workspace I/O and UI state. |
| `src/catalog.ts` | Workspace-folder file I/O, task resolution, refresh serialization, and file watching. | DOM rendering and task execution policy. |
| `src/taskProvider.ts` | Construction and resolution of `task-card` tasks using VS Code execution objects. | Discovery, folder sequencing, and webview behavior. |
| `src/viewProvider.ts` | Webview boundary, task/folder execution state, trust checks, and view models. | DOM construction and CSS presentation. |
| `media/main.js` | DOM rendering and small messages to the extension host. | File access, task semantics, and trusted HTML injection. Use DOM APIs and `textContent` for task-file values. |
| `media/styles.css` | Layout, themes, focus, loading, and running-state presentation. | Behavioral state and task logic. |
| `src/test/unit` | Fast checks for pure parsing and rendering behavior. | VS Code-dependent scenarios. |
| `src/test/integration` | Trusted, Restricted Mode, task lifecycle, ordering, and refresh behavior inside VS Code. | Product code used only to make tests pass. |
| `test/fixtures` | Hermetic integration-test workspaces. | Developer-specific paths, credentials, or machine state. |

Put a change in the narrowest existing layer that owns the behavior. Reuse the current modules before adding another abstraction. Keep `taskFile.ts` testable without VS Code, keep task commands inside `vscode.tasks`, and preserve the webview content security policy.

Generated `out/`, `.vscode-test/`, `*.vsix`, logs, and local environment files are intentionally ignored and must not be committed.

## Before opening an issue

- Search existing issues first.
- Use the bug or feature template.
- Remove secrets from `tasks.json`, logs, paths, and screenshots.
- Confirm the request fits the philosophy above, or explain the scope change in a feature issue.

Security vulnerabilities must follow [SECURITY.md](SECURITY.md), not a public issue.

## Community expectations

Be respectful, keep feedback specific to the work, and assume good intent. Harassment, discrimination, and personal attacks are not accepted. Maintainers may edit, hide, or close interactions that make the project unsafe or unproductive.

## Development setup

Prerequisites:

- Node.js 22
- Corepack, included with standard Node.js installations
- Official desktop VS Code 1.96 or newer

Fork and clone the repository, then install the exact locked dependencies:

```sh
corepack enable
pnpm install --frozen-lockfile
```

Create a focused branch from `main`:

```sh
git switch -c change/short-description
```

Open the repository in VS Code and press `F5`. The included launch configuration compiles the extension and starts an Extension Development Host against the hermetic fixture workspace. The repository's VS Code tasks run only project-local build, test, audit, and packaging commands.

## Checks

Run the smallest relevant check while developing, then the required pull-request checks before submitting:

| Command | Purpose |
| --- | --- |
| `pnpm run check` | Type-check without emitting files. |
| `pnpm run test:unit` | Compile and run parser and renderer unit tests. |
| `pnpm run test:integration` | Test trusted and Restricted Mode behavior in current VS Code. |
| `pnpm run test:minimum` | Test the declared minimum VS Code version. |
| `pnpm run audit` | Audit the complete dependency graph. |
| `pnpm run package` | Compile and create the installable VSIX. |

Integration tests download VS Code when the requested version is not already cached. On Linux, run them with a display wrapper:

```sh
xvfb-run -a pnpm run test:integration
```

Add or update the smallest test that demonstrates non-trivial behavior:

- Parsing, validation, folder construction, or DOM rendering belongs in a unit test.
- VS Code task resolution, trust, execution, cancellation, sequencing, or file watching belongs in an integration test.
- UI changes also need a manual check in narrow and wide sidebars, light/dark/high-contrast themes, keyboard navigation, and reduced-motion mode.

## Pull requests

1. Keep the change focused and preserve behavior outside its scope.
2. Follow the structure table above; explain any deliberate exception in the pull request.
3. Update `README.md` and `CHANGELOG.md` when behavior visible to users changes.
4. Do not include secrets, unrelated changes, generated VSIX files, or test downloads.
5. Complete the pull-request template with the checks you ran and any manual verification.

CI repeats type-checking, the full dependency audit, unit tests, trusted and Restricted Mode integration tests, minimum-version tests, and VSIX packaging on the supported platforms.

## Releases

Do not upload a new VSIX before its source is committed and ready for GitHub. Use this release flow:

1. Update the version in `package.json`, add the matching `CHANGELOG.md` entry, and commit all release changes on `main`.
2. Run `pnpm run test`, `pnpm run test:minimum`, and `pnpm run package`.
3. Run `node scripts/release.cjs 0.2.2`, replacing `0.2.2` with the new version.
4. Upload the generated VSIX through the [Task Cards Marketplace management page](https://marketplace.visualstudio.com/manage/publishers/DiogoRibeiro/extensions/task-cards/hub).
5. Verify that the new version appears on both the Marketplace and GitHub.

The release command requires a clean `main` branch and an existing matching VSIX, checks that the version and changelog agree, refuses to overwrite an existing GitHub tag, creates `v<version>`, and atomically pushes `main` with the tag. Generated VSIX files remain local and ignored by Git.
