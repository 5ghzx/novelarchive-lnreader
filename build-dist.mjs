import { minify_sync } from 'terser';
import fs from 'fs';
const plugin = '.js/plugins/english/novelarchive.js';
const code = fs.readFileSync(plugin, 'utf-8');
const result = minify_sync(code, {
  compress: { arrows: false },
  mangle: {},
  ecma: 5,
  enclose: false,
  module: true,
  toplevel: true,
});
if (result.error) {
  console.error(result.error);
  process.exit(1);
}
const outDir = '.js/src/plugins/english';
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(`${outDir}/novelarchive.js`, result.code);
const USERNAME = '5ghzx';
const REPO = 'novelarchive-lnreader';
const BRANCH = 'main';
const USER_CONTENT_LINK = `https://raw.githubusercontent.com/${USERNAME}/${REPO}/${BRANCH}`;
const STATIC_LINK = `${USER_CONTENT_LINK}/public/static`;
const PLUGIN_LINK = `${USER_CONTENT_LINK}/.js/src/plugins`;

// Single source of truth: read the version the plugin was compiled with so the
// manifest can never drift from the plugin's own version field.
const versionMatch = code.match(/version\s*=\s*['"]([^'"]+)['"]/);
if (!versionMatch) {
  console.error('Could not find version field in compiled plugin');
  process.exit(1);
}
const VERSION = versionMatch[1];

const AI_NOTE =
  'AI-generated plugin. The author notes: "I understand that AI generated ' +
  'software has a reputation for being of poor quality, but I am certain this ' +
  'task was simple enough for AI to handle while I focused on other things ' +
  'like reading and enjoying."';
// NOTE: the AI note is surfaced in README.md (where the repo is shared), not in
// the manifest. The official manifest schema has no `description` key, and extra
// keys risk strict parsers — so we keep the manifest standards-clean.

const manifest = [
  {
    id: 'novelarchive2',
    name: 'Novel Archive',
    site: 'https://novelarchive.cc',
    lang: 'English',
    version: VERSION,
    url: `${PLUGIN_LINK}/english/novelarchive.js`,
    iconUrl: `${STATIC_LINK}/src/en/novelarchive/icon.png`,
  },
];
fs.mkdirSync('.dist', { recursive: true });
fs.writeFileSync('.dist/plugins.min.json', JSON.stringify(manifest));
console.log('minified bytes', result.code.length);
console.log(JSON.stringify(manifest, null, 2));
