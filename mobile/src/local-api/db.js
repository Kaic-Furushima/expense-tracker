import {MIGRATIONS} from './schema.js';
import {isoDateTime} from './util.js';

/**
 * Camada fina sobre o sql.js (SQLite compilado para WebAssembly): consultas que devolvem objetos, transacoes e um
 * gancho "persist" chamado depois de cada gravacao (o aparelho grava o arquivo do banco; os testes ignoram).
 */
export class Db {
    /**
     * @param sqlDb   instancia de SQL.Database
     * @param options persist: funcao chamada (com uma funcao que exporta os bytes) apos alteracoes;
     *                newId: gerador de uuid; clock: () => Date
     */
    constructor(sqlDb, {persist = null, newId = () => crypto.randomUUID(), clock = () => new Date()} = {}) {
        this.sql = sqlDb;
        this.persistHook = persist;
        this.newId = newId;
        this.clock = clock;
        this.depth = 0;
        this.dirty = false;
        this.sql.run('pragma foreign_keys = on');
    }

    now() {
        return isoDateTime(this.clock());
    }

    all(sql, params = []) {
        const stmt = this.sql.prepare(sql);
        try {
            stmt.bind(params);
            const rows = [];
            while (stmt.step()) rows.push(stmt.getAsObject());
            return rows;
        } finally {
            stmt.free();
        }
    }

    get(sql, params = []) {
        return this.all(sql, params)[0] ?? null;
    }

    value(sql, params = []) {
        const row = this.get(sql, params);
        return row ? Object.values(row)[0] : null;
    }

    /** Executa uma gravacao e devolve o id gerado (insert) e quantas linhas mudaram. */
    run(sql, params = []) {
        this.sql.run(sql, params);
        this.dirty = true;
        const result = {lastId: this.value('select last_insert_rowid()'), changes: this.value('select changes()')};
        if (this.depth === 0) this.flush();
        return result;
    }

    /** Tudo ou nada: se fn lancar um erro, as alteracoes sao desfeitas. */
    tx(fn) {
        if (this.depth > 0) return fn();
        this.sql.run('begin');
        this.depth = 1;
        try {
            const result = fn();
            this.sql.run('commit');
            this.depth = 0;
            this.flush();
            return result;
        } catch (e) {
            this.depth = 0;
            try { this.sql.run('rollback'); } catch (ignored) { /* nada a desfazer */ }
            this.dirty = false;
            throw e;
        }
    }

    flush() {
        if (this.dirty && this.persistHook) this.persistHook(() => this.export());
        this.dirty = false;
    }

    /** Bytes do arquivo do banco. O sql.js fecha e reabre o banco ao exportar, o que desliga as chaves estrangeiras: religa. */
    export() {
        const bytes = this.sql.export();
        this.sql.run('pragma foreign_keys = on');
        return bytes;
    }

    close() {
        this.sql.close();
    }

    /** Cria as tabelas (ou aplica as migracoes novas) conforme o "user_version" do arquivo. */
    migrate() {
        const current = this.value('pragma user_version');
        if (current >= MIGRATIONS.length) return false;
        for (let v = current; v < MIGRATIONS.length; v++) this.sql.run(MIGRATIONS[v]);
        this.sql.run(`pragma user_version = ${MIGRATIONS.length}`);
        this.dirty = true;
        this.flush();
        return true;
    }
}
