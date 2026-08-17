import { minify_sync } from 'terser';
import fs from 'fs';

function buildPlugin(name) {
  const plugin = `.js/plugins/english/${name}.js`;
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
  const outDir = `.js/src/plugins/english`;
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(`${outDir}/${name}.js`, result.code);
  return { name, code: result.code };
}

buildPlugin('novelarchive');
buildPlugin('lnori.com');

const USERNAME = '5ghzx';
const REPO = 'novelarchive-lnreader';
const BRANCH = 'main';
const USER_CONTENT_LINK = `https://raw.githubusercontent.com/${USERNAME}/${REPO}/${BRANCH}`;
const STATIC_LINK = `${USER_CONTENT_LINK}/public/static`;
const PLUGIN_LINK = `${USER_CONTENT_LINK}/.js/src/plugins`;

function getVersion(name) {
  const code = fs.readFileSync(`.js/src/plugins/english/${name}.js`, 'utf-8');
  const match = code.match(/version\s*=\s*['"]([^'"]+)['"]/);
  if (!match) {
    console.error(`Could not find version field in ${name}`);
    process.exit(1);
  }
  return match[1];
}

const manifest = [
  {
    id: 'novelarchive',
    name: 'Novel Archive',
    site: 'https://novelarchive.cc',
    lang: 'English',
    version: getVersion('novelarchive'),
    url: `${PLUGIN_LINK}/english/novelarchive.js`,
    iconUrl: `${STATIC_LINK}/src/en/novelarchive/icon.png`,
  },
  {
    id: 'lnori-com',
    name: 'LNORI.com',
    site: 'https://lnori.com/',
    lang: 'English',
    version: getVersion('lnori.com'),
    url: `${PLUGIN_LINK}/english/lnori.com.js`,
    iconUrl: `${STATIC_LINK}/src/en/lnori/icon.png`,
  },
];
fs.mkdirSync('.dist', { recursive: true });
fs.writeFileSync('.dist/plugins.min.json', JSON.stringify(manifest));
console.log('Manifest written:', JSON.stringify(manifest, null, 2));