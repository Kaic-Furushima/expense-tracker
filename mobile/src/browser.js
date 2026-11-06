import initSqlJs from 'sql.js/dist/sql-wasm-browser.js';
import {Access} from './access.js';
import {createBackupHttp} from './backups-http.js';
import {createReportsHttp} from './reports-http.js';
import {createApi} from './local-api/index.js';
import {createNativeBackupFolder, installNativeFiles} from './native-files.js';
import {installNativeBack} from './native-back.js';
import {installNativeNotifications} from './native-notifications.js';
import {installNativeWidgets} from './native-widgets.js';
import {MAIN, Profiles} from './profiles.js';
import {SyncService} from './sync/service.js';
import {createSyncHttp} from './sync/sync-http.js';
import {createRestoreHttp} from './restore-http.js';

// Roda no WebView do aplicativo (ou em qualquer navegador): troca o servidor Java pela API local. O front-end
// continua chamando fetch('/expenses...'); aqui essas chamadas sao respondidas pelo SQLite do proprio aparelho.

/** O front-end consulta isto (antes de a API local terminar de abrir) para trocar textos que so valem no PC. */
window.localApp = true;

const STATIC_PREFIXES = ['/js/', '/css/', '/icons/', '/sync/'];
const STATIC_FILES = ['/', '/index.html', '/sw.js', '/manifest.webmanifest', '/flavor.json', '/hub.json'];

const IDB_NAME = 'expense-tracker';
const IDB_VERSION = 2;
const KV = 'kv';
const BACKUPS = 'backups';
const SAVE_DELAY_MS = 400;
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const AUTO_BACKUP_CHECK_MS = 60 * 60 * 1000;
/** Voltar para o app depois de tanto tempo em segundo plano pede a senha de novo (so se houver senha). */
const LOCK_AFTER_BACKGROUND_MS = 5 * 60 * 1000;
const SESSION_KEY = 'et-session';

function openIdb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(IDB_NAME, IDB_VERSION);
        request.onupgradeneeded = () => {
            const idb = request.result;
            if (!idb.objectStoreNames.contains(KV)) idb.createObjectStore(KV);
            if (!idb.objectStoreNames.contains(BACKUPS)) idb.createObjectStore(BACKUPS, {keyPath: 'name'});
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

const idbRequest = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
});

function idbWrite(idb, store, work) {
    const tx = idb.transaction(store, 'readwrite');
    work(tx.objectStore(store));
    return new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}

const kvGet = (idb, key) => idbRequest(idb.transaction(KV).objectStore(KV).get(key)).then(v => v ?? null);
const kvPut = (idb, key, value) => idbWrite(idb, KV, s => s.put(value, key));
const kvDelete = (idb, key) => idbWrite(idb, KV, s => s.delete(key));

/** Chave do arquivo do banco de cada perfil (o principal mantem a chave antiga, de antes dos perfis). */
const dbKey = id => (id === MAIN ? 'sqlite' : `sqlite:${id}`);

/** Copias de seguranca guardadas no IndexedDB (a lista nao carrega o conteudo de cada uma). */
function idbBackupStore(idb) {
    return {
        async list() {
            const all = await idbRequest(idb.transaction(BACKUPS).objectStore(BACKUPS).getAll());
            return all.map(({name, createdAt, sizeBytes}) => ({name, createdAt, sizeBytes}));
        },
        get: name => idbRequest(idb.transaction(BACKUPS).objectStore(BACKUPS).get(name)).then(v => v ?? null),
        put: entry => idbWrite(idb, BACKUPS, s => s.put(entry)),
        delete: name => idbWrite(idb, BACKUPS, s => s.delete(name))
    };
}

/** As copias de um perfil: as do principal nao tem prefixo (como antes dos perfis); as dos outros comecam com "id:". */
function scopedBackupStore(base, id) {
    const prefix = id === MAIN ? '' : `${id}:`;
    const mine = name => (id === MAIN ? !name.includes(':') : name.startsWith(prefix));
    return {
        list: async () => (await base.list()).filter(e => mine(e.name)).map(e => ({...e, name: e.name.slice(prefix.length)})),
        get: async name => { const entry = await base.get(prefix + name); return entry && {...entry, name}; },
        put: entry => base.put({...entry, name: prefix + entry.name}),
        delete: name => base.delete(prefix + name)
    };
}

const session = {
    get: () => { try { return sessionStorage.getItem(SESSION_KEY); } catch (e) { return null; } },
    set: value => { try { sessionStorage.setItem(SESSION_KEY, value); } catch (e) { /* sem armazenamento: pede a senha ao recarregar */ } },
    clear: () => { try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* idem */ } }
};

async function start() {
    // a versao "sync" do APK traz flavor.json com sync:true; a "offline" nem tem permissao de internet
    // servidor de sync padrao do build (mobile/sync-hub.json, copiado para hub.json); vazio = so "meu proprio projeto"
    const central = await window.fetch('/hub.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
    const syncFlavor = await window.fetch('/flavor.json').then(r => (r.ok ? r.json() : null)).then(j => j?.sync === true).catch(() => false);
    const SQL = await initSqlJs({locateFile: file => `/js/${file}`});
    const idb = await openIdb();
    const backupBase = idbBackupStore(idb);
    // pasta de backups escolhida pela pessoa (fora do app); vale para todos os perfis. null no navegador comum.
    const backupFolder = createNativeBackupFolder({
        get: () => kvGet(idb, 'backup-folder'),
        set: value => (value ? kvPut(idb, 'backup-folder', value) : kvDelete(idb, 'backup-folder'))
    });

    /** Abre (ou cria) o banco de um perfil: grava o arquivo pouco depois de cada alteracao (agrupando varias seguidas) e ao sair do app. */
    async function openRuntime(id, languageStore) {
        const stored = await kvGet(idb, dbKey(id));
        let timer = null;
        let exporter = null;
        const writeNow = () => {
            clearTimeout(timer);
            timer = null;
            if (!exporter) return Promise.resolve();
            const data = exporter();
            exporter = null;
            return idbWrite(idb, KV, s => s.put(data, dbKey(id))).catch(e => console.error('Não foi possível gravar o banco', e));
        };
        const persist = exportFn => {
            exporter = exportFn;
            if (timer == null) timer = setTimeout(writeNow, SAVE_DELAY_MS);
        };
        const api = createApi(stored ? new SQL.Database(new Uint8Array(stored)) : new SQL.Database(), {persist, languageStore});
        return {
            id, api, flush: writeNow,
            backups: createBackupHttp({
                backup: api.services.backup, store: scopedBackupStore(backupBase, id),
                folder: backupFolder, folderPrefix: id === MAIN ? '' : `${id}_`
            }),
            reportsHttp: createReportsHttp({reports: api.services.reports}),
            close() { writeNow(); api.db.close(); }
        };
    }

    const profiles = await new Profiles({
        storage: {
            readMeta: () => kvGet(idb, 'profiles'),
            writeMeta: meta => kvPut(idb, 'profiles', meta),
            async deleteProfile(id) {
                await kvDelete(idb, dbKey(id));
                for (const entry of await backupBase.list()) if (entry.name.startsWith(`${id}:`)) await backupBase.delete(entry.name);
            },
            async deleteAll() {
                await idbWrite(idb, KV, s => s.clear());
                await idbWrite(idb, BACKUPS, s => s.clear());
            }
        },
        openRuntime
    }).init();

    // a conexao do sync e da pessoa (nao de um perfil): fica fora dos bancos e dos backups
    const sync = await new SyncService({
        store: {get: () => kvGet(idb, 'sync-config'), set: value => kvPut(idb, 'sync-config', value)},
        profiles, available: syncFlavor, central
    }).init();
    const restoreHttp = createRestoreHttp({profiles, sync, backupsFor: (id, runtime) => runtime.backups});

    const access = await new Access({
        store: {get: () => kvGet(idb, 'password'), set: hash => kvPut(idb, 'password', hash), delete: () => kvDelete(idb, 'password')},
        session,
        onReset: () => profiles.wipeAll().then(() => sync.init())
    }).init();

    addEventListener('pagehide', () => profiles.runtime.flush());
    let hiddenAt = 0;
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            hiddenAt = Date.now();
            profiles.runtime.flush();
        } else if (hiddenAt && access.passwordSet() && Date.now() - hiddenAt > LOCK_AFTER_BACKGROUND_MS) {
            access.logout();
            location.reload(); // volta para a tela da senha
        }
    });

    const autoBackup = () => {
        const {api, backups} = profiles.runtime;
        return backups.automaticIfDue(api.services.settings.autoBackup()).catch(e => console.error('Backup automático falhou', e));
    };
    autoBackup();
    setInterval(autoBackup, AUTO_BACKUP_CHECK_MS);

    // sincronizacao automatica (so na versao com sync e com a conexao feita): ao abrir, ao voltar ao app e de tempos em tempos
    const syncMaybe = () => sync.maybeSync();
    syncMaybe();
    setInterval(syncMaybe, SYNC_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncMaybe(); });

    window.expenseTrackerLocal = {
        profiles, access,
        get api() { return profiles.runtime.api; },
        get backups() { return profiles.runtime.backups; },
        flush: () => profiles.runtime.flush()
    };
    installNativeNotifications(() => profiles.runtime.api); // so no Android: avisos agendados (do perfil em uso)
    installNativeWidgets({getApi: () => profiles.runtime.api, access}); // so no Android: widgets da tela inicial
    return {profiles, access, sync, restoreHttp};
}

installNativeFiles();
installNativeBack(); // botao voltar do Android
const ready = start();

// <img src="/attachments/ID"> nao passa pelo fetch: troca o endereco por um blob lido do banco local.
const imageUrls = new Map();
async function localizeImage(img) {
    const src = img.getAttribute('src') || '';
    if (!src.startsWith('/attachments/') || img.dataset.localized === src) return;
    img.dataset.localized = src;
    try {
        if (!imageUrls.has(src)) {
            imageUrls.set(src, (async () => {
                const res = await window.fetch(src);
                if (!res.ok) throw new Error(String(res.status));
                return URL.createObjectURL(await res.blob());
            })());
        }
        img.src = await imageUrls.get(src);
    } catch (e) {
        imageUrls.delete(src);
        console.error('Não foi possível abrir o anexo', src, e);
    }
}
new MutationObserver(records => {
    for (const r of records) {
        if (r.type === 'attributes') localizeImage(r.target);
        else r.addedNodes.forEach(n => {
            if (n.nodeType !== 1) return;
            if (n.tagName === 'IMG') localizeImage(n);
            n.querySelectorAll?.('img[src^="/attachments/"]').forEach(localizeImage);
        });
    }
}).observe(document, {childList: true, subtree: true, attributes: true, attributeFilter: ['src']});
const realFetch = window.fetch.bind(window);

const isLocalCall = url => url.origin === location.origin
    && !STATIC_FILES.includes(url.pathname)
    && !STATIC_PREFIXES.some(prefix => url.pathname.startsWith(prefix));

window.fetch = async function (input, init = {}) {
    const request = typeof input === 'string' || input instanceof URL ? null : input;
    const url = new URL(request ? request.url : String(input), location.href);
    if (!isLocalCall(url)) return realFetch(input, init);

    const {profiles, access, sync, restoreHttp} = await ready;
    const method = (init.method || (request && request.method) || 'GET').toUpperCase();
    let body = init.body ?? null;
    if (typeof body === 'string' && body) {
        try { body = JSON.parse(body); } catch (e) { /* corpo que nao e JSON: segue como texto */ }
    }
    let result;
    try {
        result = await access.handle(method, url.pathname, body);
        if (!result) {
            access.guard(); // com senha e sem entrar, nenhuma chamada de dados passa
            const {api, backups, reportsHttp} = profiles.runtime;
            result = await profiles.handle(method, url.pathname, body)
                ?? await createSyncHttp(() => sync).handle(method, url.pathname, body)
                ?? await restoreHttp.handle(method, url.pathname, body)
                ?? await backups.handle(method, url.pathname, body)
                ?? await reportsHttp.handle(method, url.pathname, Object.fromEntries(url.searchParams))
                ?? api.handle(method, url.pathname + url.search, body);
        }
    } catch (e) {
        if (e && typeof e.status === 'number') {
            result = {status: e.status, body: {status: e.status, title: e.message, detail: e.message, ...(e.errors ? {errors: e.errors} : {})}};
        } else {
            console.error(e);
            result = {status: 500, body: {status: 500, title: 'Erro interno', detail: String((e && e.message) || e)}};
        }
    }
    // Alteracao so e confirmada depois de gravada no aparelho: fechar o app logo em seguida nao perde nada.
    if (method !== 'GET') {
        await profiles.runtime.flush();
        if (!url.pathname.startsWith('/api/sync')) sync.notifyChange(); // agenda um sync logo depois de salvar
        if (window.nativeNotifications) window.nativeNotifications.refreshSoon(); // contas e limites mudaram: reagenda os avisos
        if (window.nativeWidgets) window.nativeWidgets.refreshSoon(); // saldos, senha ou perfil mudaram: atualiza os widgets
    }
    if (result.bytes !== undefined) {
        return new Response(result.bytes, {status: result.status, headers: {'Content-Type': result.contentType || 'application/octet-stream'}});
    }
    if (result.text !== undefined) {
        return new Response(result.text, {status: result.status, headers: {'Content-Type': result.contentType || 'text/plain'}});
    }
    const hasBody = result.body !== null && result.body !== undefined;
    return new Response(hasBody ? JSON.stringify(result.body) : null, {
        status: result.status,
        headers: hasBody ? {'Content-Type': 'application/json'} : {}
    });
};
