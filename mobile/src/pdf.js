import {PDFDocument, StandardFonts, rgb} from 'pdf-lib';

// PDF do extrato (porta de ReportService.pdf, que usava OpenPDF): A4, resumo, despesas por categoria, lancamentos e
// transferencias, com cabecalho de tabela repetido a cada pagina e rodape com o numero da pagina. Usa as fontes
// padrao do PDF (Helvetica), que so tem os caracteres do Windows-1252: o que nao existe la vira "?".

const W = 595.28;
const H = 841.89;
const LEFT = 36;
const RIGHT = 36;
const TOP = 40;
const BOTTOM = 44;
const CONTENT = W - LEFT - RIGHT;

const color = (r, g, b) => rgb(r / 255, g / 255, b / 255);
const GREEN = color(0x2F, 0x7D, 0x6D);
const INCOME = color(0x2E, 0x7D, 0x32);
const EXPENSE = color(0xC6, 0x28, 0x28);
const BLACK = color(0, 0, 0);
const GRAY = color(128, 128, 128);
const DARK_GRAY = color(64, 64, 64);
const WHITE = color(255, 255, 255);
const BOX_BORDER = color(0xDD, 0xDD, 0xDD);
const ROW_BORDER = color(0xE6, 0xE6, 0xE6);

export async function statementPdf(reports, d) {
    const m = reports.m;
    const doc = await PDFDocument.create();
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const title = reports.title(d);
    doc.setTitle(title);
    doc.setCreator('Expense Tracker');
    doc.setProducer('Expense Tracker');

    const supported = new Map([[regular, new Set(regular.getCharacterSet())], [bold, new Set(bold.getCharacterSet())]]);
    const safe = (text, font) => [...String(text ?? '').replace(/→/g, '->').replace(/−/g, '-').replace(/\s+/g, ' ')]
        .map(ch => (supported.get(font).has(ch.codePointAt(0)) ? ch : '?')).join('');

    const pages = [];
    let page;
    let y;
    const newPage = () => {
        page = doc.addPage([W, H]);
        pages.push(page);
        y = H - TOP;
    };
    const ensure = height => { if (y - height < BOTTOM) newPage(); };
    newPage();

    const widthOf = (text, font, size) => font.widthOfTextAtSize(text, size);

    /** Quebra o texto em linhas que cabem em maxWidth (palavra maior que a linha e cortada). */
    function wrap(text, font, size, maxWidth) {
        const lines = [];
        let line = '';
        for (const word of text.split(' ')) {
            const candidate = line ? `${line} ${word}` : word;
            if (widthOf(candidate, font, size) <= maxWidth) { line = candidate; continue; }
            if (line) lines.push(line);
            line = '';
            let rest = word;
            while (widthOf(rest, font, size) > maxWidth && rest.length > 1) {
                let cut = rest.length - 1;
                while (cut > 1 && widthOf(rest.slice(0, cut), font, size) > maxWidth) cut--;
                lines.push(rest.slice(0, cut));
                rest = rest.slice(cut);
            }
            line = rest;
        }
        lines.push(line);
        return lines;
    }

    const lineHeight = size => size * 1.25;

    function drawText(text, {font = regular, size = 9, c = BLACK, x = LEFT, align = 'left', width = CONTENT} = {}) {
        const t = safe(text, font);
        const w = widthOf(t, font, size);
        const px = align === 'right' ? x + width - w : align === 'center' ? x + (width - w) / 2 : x;
        page.drawText(t, {x: px, y: y - size, size, font, color: c});
    }

    function paragraph(text, opts) {
        const {font = regular, size = 9, spacingBefore = 0, spacingAfter = 0} = opts;
        const lines = wrap(safe(text, font), font, size, CONTENT);
        y -= spacingBefore;
        ensure(lines.length * lineHeight(size));
        for (const line of lines) {
            drawText(line, opts);
            y -= lineHeight(size);
        }
        y -= spacingAfter;
    }

    /** Tabela: cells[i] = {text, font, c, align}; widths em proporcao. O cabecalho repete a cada pagina. */
    function table(widths, headers, rows) {
        const total = widths.reduce((a, b) => a + b, 0);
        const cols = widths.map(w => (w / total) * CONTENT);
        const offsets = cols.map((_, i) => LEFT + cols.slice(0, i).reduce((a, b) => a + b, 0));
        const pad = 4;
        const drawHeader = () => {
            const size = 9;
            const height = lineHeight(size) + 10;
            ensure(height + 20);
            page.drawRectangle({x: LEFT, y: y - height, width: CONTENT, height, color: GREEN});
            headers.forEach((h, i) => {
                y -= 5;
                drawText(h.text, {font: bold, size, c: WHITE, x: offsets[i] + 5, width: cols[i] - 10, align: h.align});
                y += 5;
            });
            y -= height;
        };
        drawHeader();
        for (const row of rows) {
            const size = 9;
            const wrapped = row.map((cell, i) => wrap(safe(cell.text, cell.font ?? regular), cell.font ?? regular, size, cols[i] - 2 * pad));
            const height = Math.max(...wrapped.map(l => l.length)) * lineHeight(size) + 2 * pad;
            if (y - height < BOTTOM) { newPage(); drawHeader(); }
            const top = y;
            row.forEach((cell, i) => {
                y = top - pad;
                for (const line of wrapped[i]) {
                    drawText(line, {font: cell.font ?? regular, size, c: cell.c ?? BLACK, x: offsets[i] + pad, width: cols[i] - 2 * pad, align: cell.align});
                    y -= lineHeight(size);
                }
            });
            y = top - height;
            page.drawLine({start: {x: LEFT, y}, end: {x: LEFT + CONTENT, y}, thickness: 0.5, color: ROW_BORDER});
        }
    }

    const caption = text => paragraph(text, {font: bold, size: 12, spacingBefore: 14, spacingAfter: 4});
    const money = reports.money.bind(reports);

    // titulo e periodo
    paragraph(title, {font: bold, size: 18, c: GREEN});
    paragraph(m.t('Período: {0} · gerado em {1}', reports.period2(d), reports.br(localIso(reports.db.clock()))),
        {size: 8, c: DARK_GRAY, spacingAfter: 10});

    // resumo: tres caixas
    const boxHeight = 8 + lineHeight(8) + lineHeight(13) + 8;
    ensure(boxHeight);
    [[m.t('Receitas'), money(d.income), INCOME], [m.t('Despesas'), money(d.expense), EXPENSE], [m.t('Saldo do período'), money(d.income - d.expense), BLACK]]
        .forEach(([label, value, c], i) => {
            const x = LEFT + (CONTENT / 3) * i;
            page.drawRectangle({x, y: y - boxHeight, width: CONTENT / 3, height: boxHeight, borderColor: BOX_BORDER, borderWidth: 0.5});
            const saved = y;
            y -= 8;
            drawText(label, {size: 8, c: GRAY, x: x + 8});
            y -= lineHeight(8);
            drawText(value, {font: bold, size: 13, c, x: x + 8});
            y = saved;
        });
    y -= boxHeight;
    if (d.pendingIncome > 0 || d.pendingExpense > 0) {
        paragraph(m.t('Ainda a pagar: {0} · ainda a receber: {1} (não entram nos totais acima)', money(d.pendingExpense), money(d.pendingIncome)),
            {size: 8, c: DARK_GRAY, spacingBefore: 4});
    }

    // despesas por categoria
    if (d.byCategory.length) {
        caption(m.t('Despesas por categoria'));
        table([5, 2, 1], [{text: m.t('Categoria')}, {text: m.t('Total'), align: 'right'}, {text: '%', align: 'right'}],
            d.byCategory.map(([name, cents]) => [{text: name}, {text: money(cents), align: 'right'},
                {text: d.expense === 0 ? '' : `${Math.round((cents * 100) / d.expense)}%`, align: 'right'}]));
    }

    // lancamentos
    caption(m.t('Lançamentos ({0})', d.expenses.length));
    if (!d.expenses.length) {
        paragraph(m.t('Nenhum lançamento neste período.'), {});
    } else {
        table([1.3, 4, 2.6, 2, 2.2],
            [{text: m.t('Data')}, {text: m.t('Descrição')}, {text: m.t('Categoria')}, {text: m.t('Conta')}, {text: m.t('Valor'), align: 'right'}],
            d.expenses.map(e => {
                const name = e.paid ? e.name : m.t(e.income ? '{0} (a receber)' : '{0} (a pagar)', e.name);
                const tags = reports.tagsOf(e);
                return [{text: reports.br(e.date)}, {text: name + (tags ? `  ${tags}` : '')}, {text: e.category}, {text: e.account},
                    {text: `${e.income ? '+' : '-'} ${money(e.cents)}`, align: 'right', c: e.income ? INCOME : EXPENSE}];
            }));
    }

    // transferencias
    if (d.transfers.length) {
        caption(m.t('Transferências entre contas (não entram nos totais)'));
        table([1.3, 4, 4.6, 2.2], [{text: m.t('Data')}, {text: m.t('Descrição')}, {text: m.t('De → Para')}, {text: m.t('Valor'), align: 'right'}],
            d.transfers.map(t => [{text: reports.br(t.date)}, {text: t.description ?? m.t('Transferência')}, {text: `${t.from} → ${t.to}`},
                {text: money(t.cents), font: bold, align: 'right'}]));
    }

    // rodape de cada pagina
    pages.forEach((p, i) => {
        const text = safe(m.t('Expense Tracker · página {0}', i + 1), regular);
        p.drawText(text, {x: (W - widthOf(text, regular, 8)) / 2, y: BOTTOM - 22, size: 8, font: regular, color: GRAY});
    });
    return doc.save();
}

const localIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
