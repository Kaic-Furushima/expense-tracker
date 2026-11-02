package com.kaic.expensetracker.service;

import com.kaic.expensetracker.model.TransactionType;
import com.kaic.expensetracker.profile.Messages;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.text.NumberFormat;
import java.time.Clock;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Currency;
import java.util.List;
import java.util.Locale;

/**
 * What deserves attention right now: bills that are overdue or due soon, budgets close to (or over) the limit and the
 * end of the month. The same list feeds the bell in the app, the browser notifications and the desktop tray.
 */
@Service
public class ReminderService {

    public enum Level { INFO, WARN, ALERT }

    /** {@code key} is stable for the same fact, so a notification is shown once. */
    public record Reminder(String key, String kind, Level level, String title, String detail, LocalDate date) {
    }

    private static final BigDecimal NEAR = new BigDecimal("0.80");

    private final UpcomingService upcomingService;
    private final SummaryService summaryService;
    private final SettingsService settings;

    private final Messages messages;
    private final Clock clock;

    public ReminderService(UpcomingService upcomingService, SummaryService summaryService, SettingsService settings,
                           Messages messages, Clock clock) {
        this.clock = clock;
        this.messages = messages;
        this.upcomingService = upcomingService;
        this.summaryService = summaryService;
        this.settings = settings;
    }

    public List<Reminder> current() {
        if (!settings.remindersEnabled()) {
            return List.of();
        }
        LocalDate today = LocalDate.now(clock);
        int days = settings.reminderDays();
        List<Reminder> result = new ArrayList<>();

        // bills (money going out) overdue or due within the warning window
        for (UpcomingService.Item item : upcomingService.compute(today, today.plusDays(days), null).items()) {
            if (item.type() != TransactionType.EXPENSE) {
                continue;
            }
            long left = ChronoUnit.DAYS.between(today, item.date());
            String value = item.amount() == null ? messages.t("valor a informar") : money(item.amount());
            String id = item.kind() + ":" + item.id() + ":" + item.name() + ":" + item.date();
            if (left < 0) {
                result.add(new Reminder("overdue:" + id, "OVERDUE", Level.ALERT, messages.t("Vencida: {0}", item.name()),
                        messages.t("Venceu em {0} ({1} de atraso) · {2}", br(item.date()), messages.days(-left), value),
                        item.date()));
            } else {
                String when = left == 0 ? messages.t("hoje") : left == 1 ? messages.t("amanhã")
                        : messages.t("em {0} dias ({1})", left, br(item.date()));
                result.add(new Reminder("due:" + id, "DUE", left <= 1 ? Level.WARN : Level.INFO,
                        messages.t("{0} vence {1}", item.name(), when), value + " · " + item.accountName(), item.date()));
            }
        }

        // budgets close to the limit
        YearMonth month = YearMonth.from(today);
        SummaryService.MonthSummary summary = summaryService.summarize(month);
        for (SummaryService.CategoryTotal c : summary.categories()) {
            if (c.budget() != null && c.budget().signum() > 0) {
                budgetReminder(result, "cat" + c.categoryId(), c.name(), c.budgetSpent(), c.budget(), month);
            }
        }
        if (summary.totalBudget() != null && summary.totalBudget().signum() > 0) {
            budgetReminder(result, "total", messages.t("Limite geral do mês"), summary.totalSpent(), summary.totalBudget(), month);
        }

        // end of the month
        long untilEnd = ChronoUnit.DAYS.between(today, month.atEndOfMonth());
        if (untilEnd <= 1) {
            result.add(new Reminder("monthend:" + month, "MONTH_END", Level.INFO,
                    untilEnd == 0 ? messages.t("Hoje é o último dia do mês") : messages.t("O mês termina amanhã"),
                    messages.t("Confira os lançamentos pendentes e como ficaram os orçamentos."), month.atEndOfMonth()));
        }
        return result;
    }

    private void budgetReminder(List<Reminder> out, String id, String name, BigDecimal spent, BigDecimal limit, YearMonth month) {
        BigDecimal used = spent == null ? BigDecimal.ZERO : spent;
        if (used.compareTo(limit) >= 0) {
            out.add(new Reminder("budget:" + id + ":" + month + ":100", "BUDGET", Level.ALERT,
                    messages.t("{0}: orçamento estourado", name), messages.t("{0} de {1} ({2}%)", money(used), money(limit), pct(used, limit)), null));
        } else if (used.compareTo(limit.multiply(NEAR)) >= 0) {
            out.add(new Reminder("budget:" + id + ":" + month + ":80", "BUDGET", Level.WARN,
                    messages.t("{0}: perto do limite", name), messages.t("{0} de {1} ({2}%)", money(used), money(limit), pct(used, limit)), null));
        }
    }

    private static long pct(BigDecimal used, BigDecimal limit) {
        return used.multiply(BigDecimal.valueOf(100)).divide(limit, 0, java.math.RoundingMode.DOWN).longValue();
    }

    private static String br(LocalDate d) {
        return String.format("%02d/%02d", d.getDayOfMonth(), d.getMonthValue());
    }

    private String money(BigDecimal value) {
        NumberFormat f = NumberFormat.getCurrencyInstance(messages.locale());
        f.setCurrency(Currency.getInstance(settings.currency()));
        return f.format(value);
    }
}
