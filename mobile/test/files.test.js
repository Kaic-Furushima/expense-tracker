import assert from 'node:assert/strict';
import {beforeEach, describe, it} from 'node:test';
import initSqlJs from 'sql.js';
import {detectType} from '../src/local-api/attachments.js';
import {createApi} from '../src/local-api/index.js';

const SQL = await initSqlJs();
let n = 0;
let api;
let main;

const call = (method, url, body) => api.handle(method, url, body);
const ok = (method, url, body) => {
    const res = call(method, url, body);
    assert.ok(res.status >= 200 && res.status < 300, `${method} ${url} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
};

const b64 = bytes => Buffer.from(bytes).toString('base64');
const PNG = b64([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3]);
const JPEG = b64([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4]);
const GIF = b64(Buffer.from('GIF89a....'));
const WEBP = b64(Buffer.from('RIFF....WEBPVP8 '));
const PDF = b64(Buffer.from('%PDF-1.4\n1 0 obj\n'));

const expense = () => ok('POST', '/expenses', {name: 'Mercado', amount: 10, date: '2026-05-01'});
const attach = (id, fileName, data) => call('POST', `/expenses/${id}/attachments`, {fileName, data});

beforeEach(() => {
    api = createApi(new SQL.Database(), {clock: () => new Date(2026, 4, 15, 12, 0, 0), newId: () => `f-${++n}`});
    main = ok('GET', '/accounts')[0];
});

describe('modelos', () => {
    it('cria, lista por nome e exclui', () => {
        const cat = ok('GET', '/categories')[0];
        const pix = ok('GET', '/payment-methods').find(m => m.name === 'Pix');
        const t = ok('POST', '/templates', {name: ' Café ', amount: 7.5, categoryId: cat.id, accountId: main.id, paymentMethodId: pix.id,
            description: ' padaria ', tags: ['rotina', 'manha']});
        assert.deepEqual([t.name, t.type, t.amount, t.categoryName, t.accountName, t.paymentMethodName, t.description, t.tags],
            ['Café', 'EXPENSE', 7.5, cat.name, 'Conta principal', 'Pix', 'padaria', ['rotina', 'manha']]);
        ok('POST', '/templates', {name: 'Academia', type: 'EXPENSE'});
        assert.deepEqual(ok('GET', '/templates').map(x => x.name), ['Academia', 'Café']);
        assert.equal(call('DELETE', `/templates/${t.id}`).status, 204);
        assert.equal(call('DELETE', `/templates/${t.id}`).status, 404);
        assert.equal(ok('GET', '/templates').length, 1);
    });

    it('so o nome e obrigatorio; valor, conta e categoria sao opcionais', () => {
        const t = ok('POST', '/templates', {name: 'Livre', type: 'INCOME'});
        assert.deepEqual([t.type, t.amount, t.categoryId, t.accountId, t.paymentMethodId, t.description, t.tags], ['INCOME', null, null, null, null, null, []]);
    });

    it('valida nome, valor, tipo e referencias', () => {
        assert.equal(call('POST', '/templates', {name: ' '}).body.detail, 'Informe o nome do modelo.');
        assert.equal(call('POST', '/templates', {name: 'x', amount: 0}).status, 400);
        assert.equal(call('POST', '/templates', {name: 'x', amount: 1e12}).status, 400);
        assert.equal(call('POST', '/templates', {name: 'x', type: 'OUTRO'}).status, 400);
        assert.equal(call('POST', '/templates', {name: 'x', categoryId: 99}).status, 404);
        assert.equal(call('POST', '/templates', {name: 'x', accountId: 99}).status, 404);
    });

    it('limite de 100 modelos', () => {
        for (let i = 0; i < 100; i++) ok('POST', '/templates', {name: `m${i}`});
        const res = call('POST', '/templates', {name: 'um a mais'});
        assert.deepEqual([res.status, res.body.detail], [409, 'Limite de 100 modelos atingido.']);
    });

    it('excluir a conta de um modelo apaga o modelo; categoria e forma de pagamento so soltam', () => {
        const cat = ok('POST', '/categories', {name: 'Temp'});
        const method = ok('POST', '/payment-methods', {name: 'Vale'});
        const other = ok('POST', '/accounts', {name: 'Outra', type: 'WALLET'});
        ok('POST', '/templates', {name: 'Preso', categoryId: cat.id, paymentMethodId: method.id});
        ok('POST', '/templates', {name: 'Da outra', accountId: other.id});
        ok('DELETE', `/categories/${cat.id}`);
        ok('DELETE', `/payment-methods/${method.id}`);
        assert.deepEqual(ok('GET', '/templates').filter(t => t.name === 'Preso').map(t => [t.categoryId, t.paymentMethodId]), [[null, null]]);
        ok('DELETE', `/accounts/${other.id}`);
        assert.deepEqual(ok('GET', '/templates').map(t => t.name), ['Preso']);
    });
});

describe('deteccao do tipo do arquivo', () => {
    it('pelos primeiros bytes', () => {
        const type = text => detectType(Buffer.from(text, 'base64'));
        assert.deepEqual([PNG, JPEG, GIF, WEBP, PDF].map(type), ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);
        assert.equal(type(b64(Buffer.from('#!/bin/sh\necho oi'))), null);
        assert.equal(type(b64(Buffer.from('<html><script>'))), null);
        assert.equal(type(''), null);
    });
});

describe('anexos', () => {
    it('anexa, lista, conta, baixa e exclui', () => {
        const e = expense();
        const a = attach(e.id, 'nota.png', PNG);
        assert.equal(a.status, 201);
        assert.deepEqual([a.body.fileName, a.body.contentType, a.body.sizeBytes], ['nota.png', 'image/png', 11]);
        attach(e.id, 'recibo.pdf', PDF);
        assert.deepEqual(ok('GET', `/expenses/${e.id}/attachments`).map(x => [x.fileName, x.contentType]),
            [['nota.png', 'image/png'], ['recibo.pdf', 'application/pdf']]);
        assert.deepEqual(ok('GET', '/attachments/counts'), {[e.id]: 2});

        const file = call('GET', `/attachments/${a.body.id}`);
        assert.equal(file.status, 200);
        assert.equal(file.contentType, 'image/png');
        assert.deepEqual([...file.bytes], [...Buffer.from(PNG, 'base64')]);

        assert.equal(call('DELETE', `/attachments/${a.body.id}`).status, 204);
        assert.deepEqual(ok('GET', '/attachments/counts'), {[e.id]: 1});
        assert.equal(call('GET', `/attachments/${a.body.id}`).status, 404);
        assert.equal(call('DELETE', `/attachments/${a.body.id}`).status, 404);
    });

    it('o tipo vem do conteudo, nao do nome', () => {
        const e = expense();
        assert.equal(attach(e.id, 'foto.pdf', PNG).body.contentType, 'image/png');
        const fake = attach(e.id, 'foto.png', b64(Buffer.from('<script>alert(1)</script>')));
        assert.deepEqual([fake.status, fake.body.detail], [400, 'Só são aceitas imagens (JPEG, PNG, GIF, WebP) e arquivos PDF.']);
        assert.equal(ok('GET', `/expenses/${e.id}/attachments`).length, 1);
    });

    it('recusa base64 invalido, vazio, grande demais e lancamento inexistente', () => {
        const e = expense();
        assert.equal(attach(e.id, 'a.png', 'isto nao e base64!').body.detail, 'O arquivo não pôde ser lido.');
        assert.equal(attach(e.id, 'a.png', 'abc').status, 400);
        assert.equal(attach(e.id, 'a.png', '').body.detail, 'O arquivo está vazio.');
        assert.equal(attach(e.id, 'a.png', undefined).status, 400);
        const big = b64(Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0, 0, 0, 0]), Buffer.alloc(5 * 1024 * 1024)]));
        assert.equal(attach(e.id, 'grande.png', big).body.detail, 'O arquivo passa de 5 MB.');
        assert.equal(attach(999, 'a.png', PNG).status, 404);
        assert.equal(ok('GET', `/expenses/${e.id}/attachments`).length, 0);
    });

    it('ate 5 por lancamento', () => {
        const e = expense();
        for (let i = 0; i < 5; i++) assert.equal(attach(e.id, `n${i}.png`, PNG).status, 201);
        const res = attach(e.id, 'n6.png', PNG);
        assert.deepEqual([res.status, res.body.detail], [409, 'Cada lançamento aceita até 5 anexos.']);
    });

    it('limpa o nome do arquivo', () => {
        const e = expense();
        assert.equal(attach(e.id, '../../etc/pas:swd*.png', PNG).body.fileName, '.._.._etc_pas_swd_.png');
        assert.equal(attach(e.id, '   ', PNG).body.fileName, 'comprovante');
        assert.equal(attach(e.id, 'a'.repeat(300), PNG).body.fileName.length, 150);
    });

    it('lancamento na lixeira: some da contagem e nao aceita anexo novo; apagar de vez leva os anexos', () => {
        const e = expense();
        attach(e.id, 'nota.png', PNG);
        ok('DELETE', `/expenses/${e.id}`);
        assert.deepEqual(ok('GET', '/attachments/counts'), {});
        assert.equal(attach(e.id, 'outra.png', PNG).status, 404);
        ok('POST', `/trash/EXPENSE/${e.id}/restore`);
        assert.deepEqual(ok('GET', '/attachments/counts'), {[e.id]: 1});
        ok('DELETE', `/expenses/${e.id}`);
        ok('DELETE', `/trash/EXPENSE/${e.id}`);
        assert.equal(api.db.value('select count(*) from attachments'), 0);
    });

    it('entram e saem no backup (JSON)', () => {
        const e = expense();
        attach(e.id, 'nota.png', PNG);
        const file = api.services.backup.dump();
        api = createApi(new SQL.Database(), {clock: () => new Date(2026, 4, 15)});
        api.services.backup.restore(file);
        assert.equal(ok('GET', `/expenses/${e.id}/attachments`)[0].fileName, 'nota.png');
        assert.deepEqual([...call('GET', `/attachments/${ok('GET', `/expenses/${e.id}/attachments`)[0].id}`).bytes], [...Buffer.from(PNG, 'base64')]);
    });
});
