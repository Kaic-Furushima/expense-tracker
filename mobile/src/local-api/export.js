const FORMULA_STARTS = '=+-@\t';

/** Campo de texto do CSV: entre aspas, sem quebras de linha e com um apostrofo na frente se parecer uma formula de planilha. */
export function cell(value) {
    if (value == null) return '';
    let safe = String(value).replaceAll('"', '""').replace(/[\r\n]/g, ' ');
    if (safe && FORMULA_STARTS.includes(safe[0])) safe = `'${safe}`;
    return `"${safe}"`;
}

/** Todos os lancamentos e transferencias, do mais antigo ao mais novo. Valores sao numeros simples (sem simbolo de moeda). */
export function exportCsv(db, mainCurrency = 'BRL') {
    const lines = [];
    const tags = new Map();
    for (const r of db.all('select et.expense_id, t.name from expense_tags et join tags t on t.id = et.tag_id order by t.name')) {
        tags.set(r.expense_id, [...(tags.get(r.expense_id) ?? []), r.name]);
    }
    for (const e of db.all(`select e.*, c.name cat_name, a.name acc_name, a.currency acc_currency, m.name pm_name from expenses e
                            left join categories c on c.id = e.category_id left join accounts a on a.id = e.account_id
                            left join payment_methods m on m.id = e.payment_method_id where e.deleted_at is null`)) {
        lines.push({date: e.date, order: e.id, text: [e.date, e.type, cell(e.name), cell(e.cat_name), (e.amount_cents / 100).toFixed(2),
            cell(e.acc_name), '', cell(e.pm_name), e.status === 'PENDING' ? 'A_PAGAR' : 'PAGO', cell((tags.get(e.id) ?? []).join(' ')),
            cell(e.description), cell(e.acc_currency ?? mainCurrency), '', ''].join(';')});
    }
    for (const t of db.all(`select t.*, f.name from_name, f.currency from_currency, d.currency to_currency, d.name to_name from transfers t
                            join accounts f on f.id = t.from_account_id join accounts d on d.id = t.to_account_id where t.deleted_at is null`)) {
        lines.push({date: t.date, order: t.id, text: [t.date, 'TRANSFER', cell(t.description ?? 'Transferência'), '', (t.amount_cents / 100).toFixed(2),
            cell(t.from_name), cell(t.to_name), '', 'PAGO', '', '', cell(t.from_currency ?? mainCurrency),
            t.to_amount_cents == null ? '' : (t.to_amount_cents / 100).toFixed(2), cell(t.to_currency ?? mainCurrency)].join(';')});
    }
    lines.sort((a, b) => (a.date === b.date ? a.order - b.order : a.date < b.date ? -1 : 1));
    return `﻿data;tipo;nome;categoria;valor;conta;conta_destino;forma_pagamento;situacao;tags;descricao;moeda;valor_destino;moeda_destino\n${lines.map(l => l.text + '\n').join('')}`;
}
