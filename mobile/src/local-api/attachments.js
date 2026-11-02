import {badRequest, conflict, notFound} from './http.js';

export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_PER_EXPENSE = 5;

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Bytes de um texto base64 (o que o Java chama de Base64.getDecoder()). */
export function decodeBase64(text) {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/** O tipo vem dos primeiros bytes do arquivo, nao do nome que o cliente da: um arquivo disfarcado e recusado. */
export function detectType(b) {
    const is = (offset, text) => [...text].every((c, i) => b[offset + i] === c.charCodeAt(0));
    if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
    if (b.length >= 8 && b[0] === 0x89 && is(1, 'PNG')) return 'image/png';
    if (b.length >= 6 && is(0, 'GIF8')) return 'image/gif';
    if (b.length >= 12 && is(0, 'RIFF') && is(8, 'WEBP')) return 'image/webp';
    if (b.length >= 5 && is(0, '%PDF-')) return 'application/pdf';
    return null;
}

const cleanName = name => {
    const base = String(name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f-\u009f]/g, '_').trim() || 'comprovante';
    return base.slice(0, 150);
};

/** Comprovantes (fotos ou PDF) anexados aos lancamentos: ate 5 MB cada e 5 por lancamento. */
export class Attachments {
    constructor(db) {
        this.db = db;
    }

    meta(a) {
        return {id: a.id, fileName: a.file_name, contentType: a.content_type, sizeBytes: a.size_bytes, createdAt: a.created_at};
    }

    list(expenseId) {
        return this.db.all(`select id, file_name, content_type, size_bytes, created_at from attachments where expense_id = ? order by id`, [expenseId])
            .map(a => this.meta(a));
    }

    /** {id do lancamento: quantos anexos} so para quem tem algum. */
    counts() {
        return Object.fromEntries(this.db.all(`select a.expense_id, count(*) n from attachments a
                                               join expenses e on e.id = a.expense_id where e.deleted_at is null group by a.expense_id`)
            .map(r => [r.expense_id, r.n]));
    }

    /** O arquivo em si: {contentType, fileName, bytes}. */
    file(id) {
        const a = this.db.get('select * from attachments where id = ?', [id]);
        if (!a) throw notFound(`Anexo não encontrado: ${id}`);
        return {contentType: a.content_type, fileName: a.file_name, bytes: decodeBase64(a.data)};
    }

    add(expenseId, body) {
        if (!this.db.get('select 1 from expenses where id = ? and deleted_at is null', [expenseId])) throw notFound(`Lançamento não encontrado: ${expenseId}`);
        if (this.db.value('select count(*) from attachments where expense_id = ?', [expenseId]) >= MAX_PER_EXPENSE) {
            throw conflict(`Cada lançamento aceita até ${MAX_PER_EXPENSE} anexos.`);
        }
        const data = String(body.data ?? '').trim();
        if (data.length % 4 !== 0 || !BASE64.test(data)) throw badRequest('O arquivo não pôde ser lido.');
        const size = (data.length / 4) * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
        if (size === 0) throw badRequest('O arquivo está vazio.');
        if (size > MAX_BYTES) throw badRequest('O arquivo passa de 5 MB.');
        const type = detectType(decodeBase64(data.slice(0, 24))); // so os primeiros bytes
        if (!type) throw badRequest('Só são aceitas imagens (JPEG, PNG, GIF, WebP) e arquivos PDF.');
        const now = this.db.now();
        const {lastId} = this.db.run(`insert into attachments (uuid, expense_id, file_name, content_type, size_bytes, data, created_at, updated_at)
                                      values (?, ?, ?, ?, ?, ?, ?, ?)`, [this.db.newId(), expenseId, cleanName(body.fileName), type, size, data, now, now]);
        return this.meta(this.db.get('select id, file_name, content_type, size_bytes, created_at from attachments where id = ?', [lastId]));
    }

    delete(id) {
        if (!this.db.get('select 1 from attachments where id = ?', [id])) throw notFound(`Anexo não encontrado: ${id}`);
        this.db.run('delete from attachments where id = ?', [id]);
    }
}
