import {HttpError} from './local-api/http.js';

// Senha opcional que abre o app (porta de AccessControl, do back-end Java). Nao ha senha por padrao. Com senha, toda
// tela e toda chamada de dados pedem a senha antes. A senha vale para todos os perfis e guarda-se so o hash
// (PBKDF2-HMAC-SHA256 com sal aleatorio, no mesmo formato do Java: "pbkdf2$iteracoes$sal$hash" em Base64).
//
// ATENCAO: e uma trava de tela do app, nao criptografia. Os dados continuam no armazenamento do app, sem cifra;
// quem controla o aparelho desbloqueado e quem sabe mexer no sistema ainda consegue lê-los. O que a senha impede e
// abrir o app (e ver ou mudar os dados por ele) sem saber a senha.

export const MIN_LENGTH = 4;
export const MAX_LENGTH = 72;
export const ITERATIONS = 210_000;
const FAILURES_BEFORE_PAUSE = 5;
const PAUSE_MS = 30_000;
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

const b64 = bytes => btoa(String.fromCharCode(...bytes));
const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

async function derive(password, salt, iterations) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({name: 'PBKDF2', salt, iterations, hash: 'SHA-256'}, key, 256));
}

const sameBytes = (a, b) => a.length === b.length && a.reduce((diff, x, i) => diff | (x ^ b[i]), 0) === 0;

/** Sessao em memoria (testes) com a mesma interface do sessionStorage. */
export class MemorySession {
    constructor() { this.value = null; }
    get() { return this.value; }
    set(value) { this.value = value; }
    clear() { this.value = null; }
}

export class Access {
    /**
     * @param store   {get(), set(hash), delete()} assincrono: onde fica o hash da senha
     * @param session {get(), set(v), clear()} sincrono: lembra que o app foi aberto (sobrevive a recarregar a pagina)
     * @param options clock, iterations (os testes usam poucas), onReset: apaga todos os dados do aparelho
     */
    constructor({store, session, clock = () => Date.now(), iterations = ITERATIONS, onReset = async () => {}}) {
        this.store = store;
        this.session = session;
        this.clock = clock;
        this.iterations = iterations;
        this.onReset = onReset;
        this.hash = null;
        this.failures = 0;
        this.pausedUntil = 0;
    }

    async init() {
        this.hash = (await this.store.get()) ?? null;
        return this;
    }

    passwordSet() { return this.hash != null; }

    /** A sessao vale enquanto a senha for a mesma (trocar ou remover a senha fecha as sessoes). */
    fingerprint() { return this.hash.slice(-24); }

    unlocked() {
        if (!this.passwordSet()) return true;
        const [fingerprint, until] = String(this.session.get() ?? '').split('|');
        return fingerprint === this.fingerprint() && this.clock() < Number(until);
    }

    openSession() {
        this.session.set(`${this.fingerprint()}|${this.clock() + SESSION_MS}`);
    }

    status() {
        return {passwordSet: this.passwordSet(), unlocked: this.unlocked(), localOnly: true};
    }

    async encode(password) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        return `pbkdf2$${this.iterations}$${b64(salt)}$${b64(await derive(password, salt, this.iterations))}`;
    }

    async matches(password, stored) {
        const parts = stored.split('$');
        if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
        return sameBytes(await derive(password, unb64(parts[2]), Number(parts[1])), unb64(parts[3]));
    }

    /** Confere a senha e abre a sessao. Varias senhas erradas seguidas pausam as tentativas por um tempo. */
    async login(password) {
        const now = this.clock();
        if (now < this.pausedUntil) {
            throw new HttpError(429, `Muitas tentativas. Espere ${Math.max(1, Math.ceil((this.pausedUntil - now) / 1000))} segundos.`);
        }
        if (this.hash == null || typeof password !== 'string' || !(await this.matches(password, this.hash))) {
            if (this.hash != null && ++this.failures >= FAILURES_BEFORE_PAUSE) {
                this.failures = 0;
                this.pausedUntil = now + PAUSE_MS;
            }
            throw new HttpError(401, 'Senha incorreta.');
        }
        this.failures = 0;
        this.openSession();
    }

    /** Define, troca ou remove a senha. Trocar ou remover exige a atual. `password` vazio remove. */
    async change(current, password) {
        if (this.hash != null && (typeof current !== 'string' || !(await this.matches(current, this.hash)))) {
            throw new HttpError(403, 'Senha atual incorreta.');
        }
        this.session.clear();
        if (password == null || password === '') {
            this.hash = null;
            await this.store.delete();
            return;
        }
        if (password.length < MIN_LENGTH || password.length > MAX_LENGTH) {
            throw new HttpError(400, `A senha deve ter entre ${MIN_LENGTH} e ${MAX_LENGTH} caracteres.`);
        }
        this.hash = await this.encode(password);
        await this.store.set(this.hash);
        this.openSession();
    }

    logout() {
        this.session.clear();
    }

    /**
     * "Esqueci a senha": apaga TODOS os dados deste aparelho e a senha. E o preco de nao deixar quem pegou o celular
     * entrar: so quem tem um backup recupera os dados.
     */
    async reset() {
        await this.onReset();
        this.hash = null;
        await this.store.delete();
        this.session.clear();
    }

    /** Rotas /api/auth/*. Devolve {status, body} ou null se a rota nao for de acesso. */
    async handle(method, path, body) {
        if (!path.startsWith('/api/auth/')) return null;
        const route = `${method} ${path.slice('/api/auth'.length)}`;
        switch (route) {
            case 'GET /status':
                return {status: 200, body: this.status()};
            case 'POST /login':
                await this.login(body?.password);
                return {status: 200, body: this.status()};
            case 'POST /logout':
                this.logout();
                return {status: 200, body: this.status()};
            case 'PUT /password':
                await this.change(body?.current, body?.password);
                return {status: 200, body: this.status()};
            case 'POST /reset':
                if (body?.confirm !== true) throw new HttpError(400, 'Confirme para apagar todos os dados deste aparelho.');
                await this.reset();
                return {status: 200, body: this.status()};
            default:
                throw new HttpError(404, `Não encontrado: ${path}`);
        }
    }

    /** Com senha e sem sessao aberta, nenhuma chamada de dados passa. */
    guard() {
        if (!this.unlocked()) throw new HttpError(401, 'Entre com a senha.');
    }
}
