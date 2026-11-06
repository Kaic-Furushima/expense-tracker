// O que os widgets da tela inicial mostram. O widget e nativo (Java) e nao enxerga o banco, que fica dentro do WebView:
// o app monta aqui um resumo ja pronto (textos e valores formatados) e entrega ao Android, que so desenha.
// Com senha no app e a opcao "mostrar mesmo com senha" desligada, o resumo vai SEM nenhum valor, so o aviso.

const TOTAL_BUDGET = 'b-total';

const round2 = n => Math.round(n * 100) / 100;
const percentOf = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/**
 * @param api          a API local ({handle(method, url)}) do perfil em uso
 * @param messages     catalogo de textos (t, language)
 * @param passwordSet  se o app tem senha
 * @param withPassword se a pessoa deixou os widgets funcionarem mesmo com senha
 */
export function buildSnapshot({api, messages, passwordSet, withPassword, now = Date.now()}) {
    const t = (text, ...args) => messages.t(text, ...args);
    const texts = {
        blocked: t('Aplicativo bloqueado por senha. Widgets desativados.'),
        missing: t('Item não encontrado. Toque para abrir o app.'),
        add: t('Novo lançamento'),
        open: t('Abra o app para ativar o widget.')
    };
    if (passwordSet && !withPassword) return {v: 1, at: now, blocked: true, texts, balances: [], progress: []};

    const money = value => messages.money(value);
    const get = url => api.handle('GET', url).body;

    const accounts = get('/accounts').filter(a => !a.archived);
    // o total e o disponivel; o que esta guardado (contas marcadas como "dinheiro guardado") aparece a parte, embaixo
    const sumOf = list => round2(list.reduce((sum, a) => sum + Number(a.balance), 0));
    const total = sumOf(accounts.filter(a => !a.saved));
    const savedTotal = sumOf(accounts.filter(a => a.saved));
    const balances = [
        {key: 'total', choice: t('Saldo total'), name: t('Saldo total'), main: money(total), sub: accounts.some(a => a.saved) ? t('Guardado: {0}', money(savedTotal)) : '', progress: -1, negative: total < 0},
        ...accounts.map(a => ({
            key: `a${a.id}`, choice: a.name, name: a.name, main: money(Number(a.balance)),
            sub: a.parentName ? t('dentro de {0}', a.parentName) : '', progress: -1, negative: Number(a.balance) < 0
        }))
    ];

    const progress = [];
    const summary = get('/api/summary');
    const budgetItem = (key, name, limit, spent) => {
        const left = round2(limit - spent);
        return {
            key, choice: `${t('Orçamento')} · ${name}`, name: `${t('Orçamento')} · ${name}`, main: money(left),
            sub: `${t('restante de {0}', money(limit))} · ${percentOf(spent, limit)}%`, progress: Math.min(100, percentOf(spent, limit)), negative: left < 0
        };
    };
    if (summary.totalBudget > 0) progress.push(budgetItem(TOTAL_BUDGET, t('Geral'), Number(summary.totalBudget), Number(summary.totalSpent)));
    for (const c of summary.categories ?? []) {
        if (c.budget != null && c.budget > 0) progress.push(budgetItem(`b${c.categoryId}`, c.name, Number(c.budget), Number(c.budgetSpent ?? 0)));
    }
    for (const p of get('/pots').filter(pot => pot.active)) {
        const saved = Number(p.balance);
        const goal = p.goal == null ? 0 : Number(p.goal);
        progress.push({
            key: `p${p.id}`, choice: `${t('Caixinha')} · ${p.name}`, name: `${t('Caixinha')} · ${p.name}`, main: money(saved),
            sub: goal > 0 ? `${t('guardado de {0}', money(goal))} · ${percentOf(saved, goal)}%` : t('guardado'),
            progress: goal > 0 ? Math.min(100, percentOf(saved, goal)) : -1, negative: saved < 0
        });
    }
    return {v: 1, at: now, blocked: false, texts, balances, progress};
}
