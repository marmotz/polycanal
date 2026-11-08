---
title: Documentation versions
---

# Documentation versions

This site is versioned with Docusaurus.

- **next** documents the `main` branch. It is the only version until the first release.
- Each release freezes a copy of the documentation, API reference included, under its version number.

Maintainers cut a version from the repository root:

```bash
bun run --filter @polycanal/docs build
bun run --filter @polycanal/docs version 0.1.0
```

The build regenerates the API reference first, so that the frozen copy contains it. The new version is listed in
`apps/docs/versions.json`, its pages are written to `apps/docs/versioned_docs/version-0.1.0/` (committed), and a
version dropdown appears in the navigation bar. **next** stays the default until `lastVersion` is changed in
`docusaurus.config.ts`.
