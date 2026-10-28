import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// BASE is set by the GitHub Pages deploy, which serves the app from /<repo>/.
export default defineConfig({
  base: process.env.BASE ?? '/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'MaenglerBox',
        short_name: 'MaenglerBox',
        description: 'Modular, generative music environment',
        theme_color: '#111214',
        background_color: '#111214',
        display: 'standalone',
        orientation: 'any',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
});
