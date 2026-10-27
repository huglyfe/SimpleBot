# Shared Contract Guide

This package owns JSON/SSE schemas, shared authored settings/preset schemas, types, and small pure utilities used by both server and web. File I/O and file-specific errors stay in the server.

## Boundaries

- Keep dependency direction `web -> shared <- server`.
- Define runtime validation with Zod and infer TypeScript types where practical.
- Export the smallest stable contract current consumers need.
- Keep storage rows, renderer models, browser APIs, Node APIs, Electron IPC, and React Native modules in their owning packages.
- Use explicit optional, nullable, and versioned fields with closed states that exclude impossible combinations.
- Update schema, server, web, requirements, and compatibility tests together for a wire change.
- Before v1, replace wire shapes atomically. After v1, version compatibility and test supported skew.

## Tests

- Colocate schema tests or place cross-boundary cases in `shared/test/`.
- Cover accepted and rejected serialized shapes, defaults, and version evolution.
- Prefer table-driven cases when they improve failure clarity.
