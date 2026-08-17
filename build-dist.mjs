import { minify_sync } from 'terser';
import fs from 'fs';

const plugins = [
  {
    source: 'plugins/english/novelarchive.js',
    id: 'novelarchive',
    name: 'Novel Archive',
    site: 'https://novelarchive.cc',
    iconUrl: 'https://raw.githubusercontent.com/5ghzx/novelarchive-lnreader/main/public/static/src/en/novelarchive/icon.png',
  },
  {
    source: 'plugins/english/lnori.com.js',
    id: 'lnori-com',
    name: 'LNORI.com',
    site: 'https://lnori.com/',
    iconUrl: 'https://raw.githubusercontent.com/lnreader/lnreader-plugins/master/public/static/src/en/lnori/icon.png',
  },
];

const USERNAME = '5ghzx';
const REPO = 'novelarchive-lnreader';
const BRANCH = 'main';
const USER_CONTENT_LINK = `https://raw.githubusercontent.com/${USERNAME}/${REPO}/${BRANCH}`;
const STATIC_LINK = `${USER_CONTENT_LINK}/public/static`;
const PLUGIN_LINK = `${USER_CONTENT_LINK}/.js/src/plugins`;

const manifest = [];

for (const plugin of plugins) {
  const code = fs.readFileSync(plugin.source, 'utf-8');
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

  const outputName = plugin.source.split('/').pop();
  const outDir = '.js/src/plugins/english';
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(`${outDir}/${outputName}`, result.code);

  const versionMatch = code.match(/version\s*=\s*['"]([^'"]+)['"]/);
  if (!versionMatch) {
    console.error(`Could not find version field in ${plugin.source}`);
    process.exit(1);
  }

  manifest.push({
    id: plugin.id,
    name: plugin.name,
    site: plugin.site,
    lang: 'English',
    version: versionMatch[1],
    url: `${PLUGIN_LINK}/english/${outputName}`,
    iconUrl: plugin.iconUrl,
  });

  console.log(`${plugin.name}: minified bytes ${result.code.length}`);
}

fs.mkdirSync('.dist', { recursive: true });
fs.writeFileSync('.dist/plugins.min.json', JSON.stringify(manifest));
console.log(JSON.stringify(manifest, null, 2));
