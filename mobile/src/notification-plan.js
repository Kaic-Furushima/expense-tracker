import {addDays, daysBetween} from './local-api/reminders.js';
import {lastDay} from './local-api/util.js';

/** Hora (local) em que os avisos agendados aparecem. */
export const NOTIFY_HOUR = 9;
/** O Android limita os alarmes agendados; ficam os mais proximos. */
export const MAX_SCHEDULED = 60;

/** Id inteiro positivo e estavel para uma chave (a mesma conta gera sempre o mesmo id: reagendar nao duplica). */
export function notificationId(key) {
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return (h & 0x7fffffff) || 1;
}

const at = (isoDay, hour) => {
    const [y, m, d] = isoDay.split('-').map(Number);
    return new Date(y, m - 1, d, hour, 0, 0, 0);
};

/**
 * Avisos para agendar no celular (aparecem mesmo com o app fechado): para cada conta a pagar, um aviso N dias antes e um
 * no dia do vencimento, e dois no fim do mes. `items` sao os itens do "Por vir".
 * Devolve [{id, at: Date, title, body}] em ordem de horario.
 */
export function planNotifications({items, today, now, reminderDays, messages, hour = NOTIFY_HOUR, max = MAX_SCHEDULED}) {
    const plan = [];
    const add = (key, isoDay, title, body) => {
        const when = at(isoDay, hour);
        if (when.getTime() > now.getTime()) plan.push({id: notificationId(key), at: when, title, body});
    };

    for (const item of items) {
        if (item.type !== 'EXPENSE' || item.date < today) continue;
        const value = item.amount == null ? messages.t('valor a informar') : messages.money(item.amount);
        const body = `${value} · ${item.accountName}`;
        const key = `${item.kind}:${item.id}:${item.name}:${item.date}`;
        add(`${key}:due`, item.date, messages.t('{0} vence {1}', item.name, messages.t('hoje')), body);
        if (reminderDays >= 1) {
            add(`${key}:ahead`, addDays(item.date, -reminderDays), messages.t('{0} vence em {1}', item.name, messages.days(reminderDays)), body);
        }
    }

    const month = today.slice(0, 7);
    const end = lastDay(month);
    if (daysBetween(today, end) >= 0) {
        const detail = messages.t('Confira os lançamentos pendentes e como ficaram os orçamentos.');
        add(`monthend:${month}:eve`, addDays(end, -1), messages.t('O mês termina amanhã'), detail);
        add(`monthend:${month}:last`, end, messages.t('Hoje é o último dia do mês'), detail);
    }

    return plan.sort((a, b) => a.at - b.at).slice(0, max);
}
