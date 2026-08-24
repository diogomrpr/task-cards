## Summary

Describe the user-visible change and why it is needed.

Read the [project philosophy and structure](https://github.com/diogomrpr/task-cards/blob/main/CONTRIBUTING.md#project-philosophy) before submitting.

## Architecture and scope

Name the existing layer that owns this change. If it changes project scope, architecture, trust, execution, networking, or dependencies, link the feature discussion and explain why the current design is insufficient.

## Verification

- [ ] `pnpm run check`
- [ ] `pnpm run test:unit`
- [ ] Integration tests, when task execution or VS Code lifecycle behavior changed
- [ ] Manual keyboard, narrow-sidebar, and theme checks, when the webview UI changed
- [ ] `CHANGELOG.md` updated for user-visible changes
- [ ] The change follows the documented project structure, or the exception is explained above
- [ ] No secrets, generated VSIX files, or unrelated changes included
