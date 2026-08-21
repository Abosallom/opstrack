#!/usr/bin/env node
// lookat — regenerate `public/__lookat/`: the map, as the renderer actually
// draws it, at five cameras over the 400-organization workspace.
//
//   npm run lookat
//
// The SVGs it writes are COMMITTED. That is the whole point: a geometry change
// shows up in a pull request as a picture somebody can look at, and the map can
// never again ship unseen. `docs/MAP-ZOOM.md` §9 records what happened the last
// time it could.
//
// ── WHY THIS SCRIPT RUNS THE GATE INSTEAD OF RENDERING ─────────────────────
//
// It would be more direct to import `MapCanvas` here and call
// `renderToStaticMarkup` — and it is not possible under the house rules. Node
// cannot load a `.tsx` file: `--experimental-strip-types` removes type
// annotations and does not compile JSX, so a standalone generator needs a JSX
// loader, which is a new dependency, which is refused.
//
// The alternative would be a hand-written reimplementation of the marks — and
// the repo has already tried that. The `public/__lookat/` this script replaces
// was exactly that: a second drawing of the same idea, with colours resolved by
// hand, containing no `class` attributes and no `mtree-node-label` strings. It
// found real bugs AND it can find false ones, and nothing in it could ever go
// red when the renderer changed.
//
// So the pictures come out of the gate itself. `src/pages/map/mapRender.test.tsx`
// already renders the real components over the real fixtures at the five
// cameras; with `LOOKAT=1` it also writes what it rendered. One render path, one
// set of fixtures, and a green gate and an ugly picture cannot both be true.
//
// ── IT DOES NOT FAIL WHEN THE GATE FAILS, AND THAT IS DELIBERATE ───────────
//
// The picture is most needed on the day the numbers are red. This script reports
// the gate's verdict and exits 0 as long as the files were written; `npm test`
// is what blocks a merge, and it is not this script's job to block it twice.
// It exits non-zero only when it produced nothing.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', '__lookat')
const GATE = join('src', 'pages', 'map', 'mapRender.test.tsx')

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(
    [
      'lookat — regenerate public/__lookat/ from the render gate.',
      '',
      '  npm run lookat',
      '',
      `Renders ${GATE}'s three fixtures at its five cameras using the REAL`,
      'MapCanvas / MindNode / MindWorldRim, and writes the SVGs, an index.html and',
      'a stats.txt. Commit the result: the diff is the review.',
      '',
      'Exits 0 even when the gate is red — the picture is most useful then. Run',
      '`npm test` for the verdict.',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

// STALE PICTURES ARE WORSE THAN NO PICTURES: a leftover `desktop-full.svg` from
// the old hand-written harness is a drawing of something that no longer exists,
// sitting in the directory a reviewer trusts. Everything this run does not
// rewrite is removed first, so the directory is always exactly one render.
if (existsSync(OUT)) {
  for (const name of readdirSync(OUT)) {
    if (name.endsWith('.svg') || name === 'index.html' || name === 'stats.txt') {
      rmSync(join(OUT, name))
    }
  }
} else {
  mkdirSync(OUT, { recursive: true })
}

let red = false
try {
  execFileSync('npx', ['vitest', 'run', '--reporter=dot', GATE], {
    cwd: ROOT,
    env: { ...process.env, LOOKAT: '1' },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
} catch {
  // The gate threw or asserted. The renders happened before the assertions ran,
  // so the pictures below are still the pictures — see this file's header.
  red = true
}

const written = existsSync(OUT) ? readdirSync(OUT).filter((n) => n.endsWith('.svg')) : []
if (written.length === 0) {
  process.stderr.write(
    `lookat wrote nothing to ${OUT}.\n` +
      `The gate did not reach its render step — run \`npx vitest run ${GATE}\` and read the error.\n`,
  )
  process.exit(1)
}

const stats = join(OUT, 'stats.txt')
process.stdout.write(
  [
    '',
    `${written.length} pictures → public/__lookat/`,
    ...written.sort().map((name) => `  ${name}`),
    '',
    existsSync(stats) ? readFileSync(stats, 'utf8').trimEnd() : '(no stats.txt)',
    '',
    red
      ? 'THE GATE IS RED. The pictures above are what it measured — open index.html.'
      : 'The gate is green. Commit the diff.',
    '',
  ].join('\n'),
)
