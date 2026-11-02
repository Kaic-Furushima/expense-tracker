import {isoDate, lastDay, toCents} from './util.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Dias inteiros de a ate b (datas "yyyy-MM-dd"), negativo se b for antes. */
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

export const addDays = (isoDay, n) => new Date(Date.parse(`${isoDay}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

const br = isoDay => `${isoDay.slice(8, 10)}/${isoDay.slice(5, 7)}`;

/**
 * O que merece atencao agora: contas vencidas ou perto de vencer, orcamentos perto do limite (ou estourados) e o fim
 * do mes. A mesma lista alimenta o sino do app e as notificacoes.
 */
export class Reminders {
    constructor(settings, messages, upcoming, summary) {
        this.settings = settings;
        this.m = messages;
        this.upcoming = upcoming;
        this.summary = summary;
    }

    /** `key` e estavel para o mesmo fato, entao a notificacao so aparece uma vez. */
    current(clock) {
        if (!this.settings.remindersEnabled()) return [];
        const m = this.m;
        const today = isoDate(clock());
        const days = this.settings.reminderDays();
        const result = [];

        // contas (dinheiro saindo) vencidas ou dentro da janela de aviso
        for (const item of this.upcoming.compute(today, addDays(today, days), null).items) {
            if (item.type !== 'EXPENSE') continue;
            const left = daysBetween(today, item.date);
            const value = item.amount == null ? m.t('valor a informar') : m.money(item.amount);
            const id = `${item.kind}:${item.id}:${item.name}:${item.date}`;
            if (left < 0) {
                result.push({key: `overdue:${id}`, kind: 'OVERDUE', level: 'ALERT', title: m.t('Vencida: {0}', item.name),
                    detail: m.t('Venceu em {0} ({1} de atraso) · {2}', br(item.date), m.days(-left), value), date: item.date});
            } else {
                const when = left === 0 ? m.t('hoje') : left === 1 ? m.t('amanhã') : m.t('em {0} dias ({1})', left, br(item.date));
                result.push({key: `due:${id}`, kind: 'DUE', level: left <= 1 ? 'WARN' : 'INFO', title: m.t('{0} vence {1}', item.name, when),
                    detail: `${value} · ${item.accountName}`, date: item.date});
            }
        }

        // orcamentos perto do limite
        const month = today.slice(0, 7);
        const summary = this.summary.summarize(month);
        for (const c of summary.categories) {
            if (c.budget != null && c.budget > 0) this.budgetReminder(result, `cat${c.categoryId}`, c.name, c.budgetSpent, c.budget, month);
        }
        if (summary.totalBudget != null && summary.totalBudget > 0) {
            this.budgetReminder(result, 'total', m.t('Limite geral do mês'), summary.totalSpent, summary.totalBudget, month);
        }

        // fim do mes
        const end = lastDay(month);
        const untilEnd = daysBetween(today, end);
        if (untilEnd <= 1) {
            result.push({key: `monthend:${month}`, kind: 'MONTH_END', level: 'INFO',
                title: untilEnd === 0 ? m.t('Hoje é o último dia do mês') : m.t('O mês termina amanhã'),
                detail: m.t('Confira os lançamentos pendentes e como ficaram os orçamentos.'), date: end});
        }
        return result;
    }

    budgetReminder(out, id, name, spent, limit, month) {
        const m = this.m;
        const used = toCents(spent ?? 0);
        const max = toCents(limit);
        const pct = Math.floor((used * 100) / max);
        const detail = m.t('{0} de {1} ({2}%)', m.money(used / 100), m.money(max / 100), pct);
        if (used >= max) {
            out.push({key: `budget:${id}:${month}:100`, kind: 'BUDGET', level: 'ALERT', title: m.t('{0}: orçamento estourado', name), detail, date: null});
        } else if (used * 10 >= max * 8) {
            out.push({key: `budget:${id}:${month}:80`, kind: 'BUDGET', level: 'WARN', title: m.t('{0}: perto do limite', name), detail, date: null});
        }
    }
}
