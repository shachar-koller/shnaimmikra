import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({plugins:[VitePWA({registerType:'prompt',injectRegister:false,manifest:false,workbox:{globPatterns:['**/*.{js,css,html,png,webmanifest,woff2}'],navigateFallback:'/index.html',cleanupOutdatedCaches:true}})]});
