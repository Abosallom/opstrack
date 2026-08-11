// Proof for the map's per-node menu.
//
// WHY renderToStaticMarkup AND NOT A DOM. vitest.config.ts is `environment:
// 'node'` and jsdom is not in the dependency budget — MindtreeTable.test.tsx,
// Board.test.tsx and the entry kit's own test all open with that paragraph.
// `react-dom/server` exercises the real tree, the real locale bundle and the
// real bidi isolation, and hands back markup to assert on.
//
// WHAT IT THEREFORE CANNOT SEE, and claims nothing about: the portal, the
// measurement pass, the roving `.focus()` call, and the sub-menu once it is
// open. Every one of those is behind a state change or a layout effect that a
// server render does not run — which is exactly why the panel is a separate
// component taking its rows and its position as PROPS, and why the four
// decisions that matter (what a row offers, what a row would write, where the
// panel goes, and which key moves where) are pure functions asserted here
// without rendering anything at all.
//
// THE ONE ASSERTION THIS FILE EXISTS FOR. A menu on a screen you can DRAG has
// to agree with the drag: choosing "Dana" from the sub-menu and dropping the
// card on Dana's branch must produce the same patch, including the owner XOR
// and the "it is already there" arm. `chooseOutcome` routes both through
// `dropRules.evaluateDrop`, and the tests below pin that rather than the shape
// of the object it happens to return.

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRef } from 'react'
import type { Entry } from '../../types'
import type { MindNode } from '../../lib/mindtree/model'
import type { MindAction, MindActionCtx } from '../../lib/mindtree/actions'
// TYPE-only, so it is erased before it can run — which is what lets it sit above
// the localStorage shim below without tripping the ordering problem that forces
// every VALUE import in this file to be a dynamic one. MindtreeTable.test.tsx
// uses the same trick and says so.
import type { MenuOffset, MenuRow, MindMenuRun } from './NodeMenu'

vi.hoisted(() => {
  // lib/i18n reads localStorage at module scope, so this cannot wait for a
  // beforeAll(): the imports below run first.
  const mem = new Map<string, string>()
  const g = globalThis as unknown as Record<string, unknown>
  g.localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size
    },
  }
})

const {
  MENU_MARGIN_PX,
  NodeMenuPanel,
  chooseOutcome,
  confirmFor,
  isMenuKey,
  menuAxisFor,
  menuInlineStep,
  menuPlacement,
  menuRunFor,
  needsConfirm,
  nextMenuIndex,
  opensSubmenu,
  rootMenuRows,
  valueMenuRows,
} = await import('./NodeMenu')

const { NO_VALUE, NAME_PREFIX } = await import('../../lib/mindtree/dropRules')
const { mindActionsFor } = await import('../../lib/mindtree/actions')

/* ────────────────────────────── fixtures ─────────────────────────────────── */

function entry(over: Partial<Entry> & Pick<Entry, 'id' | 'title'>): Entry {
  return {
    track_id: 't-net',
    node_id: null,
    description: '',
    type: 'action',
    status: 'new',
    priority: 'medium',
    owner_id: null,
    owner_name: null,
    requester: null,
    due_date: null,
    follow_up_date: null,
    tags: [],
    links: [],
    created_by: 'me',
    created_at: '2026-07-24T09:00:00.000Z',
    updated_at: '2026-07-24T09:00:00.000Z',
    closed_at: null,
    last_activity_at: '2026-07-24T09:00:00.000Z',
    meeting_id: null,
    template_id: null,
    ...over,
  }
}

function node(over: Partial<MindNode> & Pick<MindNode, 'id' | 'kind'>): MindNode {
  return {
    label: { kind: 'text', text: 'Network' },
    count: 3,
    colourVars: {},
    health: {
      levels: { ok: 3, stale: 0, overdue: 0, critical: 0 },
      slaBreached: false,
    },
    children: [],
    collapsed: false,
    depth: 1,
    entryId: null,
    bucketKey: null,
    entityType: null,
    retired: false,
    ...over,
  }
}

function ctx(over: Partial<MindActionCtx> = {}): MindActionCtx {
  return {
    meId: 'me',
    role: 'member',
    entryById: new Map<string, Entry>(),
    selection: new Set<string>(),
    dimension: 'status',
    focusedId: null,
    nudge: () => ({ offer: null, blockedKey: null }),
    ...over,
  }
}

const ROW: MenuRow = {
  key: 'x',
  shape: 'item',
  label: 'Open',
  enabled: true,
  reason: null,
  checked: false,
  action: null,
  choice: null,
  outcome: null,
}

/* ──────────────────────────── which verb, which axis ─────────────────────── */

describe('menuAxisFor / opensSubmenu', () => {
  it('routes the three value verbs to their column', () => {
    expect(menuAxisFor('assign')).toBe('owner')
    expect(menuAxisFor('status')).toBe('status')
    expect(menuAxisFor('priority')).toBe('priority')
  })

  it('routes `done` to the status axis but opens no sub-menu', () => {
    // The value is in the verb's name. Routing it to the axis anyway is what
    // lets ONE code path decide whether an act closes the entry.
    expect(menuAxisFor('done')).toBe('status')
    expect(opensSubmenu('done')).toBe(false)
    expect(opensSubmenu('status')).toBe(true)
  })

  it('gives the verbs that carry no value no axis at all', () => {
    for (const kind of ['open', 'nudge', 'addHere', 'applySelection', 'focus', 'collapse'] as const) {
      expect(menuAxisFor(kind), kind).toBeNull()
      expect(opensSubmenu(kind), kind).toBe(false)
    }
  })
})

/* ─────────────────────── what choosing a value would do ──────────────────── */

describe('chooseOutcome', () => {
  const row = entry({ id: 'e1', title: 'Rack elevation sign-off' })
  const base = ctx({ entryById: new Map([['e1', row]]) })

  it('assigns to a member and lets the XOR clear the free-text name', () => {
    const out = chooseOutcome(base, 'e1', 'owner', { value: 'u-dana' })
    expect(out.kind).toBe('patch')
    if (out.kind !== 'patch') return
    expect(out.field).toBe('ownerId')
    expect(out.patch).toEqual({ ownerId: 'u-dana' })
  })

  it('unassigns with BOTH owner keys — the trap dropRules exists to close', () => {
    // `ownerId: null` is falsy, so the XOR clears nothing on its own: a row
    // owned by the vendor "Acme" would keep owner_name and reappear in the Acme
    // bucket the moment the server row came back.
    const vendor = ctx({
      entryById: new Map([['e1', entry({ id: 'e1', title: 'x', owner_name: 'Acme' })]]),
    })
    const out = chooseOutcome(vendor, 'e1', 'owner', { value: NO_VALUE })
    expect(out.kind).toBe('patch')
    if (out.kind !== 'patch') return
    expect(out.patch).toEqual({ ownerId: null, ownerName: null })
  })

  it('assigns a free-text owner from a name: bucket', () => {
    const out = chooseOutcome(base, 'e1', 'owner', { value: `${NAME_PREFIX}Acme Ltd` })
    expect(out.kind).toBe('patch')
    if (out.kind !== 'patch') return
    expect(out.patch).toEqual({ ownerName: 'Acme Ltd' })
  })

  it('reports the value the row is already in as a no-op, not as a patch', () => {
    // This is what `aria-checked` is computed from. A menu that offered to
    // write the value already stored would bump last_activity_at and reset the
    // staleness clock on work nobody touched — R3-LEAD-1.
    expect(chooseOutcome(base, 'e1', 'status', { value: 'new' }).kind).toBe('noop')
    expect(chooseOutcome(base, 'e1', 'priority', { value: 'medium' }).kind).toBe('noop')
  })

  it('refuses a retired bucket with the sentence that names it', () => {
    const out = chooseOutcome(base, 'e1', 'status', { value: 'blocked', retired: true })
    expect(out.kind).toBe('refused')
    if (out.kind !== 'refused') return
    expect(out.reasonKey).toBe('mindtree.whyRetired')
  })

  it('refuses a row the store no longer holds', () => {
    const out = chooseOutcome(base, 'gone', 'status', { value: 'blocked' })
    expect(out.kind).toBe('refused')
    if (out.kind !== 'refused') return
    expect(out.reasonKey).toBe('entry.errNotFound')
  })

  it('changes only the column the reader picked', () => {
    const out = chooseOutcome(base, 'e1', 'priority', { value: 'critical' })
    expect(out.kind).toBe('patch')
    if (out.kind !== 'patch') return
    // Not the track, not the status, not the owner — a menu is one field.
    expect(Object.keys(out.patch)).toEqual(['priority'])
  })
})

/* ───────────────────────────── the confirmation ──────────────────────────── */

describe('needsConfirm', () => {
  const row = entry({ id: 'e1', title: 'x' })
  const base = ctx({ entryById: new Map([['e1', row]]) })

  function action(over: Partial<MindAction> = {}): MindAction {
    return {
      kind: 'status',
      labelKey: 'mindtree.actStatus',
      enabled: true,
      reasonKey: null,
      mutates: true,
      confirm: false,
      closes: false,
      targetIds: ['e1'],
      patch: null,
      ...over,
    }
  }

  it('asks before an act that CLOSES the entry', () => {
    for (const value of ['done', 'cancelled']) {
      const out = chooseOutcome(base, 'e1', 'status', { value })
      expect(needsConfirm(action(), out), value).toBe(true)
    }
  })

  it('does not ask for an ordinary status change', () => {
    const out = chooseOutcome(base, 'e1', 'status', { value: 'blocked' })
    expect(needsConfirm(action(), out)).toBe(false)
  })

  it('asks whenever actions.ts already decided the act is bulk', () => {
    expect(needsConfirm(action({ confirm: true }), null)).toBe(true)
  })

  it('does not ask for a verb that picked no value at all', () => {
    expect(needsConfirm(action({ kind: 'open', mutates: false }), null)).toBe(false)
  })
})

/* ──────────────────────────────── the rows ───────────────────────────────── */

describe('rootMenuRows', () => {
  it('keeps actions.ts’s order and marks only the value verbs as sub-menus', () => {
    const leaf = node({ id: 'root/track:t/group:new/entry:e1', kind: 'entry', entryId: 'e1' })
    const base = ctx({ entryById: new Map([['e1', entry({ id: 'e1', title: 'x' })]]) })
    const rows = rootMenuRows(mindActionsFor([leaf], base))

    expect(rows.map((r) => r.action?.kind)).toEqual([
      'open',
      'assign',
      'status',
      'priority',
      'done',
      'nudge',
    ])
    expect(rows.filter((r) => r.shape === 'submenu').map((r) => r.action?.kind)).toEqual([
      'assign',
      'status',
      'priority',
    ])
  })

  it('carries a REFUSED verb through with its sentence rather than dropping it', () => {
    // The whole reason the menu exists in this shape: an ops lead needs to know
    // WHY, once, instead of hunting for a verb that is not there.
    //
    // Signed out is the refusal `lib/permissions.ENTRIES_UPDATE_IS_OPEN` leaves
    // reachable — under the OPEN branch every signed-in member may edit, so
    // asserting "not yours" here would be asserting a policy this build does not
    // ship. The sentence for the narrow branch is written and translated anyway,
    // for the day that one line flips.
    const leaf = node({ id: 'n', kind: 'entry', entryId: 'e1' })
    const out = ctx({
      meId: null,
      entryById: new Map([['e1', entry({ id: 'e1', title: 'x' })]]),
    })
    const rows = rootMenuRows(mindActionsFor([leaf], out))
    const assign = rows.find((r) => r.action?.kind === 'assign')
    expect(assign?.enabled).toBe(false)
    expect(assign?.reason).toBe('Your session has ended. Sign in again to make changes.')

    // …and a second refusal with a different cause, so the row is proved to
    // carry the action's OWN sentence rather than one generic one.
    const closed = ctx({
      entryById: new Map([['e1', entry({ id: 'e1', title: 'x', status: 'done' })]]),
    })
    const done = rootMenuRows(mindActionsFor([leaf], closed)).find(
      (r) => r.action?.kind === 'done',
    )
    expect(done?.enabled).toBe(false)
    expect(done?.reason).toBe('This one is already closed.')
  })
})

describe('valueMenuRows', () => {
  const row = entry({ id: 'e1', title: 'x', status: 'new' })
  const base = ctx({ entryById: new Map([['e1', row]]) })
  const parent: MindAction = {
    kind: 'status',
    labelKey: 'mindtree.actStatus',
    enabled: true,
    reasonKey: null,
    mutates: true,
    confirm: false,
    closes: false,
    targetIds: ['e1'],
    patch: null,
  }

  const rows = valueMenuRows(base, 'e1', 'status', [
    { value: 'new', label: 'Triage' },
    { value: 'blocked', label: 'Blocked' },
    { value: 'waiting_on', label: 'Awaiting vendor', retired: true },
  ], parent)

  it('leads with Back', () => {
    expect(rows[0]?.shape).toBe('back')
    expect(rows[0]?.label).toBe('Back')
  })

  it('ticks the value the row is already in, and only that one', () => {
    expect(rows.filter((r) => r.checked).map((r) => r.label)).toEqual(['Triage'])
  })

  it('keeps a retired option visible, disabled, with its reason', () => {
    // store/vocab's frozen rule is that hiding an option must never hide DATA.
    // The same applies to the sentence explaining why it cannot be chosen.
    const retired = rows.find((r) => r.label === 'Awaiting vendor')
    expect(retired?.enabled).toBe(false)
    expect(retired?.reason).toBe('That branch is no longer in use and cannot take new work.')
  })

  it('makes every value row a radio', () => {
    expect(rows.slice(1).every((r) => r.shape === 'radio')).toBe(true)
  })
})

/* ─────────────────────────── what a row would write ──────────────────────── */

describe('menuRunFor', () => {
  const row = entry({ id: 'e1', title: 'x', status: 'new' })
  const base = ctx({ entryById: new Map([['e1', row]]) })
  const leaf = node({ id: 'n', kind: 'entry', entryId: 'e1' })
  const rows = rootMenuRows(mindActionsFor([leaf], base))
  const doneRow = rows.find((r) => r.action?.kind === 'done')

  it('turns `done` into the same patch a drop onto the Done branch produces', () => {
    expect(doneRow).toBeDefined()
    if (doneRow === undefined) return
    const run = menuRunFor(base, 'e1', doneRow)
    expect(run?.targetIds).toEqual(['e1'])
    expect(run?.patch).toEqual({ status: 'done' })
    expect(run?.outcome?.kind).toBe('patch')
    expect(run?.confirmed).toBe(false)
  })

  it('writes nothing for a value the row already holds, but still reports it', () => {
    // A no-op is not a failure and not silence: the surface announces
    // DROP_UNCHANGED_KEY off the outcome, and writes zero rows.
    const parent = rows.find((r) => r.action?.kind === 'status')?.action ?? null
    expect(parent).not.toBeNull()
    if (parent === null) return
    const values = valueMenuRows(base, 'e1', 'status', [{ value: 'new', label: 'Triage' }], parent)
    const run = menuRunFor(base, 'e1', values[1] as MenuRow)
    expect(run?.targetIds).toEqual([])
    expect(run?.patch).toBeNull()
    expect(run?.outcome?.kind).toBe('noop')
  })

  it('hands a bulk verb the ids actions.ts already filtered', () => {
    const branch = node({ id: 'root/track:t', kind: 'track', bucketKey: 't-other' })
    const bulk = ctx({
      entryById: new Map([
        ['e1', entry({ id: 'e1', title: 'a' })],
        ['e2', entry({ id: 'e2', title: 'b' })],
      ]),
      selection: new Set(['e1', 'e2']),
    })
    const apply = rootMenuRows(mindActionsFor([node({ id: 'root', kind: 'root' }), branch], bulk))
      .find((r) => r.action?.kind === 'applySelection')
    expect(apply).toBeDefined()
    if (apply === undefined) return
    const run = menuRunFor(bulk, null, apply)
    expect(run?.targetIds).toEqual(['e1', 'e2'])
    // `mapNodeId: null` rides along on every track patch: the track ring sits
    // above the organizations, so landing on it means "under none of them".
    expect(run?.patch).toEqual({ trackId: 't-other', mapNodeId: null })
  })

  it('refuses to build a run for a disabled row, a sub-menu row or Back', () => {
    expect(menuRunFor(base, 'e1', { ...ROW, action: null })).toBeNull()
    const submenu = rows.find((r) => r.shape === 'submenu')
    expect(submenu).toBeDefined()
    if (submenu === undefined) return
    expect(menuRunFor(base, 'e1', submenu)).toBeNull()
    expect(menuRunFor(base, 'e1', { ...submenu, shape: 'back' })).toBeNull()
    expect(menuRunFor(base, 'e1', { ...submenu, shape: 'item', enabled: false })).toBeNull()
  })
})

/* ──────────────────────────────── keyboard ───────────────────────────────── */

describe('nextMenuIndex', () => {
  it('wraps both ways — a menu is a closed set', () => {
    expect(nextMenuIndex('ArrowDown', 4, 5)).toBe(0)
    expect(nextMenuIndex('ArrowUp', 0, 5)).toBe(4)
  })

  it('steps from "nothing focused" to the right end', () => {
    // -1 is a panel that has just been replaced. Modular arithmetic would send
    // ArrowUp to the SECOND-to-last row, which is the off-by-one this arm fixes.
    expect(nextMenuIndex('ArrowDown', -1, 5)).toBe(0)
    expect(nextMenuIndex('ArrowUp', -1, 5)).toBe(4)
  })

  it('jumps with Home and End', () => {
    expect(nextMenuIndex('Home', 3, 5)).toBe(0)
    expect(nextMenuIndex('End', 3, 5)).toBe(4)
  })

  it('answers null for a key it does not own, and for an empty menu', () => {
    expect(nextMenuIndex('a', 0, 5)).toBeNull()
    expect(nextMenuIndex('Enter', 0, 5)).toBeNull()
    expect(nextMenuIndex('ArrowDown', 0, 0)).toBeNull()
  })
})

describe('menuInlineStep', () => {
  it('maps the inline arrows through direction', () => {
    expect(menuInlineStep('ArrowRight', false)).toBe('forward')
    expect(menuInlineStep('ArrowLeft', false)).toBe('back')
    // In Arabic "deeper" is to the LEFT. An unmapped ArrowRight would step BACK
    // out of the sub-menu the reader has just opened.
    expect(menuInlineStep('ArrowRight', true)).toBe('back')
    expect(menuInlineStep('ArrowLeft', true)).toBe('forward')
  })

  it('leaves the block arrows alone', () => {
    expect(menuInlineStep('ArrowDown', false)).toBeNull()
    expect(menuInlineStep('ArrowUp', true)).toBeNull()
  })
})

describe('isMenuKey', () => {
  it('accepts both spellings and nothing else', () => {
    expect(isMenuKey({ key: 'ContextMenu', shiftKey: false })).toBe(true)
    expect(isMenuKey({ key: 'F10', shiftKey: true })).toBe(true)
    expect(isMenuKey({ key: 'F10', shiftKey: false })).toBe(false)
    expect(isMenuKey({ key: 'Enter', shiftKey: true })).toBe(false)
  })
})

/* ─────────────────────────────── placement ───────────────────────────────── */

describe('menuPlacement', () => {
  const viewport = { inlineSize: 1000, blockSize: 800 }
  const box = { inlineSize: 240, blockSize: 300 }

  it('hangs off the pointer when it fits', () => {
    expect(menuPlacement({ x: 100, y: 100 }, box, viewport, false)).toEqual({
      inlineStart: 100,
      blockStart: 100,
    })
  })

  it('opens toward inline-start rather than covering the node', () => {
    // Clamping would slide the panel over the branch the reader is choosing
    // from, which on this screen is the thing they are looking at.
    expect(menuPlacement({ x: 900, y: 100 }, box, viewport, false).inlineStart).toBe(660)
  })

  it('opens upward at the block-end edge', () => {
    expect(menuPlacement({ x: 100, y: 700 }, box, viewport, false).blockStart).toBe(400)
  })

  it('measures from the OTHER edge in Arabic, with the same numbers', () => {
    // The mirror of the first case: a pointer 100px from the inline-start edge
    // is x=900 in an RTL viewport 1000 wide.
    expect(menuPlacement({ x: 900, y: 100 }, box, viewport, true)).toEqual({
      inlineStart: 100,
      blockStart: 100,
    })
    // …and the mirror of the flip.
    expect(menuPlacement({ x: 100, y: 100 }, box, viewport, true).inlineStart).toBe(660)
  })

  it('pins to the start edge when the panel is bigger than the viewport', () => {
    const huge = { inlineSize: 1200, blockSize: 900 }
    expect(menuPlacement({ x: 500, y: 400 }, huge, viewport, false)).toEqual({
      inlineStart: MENU_MARGIN_PX,
      blockStart: MENU_MARGIN_PX,
    })
  })

  it('does not flip while the panel still fits inside the margin', () => {
    const at = { x: viewport.inlineSize - box.inlineSize - MENU_MARGIN_PX, y: 10 }
    expect(menuPlacement(at, box, viewport, false).inlineStart).toBe(at.x)
  })
})

/* ──────────────────────────────── the panel ──────────────────────────────── */

describe('NodeMenuPanel', () => {
  function render(rows: readonly MenuRow[], offset: MenuOffset | null = { inlineStart: 12, blockStart: 34 }): string {
    return renderToStaticMarkup(
      <NodeMenuPanel
        panelRef={createRef<HTMLDivElement>()}
        labelId="mid"
        menuLabel="Actions for Network"
        rows={rows}
        activeIndex={1}
        offset={offset}
        onKeyDown={() => {}}
        onActivate={() => {}}
        onHover={() => {}}
        registerRow={() => {}}
      />,
    )
  }

  const rows: MenuRow[] = [
    { ...ROW, key: 'a', label: 'Open' },
    { ...ROW, key: 'b', shape: 'submenu', label: 'Assign to…' },
    {
      ...ROW,
      key: 'c',
      label: 'Mark as done',
      enabled: false,
      reason: 'This one is already closed.',
    },
    { ...ROW, key: 'd', shape: 'radio', label: 'Triage', checked: true },
    { ...ROW, key: 'e', shape: 'radio', label: 'Blocked' },
  ]

  const html = render(rows)

  it('is a menu, named by its own title', () => {
    expect(html).toContain('role="menu"')
    expect(html).toContain('aria-labelledby="mid"')
    expect(html).toContain('id="mid"')
    expect(html).toContain('Actions for Network')
  })

  it('gives a value row the radio role and ticks exactly the current one', () => {
    expect(html.match(/role="menuitemradio"/g)?.length).toBe(2)
    expect(html.match(/aria-checked="true"/g)?.length).toBe(1)
    expect(html.match(/aria-checked="false"/g)?.length).toBe(1)
  })

  it('advertises a sub-menu without claiming it is open', () => {
    // aria-expanded is never true: the sub-menu REPLACES this panel, so a row
    // claiming an expanded child while it is off screen promises a subtree
    // nobody can reach.
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('aria-expanded="true"')
  })

  it('disables with aria, not with `disabled`, and points at the reason', () => {
    // A `disabled` button cannot take focus, so the sentence explaining the
    // refusal would be unreachable by keyboard and unread by a screen reader.
    expect(html).toContain('aria-disabled="true"')
    expect(html).not.toContain('disabled=""')
    expect(html).toContain('aria-describedby="mid-why-2"')
    expect(html).toContain('id="mid-why-2"')
    expect(html).toContain('This one is already closed.')
  })

  it('is ONE tab stop', () => {
    expect(html.match(/tabindex="0"/g)?.length).toBe(1)
    expect(html.match(/tabindex="-1"/g)?.length).toBe(rows.length - 1)
  })

  it('positions on the logical axes only', () => {
    expect(html).toContain('inset-inline-start:12px')
    expect(html).toContain('inset-block-start:34px')
    expect(html).not.toContain('left:')
    expect(html).not.toContain('top:')
  })

  it('stays hidden until it has been measured', () => {
    // A panel drawn at the default offset while it is being measured is a panel
    // drawn in the corner. The layout effect runs before paint, so nothing
    // flashes — but only because of this.
    expect(render(rows, null)).toContain('visibility:hidden')
  })

  it('reserves the tick slot on every row', () => {
    // A slot that appears WITH the tick shifts every label by 16px the moment a
    // value is chosen, and a list that moves under the pointer gets mis-clicked.
    expect(html.match(/class="mtree-menu-tick"/g)?.length).toBe(rows.length)
  })

  it('fences every label for direction', () => {
    // An Arabic owner name in an English menu, or the reverse. Unfenced, the
    // neutral characters around it reorder — lib/bidi's whole subject.
    expect(html).toContain('⁨Assign to…⁩')
  })
})

/* ─────────────────── the two questions, and the words in them ───────────── */

// REGRESSION, and the sharpest one in this file. `confirmFor` used to call
// `t('mindtree.confirmCloseTitle')` with NO vars and `t('mindtree.confirmBulkBody',
// { count })` — while the strings are "Mark ⁨{title}⁩ as ⁨{label}⁩?" and "They all
// move to ⁨{label}⁩…". `lib/i18n.t()` skips interpolation entirely when `vars` is
// undefined and `interpolate` leaves an unknown placeholder verbatim, so the
// reader met a literal `{title}` on every Mark-as-done and a literal `{label}` on
// every ten-plus bulk apply. `DragLayer.tsx` passes both correctly for the same
// two keys and DragLayer.test.tsx asserts it — which is why only the menu path
// was broken, and why this file now asserts the same property.
describe('confirmFor', () => {
  const row = entry({ id: 'e1', title: 'Firewall rule DC2' })
  const base = ctx({ entryById: new Map([['e1', row]]) })

  function action(over: Partial<MindAction> = {}): MindAction {
    return {
      kind: 'done',
      labelKey: 'mindtree.actDone',
      enabled: true,
      reasonKey: null,
      mutates: true,
      confirm: false,
      closes: true,
      targetIds: ['e1'],
      patch: { status: 'done' },
      ...over,
    }
  }

  function run(over: Partial<MindMenuRun> = {}): MindMenuRun {
    return {
      kind: 'done',
      action: action(),
      targetIds: ['e1'],
      patch: { status: 'done' },
      outcome: chooseOutcome(base, 'e1', 'status', { value: 'done' }),
      confirmed: false,
      ...over,
    }
  }

  it('renders NO raw placeholder in either locale, for either dialog', async () => {
    const i18n = await import('../../lib/i18n')
    const seen: string[] = []
    for (const locale of ['en', 'ar'] as const) {
      i18n.setLocale(locale)
      seen.push(confirmFor(run(), 'Firewall rule DC2', 'Done').title)
      const close = confirmFor(run(), 'Firewall rule DC2', 'Done')
      const bulk = confirmFor(
        run({ action: action({ kind: 'applySelection', closes: false, confirm: true }), targetIds: ['a', 'b'], outcome: null }),
        'Firewall rule DC2',
        'Dana',
      )
      for (const copy of [close, bulk]) {
        for (const [field, text] of Object.entries(copy)) {
          if (typeof text !== 'string') continue
          expect(`${locale}.${field}: ${text}`).not.toMatch(/[{}]/)
        }
      }
    }
    // The two locales really were exercised — otherwise this whole loop could
    // pass twice over English and prove nothing about the Arabic bundle, whose
    // copy of both strings carries the same two placeholders.
    expect(seen[0]).not.toBe(seen[1])
    i18n.setLocale('en')
  })

  it('names the item and the destination in the close question', () => {
    const copy = confirmFor(run(), 'Firewall rule DC2', 'Done')
    expect(copy.title).toContain('Firewall rule DC2')
    expect(copy.title).toContain('Done')
    expect(copy.danger).toBe(true)
  })

  it('names the branch in the bulk body — the one sentence that says WHERE', () => {
    const copy = confirmFor(
      run({ action: action({ kind: 'applySelection', closes: false, confirm: true }), targetIds: ['a', 'b', 'c'], outcome: null }),
      '',
      'Dana',
    )
    expect(copy.body).toContain('Dana')
    expect(copy.danger).toBe(false)
  })

  it('marks a CLOSING batch dangerous, matching DragLayer.commitDrop', () => {
    const copy = confirmFor(
      run({ action: action({ kind: 'applySelection', closes: true, confirm: false }), targetIds: ['a', 'b', 'c'], outcome: null }),
      '',
      'Done',
    )
    // Three rows is not "single", so it is the batch question — but it still
    // closes, so it is still the dangerous one. `plan.closes && single` is the
    // exact same split the drag makes.
    expect(copy.body).toContain('Done')
    expect(copy.danger).toBe(true)
  })
})

describe('needsConfirm sees a closing bulk apply', () => {
  // REGRESSION. `menuRunFor`'s generic arm hands the surface `outcome: null`, so
  // a `needsConfirm` that only read the outcome asked NOTHING before closing
  // nine ticked items — while dragging the same nine onto the same branch asked,
  // because `DragLayer.commitDrop` computes `plan.closes` per row.
  function bulk(over: Partial<MindAction>): MindAction {
    return {
      kind: 'applySelection',
      labelKey: 'mindtree.actStatusHere',
      enabled: true,
      reasonKey: null,
      mutates: true,
      confirm: false,
      closes: false,
      targetIds: ['a', 'b', 'c'],
      patch: { status: 'done' },
      ...over,
    }
  }

  it('asks when the act closes, even below the bulk threshold', () => {
    expect(needsConfirm(bulk({ closes: true }), null)).toBe(true)
  })

  it('still does not ask for an ordinary three-row move', () => {
    expect(needsConfirm(bulk({}), null)).toBe(false)
  })
})
