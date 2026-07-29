// The sheet store is five lines of state, and every one of them is a rule that
// a screen would otherwise re-implement: which entry is open, what "next" means
// when the caller passed a list, what it means when it did not, and what
// happens at the ends.
//
// It is tested in `node` with no DOM because the hooks are the thin half —
// openEntry / closeEntry / stepEntry are plain functions over a zustand store,
// which is exactly why the module could be five-wide-safe in the first place.

import { describe, expect, it, beforeEach } from 'vitest'
import { closeEntry, getOpenEntryId, openEntry, stepEntry } from './entrySheet'

const LIST = ['a', 'b', 'c']

describe('entrySheet', () => {
  beforeEach(() => {
    closeEntry()
  })

  it('opens nothing by default', () => {
    expect(getOpenEntryId()).toBe(null)
  })

  it('opens an entry and closes it again', () => {
    openEntry('a')
    expect(getOpenEntryId()).toBe('a')
    closeEntry()
    expect(getOpenEntryId()).toBe(null)
  })

  it('steps forward and back through the caller-supplied list', () => {
    openEntry('a', { list: LIST })
    stepEntry(1)
    expect(getOpenEntryId()).toBe('b')
    stepEntry(1)
    expect(getOpenEntryId()).toBe('c')
    stepEntry(-1)
    expect(getOpenEntryId()).toBe('b')
  })

  it('does not wrap at either end', () => {
    // A radiogroup wraps because it is a closed set of options. A list of
    // entries is a position the user is reading through, and jumping from the
    // last item to the first reads as a bug.
    openEntry('a', { list: LIST })
    stepEntry(-1)
    expect(getOpenEntryId()).toBe('a')
    openEntry('c', { list: LIST })
    stepEntry(1)
    expect(getOpenEntryId()).toBe('c')
  })

  it('keeps the list when re-opened without one, so a walk survives a toast', () => {
    openEntry('a', { list: LIST })
    openEntry('c')
    stepEntry(-1)
    expect(getOpenEntryId()).toBe('b')
  })

  it('drops the list when the target is not in it', () => {
    openEntry('a', { list: LIST })
    openEntry('z')
    stepEntry(-1)
    expect(getOpenEntryId()).toBe('z')
  })

  it('forgets the list on close, so the next open does not inherit it', () => {
    openEntry('a', { list: LIST })
    closeEntry()
    openEntry('b')
    stepEntry(1)
    expect(getOpenEntryId()).toBe('b')
  })

  it('is inert when nothing is open', () => {
    stepEntry(1)
    expect(getOpenEntryId()).toBe(null)
  })
})
