// Monta a pasta www/ que o Capacitor empacota no APK: o front-end do app (src/main/resources/static), a API local
// (src/browser.js empacotado) e o SQLite em WebAssembly. Nada aqui precisa de internet para rodar.
import {build} from 'esbuild';
import {cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = join(root, '..', 'src', 'main', 'resources', 'static');
const www = join(root, 'www');

if (!existsSync(staticDir)) throw new Error(`Front-end nao encontrado em ${staticDir}`);

rmSync(www, {recursive: true, force: true});
cpSync(staticDir, www, {recursive: true});
mkdirSync(join(www, 'js'), {recursive: true});

await build({
    entryPoints: [join(root, 'src', 'browser.js')],
    outfile: join(www, 'js', 'local-api.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    minify: true,
    logLevel: 'warning'
});
cpSync(join(root, 'node_modules', 'sql.js', 'dist', 'sql-wasm-browser.wasm'), join(www, 'js', 'sql-wasm-browser.wasm'));

// A API local precisa existir antes do primeiro fetch do front-end.
const indexPath = join(www, 'index.html');
const html = readFileSync(indexPath, 'utf8');
if (!html.includes('<script src="/js/lang.js"></script>')) throw new Error('index.html mudou: ajuste o ponto de injecao da API local');
writeFileSync(indexPath, html.replace('<script src="/js/lang.js"></script>', '<script src="/js/local-api.js"></script>\n<script src="/js/lang.js"></script>'));

// O app ja abre sem rede (tudo esta no aparelho): o service worker do PWA so atrapalharia as atualizacoes do APK.
writeFileSync(join(www, 'sw.js'), `// Substituido no build do aplicativo: remove o service worker antigo.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(
    self.registration.unregister().then(() => caches.keys()).then(keys => Promise.all(keys.map(k => caches.delete(k))))));
`);

// Servidor de sync padrao (opcional): sync-hub.json na raiz de mobile/ vira www/hub.json. Vazio = cada pessoa usa o seu projeto.
const hubFile = join(root, 'sync-hub.json');
writeFileSync(join(www, 'hub.json'), existsSync(hubFile) ? readFileSync(hubFile, 'utf8') : '{"url":"","anonKey":""}');

console.log('www/ pronto');
