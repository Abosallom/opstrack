// EDITING AN ORGANIZATION WHERE YOU ARE LOOKING AT IT.
//
// ── WHY THIS EXISTS ───────────────────────────────────────────────────────
//
// The panel that opens when you tap an organization showed nine facts and let
// you change ONE of them: its stage. Its name, its kind, who is accountable for
// it and which company is doing the integration were all read-only — and the
// only screen that could change them was Settings ▸ Structure, which is behind
// a permission gate, a different route, and a tree of a hundred and four rows
// you have to find the organization in a second time.
//
// So the fields move to where the reader already is. Nothing here is a new
// capability: `updateMapNode` and `setMapNodeArchived` are the same two calls
// StructureAdmin makes, with the same guards behind them.
//
// ── WHY THERE IS NO DELETE, WHICH IS A REAL ANSWER AND NOT AN OMISSION ────
//
// StructureAdmin's header settles it and this file inherits the reasoning:
// 0023's guard refuses to delete a node while ANYTHING still points at it — an
// entry, a child, a use-case link, a stage record — so a Delete button would be
// a control that fails for every node worth deleting and succeeds only on the
// row somebody typed by mistake this morning. Archive is the reversible
// operation, it is what "get this off my map" actually means, and `deleteMapNode`
// stays where it is for the SQL editor.
//
// ── THE PERMISSION IS ABSENT, NOT DISABLED ───────────────────────────────
//
// `structure.edit` is the key that gates every `map_nodes` write in RLS. A
// reader without it sees the panel exactly as it was — facts, no controls —
// rather than a row of greyed-out buttons explaining a screen they will never
// use. The map's own menu makes the same call for the same reason.

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { setMapNodeArchived, updateMapNode } from '../../api/map'
import { confirm } from '../Confirm'
import { toast } from '../toast'
import { t } from '../../lib/i18n'
import { useNodeLabel, useKindLabel } from '../../lib/labels'
import { useHasPerm } from '../../store/auth'
import { invalidateConfig, useHisProducts, useMapNodeKinds, useMapNodes } from '../../store/config'
import { useMembers } from '../../store/members'
import type { MapNode } from '../../types'

/** Matches `map_nodes_name_len` and StructureAdmin's own guard. */
const NAME_MAX = 60

interface Form {
  name: string
  nameAr: string
  kindId: string
  managerId: string
  vendor: string
  /** `''` is "nobody has recorded a system" — see the field below. */
  hisId: string
}

export interface NodeEditorProps {
  nodeId: string
  /**
   * Told to the panel so it can hide the read-only fields this form replaces.
   * Lifting the flag rather than letting this component hide them itself is
   * what keeps `DetailBand` renderable without a store — the rule that file
   * states about `StagePicker` and the reason it takes a ReactNode.
   */
  onEditingChange?: (editing: boolean) => void
}

export default function NodeEditor({ nodeId, onEditingChange }: NodeEditorProps): ReactElement | null {
  const canEdit = useHasPerm('structure.edit')
  const nodes = useMapNodes()
  const kinds = useMapNodeKinds()
  const hisProducts = useHisProducts()
  const members = useMembers()
  const nodeLabel = useNodeLabel()
  const kindLabel = useKindLabel()

  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)

  // The unmount guard every write path in this app carries: a PATCH that
  // resolves after the panel closed must not call setState on a dead tree.
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const node: MapNode | undefined = nodes.find((n) => n.id === nodeId)

  const close = useCallback(() => {
    setForm(null)
    onEditingChange?.(false)
  }, [onEditingChange])

  /**
   * ⚠ CLOSE THE FORM WHEN THE PANEL MOVES TO ANOTHER ORGANIZATION. Without
   *   this, tapping a second organization while a form is open would leave the
   *   first one's typed values on the screen under the second one's name — and
   *   Save would then write them to the wrong row. The panel is reused rather
   *   than remounted, so this component sees a new `nodeId` rather than a fresh
   *   mount.
   */
  useEffect(() => {
    setForm(null)
    onEditingChange?.(false)
    // `onEditingChange` is stable in the one call site and is deliberately not a
    // dependency: including it would re-close the form on every parent render.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId])

  if (!canEdit || node === undefined) return null

  const open = (): void => {
    setForm({
      name: node.name,
      nameAr: node.name_ar,
      kindId: node.kind_id ?? '',
      managerId: node.account_manager_id ?? '',
      vendor: node.vendor,
      hisId: node.his_id ?? '',
    })
    onEditingChange?.(true)
  }

  const save = async (): Promise<void> => {
    if (form === null) return
    const name = form.name.trim()
    if (name === '' || name.length > NAME_MAX) {
      toast(t('structure.nameRequired'), { tone: 'error' })
      return
    }
    setBusy(true)
    // `null` IS AN INSTRUCTION on the two nullable columns — "no kind", "nobody
    // named" — and `updateMapNode` distinguishes it from a key left off, which
    // means "do not touch". An empty select value must therefore become null
    // rather than be dropped, or clearing a manager would silently do nothing.
    const result = await updateMapNode(node.id, {
      name,
      nameAr: form.nameAr.trim(),
      kindId: form.kindId === '' ? null : form.kindId,
      accountManagerId: form.managerId === '' ? null : form.managerId,
      vendor: form.vendor.trim(),
      // ⚠ `''` BECOMES NULL, NOT THE EMPTY STRING. `his_id` is a real foreign
      //   key into the catalogue and its "not recorded" is null; `vendor` two
      //   lines up is free text whose "not recorded" is `''`. Writing `''` here
      //   would be rejected as an invalid uuid, and writing it as a key left off
      //   would make clearing a system silently do nothing — the same pair of
      //   mistakes `updateMapNode`'s own comment describes for `kind_id`.
      hisId: form.hisId === '' ? null : form.hisId,
    })
    if (!alive.current) return
    setBusy(false)
    if (!result.ok) {
      // `result.error` is an i18n KEY from `pgErrorKey`, not a constraint name.
      toast(t(result.error), { tone: 'error' })
      return
    }
    close()
    invalidateConfig()
    toast(t('structure.saved', { name: nodeLabel(result.data) }))
  }

  const archive = async (): Promise<void> => {
    const ok = await confirm({
      title: t('structure.archiveTitle', { name: nodeLabel(node) }),
      body: t('structure.archiveBody'),
      confirmLabel: t('structure.archiveConfirm'),
      cancelLabel: t('common.cancel'),
      danger: true,
    })
    if (!ok || !alive.current) return
    setBusy(true)
    const result = await setMapNodeArchived(node.id, true)
    if (!alive.current) return
    setBusy(false)
    if (!result.ok) {
      toast(t(result.error), { tone: 'error' })
      return
    }
    close()
    invalidateConfig()
    toast(t('structure.archivedToast', { name: nodeLabel(result.data) }))
  }

  if (form === null) {
    return (
      <div className="mbr-edit-row">
        <button type="button" className="btn btn-sm" onClick={open}>
          {t('structure.edit')}
        </button>
      </div>
    )
  }

  const set = (patch: Partial<Form>): void => setForm((f) => (f === null ? f : { ...f, ...patch }))

  return (
    <form
      className="mbr-edit"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <label className="mbr-edit-field">
        <span className="mbr-edit-k">{t('structure.nameEn')}</span>
        <input
          className="input"
          value={form.name}
          maxLength={NAME_MAX}
          onChange={(e) => set({ name: e.target.value })}
          // The one field that cannot be empty, and the browser says so before
          // the toast does.
          required
        />
      </label>

      <label className="mbr-edit-field">
        <span className="mbr-edit-k">{t('structure.nameAr')}</span>
        <input
          className="input"
          value={form.nameAr}
          maxLength={NAME_MAX}
          lang="ar"
          dir="rtl"
          onChange={(e) => set({ nameAr: e.target.value })}
        />
      </label>

      <label className="mbr-edit-field">
        <span className="mbr-edit-k">{t('structure.kind')}</span>
        <select
          className="select"
          value={form.kindId}
          onChange={(e) => set({ kindId: e.target.value })}
        >
          <option value="">{t('structure.kindNone')}</option>
          {kinds.map((kind) => (
            <option key={kind.id} value={kind.id}>
              {kindLabel(kind)}
            </option>
          ))}
        </select>
      </label>

      <label className="mbr-edit-field">
        <span className="mbr-edit-k">{t('mapnode.accountManager')}</span>
        <select
          className="select"
          value={form.managerId}
          onChange={(e) => set({ managerId: e.target.value })}
        >
          <option value="">{t('structure.managerNone')}</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
      </label>

      {/* THE HOSPITAL'S OWN SYSTEM, from the catalogue 0034 seeded.
          A picker rather than free text, and the asymmetry with `vendor` right
          below is deliberate in the other direction: there are eleven of these
          and the estate spells them six ways, so this one gets a closed list.
          Rhapsody is deliberately absent from that list — it is the engine the
          technical team builds interfaces IN, not something a hospital runs. */}
      <label className="mbr-edit-field">
        <span className="mbr-edit-k">{t('structure.his')}</span>
        <select
          className="input"
          value={form.hisId}
          onChange={(e) => set({ hisId: e.target.value })}
        >
          {/* "Nobody has recorded one" is the honest first option and the state
              all 140 organizations are in today. It is not "None" — a hospital
              runs something; we have simply not written down what. */}
          <option value="">{t('structure.hisNone')}</option>
          {hisProducts.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </select>
        <small className="mbr-edit-hint">{t('structure.hisHint')}</small>
      </label>

      <label className="mbr-edit-field">
        <span className="mbr-edit-k">{t('structure.vendor')}</span>
        <input
          className="input"
          value={form.vendor}
          onChange={(e) => set({ vendor: e.target.value })}
        />
        <small className="mbr-edit-hint">{t('structure.vendorHint')}</small>
      </label>

      <div className="mbr-edit-actions">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
          {t('structure.save')}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={close} disabled={busy}>
          {t('common.cancel')}
        </button>
        {/* ARCHIVE, NOT DELETE — see this file's header. Last, and separated,
            because it is the one control here that removes something from every
            other reader's map. */}
        <button
          type="button"
          className="btn btn-sm btn-danger mbr-edit-archive"
          onClick={() => void archive()}
          disabled={busy}
        >
          {t('structure.archive')}
        </button>
      </div>
    </form>
  )
}
