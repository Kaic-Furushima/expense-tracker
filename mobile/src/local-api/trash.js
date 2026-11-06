import {notFound} from './http.js';

/** Quantos dias um item fica na lixeira antes de ser apagado de vez. */
export const RETENTION_DAYS = 30;

const KINDS = ['EXPENSE', 'TRANSFER'];

/** Lixeira: lancamentos e transferencias excluidos podem voltar ate serem removidos de vez. */
export class Trash {
    constructor(db) {
        this.db = db;
    }

    list() {
        const items = [
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
        const table = this.requireTrashed(kind, id);
        this.db.run(`update ${table} set deleted_at = null, updated_at = ? where id = ?`, [this.db.now(), id]);
    }

    /** Remove um item de vez (etiquetas e anexos do lancamento saem junto, por cascata). */
    purge(kind, id) {
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
            this.db.run('delete from expenses where deleted_at is not null and deleted_at < ?', [limit]);
            this.db.run('delete from transfers where deleted_at is not null and deleted_at < ?', [limit]);
        });
    }
}
