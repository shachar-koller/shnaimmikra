// Writes ios/Config/Supabase.xcconfig from the web app's .env, so both apps use the same project.
// The file is not committed. The anon key is public, as in the web bundle; never put a service key here.
import { readFileSync, writeFileSync } from 'node:fs';

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')
  .map(line => /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line)).filter(Boolean).map(([, key, value]) => [key, value.replace(/^['"]|['"]$/g, '')]));
const url = env.VITE_SUPABASE_URL, key = env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error('.env needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
const host = new URL(url).host;
writeFileSync(new URL('../ios/Config/Supabase.xcconfig', import.meta.url),
  `// Written by scripts/write-ios-config.mjs from .env. Not committed.\nSUPABASE_HOST = ${host}\nSUPABASE_ANON_KEY = ${key}\n`);
console.log(`Wrote ios/Config/Supabase.xcconfig for ${host}.`);
