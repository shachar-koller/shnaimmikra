import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  use: {
    baseURL: 'http://127.0.0.1:5175',
    viewport: { width: 393, height: 852 },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 5175 --strictPort',
    url: 'http://127.0.0.1:5175',
    env: {
      VITE_SUPABASE_URL: 'https://auth-test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'test-public-anon-key',
      VITE_GOOGLE_CLIENT_ID: '',
    },
  },
});
