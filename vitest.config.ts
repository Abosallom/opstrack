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
    //
    // THE SECOND LINE IS THE EDGE FUNCTIONS, AND IT IS NOT A CONVENIENCE.
    // `supabase/functions/capture-assist/index.ts` holds `validateProposal()`,
    // which is the copy of the AI validator an attacker CANNOT skip: the client
    // copy runs in a browser the caller controls, so anyone with a valid
    // session can POST that endpoint directly and meet only this one. Until
    // this line existed, the boundary that is actually load-bearing had zero
    // automated coverage while the browser-side copy had 543 lines of it, and
    // any hand-drift between them was invisible to CI, to the gates and to
    // review. Same for `send-push`'s `buildPayload()`, which renders the
    // sentence that lands on a lock screen where nobody can correct it.
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'supabase/functions/**/*.test.ts',
    ],
    // A `?raw` IMPORT OF A .css FILE RESOLVES TO THE EMPTY STRING WITHOUT THIS,
    // and that is a false-green generator rather than an inconvenience. Vitest's
    // default (`css: false`) stubs every CSS module, and the interception
    // matches the EXTENSION before the query — so `import './x.css?raw'` and
    // `import.meta.glob('./x.css', { query: '?raw' })` both yield `''`, and every
    // assertion written against that string passes against nothing, forever.
    // Two Wave-B agents wrote sheet assertions that were vacuously green until
    // they measured it. `true` makes the same import return the real file.
    //
    // The alternative the repo already uses — reading the file through a
    // VARIABLE `node:fs` specifier, as styles/contrast.test.ts does — still
    // works and is still correct; this only stops the other spelling lying.
    css: true,
  },
  // Deno spells its dependencies `npm:pkg@2`; Node does not. This one rewrite
  // is what lets a test import the DEPLOYED file rather than a copy of it —
  // and importing the deployed file is the whole point, because a test against
  // a copy proves nothing about the function that is actually serving. Nothing
  // in the app bundle uses `npm:` specifiers, so this cannot affect a build:
  // `vite build` does not read this file.
  resolve: {
    alias: [{ find: /^npm:(@supabase\/supabase-js)@\d+$/, replacement: '$1' }],
  },
})
