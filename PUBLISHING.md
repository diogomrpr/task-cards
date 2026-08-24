# Publishing Task Cards

This checklist covers the manual account and publication steps for `DiogoRibeiro.task-cards`.

## One-time GitHub setup

1. Create the public repository at <https://github.com/diogomrpr/task-cards> if it does not already exist. Do not initialize it with replacement project files.
2. Confirm that `origin` points to the repository, adding it only if needed:

   ```sh
   git remote -v
   ```

   If `origin` is missing:

   ```sh
   git remote add origin https://github.com/diogomrpr/task-cards.git
   ```

3. Push `main` and confirm that the public README, screenshot, contribution guide, issue templates, and CI workflow render correctly:

   ```sh
   git push -u origin main
   ```

4. Enable **Private vulnerability reporting** in the repository settings.

## One-time Marketplace setup

1. Sign in to the [Visual Studio Marketplace publisher management page](https://marketplace.visualstudio.com/manage).
2. Confirm that the publisher ID is exactly `DiogoRibeiro`; the resulting extension ID is `DiogoRibeiro.task-cards`.
3. Confirm that the Marketplace names `task-cards` and **Task Cards** are available.

## Build the release

From a clean checkout:

```sh
corepack enable
pnpm install --frozen-lockfile
git status --short
pnpm run check
pnpm run audit
pnpm run test:unit
pnpm run test:integration
pnpm run test:minimum
pnpm run package
```

`git status --short` must produce no output before building the release. Push the exact release commit to the public `main` branch before Marketplace upload so the relative README links and screenshot resolve from the repository.

Install `task-cards-0.2.0.vsix` locally and verify light, dark, and high-contrast themes; keyboard access; narrow and wide sidebars; confirmation cancellation; running and stop states; ordered folder runs; automatic refresh; and multi-root grouping.

If a development build with the placeholder ID is installed, uninstall `your-publisher.task-cards` before installing `DiogoRibeiro.task-cards`. VS Code treats them as separate extensions.

## Publish to the Marketplace

The simplest first-release path is manual upload:

1. Open the publisher management page.
2. Select **New extension** → **Visual Studio Code**.
3. Upload `task-cards-0.2.0.vsix`.
4. Review the rendered README, icon, screenshot, license, repository links, supported VS Code version, and Restricted Mode declaration.
5. Publish and install the extension once from its public Marketplace listing.

Follow the official [VS Code publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) if publishing automation is added later. Never commit publishing credentials.

## Publish the GitHub release

After Marketplace publication:

```sh
git tag v0.2.0
git push origin v0.2.0
```

Create a GitHub release from the tag, copy the `0.2.0` changelog notes, and attach the matching VSIX. Never reuse a Marketplace version number after it has been published.
