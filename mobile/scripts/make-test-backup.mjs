// Gera o arquivo de teste do restore do backup do celular no PC (src/test/resources/mobile-backup.json): dados de exemplo + uma correcao de saldo.
import initSqlJs from 'sql.js';
import {writeFileSync} from 'node:fs';
import {createApi} from '../src/local-api/index.js';
const SQL = await initSqlJs();
const api = createApi(new SQL.Database(), {clock: () => new Date(2026, 4, 15, 12), newId: () => crypto.randomUUID()});
api.handle('POST', '/api/demo-data');
const main = api.handle('GET', '/accounts').body[0];
api.handle('POST', `/accounts/${main.id}/adjust-balance`, {balance: 1234.56});
writeFileSync(new URL('../../src/test/resources/mobile-backup.json', import.meta.url), api.services.backup.dump());
console.log('ok', api.handle('GET', '/accounts').body.map(a => [a.name, a.balance]));
