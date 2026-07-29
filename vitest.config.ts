import { defineConfig } from 'vitest/config'

// Vitest is the repo's ONLY new runtime-adjacent dependency, and it is a
// devDependency. Nothing here pulls in a DOM environment: every module the plan
// puts under test — the parser, dates, health, the entry filter, sections,
// aggregation, the digest renderers, locale parity — is pure by construction
// (src/lib/** may not import from src/store/** or src/api/**), so `node` is
// both correct and the fastest option. A test that needs a document is a sign
// the logic is in the wrong layer.
//
// `globals` is deliberately OFF. Tests import { describe, it, expect } from
// 'vitest' explicitly, which keeps tsconfig.app.json's `types` array untouched —
// adding "vitest/globals" there would leak test globals into every app file's
// type space and make `expect` autocomplete inside a React component.
//
// This file is typechecked by tsconfig.node.json, alongside vite.config.ts.
export default defineConfig({
  test: {
    environment: 'node',
    // Co-located with the code they cover: src/lib/dates.test.ts sits next to
    // src/lib/dates.ts. No separate tests/ tree to keep in step with a rename.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
