// Builds the two plugin bundles + the repository manifest.
//
// Pipeline (matches what actually ships to the app, see commits 4fc05dd & dffb3a1):
//   1. esbuild transform  plugins/english/<name>.ts -> CJS at es2022
//      (native class fields: the app's Hermes runtime supports them and the
//      shipped bundles rely on them; es2017 downleveling is NOT used).
//      No bundling: `@libs/*` and `cheerio` stay as bare requires, provided
//      by the app at eval time.
//   2. terser minify (compress.arrows:false keeps `fetchText(...)` calls
//      from being mangled into forms that break on old hermes; toplevel
//      identifiers keep esbuild's __export helpers and the plugin class
//      name so the app's eval wrapper can find the default export).
//   3. CJS interop bridge appended: esbuild CJS output REPLACES module.exports
//      while LNReader's eval wrapper returns its pre-captured `exports`
//      object — the bridge folds the replacement back so the app sees
//      `default` (and named fields) either way.
//
// Requires: npm i esbuild terser (Node >= 22).
import { transformSync } from 'esbuild';
import { minify_sync } from 'terser';
import fs from 'fs';

const USERNAME = '5ghzx';
const REPO = 'novelarchive-lnreader';
const BRANCH = 'main';
const USER_CONTENT_LINK = `https://raw.githubusercontent.com/${USERNAME}/${REPO}/${BRANCH}`;
const STATIC_LINK = `${USER_CONTENT_LINK}/public/static`;
const PLUGIN_LINK = `${USER_CONTENT_LINK}/.js/src/plugins`;

function evalLikeApp(code) {
  const wrapper = new Function('module', 'exports', 'require', code);
  const module = { exports: {} };
  const stubRequire = request => {
    switch (request) {
      case '@libs/fetch': return { fetchText: async () => '' };
      case '@libs/storage': return { storage: { get: () => undefined, set: () => {} } };
      case '@libs/filterInputs': return { FilterTypes: { Picker: 'Picker', Switch: 'Switch', Text: 'Text', Select: 'Select', CheckboxGroup: 'CheckboxGroup', ExcludableCheckboxGroup: 'ExcludableCheckboxGroup' } };
      case '@libs/defaultCover': return { defaultCover: 'default-cover' };
      case 'cheerio': return { load: () => ({}) };
      default: return {};
    }
  };
  wrapper(module, module.exports, stubRequire);
  return module.exports;
}

function buildPlugin(name) {
  const src = fs.readFileSync(`plugins/english/${name}.ts`, 'utf-8');
  const js = transformSync(src, { loader: 'ts', target: 'es2022', format: 'cjs' }).code;
  const result = minify_sync(js, {
    compress: { arrows: false },
    mangle: {},
    ecma: 5,
    enclose: false,
    module: false,
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  const code =
    result.code +
    `\n;if(typeof module==='object'&&module.exports!==exports&&typeof exports==='object'){Object.assign(exports,module.exports);}`;

  // Gate: evaluate the bundle exactly like the app does (CJS eval wrapper
  // that captures `exports` before running). The app's update path reads
  // name/site/lang/version off the evaluated module's DEFAULT EXPORT (the
  // plugin instance); a bundle missing any of those produces nameless rows
  // that crash the source list (24b2b43), and exports-replacing bundles
  // break install/update (dffb3a1).
  const evaluated = evalLikeApp(code);
  const instance = evaluated.default ?? evaluated;
  for (const field of ['id', 'name', 'site', 'lang', 'version']) {
    if (!instance[field]) {
      console.error(`App-style eval of built ${name} exposes no '${field}' — refusing to ship`);
      process.exit(1);
    }
  }
  const version = instance.version;

  const outDir = `.js/src/plugins/english`;
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(`${outDir}/${name}.js`, code);
  return { name, version };
}

const built = [buildPlugin('novelarchive'), buildPlugin('lnori.com')];

const manifest = [
  {
    id: 'novelarchive',
    name: 'Novel Archive',
    site: 'https://novelarchive.cc',
    lang: 'English',
    version: built.find(b => b.name === 'novelarchive').version,
    url: `${PLUGIN_LINK}/english/novelarchive.js`,
    iconUrl: `${STATIC_LINK}/src/en/novelarchive/icon.png`,
  },
  {
    id: 'lnori-com',
    name: 'LNORI.com',
    site: 'https://lnori.com/',
    lang: 'English',
    version: built.find(b => b.name === 'lnori.com').version,
    url: `${PLUGIN_LINK}/english/lnori.com.js`,
    iconUrl: `${STATIC_LINK}/src/en/lnori/icon.png`,
  },
];
fs.mkdirSync('.dist', { recursive: true });
fs.writeFileSync('.dist/plugins.min.json', JSON.stringify(manifest));
console.log('Manifest written:', JSON.stringify(manifest, null, 2));
