// The only error boundary in the app, and the reason it exists is deployment.
//
// THE FAILURE IT CATCHES. Every route is `lazy()`, so navigating fetches a
// content-hashed chunk. `deploy-pages` REPLACES the site: the moment a new build
// lands, `assets/Board-BSzM_1eh.js` stops existing. Anyone with the tab already
// open is holding an index bundle that still asks for it, so their next
// navigation rejects a dynamic import — and React unmounts the entire tree when
// nothing catches that. Not a broken page: a WHITE SCREEN, with no toast, no
// message and no way back short of a manual reload the user has to think of.
//
// It is not hypothetical either. `registerType: 'prompt'` means the service
// worker never calls clientsClaim, so the first visit is uncontrolled and the
// precache cannot serve the old chunk back. And the update prompt itself can be
// missed — see the sticky-toast rule in toast.tsx.
//
// WHY THE ANSWER IS "RELOAD" AND NOT "RETRY". A missing chunk does not come
// back; the index bundle asking for it is the stale thing. Reload is the fix
// and it is offered first. "Try again" is kept as the secondary action for
// every OTHER error — a render crash in one screen, a bad row from a resolver —
// where re-rendering genuinely can recover and a full reload would throw away
// unsaved capture text.
//
// STYLING: none of its own. It composes EmptyState and the `.btn` primitives,
// so there is no new stylesheet and nothing to register in the CSS prefix
// table (§1.0.4) — and an error screen that inherits the app's own spacing and
// type is one less thing that can look broken while reporting breakage.

import { Component, type ErrorInfo, type ReactElement, type ReactNode } from 'react'
import { EmptyState } from './shared'
import { t } from '../lib/i18n'

interface Props {
  children: ReactNode
  /**
   * Change this to clear a caught error. App passes the pathname, so navigating
   * away from a screen that crashed gives the next one a clean boundary instead
   * of wedging the session behind one bad route.
   *
   * A `key` would do the same thing by remounting — and would also throw away
   * the Suspense tree and every route's state on EVERY navigation, which is a
   * steep price for an error that has not happened.
   */
  resetKey?: string
}

interface State {
  error: Error | null
  /** The `resetKey` this state was derived under, so a change can be detected. */
  seenKey: string | undefined
}

/** Vite's dynamic-import failures, which are the deploy case above. */
function isChunkError(error: Error): boolean {
  const text = `${error.name} ${error.message}`
  return (
    /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk/i.test(
      text,
    ) || error.name === 'ChunkLoadError'
  )
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, seenKey: this.props.resetKey }

  static getDerivedStateFromError(error: Error): Pick<State, 'error'> {
    return { error }
  }

  /**
   * Clear the error when `resetKey` changes.
   *
   * Here rather than in componentDidUpdate — which is the other way to write
   * this and the way React's own docs used to show — because setState during
   * componentDidUpdate renders the failed subtree a second time before
   * replacing it. On a route change that means mounting the crashed screen,
   * catching again, and only then recovering. Deriving it clears the error in
   * the SAME render that brings the new key, so the new route mounts once.
   *
   * The order is safe: after a throw, this runs on the next render with
   * `props.resetKey` still equal to `seenKey`, so it returns null and leaves
   * the error that getDerivedStateFromError just set.
   */
  static getDerivedStateFromProps(props: Props, state: State): State | null {
    if (props.resetKey === state.seenKey) return null
    return { error: null, seenKey: props.resetKey }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The only place this is recorded. There is no error-reporting service on
    // this project, and a boundary that swallows the stack makes the bug it
    // caught harder to fix than the white screen was.
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    const { resetKey } = this.props
    if (error === null) return this.props.children

    const chunk = isChunkError(error)
    return (
      <ErrorPanel
        // A stale build is not the user's mistake and "something went wrong"
        // invites them to look for it. `pwa.updateReady` already says the true
        // thing — a new version is here — and the button below applies it.
        title={chunk ? t('pwa.updateReady') : t('common.error')}
        description={chunk ? undefined : t('common.errorHint')}
        onRetry={chunk ? undefined : () => this.setState({ error: null, seenKey: resetKey })}
      />
    )
  }
}

function ErrorPanel({
  title,
  description,
  onRetry,
}: {
  title: string
  description?: string
  onRetry?: () => void
}): ReactElement {
  return (
    <EmptyState
      title={title}
      description={description}
      // Stacked, not side by side: `.empty-state` is already a centred column
      // and every `.btn` inside it gets its own block spacing, so a fragment
      // needs no wrapper, no new class and no entry in the prefix registry —
      // and it mirrors correctly in RTL for free.
      action={
        <>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              window.location.reload()
            }}
          >
            {t('common.reload')}
          </button>
          {onRetry && (
            <button type="button" className="btn btn-ghost" onClick={onRetry}>
              {t('common.retry')}
            </button>
          )}
        </>
      }
    />
  )
}
