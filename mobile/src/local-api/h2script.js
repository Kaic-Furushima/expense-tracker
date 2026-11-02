import {badRequest} from './http.js';

// Le o backup do aplicativo de computador: um script SQL gerado pelo H2 (SCRIPT), com CREATE TABLE e INSERT ... VALUES.
// Nao executa SQL: so extrai, de cada tabela, os nomes das colunas e as linhas. Devolve {tabela: {columns, rows}} com
// nomes em minusculas; datas e horas viram texto, numeros viram number, TRUE/FALSE viram boolean.

const INVALID = 'Este arquivo não parece um backup deste aplicativo.';

const TABLE_RE = /CREATE\s+(?:MEMORY\s+|CACHED\s+)?TABLE\s+(?:"[^"]+"\.)?"([^"]+)"\s*\(/g;
const INSERT_RE = /INSERT\s+INTO\s+(?:"[^"]+"\.)?"([^"]+)"\s*(\(\s*"[^)]*\))?\s*VALUES\s*/g;
const NUMBER_RE = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const WORD_RE = /[A-Za-z_]+/y;

export function parseH2Script(text) {
    const source = text.replace(/^\uFEFF/, '');
    const tables = new Map();

    for (const m of source.matchAll(TABLE_RE)) {
        const end = source.indexOf('\n)', m.index);
        const body = source.slice(m.index + m[0].length, end < 0 ? undefined : end);
        const columns = [...body.matchAll(/^\s*"([^"]+)"\s/gm)].map(c => c[1].toLowerCase());
        tables.set(m[1].toLowerCase(), {columns, rows: []});
    }

    for (const m of source.matchAll(INSERT_RE)) {
        const table = tables.get(m[1].toLowerCase());
        if (!table) continue;
        const columns = m[2] ? [...m[2].matchAll(/"([^"]+)"/g)].map(c => c[1].toLowerCase()) : table.columns;
        const reader = new Reader(source, m.index + m[0].length);
        for (;;) {
            reader.skipSpace();
            table.rows.push(reader.row(columns));
            reader.skipSpace();
            if (reader.peek() === ',') { reader.pos++; continue; }
            break;
        }
    }
    return tables;
}

class Reader {
    constructor(text, pos) {
        this.text = text;
        this.pos = pos;
    }

    peek() { return this.text[this.pos]; }

    skipSpace() {
        while (this.pos < this.text.length && /\s/.test(this.text[this.pos])) this.pos++;
    }

    fail() {
        throw badRequest(INVALID);
    }

    expect(char) {
        this.skipSpace();
        if (this.text[this.pos] !== char) this.fail();
        this.pos++;
    }

    /** Uma linha "(v1, v2, ...)" como objeto {coluna: valor}. */
    row(columns) {
        this.expect('(');
        const values = [];
        for (;;) {
            values.push(this.value());
            this.skipSpace();
            if (this.peek() === ',') { this.pos++; continue; }
            this.expect(')');
            break;
        }
        if (values.length !== columns.length) this.fail();
        return Object.fromEntries(columns.map((c, i) => [c, values[i]]));
    }

    value() {
        this.skipSpace();
        const ch = this.text[this.pos];
        if (ch === "'") return this.quoted(false);
        if (ch === '-' || (ch >= '0' && ch <= '9')) {
            NUMBER_RE.lastIndex = this.pos;
            const m = NUMBER_RE.exec(this.text);
            if (!m) this.fail();
            this.pos += m[0].length;
            return Number(m[0]);
        }
        WORD_RE.lastIndex = this.pos;
        const word = WORD_RE.exec(this.text);
        if (!word) this.fail();
        const name = word[0].toUpperCase();
        this.pos += word[0].length;
        switch (name) {
            case 'NULL': return null;
            case 'TRUE': return true;
            case 'FALSE': return false;
            case 'U': // U&'...' (com escapes \00e7 e \+01f37d)
                if (this.text[this.pos] !== '&') this.fail();
                this.pos++;
                return this.quoted(true);
            case 'DATE':
            case 'TIME':
            case 'TIMESTAMP':
                return this.temporal();
            case 'STRINGDECODE': {
                this.expect('(');
                const raw = this.quoted(false);
                this.expect(')');
                return decodeJava(raw);
            }
            default:
                return this.fail();
        }
    }

    /** DATE '...', TIME '...', TIMESTAMP '...' (talvez "WITH TIME ZONE"): fica so o texto. */
    temporal() {
        for (;;) { // pula palavras como "WITH TIME ZONE" ate a aspa
            this.skipSpace();
            if (this.text[this.pos] === "'") break;
            WORD_RE.lastIndex = this.pos;
            const word = WORD_RE.exec(this.text);
            if (!word) this.fail();
            this.pos += word[0].length;
        }
        return this.quoted(false);
    }

    quoted(unicodeEscapes) {
        this.skipSpace();
        if (this.text[this.pos] !== "'") this.fail();
        let i = this.pos + 1;
        let out = '';
        for (;;) {
            const q = this.text.indexOf("'", i);
            if (q < 0) this.fail();
            out += this.text.slice(i, q);
            if (this.text[q + 1] === "'") { out += "'"; i = q + 2; continue; }
            this.pos = q + 1;
            break;
        }
        return unicodeEscapes ? decodeUnicode(out) : out;
    }
}

/** U&'...': \XXXX (4 digitos), \+XXXXXX (6 digitos) e \\ (barra). */
function decodeUnicode(text) {
    if (!text.includes('\\')) return text;
    return text.replace(/\\(\\|\+[0-9a-fA-F]{6}|[0-9a-fA-F]{4})/g, (_, code) =>
        code === '\\' ? '\\' : String.fromCodePoint(parseInt(code.replace('+', ''), 16)));
}

/** STRINGDECODE('...'): escapes no estilo Java (\n, \t, \uXXXX, \\, \"). */
function decodeJava(text) {
    return text.replace(/\\(u[0-9a-fA-F]{4}|[ntrbf"'\\])/g, (_, code) => {
        if (code[0] === 'u') return String.fromCharCode(parseInt(code.slice(1), 16));
        return {n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', "'": "'", '\\': '\\'}[code];
    });
}
