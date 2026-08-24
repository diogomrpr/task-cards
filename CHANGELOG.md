# Changelog

## 0.2.0

- Corrected shell execution so complete command lines retain pipes, `&&`, quoting, and other shell syntax.
- Made task labels part of `task-card` identity so separate tasks with the same command resolve independently.
- Preserved standard VS Code task customizations when resolving `task-card` entries.
- Prevented duplicate rapid launches and overlapping folder sequences.
- Kept folder runs in source order, stopped after failures, and made cancellation and task-file changes release running state reliably.
- Rejected malformed `task-card` definitions instead of resolving them with altered defaults.
- Removed the inaccessible Favorites and unused Recents state.
- Improved loading, running-state, live-region, and reduced-motion accessibility.
- Added hermetic trusted, Restricted Mode, minimum-version, and Windows integration coverage.
- Updated Marketplace identity, documentation, screenshot, and packaging metadata for the first public release.

## 0.1.0–0.1.15

- Internal development builds established the Task Cards view, nested folders, compact cards, automatic refresh, startup skeletons, cancellation, and ordered folder execution.
