package com.kaic.expensetracker.profile;

import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * The few texts the server itself produces for people (reminders, reports): written in Portuguese and translated
 * through this catalog, keyed by the Portuguese text. {@code {0}}, {@code {1}}… mark the values filled in.
 * Anything missing from the catalog simply stays in Portuguese. The screens are translated in the browser.
 */
@Component
public class Messages {

    /** pt text -> {English, Spanish}. */
    private static final Map<String, String[]> CATALOG = new HashMap<>();

    private static void add(String pt, String en, String es) {
        CATALOG.put(pt, new String[]{en, es});
    }

    static {
        // reminders
        add("Vencida: {0}", "Overdue: {0}", "Vencida: {0}");
        add("Venceu em {0} ({1} de atraso) · {2}", "Was due on {0} ({1} late) · {2}", "Venció el {0} ({1} de atraso) · {2}");
        add("valor a informar", "amount to be set", "valor por informar");
        add("hoje", "today", "hoy");
        add("amanhã", "tomorrow", "mañana");
        add("em {0} dias ({1})", "in {0} days ({1})", "en {0} días ({1})");
        add("{0} vence {1}", "{0} is due {1}", "{0} vence {1}");
        add("Limite geral do mês", "Overall monthly limit", "Límite general del mes");
        add("{0}: orçamento estourado", "{0}: budget exceeded", "{0}: presupuesto excedido");
        add("{0}: perto do limite", "{0}: close to the limit", "{0}: cerca del límite");
        add("{0} de {1} ({2}%)", "{0} of {1} ({2}%)", "{0} de {1} ({2}%)");
        add("Hoje é o último dia do mês", "Today is the last day of the month", "Hoy es el último día del mes");
        add("O mês termina amanhã", "The month ends tomorrow", "El mes termina mañana");
        add("Confira os lançamentos pendentes e como ficaram os orçamentos.",
                "Check your pending entries and how your budgets ended up.",
                "Revisa los movimientos pendientes y cómo quedaron los presupuestos.");
        add("Expense Tracker: {0} lembretes", "Expense Tracker: {0} reminders", "Expense Tracker: {0} recordatorios");
        add("…abra o app para ver todos.", "…open the app to see them all.", "…abre la app para verlos todos.");
        // reports
        add("Extrato", "Statement", "Extracto");
        add("{0} a {1}", "{0} to {1}", "{0} a {1}");
        add("Sem categoria", "No category", "Sin categoría");
        add("Expense Tracker · página {0}", "Expense Tracker · page {0}", "Expense Tracker · página {0}");
        add("Período: {0} · gerado em {1}", "Period: {0} · generated on {1}", "Período: {0} · generado el {1}");
        add("Período: {0}", "Period: {0}", "Período: {0}");
        add("Receitas", "Income", "Ingresos");
        add("Despesas", "Expenses", "Gastos");
        add("Saldo do período", "Balance for the period", "Saldo del período");
        add("Ainda a pagar: {0} · ainda a receber: {1} (não entram nos totais acima)",
                "Still to pay: {0} · still to receive: {1} (not included in the totals above)",
                "Aún por pagar: {0} · aún por cobrar: {1} (no entran en los totales de arriba)");
        add("Despesas por categoria", "Expenses by category", "Gastos por categoría");
        add("Categoria", "Category", "Categoría");
        add("Total", "Total", "Total");
        add("Lançamentos ({0})", "Entries ({0})", "Movimientos ({0})");
        add("Nenhum lançamento neste período.", "No entries in this period.", "Ningún movimiento en este período.");
        add("Data", "Date", "Fecha");
        add("Descrição", "Description", "Descripción");
        add("Conta", "Account", "Cuenta");
        add("Valor", "Amount", "Importe");
        add("{0} (a receber)", "{0} (to receive)", "{0} (por cobrar)");
        add("{0} (a pagar)", "{0} (to pay)", "{0} (por pagar)");
        add("Transferências entre contas (não entram nos totais)", "Transfers between accounts (not included in the totals)",
                "Transferencias entre cuentas (no entran en los totales)");
        add("De → Para", "From → To", "De → A");
        add("Transferência", "Transfer", "Transferencia");
        add("Transferências", "Transfers", "Transferencias");
        add("Resumo", "Summary", "Resumen");
        add("Lançamentos", "Entries", "Movimientos");
        add("Receitas (pagas)", "Income (paid)", "Ingresos (pagados)");
        add("Despesas (pagas)", "Expenses (paid)", "Gastos (pagados)");
        add("A receber (pendente)", "To receive (pending)", "Por cobrar (pendiente)");
        add("A pagar (pendente)", "To pay (pending)", "Por pagar (pendiente)");
        add("Forma de pagamento", "Payment method", "Forma de pago");
        add("Tipo", "Type", "Tipo");
        add("Situação", "Status", "Estado");
        add("Receita", "Income", "Ingreso");
        add("Despesa", "Expense", "Gasto");
        add("Pago", "Paid", "Pagado");
        add("A receber", "To receive", "Por cobrar");
        add("A pagar", "To pay", "Por pagar");
        add("Saldo pago", "Paid balance", "Saldo pagado");
        add("De", "From", "De");
        add("Para", "To", "A");
        // starter data
        add("Principal", "Main", "Principal");
    }

    private final ProfileService profiles;

    public Messages(ProfileService profiles) {
        this.profiles = profiles;
    }

    public String language() {
        return profiles.language();
    }

    /** Number and currency format of the language. */
    public Locale locale() {
        return switch (language()) {
            case "en" -> Locale.forLanguageTag("en-US");
            case "es" -> Locale.forLanguageTag("es-ES");
            default -> Locale.forLanguageTag("pt-BR");
        };
    }

    /** The text in the app language with {@code {n}} replaced by the arguments. */
    public String t(String pt, Object... args) {
        String template = pt;
        String language = language();
        if (!"pt".equals(language)) {
            String[] translated = CATALOG.get(pt);
            if (translated != null) {
                template = "en".equals(language) ? translated[0] : translated[1];
            }
        }
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < template.length(); i++) {
            char c = template.charAt(i);
            int close = template.indexOf('}', i);
            if (c == '{' && close > i + 1 && template.substring(i + 1, close).chars().allMatch(Character::isDigit)) {
                int index = Integer.parseInt(template.substring(i + 1, close));
                out.append(index < args.length ? String.valueOf(args[index]) : "");
                i = close;
            } else {
                out.append(c);
            }
        }
        return out.toString();
    }

    /** "1 dia", "3 dias" in the app language. */
    public String days(long n) {
        return switch (language()) {
            case "en" -> n + (n == 1 ? " day" : " days");
            case "es" -> n + (n == 1 ? " día" : " días");
            default -> n + (n == 1 ? " dia" : " dias");
        };
    }
}
