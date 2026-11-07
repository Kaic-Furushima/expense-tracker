import {HttpError} from './local-api/http.js';
import {statementPdf} from './pdf.js';
import {statementXlsx} from './xlsx.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Rota /reports/statement.{pdf|xlsx}: gera o extrato no aparelho. Fica separada das demais rotas porque o PDF e montado
 * de forma assincrona. Devolve {status, bytes, contentType} ou null se a rota nao for de relatorio.
 */
export function createReportsHttp({reports}) {
    async function handle(method, path, query) {
        const match = /^\/reports\/statement\.([^/]+)$/.exec(path);
        if (!match) return null;
        if (method !== 'GET') throw new HttpError(405, 'Método não permitido.');
        const format = match[1].toLowerCase();
        if (format !== 'pdf' && format !== 'xlsx') throw new HttpError(404, `Não encontrado: ${path}`);
        const {from, to} = reports.period(query);
        const data = reports.collect(from, to, query.accountId ? Number(query.accountId) : null, query.currency || null);
        return format === 'pdf'
            ? {status: 200, bytes: await statementPdf(reports, data), contentType: 'application/pdf'}
            : {status: 200, bytes: statementXlsx(reports, data), contentType: XLSX};
    }
    return {handle};
}
