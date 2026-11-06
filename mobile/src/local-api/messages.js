// Os poucos textos que o proprio servidor produz para as pessoas (lembretes, relatorios): escritos em portugues e
// traduzidos por este catalogo, que tem como chave o texto em portugues. {0}, {1}... marcam os valores. O que nao
// estiver no catalogo continua em portugues. As telas sao traduzidas no navegador (lang.js).

/** texto pt -> [ingles, espanhol] */
const CATALOG = new Map([
    // lembretes
    ['Vencida: {0}', ['Overdue: {0}', 'Vencida: {0}']],
    ['Venceu em {0} ({1} de atraso) · {2}', ['Was due on {0} ({1} late) · {2}', 'Venció el {0} ({1} de atraso) · {2}']],
    ['valor a informar', ['amount to be set', 'valor por informar']],
    ['hoje', ['today', 'hoy']],
    ['amanhã', ['tomorrow', 'mañana']],
    ['em {0} dias ({1})', ['in {0} days ({1})', 'en {0} días ({1})']],
    ['{0} vence {1}', ['{0} is due {1}', '{0} vence {1}']],
    ['Limite geral do mês', ['Overall monthly limit', 'Límite general del mes']],
    ['{0}: orçamento estourado', ['{0}: budget exceeded', '{0}: presupuesto excedido']],
    ['{0}: perto do limite', ['{0}: close to the limit', '{0}: cerca del límite']],
    ['{0} de {1} ({2}%)', ['{0} of {1} ({2}%)', '{0} de {1} ({2}%)']],
    ['Hoje é o último dia do mês', ['Today is the last day of the month', 'Hoy es el último día del mes']],
    ['O mês termina amanhã', ['The month ends tomorrow', 'El mes termina mañana']],
    ['Confira os lançamentos pendentes e como ficaram os orçamentos.',
        ['Check your pending entries and how your budgets ended up.', 'Revisa los movimientos pendientes y cómo quedaron los presupuestos.']],
    ['Expense Tracker: {0} lembretes', ['Expense Tracker: {0} reminders', 'Expense Tracker: {0} recordatorios']],
    ['…abra o app para ver todos.', ['…open the app to see them all.', '…abre la app para verlos todos.']],
    // relatorios
    ['Extrato', ['Statement', 'Extracto']],
    ['{0} a {1}', ['{0} to {1}', '{0} a {1}']],
    ['Sem categoria', ['No category', 'Sin categoría']],
    ['Expense Tracker · página {0}', ['Expense Tracker · page {0}', 'Expense Tracker · página {0}']],
    ['Período: {0} · gerado em {1}', ['Period: {0} · generated on {1}', 'Período: {0} · generado el {1}']],
    ['Período: {0}', ['Period: {0}', 'Período: {0}']],
    ['Receitas', ['Income', 'Ingresos']],
    ['Despesas', ['Expenses', 'Gastos']],
    ['Saldo do período', ['Balance for the period', 'Saldo del período']],
    ['Ainda a pagar: {0} · ainda a receber: {1} (não entram nos totais acima)',
        ['Still to pay: {0} · still to receive: {1} (not included in the totals above)', 'Aún por pagar: {0} · aún por cobrar: {1} (no entran en los totales de arriba)']],
    ['Despesas por categoria', ['Expenses by category', 'Gastos por categoría']],
    ['Categoria', ['Category', 'Categoría']],
    ['Total', ['Total', 'Total']],
    ['Lançamentos ({0})', ['Entries ({0})', 'Movimientos ({0})']],
    ['Nenhum lançamento neste período.', ['No entries in this period.', 'Ningún movimiento en este período.']],
    ['Data', ['Date', 'Fecha']],
    ['Descrição', ['Description', 'Descripción']],
    ['Conta', ['Account', 'Cuenta']],
    ['Valor', ['Amount', 'Importe']],
    ['{0} (a receber)', ['{0} (to receive)', '{0} (por cobrar)']],
    ['{0} (a pagar)', ['{0} (to pay)', '{0} (por pagar)']],
    ['Transferências entre contas (não entram nos totais)', ['Transfers between accounts (not included in the totals)', 'Transferencias entre cuentas (no entran en los totales)']],
    ['De → Para', ['From → To', 'De → A']],
    ['Transferência', ['Transfer', 'Transferencia']],
    ['Transferências', ['Transfers', 'Transferencias']],
    ['Resumo', ['Summary', 'Resumen']],
    ['Lançamentos', ['Entries', 'Movimientos']],
    ['Receitas (pagas)', ['Income (paid)', 'Ingresos (pagados)']],
    ['Despesas (pagas)', ['Expenses (paid)', 'Gastos (pagados)']],
    ['A receber (pendente)', ['To receive (pending)', 'Por cobrar (pendiente)']],
    ['A pagar (pendente)', ['To pay (pending)', 'Por pagar (pendiente)']],
    ['Forma de pagamento', ['Payment method', 'Forma de pago']],
    ['Tipo', ['Type', 'Tipo']],
    ['Situação', ['Status', 'Estado']],
    ['Receita', ['Income', 'Ingreso']],
    ['Despesa', ['Expense', 'Gasto']],
    ['Pago', ['Paid', 'Pagado']],
    ['A receber', ['To receive', 'Por cobrar']],
    ['A pagar', ['To pay', 'Por pagar']],
    ['Saldo pago', ['Paid balance', 'Saldo pagado']],
    ['De', ['From', 'De']],
    ['Para', ['To', 'A']],
    // widgets da tela inicial
    ['Aplicativo bloqueado por senha. Widgets desativados.', ['App locked by password. Widgets disabled.', 'Aplicación bloqueada por contraseña. Widgets desactivados.']],
    ['Item não encontrado. Toque para abrir o app.', ['Item not found. Tap to open the app.', 'Elemento no encontrado. Toca para abrir la app.']],
    ['Novo lançamento', ['New entry', 'Nuevo movimiento']],
    ['Abra o app para ativar o widget.', ['Open the app to activate the widget.', 'Abre la app para activar el widget.']],
    ['Saldo total', ['Total balance', 'Saldo total']],
    ['dentro de {0}', ['inside {0}', 'dentro de {0}']],
    ['Guardado: {0}', ['Saved: {0}', 'Guardado: {0}']],
    ['Orçamento', ['Budget', 'Presupuesto']],
    ['Geral', ['Overall', 'General']],
    ['restante de {0}', ['left of {0}', 'restante de {0}']],
    ['Caixinha', ['Pot', 'Hucha']],
    ['guardado de {0}', ['saved of {0}', 'guardado de {0}']],
    ['guardado', ['saved', 'guardado']],
    // avisos agendados no celular
    ['{0} vence em {1}', ['{0} is due in {1}', '{0} vence en {1}']]
]);

const LOCALES = {pt: 'pt-BR', en: 'en-US', es: 'es-ES'};

export class Messages {
    constructor(settings) {
        this.settings = settings;
    }

    language() { return this.settings.language(); }

    /** Formato de numero e moeda do idioma. */
    locale() { return LOCALES[this.language()]; }

    /** O texto no idioma do app, com {n} trocado pelos argumentos. */
    t(pt, ...args) {
        let template = pt;
        const lang = this.language();
        if (lang !== 'pt') {
            const translated = CATALOG.get(pt);
            if (translated) template = lang === 'en' ? translated[0] : translated[1];
        }
        return template.replace(/\{(\d+)\}/g, (_, i) => (Number(i) < args.length ? String(args[Number(i)]) : ''));
    }

    /** "1 dia", "3 dias" no idioma do app. */
    days(n) {
        const lang = this.language();
        if (lang === 'en') return `${n} ${n === 1 ? 'day' : 'days'}`;
        if (lang === 'es') return `${n} ${n === 1 ? 'día' : 'días'}`;
        return `${n} ${n === 1 ? 'dia' : 'dias'}`;
    }

    money(value) {
        return new Intl.NumberFormat(this.locale(), {style: 'currency', currency: this.settings.currency()}).format(value);
    }
}
