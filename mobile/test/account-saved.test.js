import assert from 'node:assert/strict';
import {beforeEach, describe, it} from 'node:test';
import initSqlJs from 'sql.js';
import {createApi} from '../src/local-api/index.js';
import {MIGRATIONS} from '../src/local-api/schema.js';

const SQL = await initSqlJs();
let api;
let n = 0;
const ok = (method, url, body) => {
    const res = api.handle(method, url, body);
    assert.ok(res.status >= 200 && res.status < 300, `${method} ${url} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
};
const byName = name => ok('GET', '/accounts').find(a => a.name === name);

beforeEach(() => {
    api = createApi(new SQL.Database(), {clock: () => new Date(2026, 4, 15, 12), newId: () => `s-${++n}`});
});

describe('dinheiro guardado (escolha da conta)', () => {
    it('uma conta nova nao e guardada, a menos que seja marcada', () => {
        assert.equal(ok('POST', '/accounts', {name: 'Carteira'}).saved, false);
        assert.equal(ok('POST', '/accounts', {name: 'Cofre', saved: true}).saved, true);
    });

    it('ficar dentro de outra conta nao marca como guardado sozinho', () => {
        const main = ok('GET', '/accounts')[0];
        const part = ok('POST', '/accounts', {name: 'Caixinha', parentId: main.id});
        assert.equal(part.saved, false);
        assert.equal(part.parentId, main.id);
    });

    it('editar sem mandar o campo mantem como estava; mandar muda', () => {
        const cofre = ok('POST', '/accounts', {name: 'Cofre', saved: true});
        const {saved, ...rest} = cofre;
        assert.equal(ok('PUT', `/accounts/${cofre.id}`, {...rest, name: 'Cofre 2'}).saved, true);
        assert.equal(ok('PUT', `/accounts/${cofre.id}`, {...rest, name: 'Cofre 2', saved: false}).saved, false);
    });
});

describe('migracao do campo "guardado"', () => {
    it('quem ja ficava dentro de outra conta continua guardado; as demais, nao', () => {
        // um banco como era antes do campo existir (versao 5 do esquema)
        const old = new SQL.Database();
        MIGRATIONS.slice(0, 5).forEach(sql => old.run(sql));
        old.run('pragma user_version = 5');
        const insert = (id, name, parent) => old.run(
            `insert into accounts (id, uuid, name, type, color, icon, initial_cents, archived, parent_id, updated_at)
             values (?, ?, ?, 'CHECKING', '#64B5F6', 'bank', 0, 0, ?, '2026-01-01T00:00:00')`, [id, `old-${id}`, name, parent]);
        insert(1, 'Banco', null);
        insert(2, 'Caixinha', 1);
        insert(3, 'Carteira', null);

        api = createApi(old, {clock: () => new Date(2026, 4, 15, 12), newId: () => `m-${++n}`});
        assert.deepEqual(['Banco', 'Caixinha', 'Carteira'].map(name => byName(name).saved), [false, true, false]);
    });
});
