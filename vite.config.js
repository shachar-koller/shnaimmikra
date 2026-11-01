import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: {
    allowedHosts: ['always-free-vps', 'always-free-vps.tail617571.ts.net', '.ts.net'],
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest,woff2}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        // The plugin only sets these itself when it injects the registration.
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
});
