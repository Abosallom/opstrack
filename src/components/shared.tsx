// Shared UI building blocks used across pages.
//
// These deliberately have no co-located stylesheet: they lean on the global
// primitives (.card, .empty-state, .skeleton) so they stay consistent with
// every page, and the only self-contained styling here is the spinner's
// keyframes, which are injected inline so the spinner keeps working even when
// it renders inside a Suspense fallback before any route CSS chunk has loaded.

import type { ReactElement, ReactNode } from 'react'
import { t } from '../lib/i18n'

/**
 * Three pulsing dots. Used as the route-chunk Suspense fallback and as the
 * boot splash while the auth session is being restored.
 *
 * role="status" + aria-label so a screen reader announces the wait instead of
 * silence; the dots themselves are decorative.
 */
export function LoadingSpinner({ label }: { label?: string }): ReactElement {
  return (
    <div className="ops-spinner" role="status" aria-label={label ?? t('common.loading')}>
      <style>{`
        .ops-spinner {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          padding-block: 3.5rem;
        }
        .ops-spinner-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--text-dim);
          animation: ops-dot-pulse 1.2s ease-in-out infinite;
        }
        .ops-spinner-dot:nth-of-type(2) { animation-delay: 0.18s; }
        .ops-spinner-dot:nth-of-type(3) { animation-delay: 0.36s; }
        @keyframes ops-dot-pulse {
          0%, 80%, 100% { opacity: 0.25; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .ops-spinner-dot { animation: none; opacity: 0.5; }
        }
      `}</style>
      <span className="ops-spinner-dot" />
      <span className="ops-spinner-dot" />
      <span className="ops-spinner-dot" />
    </div>
  )
}

/**
 * Empty states always suggest a next action rather than just stating the void —
 * a blank list with no way forward is the most common dead end in this app.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}): ReactElement {
  return (
    <div className="empty-state">
      {icon && (
        <div className="empty-state-icon" aria-hidden="true">
          {icon}
        </div>
      )}
      <p className="empty-state-title">{title}</p>
      {description && <p className="empty-state-body">{description}</p>}
      {action}
    </div>
  )
}

/**
 * Shimmer placeholder. Loading skeletons are aria-hidden and wrapped by the
 * caller's own live region — announcing "loading, loading, loading…" once per
 * skeleton line is worse than silence.
 *
 * `width` is a raw CSS length so callers can pass percentages for ragged,
 * text-like rows.
 */
export function Skeleton({
  width = '100%',
  height = 14,
  radius,
  count = 1,
}: {
  width?: string
  height?: number
  radius?: number
  count?: number
}): ReactElement {
  return (
    <div aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="skeleton"
          style={{
            width,
            height,
            borderRadius: radius ?? 'var(--radius-sm)',
            marginBlockStart: i === 0 ? 0 : 8,
          }}
        />
      ))}
    </div>
  )
}
