import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import pkg from './package.json' with { type: 'json' }

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths so the build works at any URL. GitHub Pages serves
  // project sites from /<repo-name>/, and an absolute '/assets/...' 404s there.
  base: './',
  // Expose the real package.json version to the app (About card in Settings).
  // Declared for TS in src/vite-env.d.ts.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    VitePWA({
      // 'prompt': never swap the service worker under the user mid-task. The app
      // shows a "new version available" bar and applies it only on tap —
      // auto-reload during a capture would lose whatever was half-typed.
      registerType: 'prompt',
      // The SVG favicon and the Apple touch icon are not referenced by the
      // manifest, so workbox would leave them out of the precache.
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'favicon-32.png'],
      manifest: {
        name: 'CoreTrack',
        short_name: 'CoreTrack',
        description: 'Multi-track action and decision tracker for operations leads.',
        display: 'standalone',
        orientation: 'portrait',
        // Relative so the installed app scopes correctly under /opstrack/ on
        // GitHub Pages (both are resolved against the deployed manifest URL).
        start_url: './',
        scope: './',
        // The dark theme's --bg from global.css, so the standalone status bar
        // and the generated splash screen do not flash a different colour
        // before React mounts. It claimed to match from Wave 4 and did not —
        // #101215 against a real --bg of #101519 — which the v1.0.0 release
        // smoke measured on the deployed manifest. `background_color` is the
        // one Android actually paints the splash with, so the drift was most
        // visible on exactly the install this release is being handed to.
        // capacitor.config.json already carried the correct value; these two
        // and src/lib/theme.ts were the three that did not.
        background_color: '#101519',
        theme_color: '#101519',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // SPA under hash routing: every navigation serves the precached shell.
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // Supabase auth, PostgREST and Realtime must NEVER be served from
            // cache — a cached token refresh or a cached entry list would show
            // stale ownership/status, which is exactly what this app exists to
            // prevent. Offline reads come from the app's own cache instead.
            urlPattern: /^https:\/\/[^/]+\.supabase\.co\/.*/i,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
})
