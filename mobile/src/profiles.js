import {HttpError, badRequest, conflict, notFound} from './local-api/http.js';

// Perfis (por exemplo, um por pessoa): cada um tem o proprio banco, com lancamentos, contas, categorias, orcamentos e
// backups separados. Porta de ProfileService, do back-end Java. O idioma vale para o app todo.
// Aqui so ha a logica; o armazenamento e a abertura de cada banco vem de fora (browser.js no app, memoria nos testes).

export const MAIN = 'main';
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
     */
    constructor({storage, openRuntime, newId = () => crypto.randomUUID().replaceAll('-', '').slice(0, 8)}) {
        this.storage = storage;
        this.openRuntime = openRuntime;
        this.newId = newId;
        this.meta = null;
        this.runtime = null;
        this.languageStore = {get: () => this.meta?.language ?? 'pt', set: language => this.setLanguage(language)};
    }

    async init() {
        const stored = await this.storage.readMeta();
        this.meta = {ids: [], names: {}, last: MAIN, language: 'pt', ...(stored ?? {})};
        if (!LANGUAGES.includes(this.meta.language)) this.meta.language = 'pt';
        if (!this.exists(this.meta.last)) this.meta.last = MAIN;
        this.runtime = await this.openRuntime(this.meta.last, this.languageStore);
        return this;
    }

    get current() { return this.meta.last; }

    list() {
        return [{id: MAIN, name: this.meta.names[MAIN] ?? 'Principal'}, ...this.meta.ids.map(id => ({id, name: this.meta.names[id] ?? id}))];
    }

    exists(id) { return id === MAIN || this.meta.ids.includes(id); }

    snapshot() {
        return {profiles: this.list(), current: this.current, language: this.meta.language, canCreate: true};
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

    /** Cria um perfil vazio (com as categorias e formas de pagamento padrao) e ja passa a usa-lo. */
    async create(rawName) {
        const name = cleanName(rawName);
        if (this.meta.ids.length + 1 >= MAX_PROFILES) throw badRequest(`Limite de ${MAX_PROFILES} perfis atingido.`);
        this.requireFreeName(name, null);
        const id = this.newId();
        await this.runtime.flush();
        const next = await this.openRuntime(id, this.languageStore); // cria o banco e os dados iniciais
        await next.flush();
        this.runtime.close();
        this.runtime = next;
        this.meta.ids.push(id);
        this.meta.names[id] = name;
        this.meta.last = id;
        await this.save();
        return {id, name};
    }

    async rename(id, rawName) {
        if (!this.exists(id)) throw notFound('Perfil não encontrado.');
        const name = cleanName(rawName);
        this.requireFreeName(name, id);
        this.meta.names[id] = name;
        await this.save();
    }

    /** Remove o perfil e apaga os dados dele deste aparelho (faca um backup antes se quiser guardar). */
    async remove(id) {
        if (id === MAIN) throw badRequest('O perfil principal não pode ser removido.');
        if (!this.exists(id)) throw notFound('Perfil não encontrado.');
        if (id === this.meta.last) await this.select(MAIN);
        this.meta.ids = this.meta.ids.filter(x => x !== id);
        delete this.meta.names[id];
        await this.save();
        await this.storage.deleteProfile(id);
    }

    /** Apaga tudo (todos os perfis e a lista) e recomeca com um perfil principal vazio. Usado por "esqueci a senha". */
    async wipeAll() {
        this.runtime.close();
        await this.storage.deleteAll();
        this.meta = {ids: [], names: {}, last: MAIN, language: this.meta.language};
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
        const m = /^\/profiles(?:\/([^/]+)(\/switch)?)?$/.exec(path);
        if (!m) return null;
        const [, id, sw] = m;
        const ok = () => ({status: 200, body: this.snapshot()});
        if (!id) {
            if (method === 'GET') return ok();
            if (method === 'POST') { await this.create(body?.name); return ok(); }
        } else if (sw) {
            if (method === 'POST') { await this.select(decodeURIComponent(id)); return ok(); }
        } else if (method === 'PUT') {
            await this.rename(decodeURIComponent(id), body?.name);
            return ok();
        } else if (method === 'DELETE') {
            await this.remove(decodeURIComponent(id));
            return ok();
        }
        throw new HttpError(405, 'Método não permitido.');
    }
}
