import {strToU8, zipSync} from 'fflate';

// Escritor minimo de .xlsx (porta do ReportService.Xlsx do back-end Java): abas de linhas com texto, numeros, datas e
// formulas, e um punhado de estilos. Um .xlsx e um zip de arquivos XML.

export const DEFAULT = 0, HEADER = 1, DATE = 2, MONEY = 3, BOLD = 4, TITLE = 5, MONEY_BOLD = 6, PERCENT = 7;

export const text = (value, style = DEFAULT) => ({kind: 's', text: value, style});
export const num = (value, style) => ({kind: 'n', number: value, style});
export const formula = (expression, cached, style) => ({kind: 'f', formula: expression, number: cached, style});
/** Data como numero de serie do Excel (dias desde 30/12/1899). */
export const date = isoDay => num(Math.round((Date.UTC(+isoDay.slice(0, 4), +isoDay.slice(5, 7) - 1, +isoDay.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000), DATE);

/** Escapa XML e descarta caracteres que XML nao aceita. */
const esc = s => [...String(s)].map(ch => {
    switch (ch) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        default: return ch >= ' ' || ch === '\t' || ch === '\n' ? ch : '';
    }
}).join('');

function column(index) {
    let s = '';
    for (let i = index; i >= 0; i = Math.floor(i / 26) - 1) s = String.fromCharCode(65 + (i % 26)) + s;
    return s;
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const STYLES = `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + '<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00"/>'
    + '<numFmt numFmtId="165" formatCode="dd/mm/yyyy"/><numFmt numFmtId="166" formatCode="0%"/></numFmts>'
    + '<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font>'
    + '<font><b/><sz val="11"/><name val="Calibri"/></font>'
    + '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
    + '<font><b/><sz val="14"/><color rgb="FF2F7D6D"/><name val="Calibri"/></font></fonts>'
    + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FF2F7D6D"/><bgColor indexed="64"/></patternFill></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="8">'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
    + '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
    + '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
    + '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>'
    + '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

export class Workbook {
    constructor() {
        this.sheets = [];
    }

    sheet(name, widths, freezeHeader) {
        const sheet = {name, widths, freezeHeader, rows: [], row: (...cells) => { sheet.rows.push(cells); }};
        this.sheets.push(sheet);
        return sheet;
    }

    sheetXml(sheet) {
        let x = `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`;
        if (sheet.freezeHeader) x += '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
        x += '<cols>' + sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols><sheetData>';
        sheet.rows.forEach((row, r) => {
            x += `<row r="${r + 1}">`;
            row.forEach((cell, c) => {
                const ref = `${column(c)}${r + 1}`;
                if (cell.kind === 's') x += `<c r="${ref}" t="inlineStr" s="${cell.style}"><is><t xml:space="preserve">${esc(cell.text ?? '')}</t></is></c>`;
                else if (cell.kind === 'f') x += `<c r="${ref}" s="${cell.style}"><f>${esc(cell.formula)}</f><v>${cell.number}</v></c>`;
                else x += `<c r="${ref}" s="${cell.style}"><v>${cell.number}</v></c>`;
            });
            x += '</row>';
        });
        return `${x}</sheetData></worksheet>`;
    }

    /** O arquivo .xlsx como bytes. */
    build() {
        let types = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
            + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            + '<Default Extension="xml" ContentType="application/xml"/>'
            + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
        let workbook = `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" `
            + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>';
        let rels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`;
        const files = {};
        this.sheets.forEach((sheet, i) => {
            const n = i + 1;
            types += `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
            workbook += `<sheet name="${esc(sheet.name)}" sheetId="${n}" r:id="rId${n}"/>`;
            rels += `<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`;
            files[`xl/worksheets/sheet${n}.xml`] = strToU8(this.sheetXml(sheet));
        });
        rels += `<Relationship Id="rId${this.sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
        return zipSync({
            '[Content_Types].xml': strToU8(`${types}</Types>`),
            '_rels/.rels': strToU8(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
                + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
            'xl/workbook.xml': strToU8(`${workbook}</sheets></workbook>`),
            'xl/_rels/workbook.xml.rels': strToU8(rels),
            'xl/styles.xml': strToU8(STYLES),
            ...files
        });
    }
}

/** A planilha do extrato, com as abas Resumo, Lancamentos e Transferencias (porta de ReportService.xlsx). */
export function statementXlsx(reports, d) {
    const m = reports.m;
    const money = cents => cents / 100;
    const book = new Workbook();

    const summary = book.sheet(m.t('Resumo'), [34, 18, 12], false);
    summary.row(text(reports.title(d), TITLE));
    summary.row(text(m.t('Período: {0}', reports.period2(d))));
    summary.row();
    summary.row(text(m.t('Receitas (pagas)'), BOLD), num(money(d.income), MONEY));
    summary.row(text(m.t('Despesas (pagas)'), BOLD), num(money(d.expense), MONEY));
    summary.row(text(m.t('Saldo do período'), BOLD), num(money(d.income - d.expense), MONEY_BOLD));
    summary.row(text(m.t('A receber (pendente)')), num(money(d.pendingIncome), MONEY));
    summary.row(text(m.t('A pagar (pendente)')), num(money(d.pendingExpense), MONEY));
    summary.row();
    summary.row(text(m.t('Despesas por categoria'), HEADER), text(m.t('Total'), HEADER), text('%', HEADER));
    for (const [name, cents] of d.byCategory) {
        summary.row(text(name), num(money(cents), MONEY), d.expense === 0 ? text('') : num(Math.round((cents / d.expense) * 10000) / 10000, PERCENT));
    }

    const list = book.sheet(m.t('Lançamentos'), [12, 38, 22, 20, 16, 12, 14, 24, 28], true);
    list.row(...[['Data'], ['Descrição'], ['Categoria'], ['Conta'], ['Forma de pagamento'], ['Tipo'], ['Valor'], ['Situação']].map(([h]) => text(m.t(h), HEADER)), text('Tags', HEADER));
    let rowNumber = 1;
    for (const e of d.expenses) {
        rowNumber++;
        list.row(date(e.date), text(e.name), text(e.category), text(e.account), text(e.method), text(m.t(e.income ? 'Receita' : 'Despesa')),
            num(money(e.income ? e.cents : -e.cents), MONEY), text(m.t(e.paid ? 'Pago' : e.income ? 'A receber' : 'A pagar')), text(reports.tagsOf(e)));
    }
    if (rowNumber > 1) {
        list.row(text(m.t('Saldo pago'), BOLD), text(''), text(''), text(''), text(''), text(''),
            formula(`SUMIF(H2:H${rowNumber},"${m.t('Pago')}",G2:G${rowNumber})`, money(d.income - d.expense), MONEY_BOLD));
    }

    const moves = book.sheet(m.t('Transferências'), [12, 34, 22, 22, 16], true);
    moves.row(...['Data', 'Descrição', 'De', 'Para', 'Valor'].map(h => text(m.t(h), HEADER)));
    for (const t of d.transfers) moves.row(date(t.date), text(t.description ?? m.t('Transferência')), text(t.from), text(t.to), num(money(t.cents), MONEY));
    return book.build();
}
