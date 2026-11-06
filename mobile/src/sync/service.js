import {SyncCrypto, newSalt} from './crypto.js';
import {MAX_SYNC_ATTACHMENT_BYTES, SyncEngine} from './engine.js';
import {SupabaseHub} from './hub-supabase.js';
import {ProfileRegistrySync} from './registry.js';

// O que a tela de sincronizacao e os gatilhos automaticos usam: guarda a conexao (da pessoa, nao de um perfil: fica fora
// dos bancos e dos backups), abre o motor, sincroniza primeiro a lista de perfis e depois os dados de cada perfil em uso,
// e lembra como foi. Nada aqui acontece na versao "offline" do aplicativo.

const DEFAULT_DEBOUNCE_MS = 8000;
const OFFLINE_MESSAGE = 'Sem conexão com o sync. As alterações serão enviadas quando a internet voltar.';

/** Estado da conexao guardado fora dos bancos. Os testes usam este; o app, o IndexedDB (browser.js). */
export class MemorySyncStore {
    constructor(value = {}) { this.value = value; }
    async get() { return structuredClone(this.value); }
    async set(value) { this.value = structuredClone(value); }
}

export class SyncService {
    /**
     * @param store      {get(), set(obj)} assincrono: {cfg, session, last, registryCursor, device}
     * @param profiles   os perfis (Profiles): withRuntime(id, fn), list(), syncIdOf(id)...
     * @param available  false na versao sem internet: tudo vira "indisponivel"
     * @param central    {url, anonKey} do servidor padrao do build, ou null
     * @param hubFactory (config, onSession) => hub; o padrao usa o Supabase
     */
    constructor({store, profiles, available = true, central = null, hubFactory = null, now = () => Date.now(),
        debounceMs = DEFAULT_DEBOUNCE_MS, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = id => clearTimeout(id),
        newId = () => crypto.randomUUID()}) {
        this.store = store;
        this.profiles = profiles;
        this.available = available;
        this.central = central && central.url && central.anonKey ? {url: central.url, anonKey: central.anonKey} : null;
        this.hubFactory = hubFactory ?? ((cfg, onSession) => new SupabaseHub({url: cfg.url, anonKey: cfg.anonKey, session: cfg.session, onSession}));
        this.now = now;
        this.debounceMs = debounceMs;
        this.setTimer = setTimer;
        this.clearTimer = clearTimer;
        this.newId = newId;
        this.state = {};
        this.hub = null;
        this.crypto = null;
        this.running = false;
        this.timer = null;
    }

    async init() {
        this.state = (await this.store.get()) ?? {};
        return this;
    }

    async persist() { await this.store.set(this.state); }

    get cfg() { return this.state.cfg ?? null; }

    status() {
        if (!this.available) return {available: false, configured: false};
        const cfg = this.cfg;
        const last = this.state.last ?? {};
        const db = this.profiles.runtime.api.db;
        return {
            available: true, configured: !!cfg, running: this.running, central: !!this.central,
            mode: cfg ? (cfg.central ? 'central' : 'own') : null,
            url: cfg && !cfg.central ? cfg.url : null, email: cfg?.email ?? null, autoSync: cfg ? cfg.autoSync !== false : true,
            lastSyncAt: last.at ?? null, lastError: last.error ?? null,
            pending: db.value('select count(*) from sync_pending'), unsent: db.value('select count(*) from sync_outbox'),
            skippedAttachments: db.value('select count(*) from attachments where size_bytes > ?', [MAX_SYNC_ATTACHMENT_BYTES])
        };
    }

    // ---- conectar e desconectar ----

    async connect({url, anonKey, email, password, syncPassword, createAccount = false, useCentral = false} = {}) {
        this.requireAvailable();
        if (useCentral) {
            if (!this.central) throw new Error('Este aplicativo não tem um servidor padrão: use o seu próprio projeto.');
            ({url, anonKey} = this.central);
        }
        const missing = [url, anonKey, email, password, syncPassword].some(v => !String(v ?? '').trim());
        if (missing) throw new Error('Preencha todos os campos.');
        if (String(syncPassword).length < 8) throw new Error('A senha de sincronização precisa ter pelo menos 8 caracteres.');

        const cfg = {url: url.trim(), anonKey: anonKey.trim(), email: email.trim(), syncPassword, autoSync: true, central: !!useCentral};
        let session = null;
        const hub = this.hubFactory({...cfg, session: null}, s => { session = s; });
        try {
            if (createAccount) {
                await hub.signUp(cfg.email, password);
                if (!hub.signedIn()) await hub.signIn(cfg.email, password); // sem confirmacao por e-mail, ja entrou
            } else {
                await hub.signIn(cfg.email, password);
            }
            this.crypto = await openCrypto(hub, syncPassword);
        } catch (e) {
            this.crypto = null;
            throw new Error(this.friendly(e));
        }
        this.hub = hub;
        hub.onSession = s => { this.state.session = s; this.persist(); }; // renovacoes de login passam a ser guardadas
        this.state = {...this.state, cfg, session, registryCursor: 0};
        await this.persist();
        await this.syncNow();
        return this.status();
    }

    async disconnect() {
        this.requireAvailable();
        this.clearTimer(this.timer);
        this.timer = null;
        this.hub = null;
        this.crypto = null;
        const {device} = this.state;
        this.state = device ? {device} : {};
        await this.persist();
        return this.status();
    }

    async setAuto(enabled) {
        this.requireConfig();
        this.state.cfg = {...this.cfg, autoSync: !!enabled};
        await this.persist();
        return this.status();
    }

    connected() { return this.available && !!this.cfg; }

    // ---- sincronizar ----

    deviceId() {
        if (!this.state.device) this.state.device = this.newId();
        return this.state.device;
    }

    async open() {
        if (this.hub && this.crypto) return;
        const cfg = this.requireConfig();
        this.hub = this.hubFactory({...cfg, session: this.state.session ?? null}, s => { this.state.session = s; this.persist(); });
        this.crypto = await openCrypto(this.hub, cfg.syncPassword);
    }

    /** Alinha a lista de perfis com os outros aparelhos e sincroniza os dados de cada perfil em uso. */
    async syncNow() {
        this.requireAvailable();
        this.requireConfig();
        if (this.running) return this.status();
        this.running = true;
        try {
            await this.open();
            const device = this.deviceId();
            const self = this;
            await new ProfileRegistrySync({
                hub: this.hub, crypto: this.crypto, profiles: this.profiles, deviceId: device,
                state: {get cursor() { return self.state.registryCursor ?? 0; }, set cursor(v) { self.state.registryCursor = v; }}
            }).sync();
            let firstError = null;
            for (const p of this.profiles.list()) {
                try {
                    await this.profiles.withRuntime(p.id, rt => this.engineFor(p.id, rt).sync());
                } catch (e) {
                    firstError ??= this.friendly(e);
                }
            }
            if (firstError) throw new Error(firstError);
            this.state.last = {at: this.now(), error: null};
        } catch (e) {
            this.state.last = {at: this.state.last?.at ?? null, error: this.friendly(e)};
            if (/incorret/i.test(String(e.message))) { this.hub = null; this.crypto = null; }
        } finally {
            this.running = false;
            await this.persist();
        }
        return this.status();
    }

    engineFor(profileId, runtime) {
        return new SyncEngine(runtime.api.db, {hub: this.hub, crypto: this.crypto, profileId: this.profiles.syncIdOf(profileId)});
    }

    /**
     * Depois de restaurar um backup sobre um perfil: faz a nuvem (e os outros aparelhos) ficar igual a ele, apagando la o
     * que o backup nao tem. Nao faz nada se o sync nao estiver conectado.
     */
    async forceOverwrite(profileId) {
        if (!this.connected()) return;
        await this.open();
        await this.profiles.withRuntime(profileId, rt => this.engineFor(profileId, rt).forceOverwrite());
        this.state.last = {at: this.now(), error: null};
        await this.persist();
    }

    /** Sincroniza sozinho, se estiver conectado e ligado. Nunca lanca erro: serve aos gatilhos automaticos. */
    async maybeSync() {
        if (!this.available || this.running) return;
        const cfg = this.cfg;
        if (!cfg || cfg.autoSync === false) return;
        await this.syncNow().catch(() => {});
    }

    /** Chamado depois de cada gravacao: agrupa varias seguidas numa sincronizacao so. */
    notifyChange() {
        if (!this.available) return;
        const cfg = this.cfg;
        if (!cfg || cfg.autoSync === false) return;
        this.clearTimer(this.timer);
        this.timer = this.setTimer(() => { this.timer = null; this.maybeSync(); }, this.debounceMs);
    }

    // ---- util ----

    requireAvailable() {
        if (!this.available) throw new Error('A sincronização não está disponível nesta versão do aplicativo.');
    }

    requireConfig() {
        const cfg = this.cfg;
        if (!cfg) throw new Error('Conecte este aparelho ao sync primeiro.');
        return cfg;
    }

    friendly(e) {
        const message = String(e?.message ?? e);
        if (e instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(message)) return OFFLINE_MESSAGE;
        if (/invalid login credentials/i.test(message)) return 'E-mail ou senha da conta incorretos.';
        if (/already registered/i.test(message)) return 'Este e-mail já tem conta: desmarque “Criar a conta agora” e entre.';
        return message;
    }
}

/** O cofre no hub: o primeiro aparelho cria; os outros conferem a senha. Devolve a chave de criptografia. */
async function openCrypto(hub, password) {
    let vault = await hub.getVault();
    if (!vault) {
        const salt = newSalt();
        const crypto = await SyncCrypto.fromPassword(password, salt);
        vault = {salt, check: await crypto.makeCheck()};
        await hub.setVault(vault);
        return crypto;
    }
    const crypto = await SyncCrypto.fromPassword(password, vault.salt);
    if (!(await crypto.verify(vault.check))) throw new Error('Senha de sync incorreta.');
    return crypto;
}
