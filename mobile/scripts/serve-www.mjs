// Servidor estatico para testar o app do celular no navegador do computador (sem Java): npm run serve
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {dirname, extname, join, normalize} from 'node:path';
import {fileURLToPath} from 'node:url';

const www = join(dirname(fileURLToPath(import.meta.url)), '..', 'www');
const port = Number(process.env.PORT || 5173);
const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon'
};

createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const file = normalize(join(www, path === '/' ? 'index.html' : path));
    if (!file.startsWith(www)) { res.writeHead(403).end(); return; }
    try {
        const data = await readFile(file);
        res.writeHead(200, {'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store'}).end(data);
    } catch {
        res.writeHead(404).end('nao encontrado');
    }
}).listen(port, () => console.log(`http://localhost:${port}`));
