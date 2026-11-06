import {TABLES} from './backup.js';
import {notFound} from './http.js';

/** Quantos dias um item fica na lixeira antes de ser apagado de vez. */
export const RETENTION_DAYS = 30;

const KINDS = ['EXPENSE', 'TRANSFER'];
/** O "item" da lixeira que guarda uma copia de todos os dados (de "Limpar tudo"). */
export const EVERYTHING = 'EVERYTHING';

/**
 * Lixeira: lancamentos e transferencias excluidos podem voltar ate serem removidos de vez. "Limpar tudo" tambem vem
 * para ca: uma copia completa dos dados vira um item (EVERYTHING) e o app volta ao estado de recem-instalado.
 * @param options.backup   Backup (gera e le a copia completa)
 * @param options.reseed   () => void: recria o que um app novo tem (conta principal, formas de pagamento, categorias)
 */
export class Trash {
    constructor(db, {backup, reseed} = {}) {
        this.db = db;
        this.backup = backup;
        this.reseed = reseed;
    }

    snapshots() {
        return this.db.all('select id, created_at, summary from trash_snapshots').map(s => ({
            kind: EVERYTHING, id: s.id, title: 'Todos os dados', amount: null, date: null, detail: s.summary, deletedAt: s.created_at
        }));
    }

    /** "22 lançamentos · 5 contas · ...": o que a copia guarda, para a pessoa reconhecer. */
    describe() {
        const count = sql => this.db.value(sql);
        const parts = [
            [count('select count(*) from expenses where deleted_at is null'), 'lançamentos', 'lançamento'],
            [count('select count(*) from accounts'), 'contas', 'conta'],
            [count('select count(*) from categories'), 'categorias', 'categoria'],
            [count('select count(*) from budgets'), 'orçamentos', 'orçamento'],
            [count('select count(*) from recurring_payments'), 'recorrentes', 'recorrente'],
            [count('select count(*) from pots'), 'caixinhas', 'caixinha']
        ];
        return parts.filter(([n]) => n > 0).map(([n, many, one]) => `${n} ${n === 1 ? one : many}`).join(' · ');
    }

    /** Ha algo alem do que um app recem-instalado ja traz? */
    hasUserData() {
        const n = sql => this.db.value(sql);
        return n('select count(*) from expenses') + n('select count(*) from transfers') + n('select count(*) from budgets')
            + n('select count(*) from pots') + n('select count(*) from recurring_payments') + n('select count(*) from wish_items')
            + n('select count(*) from expense_templates') > 0 || n('select count(*) from accounts') > 1;
    }

    saveSnapshot() {
        this.db.run('insert into trash_snapshots (created_at, summary, payload) values (?, ?, ?)',
            [this.db.now(), this.describe(), this.backup.dump()]);
    }

    /** "Limpar tudo": guarda uma copia completa na lixeira e deixa o app como se tivesse acabado de ser instalado. */
    trashEverything() {
        this.db.tx(() => {
            this.saveSnapshot();
            this.db.sql.run('pragma defer_foreign_keys = on');
            for (const table of [...TABLES].reverse()) {
                if (table === 'app_settings') this.db.run("delete from app_settings where setting_key <> 'language'"); // o idioma continua
                else this.db.run(`delete from ${table}`);
            }
            this.db.run("delete from sqlite_sequence where name <> 'trash_snapshots'");
            this.reseed();
        });
    }

    restoreEverything(id) {
        this.db.tx(() => {
            const snapshot = this.db.get('select payload from trash_snapshots where id = ?', [id]);
            if (!snapshot) throw notFound(`Item não encontrado na lixeira: ${id}`);
            if (this.hasUserData()) this.saveSnapshot(); // o que existe agora tambem nao se perde: vai para a lixeira
            this.backup.restore(snapshot.payload);
            this.db.run('delete from trash_snapshots where id = ?', [id]);
        });
    }

    list() {
        const items = [
            ...this.snapshots(),
            ...this.db.all(`select e.*, a.name acc_name, c.name cat_name from expenses e join accounts a on a.id = e.account_id
                            left join categories c on c.id = e.category_id where e.deleted_at is not null`)
                .map(e => ({kind: 'EXPENSE', id: e.id, title: e.name, amount: e.amount_cents / 100, date: e.date,
                    detail: e.acc_name + (e.cat_name ? ` · ${e.cat_name}` : ''), deletedAt: e.deleted_at})),
            ...this.db.all(`select t.*, f.name from_name, d.name to_name from transfers t join accounts f on f.id = t.from_account_id
                            join accounts d on d.id = t.to_account_id where t.deleted_at is not null`)
                .map(t => ({kind: 'TRANSFER', id: t.id, title: t.description ?? 'Transferência', amount: t.amount_cents / 100, date: t.date,
                    detail: `${t.from_name} → ${t.to_name}`, deletedAt: t.deleted_at}))
        ];
        return items.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : a.deletedAt > b.deletedAt ? -1 : 0));
    }

    table(kind) {
        if (!KINDS.includes(kind)) throw notFound(`Item não encontrado na lixeira: ${kind}`);
        return kind === 'EXPENSE' ? 'expenses' : 'transfers';
    }

    requireTrashed(kind, id) {
        const table = this.table(kind);
        if (!this.db.get(`select 1 from ${table} where id = ? and deleted_at is not null`, [id])) throw notFound(`Item não encontrado na lixeira: ${id}`);
        return table;
    }

    restore(kind, id) {
        if (kind === EVERYTHING) return this.restoreEverything(id);
        const table = this.requireTrashed(kind, id);
        this.db.run(`update ${table} set deleted_at = null, updated_at = ? where id = ?`, [this.db.now(), id]);
    }

    /** Remove um item de vez (etiquetas e anexos do lancamento saem junto, por cascata). */
    purge(kind, id) {
        if (kind === EVERYTHING) {
            if (!this.db.get('select 1 from trash_snapshots where id = ?', [id])) throw notFound(`Item não encontrado na lixeira: ${id}`);
            this.db.run('delete from trash_snapshots where id = ?', [id]);
            return;
        }
        const table = this.requireTrashed(kind, id);
        this.db.run(`delete from ${table} where id = ?`, [id]);
    }

    empty() {
        this.purgeTrashedBefore('9999');
    }

    /** Apaga de vez o que esta na lixeira ha mais de RETENTION_DAYS dias. */
    purgeExpired() {
        const cutoff = new Date(this.db.clock().getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
        const pad = n => String(n).padStart(2, '0');
        this.purgeTrashedBefore(`${cutoff.getFullYear()}-${pad(cutoff.getMonth() + 1)}-${pad(cutoff.getDate())}T${pad(cutoff.getHours())}:${pad(cutoff.getMinutes())}:${pad(cutoff.getSeconds())}`);
    }

    purgeTrashedBefore(limit) {
        this.db.tx(() => {
            this.db.run('delete from trash_snapshots where created_at < ?', [limit]);
            this.db.run('delete from expenses where deleted_at is not null and deleted_at < ?', [limit]);
            this.db.run('delete from transfers where deleted_at is not null and deleted_at < ?', [limit]);
        });
    }
}
