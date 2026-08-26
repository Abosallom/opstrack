// The eleven use cases, and the one place the two vocabularies are reconciled.
//
// ⚠ WHY THIS FILE EXISTS. `use_cases` in the database holds `Rad Report`, `Rad
//   Order` and `Lab Result`; rebuild.mjs's matching rules answer `Radiology
//   Report`, `Radiology Order` and `Lab Results`. Neither is wrong — they were
//   written months apart — but any script that assumes one vocabulary silently
//   drops three of the eleven, which is a quarter of the grid. Two scripts need
//   the reconciliation now (grid.mjs and tickets.mjs) and a third will, so it
//   is written down once rather than copied.

/** The eleven the owner named, in his order. Not the catalogue's whole 15: the
 *  XD/CDA family and Encounter History are real capabilities that are not part
 *  of the onboarding grid. */
export const ELEVEN = [
  'ADT',
  'Medication Prescribe V1', 'Medication Prescribe V2',
  'Medication Dispense V1', 'Medication Dispense V2',
  'Rad Report', 'Rad Order',
  'Lab Result', 'Lab Order',
  'Clinical Notes',
  'Vital Signs',
]

/** reader's name → catalogue name. Anything absent from here is already equal. */
export const BRIDGE = new Map([
  ['Radiology Report', 'Rad Report'],
  ['Radiology Order', 'Rad Order'],
  ['Lab Results', 'Lab Result'],
])

const ELEVEN_SET = new Set(ELEVEN.map((n) => n.toLowerCase()))

/** A capability name in the reader's vocabulary → the catalogue's, or null when
 *  it is not one of the eleven. */
export function catalogueName(capRaw) {
  if (!capRaw) return null
  const name = BRIDGE.get(capRaw) ?? capRaw
  return ELEVEN_SET.has(name.toLowerCase()) ? name : null
}
