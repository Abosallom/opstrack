// The `?` sheet: every shortcut the layer binds, and nothing it does not.
//
// RENDERED FROM lib/hotkeys.SHORTCUTS, not from a list written here. Acceptance
// gate (d) asks that every spec shortcut "works, and is listed in the
// cheatsheet", and the only way to make that a property rather than a promise is
// for the binding table and the help text to be the same array —
// src/lib/hotkeys.test.ts then asserts that array covers exactly what
// resolveHotkey() answers to, in both directions.
//
// THE STATUS ROW READS THE VOCABULARY. Digits 1–4 set a status, and an admin can
// rename any status label from Settings → Vocabulary (migration 0003 renames
// LABELS and freezes KEYS, which is what makes lib/hotkeys' digit→key map safe
// to hardcode). Printing "Blocked" in a locale file would go stale the first
// time somebody renames it to "On hold", so the four labels come from
// store/vocab at render time.
//
// It reuses components/sheet/Sheet.tsx rather than owning a dialog: that
// component already has the Escape arbitration through lib/overlayStack, the Tab
// trap, the focus restore and the aria-modal wiring, and a second
// implementation of all four is exactly the drift §1.0 exists to prevent. Only
// the internals are ours, and they are `.cmd-*` per the prefix registry.

import type { ReactElement } from 'react'
import Sheet from './sheet/Sheet'
import { SHORTCUTS, STATUS_DIGITS, modLabel, type ShortcutDoc } from '../lib/hotkeys'
import { t } from '../lib/i18n'
import { useVocabLabel } from '../store/vocab'
import './cmd.css'

export interface CheatsheetProps {
  open: boolean
  onClose: () => void
}

/** `mod` → ⌘ or Ctrl; everything else prints itself. */
function keyLabel(key: string): string {
  return key === 'mod' ? modLabel() : key
}

function Keys({ keys }: { keys: readonly string[] }): ReactElement {
  return (
    <span className="cmd-keys">
      {keys.map((key) => (
        // <kbd> is the element for this, and it carries the meaning to a screen
        // reader without an aria-label per chip. The chips sit in source order
        // inside one inline-flex row, so the chord reads start-to-end in both
        // directions with no mirror rule — a chord is a sequence of presses,
        // not a sentence, but ⌘ then K is still the reading order in Arabic.
        <kbd className="cmd-key" key={key}>
          {keyLabel(key)}
        </kbd>
      ))}
    </span>
  )
}

function Row({ doc }: { doc: ShortcutDoc }): ReactElement {
  return (
    <div className="cmd-help-row">
      <Keys keys={doc.keys} />
      <span className="cmd-help-label">{t(doc.labelKey)}</span>
    </div>
  )
}

export default function Cheatsheet({ open, onClose }: CheatsheetProps): ReactElement {
  const vocabLabel = useVocabLabel()
  const global = SHORTCUTS.filter((s) => s.group === 'global')
  const entry = SHORTCUTS.filter((s) => s.group === 'entry')

  // `title` alone, no `label`: Sheet names the dialog from its heading when one
  // is given, and passing both would set an aria-label beside the winning
  // aria-labelledby — two names for one dialog.
  return (
    <Sheet open={open} onClose={onClose} title={t('cmd.keysTitle')}>
      <div className="cmd-help">
        <p className="cmd-help-hint">{t('cmd.keysHint')}</p>

        <h3 className="cmd-help-group">{t('cmd.keysGlobal')}</h3>
        {global.map((doc) => (
          <Row key={doc.id} doc={doc} />
        ))}

        <h3 className="cmd-help-group">{t('cmd.keysEntry')}</h3>
        {entry.map((doc) => (
          <Row key={doc.id} doc={doc} />
        ))}
        {/* The one thing the generic row cannot say: WHICH status each digit
            sets. Built here from the same array lib/hotkeys resolves against,
            so a fifth digit could never appear in one and not the other. */}
        <dl className="cmd-help-statuses">
          {STATUS_DIGITS.map((status, i) => (
            <div className="cmd-help-status" key={status}>
              <dt>
                <kbd className="cmd-key">{i + 1}</kbd>
              </dt>
              {/* Vocabulary labels are admin-editable free text, so they can be
                  Latin inside the Arabic UI and Arabic inside the English one.
                  `unicode-bidi: isolate` in cmd.css fences the run — the CSS
                  equivalent of lib/bidi's FSI, and the right tool when the value
                  has its own element rather than sitting in a sentence. */}
              <dd className="cmd-help-status-label">{vocabLabel('status', status)}</dd>
            </div>
          ))}
        </dl>
        <p className="cmd-help-hint">{t('cmd.keysEntryHint')}</p>
      </div>
    </Sheet>
  )
}
