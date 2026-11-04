import {SyncCrypto, newSalt} from './crypto.js';
import {TABLES, fkName, fkTarget, isFk} from './tables.js';
import {SYNC_TABLES} from '../local-api/schema.js';
import {isoDateTime} from '../local-api/util.js';

// Motor de sincronizacao (lado do celular). Protocolo:
//  * PUSH: tudo que o aparelho mudou fica em sync_outbox (gatilhos do SQLite). Cada item vira uma "alteracao"
//    {tabela, uuid, updatedAt (ms UTC), deleted, payload cifrado} enviada ao hub. O hub guarda uma linha por registro e
//    so aceita versao mais nova (updatedAt maior).
//  * PULL: o hub devolve, em ordem de sequencia, o que mudou depois do cursor deste aparelho. Cada alteracao entra se for
//    mais nova que a linha local ("vale a mais recente"); exclusoes seguem a mesma regra.
//  * Linhas viajam com chaves estrangeiras como uuid. Se o "pai" ainda nao chegou, a alteracao espera em sync_pending.
//  * Se dois aparelhos criaram a mesma coisa (mesmo nome de conta, mesmo orcamento do mes...) com uuids diferentes, fica
//    o menor uuid; o outro vira apelido (sync_alias) e os filhos que o citam sao redirecionados.

const PAGE = 200;
const PUSH_BATCH = 100;
/** Um envio ao hub leva ate isso em texto cifrado (uma alteracao grande sozinha pode passar um pouco). */
const PUSH_BATCH_BYTES = 4 * 1024 * 1024;
/** Anexos maiores que isso (3 MB) ficam so no aparelho: cifrados e em base64, passariam de 5 MB por alteracao. O app aceita ate 5 MB. */
export const MAX_SYNC_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const FAR_PAST = 0;

const toMs = text => (text == null ? null : new Date(text).getTime());
const fromMs = ms => (ms == null ? null : isoDateTime(new Date(ms)));

export class SyncEngine {
    constructor(db, {hub, crypto, profileId = 'default'}) {
        this.db = db;
        this.hub = hub;
        this.crypto = crypto;
        this.profileId = profileId;
        this.running = false;
    }

    /**
     * Abre o sync com a senha de sync: no primeiro aparelho cria o cofre no hub; nos outros confere a senha.
     * Lanca erro se a senha estiver errada.
     */
    static async open(db, hub, password, {profileId = 'default'} = {}) {
        let vault = await hub.getVault();
        let crypto;
        if (!vault) {
            const salt = newSalt();
            crypto = await SyncCrypto.fromPassword(password, salt);
            vault = {salt, check: await crypto.makeCheck()};
            await hub.setVault(vault);
        } else {
            crypto = await SyncCrypto.fromPassword(password, vault.salt);
            if (!(await crypto.verify(vault.check))) throw new Error('Senha de sync incorreta.');
        }
        return new SyncEngine(db, {hub, crypto, profileId});
    }

    // ---- estado local ----

    state(key) {
        return this.db.value('select value from sync_state where key = ?', [key]);
    }

    setState(key, value) {
        this.db.run('insert or replace into sync_state (key, value) values (?, ?)', [key, String(value)]);
    }

    deviceId() {
        let id = this.state('device');
        if (!id) {
            id = this.db.newId();
            this.setState('device', id);
        }
        return id;
    }

    cursor() {
        return Number(this.state(`cursor:${this.profileId}`) ?? 0);
    }

    pendingCount() {
        return this.db.value('select count(*) from sync_pending');
    }

    outboxCount() {
        return this.db.value('select count(*) from sync_outbox');
    }

    /** Depois de restaurar um backup (ou em caso de duvida): manda tudo de novo e le tudo de novo. O hub descarta o que for velho. */
    fullResync() {
        this.db.tx(() => {
            for (const t of SYNC_TABLES) {
                this.db.run(`insert or ignore into sync_outbox (table_name, uuid, deleted, at) select '${t}', uuid, 0, ${FAR_PAST} from ${t}`);
            }
            this.setState(`cursor:${this.profileId}`, 0);
        });
    }

    /**
     * Faz o hub (e portanto todos os outros aparelhos) ficar igual ao que existe aqui, seja o que for que ele guardava:
     * depois de restaurar um backup sobre um perfil. Toda linha local passa a ser "a mais nova", o que o hub tem e nao
     * existe mais aqui e apagado la, e o estado antigo do hub nao volta para ca. Nao tem volta nos outros aparelhos.
     */
    async forceOverwrite() {
        // o que o hub tem: a versao mais nova (uma datada no futuro tambem precisa perder) e o que esta vivo
        const alive = new Set();
        let newest = 0;
        let cursor = 0;
        for (;;) {
            const page = await this.hub.pull(this.profileId, cursor, PAGE);
            for (const c of page) {
                newest = Math.max(newest, c.updatedAt);
                if (c.deleted) alive.delete(`${c.table}|${c.uuid}`); else alive.add(`${c.table}|${c.uuid}`);
            }
            if (page.length) cursor = page[page.length - 1].seq;
            if (page.length < PAGE) break;
        }
        const ms = Math.max(Date.now(), newest + 1);

        this.db.tx(() => {
            this.db.sql.run('update sync_ctl set applying = 1');
            try {
                this.db.run('delete from sync_outbox');
                for (const t of SYNC_TABLES) {
                    this.db.run(`update ${t} set updated_at = ?`, [fromMs(ms)]);
                    this.db.run(`insert or replace into sync_outbox (table_name, uuid, deleted, at) select '${t}', uuid, 0, ? from ${t}`, [ms]);
                    for (const r of this.db.all(`select uuid from ${t}`)) alive.delete(`${t}|${r.uuid}`);
                }
                this.db.run('delete from sync_pending');
                this.db.run('delete from sync_alias');
            } finally {
                this.db.sql.run('update sync_ctl set applying = 0');
            }
        });
        // o que o hub tem vivo e nao existe mais aqui tambem some la
        const deletes = [...alive].map(key => {
            const bar = key.indexOf('|');
            return {table: key.slice(0, bar), uuid: key.slice(bar + 1), updatedAt: ms, deleted: true, payload: null};
        });
        for (let i = 0; i < deletes.length; i += PUSH_BATCH) await this.hub.push(this.profileId, this.deviceId(), deletes.slice(i, i + PUSH_BATCH));
        this.setState(`cursor:${this.profileId}`, 0);
        await this.sync();
    }

    // ---- ciclo completo ----

    /** Busca o que mudou la, depois envia o que mudou aqui. */
    async sync() {
        if (this.running) return {skipped: true};
        this.running = true;
        try {
            const pulled = await this.pull();
            const pushed = await this.push();
            return {pulled, pushed, pending: this.pendingCount()};
        } finally {
            this.running = false;
        }
    }

    // ---- PUSH ----

    async push() {
        let sent = 0;
        for (;;) {
            const items = this.db.all('select * from sync_outbox order by at, table_name, uuid limit ?', [PUSH_BATCH]);
            if (!items.length) return sent;
            const changes = [];
            const included = [];
            let bytes = 0;
            for (const item of items) {
                if (this.tooBigToSync(item)) { included.push(item); continue; } // fica so aqui: sai da caixa sem ser enviado
                const change = await this.buildChange(item);
                changes.push(change);
                included.push(item);
                bytes += change.payload ? change.payload.length : 0;
                if (bytes >= PUSH_BATCH_BYTES) break; // o resto vai no proximo envio
            }
            if (changes.length) await this.hub.push(this.profileId, this.deviceId(), changes);
            // so tira da caixa o que nao mudou de novo enquanto enviava
            this.db.tx(() => {
                for (const item of included) {
                    this.db.run('delete from sync_outbox where table_name = ? and uuid = ? and at = ?', [item.table_name, item.uuid, item.at]);
                }
            });
            sent += changes.length;
        }
    }

    tooBigToSync(item) {
        return item.table_name === 'attachments' && !item.deleted
            && (this.db.value('select size_bytes from attachments where uuid = ?', [item.uuid]) ?? 0) > MAX_SYNC_ATTACHMENT_BYTES;
    }

    async buildChange(item) {
        const spec = TABLES[item.table_name];
        const row = item.deleted ? null : this.db.get(`select * from ${item.table_name} where uuid = ?`, [item.uuid]);
        if (!row) {
            // excluido (ou sumiu antes de enviar)
            return {table: item.table_name, uuid: item.uuid, updatedAt: item.at || Date.now(), deleted: true, payload: null};
        }
        const payload = {};
        for (const [column, type] of Object.entries(spec.columns)) {
            const value = row[column] ?? null;
            if (isFk(type)) payload[fkName(column)] = value == null ? null : this.uuidOf(fkTarget(type), value);
            else payload[column] = type === 'ts' ? toMs(value) : value;
        }
        if (spec.tags) {
            payload.tag_uuids = this.db.all('select t.uuid from expense_tags et join tags t on t.id = et.tag_id where et.expense_id = ? order by t.uuid',
                [row.id]).map(r => r.uuid);
        }
        return {
            table: item.table_name, uuid: item.uuid, updatedAt: Math.max(toMs(row.updated_at) ?? 0, item.at),
            deleted: false, payload: await this.crypto.encrypt(JSON.stringify(payload))
        };
    }

    uuidOf(table, id) {
        return this.db.value(`select uuid from ${table} where id = ?`, [id]);
    }

    // ---- PULL ----

    async pull() {
        const mine = this.deviceId();
        let applied = 0;
        let cursor = this.cursor();
        for (;;) {
            const page = await this.hub.pull(this.profileId, cursor, PAGE);
            const incoming = [];
            for (const raw of page) {
                if (raw.deviceId === mine) continue; // foi este aparelho que mandou
                incoming.push({
                    table: raw.table, uuid: raw.uuid, updatedAt: raw.updatedAt, deleted: raw.deleted,
                    payload: raw.deleted ? null : await this.crypto.decrypt(raw.payload)
                });
            }
            if (page.length) cursor = page[page.length - 1].seq;
            applied += this.applyBatch(incoming);
            if (page.length) this.setState(`cursor:${this.profileId}`, cursor);
            if (page.length < PAGE) return applied;
        }
    }

    /** Aplica um lote (mais o que estava pendente) numa transacao so. Devolve quantas alteracoes mudaram dados. */
    applyBatch(incoming) {
        return this.db.tx(() => {
            this.db.sql.run('update sync_ctl set applying = 1');
            try {
                const byKey = new Map();
                for (const p of this.db.all('select * from sync_pending')) byKey.set(`${p.table_name}|${p.uuid}`, JSON.parse(p.change));
                for (const c of incoming) byKey.set(`${c.table}|${c.uuid}`, c);

                let changed = 0;
                const outcome = (c, result, reason) => {
                    if (result === 'pending') {
                        this.db.run('insert or replace into sync_pending (table_name, uuid, change, reason) values (?, ?, ?, ?)',
                            [c.table, c.uuid, JSON.stringify(c), reason]);
                        return false;
                    }
                    this.db.run('delete from sync_pending where table_name = ? and uuid = ?', [c.table, c.uuid]);
                    if (result === 'applied') changed++;
                    return true;
                };

                // inclusoes e alteracoes: pais antes dos filhos; repete enquanto alguma coisa destravar (ex.: categoria dentro de categoria)
                let queue = [...byKey.values()].filter(c => !c.deleted)
                    .sort((a, b) => SYNC_TABLES.indexOf(a.table) - SYNC_TABLES.indexOf(b.table));
                for (let progress = true; progress && queue.length;) {
                    progress = false;
                    const next = [];
                    for (const c of queue) {
                        const [result, reason] = this.applyUpsert(c);
                        if (outcome(c, result, reason)) progress = true; else next.push([c, reason]);
                    }
                    queue = next.map(([c]) => c);
                    this.lastReasons = new Map(next.map(([c, reason]) => [`${c.table}|${c.uuid}`, reason]));
                }
                for (const c of queue) outcome(c, 'pending', this.lastReasons?.get(`${c.table}|${c.uuid}`) ?? 'Falta uma linha da qual esta depende.');

                // exclusoes: filhos antes dos pais
                const deletes = [...byKey.values()].filter(c => c.deleted)
                    .sort((a, b) => SYNC_TABLES.indexOf(b.table) - SYNC_TABLES.indexOf(a.table));
                for (const c of deletes) {
                    const [result, reason] = this.applyDelete(c);
                    outcome(c, result, reason);
                }
                return changed;
            } finally {
                this.db.sql.run('update sync_ctl set applying = 0');
            }
        });
    }

    // ---- aplicar uma alteracao ----

    /** Tempo da ultima alteracao local da linha: o maior entre o updated_at dela e o da caixa de saida. */
    localMs(table, row) {
        const out = this.db.get('select at from sync_outbox where table_name = ? and uuid = ?', [table, row.uuid]);
        return Math.max(toMs(row.updated_at) ?? 0, out?.at ?? 0);
    }

    resolveAlias(table, uuid) {
        let current = uuid;
        for (let i = 0; i < 10; i++) {
            const next = this.db.value('select to_uuid from sync_alias where table_name = ? and from_uuid = ?', [table, current]);
            if (!next) break;
            current = next;
        }
        return current;
    }

    idOf(table, uuid) {
        return this.db.value(`select id from ${table} where uuid = ?`, [this.resolveAlias(table, uuid)]);
    }

    applyUpsert(c) {
        const spec = TABLES[c.table];
        const payload = JSON.parse(c.payload);

        const values = {};
        for (const [column, type] of Object.entries(spec.columns)) {
            if (isFk(type)) {
                const ref = payload[fkName(column)] ?? null;
                if (ref == null) { values[column] = null; continue; }
                const id = this.idOf(fkTarget(type), ref);
                if (id == null) return ['pending', 'Falta uma linha da qual esta depende.'];
                values[column] = id;
            } else {
                values[column] = type === 'ts' ? fromMs(payload[column]) : (payload[column] ?? (column === 'kind' ? 'EXPENSE' : null)); // 'kind': versao do app sem categorias por tipo
            }
        }
        let tagIds = null;
        if (spec.tags) {
            tagIds = [];
            for (const tag of payload.tag_uuids ?? []) {
                const id = this.idOf('tags', tag);
                if (id == null) return ['pending', 'Falta uma etiqueta da qual esta depende.'];
                tagIds.push(id);
            }
        }

        try {
            let uuid = this.resolveAlias(c.table, c.uuid);
            let local = this.db.get(`select * from ${c.table} where uuid = ?`, [uuid]);

            if (!local) {
                const twin = this.findTwin(c.table, spec, values);
                if (twin) {
                    if (c.uuid > twin.uuid) { // o outro aparelho vai adotar o nosso uuid
                        this.db.run('insert or replace into sync_alias (table_name, from_uuid, to_uuid) values (?, ?, ?)', [c.table, c.uuid, twin.uuid]);
                        return ['skipped'];
                    }
                    // nosso uuid e maior: adotamos o do outro aparelho
                    const mine = twin.uuid;
                    this.db.run(`update ${c.table} set uuid = ? where id = ?`, [c.uuid, twin.id]);
                    this.db.run('insert or replace into sync_alias (table_name, from_uuid, to_uuid) values (?, ?, ?)', [c.table, mine, c.uuid]);
                    const queued = this.db.get('select at from sync_outbox where table_name = ? and uuid = ?', [c.table, mine]);
                    this.db.run('delete from sync_outbox where table_name = ? and uuid = ?', [c.table, mine]);
                    if (queued) this.db.run('insert or replace into sync_outbox (table_name, uuid, deleted, at) values (?, ?, 0, ?)', [c.table, c.uuid, queued.at]);
                    uuid = c.uuid;
                    local = {...twin, uuid};
                }
            }

            if (local) {
                if (c.updatedAt <= this.localMs(c.table, local)) {
                    // a versao daqui e mais nova (ou igual): fica, e garante que sera enviada
                    this.db.run('insert or ignore into sync_outbox (table_name, uuid, deleted, at) values (?, ?, 0, ?)', [c.table, uuid, FAR_PAST]);
                    return ['skipped'];
                }
                const columns = Object.keys(values);
                this.db.run(`update ${c.table} set ${columns.map(k => `${k} = ?`).join(', ')}, updated_at = ? where id = ?`,
                    [...columns.map(k => values[k]), fromMs(c.updatedAt), local.id]);
                this.db.run('delete from sync_outbox where table_name = ? and uuid = ?', [c.table, uuid]);
                if (tagIds) this.setTags(local.id, tagIds);
                return ['applied'];
            }

            // nao existe aqui: se foi apagado aqui depois dessa versao, continua apagado
            const gone = this.db.get('select at from sync_outbox where table_name = ? and uuid = ? and deleted = 1', [c.table, uuid]);
            if (gone && gone.at >= c.updatedAt) return ['skipped'];
            const columns = Object.keys(values);
            const res = this.db.run(
                `insert into ${c.table} (uuid, ${columns.join(', ')}, updated_at) values (?, ${columns.map(() => '?').join(', ')}, ?)`,
                [uuid, ...columns.map(k => values[k]), fromMs(c.updatedAt)]);
            this.db.run('delete from sync_outbox where table_name = ? and uuid = ?', [c.table, uuid]);
            if (tagIds) this.setTags(res.lastId, tagIds);
            return ['applied'];
        } catch (e) {
            return ['pending', e.message];
        }
    }

    applyDelete(c) {
        const uuid = this.resolveAlias(c.table, c.uuid);
        const local = this.db.get(`select * from ${c.table} where uuid = ?`, [uuid]);
        if (!local) return ['skipped'];
        if (c.updatedAt <= this.localMs(c.table, local)) {
            this.db.run('insert or ignore into sync_outbox (table_name, uuid, deleted, at) values (?, ?, 0, ?)', [c.table, uuid, FAR_PAST]);
            return ['skipped'];
        }
        try {
            this.db.run(`delete from ${c.table} where id = ?`, [local.id]);
        } catch (e) {
            return ['pending', e.message];
        }
        this.db.run('delete from sync_outbox where table_name = ? and uuid = ?', [c.table, uuid]);
        return ['applied'];
    }

    setTags(expenseId, tagIds) {
        this.db.run('delete from expense_tags where expense_id = ?', [expenseId]);
        for (const id of new Set(tagIds)) this.db.run('insert into expense_tags (expense_id, tag_id) values (?, ?)', [expenseId, id]);
    }

    /** Linha daqui que e "a mesma coisa" que a recebida, mas com outro uuid (ver o campo natural em tables.js). */
    findTwin(table, spec, values) {
        if (!spec.natural) return null;
        if (spec.naturalWhen && values[spec.naturalWhen] == null) return null;
        const conditions = spec.natural.map(k => (spec.columns[k] === 'text' && k === 'name' ? `${k} = ? collate nocase` : `coalesce(${k}, -1) = coalesce(?, -1)`));
        return this.db.get(`select * from ${table} where ${conditions.join(' and ')}`, spec.natural.map(k => values[k]));
    }
}
