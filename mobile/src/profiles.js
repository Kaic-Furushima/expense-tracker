import {HttpError, badRequest, conflict, notFound} from './local-api/http.js';

// Perfis (por exemplo, um por pessoa): cada um tem o proprio banco, com lancamentos, contas, categorias, orcamentos e
// backups separados. Porta de ProfileService, do back-end Java. O idioma vale para o app todo.
// Remover um perfil o manda primeiro para a LIXEIRA (nada e apagado); de la ele volta ou e excluido de vez.
// Para o sync, cada perfil tem uma identidade (syncId, a mesma em todos os aparelhos; o principal e sempre "default"),
// o instante da ultima alteracao e, na lixeira, o instante em que foi para la.
// Aqui so ha a logica; o armazenamento e a abertura de cada banco vem de fora (browser.js no app, memoria nos testes).

export const MAIN = 'main';
export const MAIN_SYNC_ID = 'default';
export const MAX_PROFILES = 10;
export const MAX_NAME = 40;
const LANGUAGES = ['pt', 'en', 'es'];

const cleanName = raw => {
    const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
    if (!name) throw badRequest('Dê um nome ao perfil.');
    if (name.length > MAX_NAME) throw badRequest(`O nome pode ter no máximo ${MAX_NAME} caracteres.`);
    return name;
};

export class Profiles {
    /**
     * @param storage     {readMeta(), writeMeta(meta), deleteProfile(id), deleteAll()}: lista de perfis e dados de cada um
     * @param openRuntime async (id, languageStore) => runtime {api, flush(), close()}: abre (ou cria) o banco do perfil
     * @param newId       gera o id de um perfil novo (8 letras/numeros)
     * @param newSyncId   gera a identidade de sync de um perfil novo
     * @param now         () => milissegundos (os testes controlam)
     */
    constructor({storage, openRuntime, newId = () => crypto.randomUUID().replaceAll('-', '').slice(0, 8),
        newSyncId = () => crypto.randomUUID(), now = () => Date.now()}) {
        this.storage = storage;
        this.openRuntime = openRuntime;
        this.newId = newId;
        this.newSyncId = newSyncId;
        this.now = now;
        this.meta = null;
        this.runtime = null;
        this.languageStore = {get: () => this.meta?.language ?? 'pt', set: language => this.setLanguage(language)};
    }

    async init() {
        const stored = await this.storage.readMeta();
        this.meta = {ids: [], names: {}, last: MAIN, language: 'pt', ...(stored ?? {})};
        for (const key of ['sync', 'updated', 'trashed', 'sent']) this.meta[key] ??= {};
        this.meta.purged ??= [];
        if (!LANGUAGES.includes(this.meta.language)) this.meta.language = 'pt';
        if (!this.exists(this.meta.last)) this.meta.last = MAIN;
        this.runtime = await this.openRuntime(this.meta.last, this.languageStore);
        return this;
    }

    get current() { return this.meta.last; }

    // ---- listas ----

    /** Os perfis em uso (os da lixeira nao entram). */
    list() {
        return [{id: MAIN, name: this.meta.names[MAIN] ?? 'Principal'},
            ...this.meta.ids.filter(id => !this.meta.trashed[id]).map(id => ({id, name: this.meta.names[id] ?? id}))];
    }

    trashed() {
        return this.meta.ids.filter(id => this.meta.trashed[id])
            .map(id => ({id, name: this.meta.names[id] ?? id, trashedAt: this.meta.trashed[id]}));
    }

    /** Em uso: ninguem troca para um perfil da lixeira. */
    exists(id) { return id === MAIN || (this.meta.ids.includes(id) && !this.meta.trashed[id]); }

    /** Em uso ou na lixeira. */
    existsAny(id) { return id === MAIN || this.meta.ids.includes(id); }

    snapshot() {
        return {profiles: this.list(), trashed: this.trashed(), current: this.current, language: this.meta.language};
    }

    async save() { await this.storage.writeMeta(this.meta); }

    setLanguage(language) {
        if (!LANGUAGES.includes(language)) throw badRequest('Idioma inválido.');
        this.meta.language = language;
        return this.save();
    }

    requireFreeName(name, exceptId) {
        if (this.list().some(p => p.id !== exceptId && p.name.toLowerCase() === name.toLowerCase())) throw conflict('Já existe um perfil com esse nome.');
    }

    /** O nome, ou "nome (2)", "nome (3)"... quando outro perfil em uso ja o tem. */
    freeName(name, exceptId) {
        const taken = new Set(this.list().filter(p => p.id !== exceptId).map(p => p.name.toLowerCase()));
        let candidate = name;
        for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
            const suffix = ` (${n})`;
            candidate = name.slice(0, MAX_NAME - suffix.length) + suffix;
        }
        return candidate;
    }

    touch(id) { this.meta.updated[id] = this.now(); }

    inUseCount() { return 1 + this.meta.ids.filter(id => !this.meta.trashed[id]).length; }

    // ---- abrir bancos ----

    /** Passa a usar o perfil: grava o que estava pendente no atual, fecha-o e abre o outro. */
    async select(id) {
        if (!this.exists(id)) throw notFound('Perfil não encontrado.');
        if (id !== this.meta.last) {
            await this.runtime.flush();
            const next = await this.openRuntime(id, this.languageStore);
            this.runtime.close();
            this.runtime = next;
            this.meta.last = id;
        }
        await this.save();
    }

    /** Roda fn com o banco de um perfil (o em uso, ou um aberto so por um instante). Grava o que fn alterar. */
    async withRuntime(id, fn) {
        if (!this.existsAny(id)) throw notFound('Perfil não encontrado.');
        if (id === this.meta.last) {
            const result = await fn(this.runtime);
            await this.runtime.flush();
            return result;
        }
        const temp = await this.openRuntime(id, this.languageStore);
        try {
            return await fn(temp);
        } finally {
            await temp.flush();
            temp.close();
        }
    }

    // ---- criar, renomear, lixeira ----

    async register(id, name, {syncId, trashedAt = null, updatedAt = this.now()} = {}) {
        this.meta.ids.push(id);
        this.meta.names[id] = name;
        this.meta.sync[id] = syncId ?? this.newSyncId();
        this.meta.updated[id] = updatedAt;
        if (trashedAt != null) this.meta.trashed[id] = trashedAt;
    }

    /** Cria um perfil vazio sem passar a usa-lo (por exemplo, para restaurar um backup nele). */
    async createQuiet(rawName) {
        const name = cleanName(rawName);
        if (this.inUseCount() >= MAX_PROFILES) throw badRequest(`Limite de ${MAX_PROFILES} perfis atingido.`);
        this.requireFreeName(name, null);
        const id = this.newId();
        const next = await this.openRuntime(id, this.languageStore);
        await next.flush();
        next.close();
        await this.register(id, name);
        await this.save();
        return {id, name};
    }

    /** Cria um perfil vazio (com as categorias e formas de pagamento padrao) e ja passa a usa-lo. */
    async create(rawName) {
        const name = cleanName(rawName);
        if (this.inUseCount() >= MAX_PROFILES) throw badRequest(`Limite de ${MAX_PROFILES} perfis atingido.`);
        this.requireFreeName(name, null);
        const id = this.newId();
        await this.runtime.flush();
        const next = await this.openRuntime(id, this.languageStore); // cria o banco e os dados iniciais
        await next.flush();
        this.runtime.close();
        this.runtime = next;
        await this.register(id, name);
        this.meta.last = id;
        await this.save();
        return {id, name};
    }

    async rename(id, rawName) {
        if (!this.existsAny(id)) throw notFound('Perfil não encontrado.');
        const name = cleanName(rawName);
        this.requireFreeName(name, id);
        this.meta.names[id] = name;
        this.touch(id);
        await this.save();
    }

    /** Manda o perfil para a lixeira: some do app, nada e apagado, e da para restaurar. */
    async remove(id) {
        if (id === MAIN) throw badRequest('O perfil principal não pode ser removido.');
        if (!this.exists(id)) throw notFound('Perfil não encontrado.');
        if (id === this.meta.last) await this.select(MAIN);
        this.meta.trashed[id] = this.now();
        this.touch(id);
        await this.save();
    }

    /** Tira da lixeira (o nome ganha um numero se outro perfil o tomou nesse meio tempo). */
    async restore(id) {
        if (!this.meta.ids.includes(id) || !this.meta.trashed[id]) throw notFound('Perfil não encontrado na lixeira.');
        this.meta.names[id] = this.freeName(this.meta.names[id] ?? id, id);
        delete this.meta.trashed[id];
        this.touch(id);
        await this.save();
        return {id, name: this.meta.names[id]};
    }

    /** Exclui de vez um perfil que esta na lixeira: apaga os dados daqui; o sync avisa os outros aparelhos. */
    async purge(id) {
        if (!this.meta.ids.includes(id) || !this.meta.trashed[id]) throw badRequest('Só dá para excluir de vez um perfil que está na lixeira.');
        const syncId = this.syncIdOf(id);
        await this.forget(id);
        this.meta.purged.push({syncId, at: this.now()});
        await this.save();
        await this.storage.deleteProfile(id);
    }

    async forget(id) {
        if (id === this.meta.last) await this.select(MAIN);
        this.meta.ids = this.meta.ids.filter(x => x !== id);
        for (const key of ['names', 'sync', 'updated', 'trashed', 'sent']) delete this.meta[key][id];
    }

    // ---- registro de perfis do sync ----

    syncIdOf(id) {
        if (id === MAIN) return MAIN_SYNC_ID;
        if (!this.meta.ids.includes(id)) throw notFound('Perfil não encontrado.');
        return (this.meta.sync[id] ??= this.newSyncId()); // perfis de antes do sync ganham a identidade na primeira vez
    }

    idOfSync(syncId) {
        if (syncId === MAIN_SYNC_ID) return MAIN;
        return this.meta.ids.find(id => this.meta.sync[id] === syncId) ?? null;
    }

    /** Todos os perfis conhecidos, os da lixeira tambem, com o que o registro leva. */
    registry() {
        return [{id: MAIN, syncId: MAIN_SYNC_ID, name: this.meta.names[MAIN] ?? 'Principal', updatedAt: this.meta.updated[MAIN] ?? 0, trashedAt: null},
            ...this.meta.ids.map(id => ({id, syncId: this.syncIdOf(id), name: this.meta.names[id] ?? id,
                updatedAt: this.meta.updated[id] ?? 0, trashedAt: this.meta.trashed[id] ?? null}))];
    }

    registrySentAt(id) { return this.meta.sent[id] ?? -1; }

    async markRegistrySent(id, updatedAt) { this.meta.sent[id] = updatedAt; await this.save(); }

    purged() { return [...this.meta.purged]; }

    async forgetPurged(syncId) { this.meta.purged = this.meta.purged.filter(p => p.syncId !== syncId); await this.save(); }

    /** Um perfil que outro aparelho criou: nasce aqui com a mesma identidade (os dados vem no proximo sync de dados). */
    async createFromRemote(syncId, rawName, trashedAt, updatedAt) {
        if (this.inUseCount() >= MAX_PROFILES) throw badRequest(`Limite de ${MAX_PROFILES} perfis atingido.`);
        const id = this.newId();
        const next = await this.openRuntime(id, this.languageStore); // cria o banco e os dados iniciais
        await next.flush();
        next.close();
        await this.register(id, this.freeName(cleanName(rawName), null), {syncId, trashedAt, updatedAt});
        this.meta.sent[id] = updatedAt; // veio do hub: nada a devolver
        await this.save();
        return id;
    }

    /** O que outro aparelho mudou (nome, lixeira). O instante dele passa a ser o nosso, para nao voltar. */
    async updateFromRemote(id, rawName, trashedAt, updatedAt) {
        this.meta.names[id] = this.freeName(cleanName(rawName), id);
        if (trashedAt == null) delete this.meta.trashed[id]; else this.meta.trashed[id] = trashedAt;
        if (trashedAt != null && id === this.meta.last) await this.select(MAIN);
        this.meta.updated[id] = updatedAt;
        this.meta.sent[id] = updatedAt;
        await this.save();
    }

    /** Outro aparelho excluiu o perfil de vez: o mesmo aqui. */
    async purgeFromRemote(id) {
        if (!this.meta.ids.includes(id)) return;
        await this.forget(id);
        await this.save();
        await this.storage.deleteProfile(id);
    }

    /** Apaga tudo (todos os perfis e a lista) e recomeca com um perfil principal vazio. Usado por "esqueci a senha". */
    async wipeAll() {
        this.runtime.close();
        await this.storage.deleteAll();
        this.meta = {ids: [], names: {}, last: MAIN, language: this.meta.language, sync: {}, updated: {}, trashed: {}, sent: {}, purged: []};
        this.runtime = await this.openRuntime(MAIN, this.languageStore);
        await this.runtime.flush();
        await this.save();
    }

    /** Rotas /profiles e /app/language. Devolve {status, body} ou null se a rota nao for de perfis. */
    async handle(method, path, body) {
        if (path === '/app/language') {
            if (method !== 'PUT') throw new HttpError(405, 'Método não permitido.');
            await this.setLanguage(body?.language);
            return {status: 200, body: this.snapshot()};
        }
        const m = /^\/profiles(?:\/([^/]+)(\/switch|\/restore|\/purge)?)?$/.exec(path);
        if (!m) return null;
        const [, rawId, action] = m;
        const id = rawId && decodeURIComponent(rawId);
        const ok = () => ({status: 200, body: this.snapshot()});
        if (!id) {
            if (method === 'GET') return ok();
            if (method === 'POST') { await this.create(body?.name); return ok(); }
        } else if (action === '/switch') {
            if (method === 'POST') { await this.select(id); return ok(); }
        } else if (action === '/restore') {
            if (method === 'POST') { await this.restore(id); return ok(); }
        } else if (action === '/purge') {
            if (method === 'DELETE') { await this.purge(id); return ok(); }
        } else if (method === 'PUT') {
            await this.rename(id, body?.name);
            return ok();
        } else if (method === 'DELETE') {
            await this.remove(id);
            return ok();
        }
        throw new HttpError(405, 'Método não permitido.');
    }
}
