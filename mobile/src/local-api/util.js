// Dinheiro, datas e meses. Datas sao textos ISO ("2026-05-01"); meses, "2026-05".

export const toCents = value => Math.round(Number(value) * 100);
export const fromCents = cents => (cents == null ? null : cents / 100);

const pad = n => String(n).padStart(2, '0');

export function isoDate(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Data e hora local no formato do Java (LocalDateTime), sem fuso. */
export function isoDateTime(date) {
    return `${isoDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

export const isIsoDate = text => typeof text === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text));
export const isYearMonth = text => typeof text === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(text);

export function monthOf(isoDay) {
    return isoDay.slice(0, 7);
}

/** Soma (ou subtrai, com n negativo) meses a "yyyy-MM". */
export function addMonths(month, n) {
    const [y, m] = month.split('-').map(Number);
    const index = y * 12 + (m - 1) + n;
    return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

export function firstDay(month) {
    return `${month}-01`;
}

export function lastDay(month) {
    const [y, m] = month.split('-').map(Number);
    return `${month}-${pad(new Date(y, m, 0).getDate())}`;
}

/** Soma meses a uma data; o dia e ajustado ao fim do mes quando nao existe (31 de jan + 1 mes = 28/29 de fev). */
export function addMonthsToDate(isoDay, n) {
    const month = addMonths(monthOf(isoDay), n);
    const day = Math.min(Number(isoDay.slice(8, 10)), Number(lastDay(month).slice(8, 10)));
    return `${month}-${pad(day)}`;
}
