import {HttpError} from './local-api/http.js';

// Rotas /backups do aplicativo do celular. As copias ficam guardadas no proprio aparelho (um "store" assincrono: o
// IndexedDB no app, a memoria nos testes) e podem ser salvas/compartilhadas como arquivo pelo front-end.
// Mesmas rotas do back-end Java (BackupController), mas o arquivo e JSON em vez de um script SQL do H2.

/** Quantas copias manuais (e de seguranca antes de restaurar) ficam guardadas. */
export const KEEP = 30;
export const KEEP_AUTOMATIC = 7;

const NAME = /^backup-\d{8}-\d{6}(-\d+)?(-antes-de-restaurar|-auto)?\.json$/;
const pad = n => String(n).padStart(2, '0');

export function stampOf(date) {
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** Store em memoria com a mesma interface do IndexedDB; usado nos testes. */
export class MemoryBackupStore {
    constructor() { this.items = new Map(); }
    async list() { return [...this.items.values()].map(({name, createdAt, sizeBytes}) => ({name, createdAt, sizeBytes})); }
    async get(name) { return this.items.get(name) ?? null; }
    async put(entry) { this.items.set(entry.name, entry); }
    async delete(name) { this.items.delete(name); }
}

export function createBackupHttp({backup, store, clock = () => new Date()}) {
    const list = async () => (await store.list()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.name < b.name ? 1 : -1));

    async function uniqueName(suffix) {
        const base = `backup-${stampOf(clock())}`;
        let name = `${base}${suffix}.json`;
        for (let n = 2; await store.get(name); n++) name = `${base}-${n}${suffix}.json`;
        return name;
    }

    async function create(suffix = '') {
        const content = backup.dump();
        const entry = {name: await uniqueName(suffix), createdAt: clock().toISOString(), sizeBytes: new Blob([content]).size, content};
        await store.put(entry);
        await prune();
        return {name: entry.name, sizeBytes: entry.sizeBytes, createdAt: entry.createdAt};
    }

    /** Mantem as copias automaticas (as 7 mais novas) separadas das manuais, para uma nao expulsar a outra. */
    async function prune() {
        const all = await list();
        const auto = all.filter(b => b.name.endsWith('-auto.json'));
        const manual = all.filter(b => !b.name.endsWith('-auto.json'));
        for (const b of [...auto.slice(KEEP_AUTOMATIC), ...manual.slice(KEEP)]) await store.delete(b.name);
    }

    const requireName = name => {
        if (!NAME.test(name)) throw new HttpError(404, `Backup não encontrado: ${name}`);
        return name;
    };

    async function read(name) {
        const entry = await store.get(requireName(name));
        if (!entry) throw new HttpError(404, `Backup não encontrado: ${name}`);
        return entry.content;
    }

    /** Guarda uma copia do que existe agora e so entao substitui; se o arquivo for invalido nada muda (e a copia some). */
    async function restoreContent(content) {
        if (typeof content !== 'string' || !content.trim()) throw new HttpError(400, 'Dados inválidos.', {content: 'O arquivo está vazio.'});
        backup.parse(content); // recusa antes de guardar a copia de seguranca
        const safety = await create('-antes-de-restaurar');
        try {
            backup.restore(content);
        } catch (e) {
            await store.delete(safety.name);
            throw e;
        }
    }

    /** Devolve {status, body | text} ou null se a rota nao for de backup. */
    async function handle(method, path, body) {
        if (path !== '/backups' && !path.startsWith('/backups/')) return null;
        const parts = path.split('/').filter(Boolean).slice(1).map(decodeURIComponent);
        if (parts.length === 0) {
            if (method === 'GET') return {status: 200, body: await list()};
            if (method === 'POST') return {status: 201, body: await create()};
        } else if (parts.length === 1 && parts[0] === 'restore' && method === 'POST') {
            await restoreContent(body?.content);
            return {status: 204, body: null};
        } else if (parts.length === 1 && method === 'GET') {
            return {status: 200, text: await read(parts[0]), contentType: 'application/json;charset=UTF-8'};
        } else if (parts.length === 1 && method === 'DELETE') {
            await store.delete(requireName(parts[0]));
            return {status: 204, body: null};
        } else if (parts.length === 2 && parts[1] === 'restore' && method === 'POST') {
            await restoreContent(await read(parts[0]));
            return {status: 204, body: null};
        }
        throw new HttpError(405, 'Método não permitido.');
    }

    /** Uma copia por dia, enquanto a configuracao "backup automatico" estiver ligada. */
    async function automaticIfDue(enabled) {
        if (!enabled) return false;
        const last = (await list()).find(b => b.name.endsWith('-auto.json'));
        if (last && clock().getTime() - Date.parse(last.createdAt) < 24 * 60 * 60 * 1000) return false;
        await create('-auto');
        return true;
    }

    return {handle, create, automaticIfDue, restoreContent, read};
}
