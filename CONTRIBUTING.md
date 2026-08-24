# Contributing to Task Cards

Thanks for helping improve Task Cards. Bug fixes, focused features, tests, documentation, and accessibility improvements are welcome.

## Before opening an issue

- Search existing issues first.
- Use the bug or feature template.
- Remove secrets from `tasks.json`, logs, and screenshots.
- Keep proposals within the extension's scope: official desktop VS Code and tasks explicitly declared in workspace-folder `.vscode/tasks.json` files.

Security vulnerabilities should follow [SECURITY.md](SECURITY.md), not a public issue.

## Development setup

Prerequisites:

- Node.js 22
- Corepack, included with standard Node.js installations
- Official desktop VS Code 1.96 or newer

Install and verify the project:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm run check
pnpm run test:unit
```

Open the repository in VS Code and press `F5` to launch an Extension Development Host against the included fixture workspace.

The repository's own `.vscode/tasks.json` is demonstration data copied from a larger development workspace. Review every command before running it here; several referenced projects are not part of this repository, and **Clear Docker** intentionally prunes local Docker data.

## Tests

Run the trusted and Restricted Mode integration tests:

```sh
pnpm run test:integration
```

Linux CI requires a display wrapper:

```sh
xvfb-run -a pnpm run test:integration
```

Verify compatibility with the minimum supported VS Code version:

```sh
pnpm run test:minimum
```

Create a local VSIX with:

```sh
pnpm run package
```

## Pull requests

1. Create a branch from `main`.
2. Keep the change focused and preserve existing behavior outside its scope.
3. Add or update the smallest test that demonstrates non-trivial behavior.
4. Update `README.md` and `CHANGELOG.md` when behavior visible to users changes.
5. For UI work, manually check narrow and wide sidebars, light/dark/high-contrast themes, keyboard use, running state, and confirmation cancellation.
6. Open a pull request and complete its checklist.

The project intentionally uses plain webview HTML, CSS, and JavaScript with VS Code theme tokens. Avoid frontend frameworks, telemetry, external web resources, and new runtime dependencies unless they are necessary for a concrete feature.
