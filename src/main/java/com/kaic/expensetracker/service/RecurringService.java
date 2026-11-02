package com.kaic.expensetracker.service;

import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.model.OccurrenceStatus;
import com.kaic.expensetracker.model.RecurringOccurrence;
import com.kaic.expensetracker.model.RecurringPayment;
import com.kaic.expensetracker.model.TransactionType;
import com.kaic.expensetracker.repository.RecurringOccurrenceRepository;
import com.kaic.expensetracker.repository.RecurringPaymentRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.List;

/**
 * Recurring payments: a rule (name, amount, day of the month) plus one occurrence per month. An occurrence stays
 * pending until it is paid, either by the user ("pay now", even before the due date) or automatically when the
 * {@code autoPayRecurring} setting is on.
 */
@Service
@Transactional(readOnly = true)
public class RecurringService {

    /** Automatic payment only catches up the current and the previous month; older ones ask for confirmation. */
    private static final int AUTO_PAY_LOOKBACK_MONTHS = 1;

    private final RecurringPaymentRepository payments;
    private final RecurringOccurrenceRepository occurrences;
    private final ExpenseService expenseService;
    private final AccountService accountService;
    private final PaymentMethodService paymentMethodService;
    private final CategoryService categoryService;
    private final SettingsService settings;
    private final Clock clock;

    public RecurringService(RecurringPaymentRepository payments, RecurringOccurrenceRepository occurrences,
                            ExpenseService expenseService, AccountService accountService,
                            PaymentMethodService paymentMethodService, CategoryService categoryService,
                            SettingsService settings, Clock clock) {
        this.clock = clock;
        this.payments = payments;
        this.occurrences = occurrences;
        this.expenseService = expenseService;
        this.accountService = accountService;
        this.paymentMethodService = paymentMethodService;
        this.categoryService = categoryService;
        this.settings = settings;
    }

    /** Fields of a recurring payment, as typed by the user. */
    public record Draft(String name, TransactionType type, BigDecimal amount, boolean variableAmount, int dayOfMonth,
                        Long accountId, Long paymentMethodId, Long categoryId,
                        boolean active, String startMonth, String endMonth) {
    }

    public List<RecurringPayment> findAll() {
        return payments.findAllByOrderByNameAsc();
    }

    public RecurringPayment getOrThrow(Long id) {
        return payments.findById(id).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "Pagamento recorrente não encontrado: " + id));
    }

    @Transactional
    public RecurringPayment create(Draft draft) {
        RecurringPayment payment = new RecurringPayment();
        apply(payment, draft);
        RecurringPayment saved = payments.save(payment);
        sync();
        return saved;
    }

    @Transactional
    public RecurringPayment update(Long id, Draft draft) {
        RecurringPayment payment = getOrThrow(id);
        apply(payment, draft);
        RecurringPayment saved = payments.save(payment);
        // A new amount only applies from now on: pending occurrences follow the rule, paid ones keep their value.
        occurrences.findByRecurring(saved).stream()
                .filter(o -> o.getStatus() == OccurrenceStatus.PENDING)
                .forEach(o -> {
                    o.setAmount(saved.isVariableAmount() ? null : saved.getAmount());
                    o.setDueDate(dueDate(YearMonth.parse(o.getMonth()), saved.getDayOfMonth()));
                });
        sync();
        return saved;
    }

    /** Deleting the rule removes its occurrences; transactions already created from them stay. */
    @Transactional
    public void delete(Long id) {
        RecurringPayment payment = getOrThrow(id);
        occurrences.deleteByRecurring(payment);
        payments.delete(payment);
    }

    /** Occurrences of one month (creating the missing ones first). */
    @Transactional
    public List<RecurringOccurrence> occurrencesOf(YearMonth month) {
        sync();
        return occurrences.findByMonthOrderByDueDateAscIdAsc(month.toString());
    }

    /**
     * Creates the occurrences that are missing from each rule's start up to the current month and, when automatic
     * payment is on, pays the ones that are due. Safe to call repeatedly (and after the app was closed for days).
     */
    @Transactional
    public synchronized void sync() {
        YearMonth now = YearMonth.now();
        LocalDate today = LocalDate.now(clock);

        for (RecurringPayment payment : payments.findByActiveTrue()) {
            YearMonth last = payment.end() == null || payment.end().isAfter(now) ? now : payment.end();
            for (YearMonth m = payment.start(); !m.isAfter(last); m = m.plusMonths(1)) {
                if (!occurrences.existsByRecurringAndMonth(payment, m.toString())) {
                    RecurringOccurrence occurrence = new RecurringOccurrence();
                    occurrence.setRecurring(payment);
                    occurrence.setMonth(m.toString());
                    occurrence.setDueDate(dueDate(m, payment.getDayOfMonth()));
                    occurrence.setAmount(payment.isVariableAmount() ? null : payment.getAmount());
                    occurrences.save(occurrence);
                }
            }
        }

        if (settings.autoPayRecurring()) {
            YearMonth oldest = now.minusMonths(AUTO_PAY_LOOKBACK_MONTHS);
            for (RecurringOccurrence o : occurrences.findByStatusAndDueDateLessThanEqual(OccurrenceStatus.PENDING, today)) {
                RecurringPayment p = o.getRecurring();
                boolean recent = !YearMonth.parse(o.getMonth()).isBefore(oldest);
                if (p.isActive() && !p.isVariableAmount() && recent) {
                    pay(o, o.getDueDate(), null, null, null);
                }
            }
        }
    }

    /**
     * Pays an occurrence now or on a chosen date (for example the 28th for a payment due on the 30th).
     * Variable payments need an amount.
     */
    @Transactional
    public RecurringOccurrence pay(Long occurrenceId, LocalDate date, BigDecimal amount, Long accountId,
                                   Long paymentMethodId) {
        RecurringOccurrence occurrence = getOccurrence(occurrenceId);
        if (occurrence.getStatus() == OccurrenceStatus.PAID) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Este pagamento já foi feito.");
        }
        return pay(occurrence, date == null ? LocalDate.now(clock) : date, amount, accountId, paymentMethodId);
    }

    @Transactional
    public RecurringOccurrence skip(Long occurrenceId) {
        RecurringOccurrence occurrence = getOccurrence(occurrenceId);
        if (occurrence.getStatus() == OccurrenceStatus.PAID) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Este pagamento já foi feito.");
        }
        occurrence.setStatus(OccurrenceStatus.SKIPPED);
        return occurrences.save(occurrence);
    }

    @Transactional
    public RecurringOccurrence reopen(Long occurrenceId) {
        RecurringOccurrence occurrence = getOccurrence(occurrenceId);
        if (occurrence.getStatus() != OccurrenceStatus.SKIPPED) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Só é possível reabrir um pagamento pulado.");
        }
        occurrence.setStatus(OccurrenceStatus.PENDING);
        return occurrences.save(occurrence);
    }

    private RecurringOccurrence pay(RecurringOccurrence occurrence, LocalDate date, BigDecimal amount,
                                    Long accountId, Long paymentMethodId) {
        RecurringPayment rule = occurrence.getRecurring();
        BigDecimal value = amount != null ? amount : occurrence.getAmount() != null ? occurrence.getAmount() : rule.getAmount();
        if (value == null || value.signum() <= 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Informe o valor deste pagamento.");
        }
        Expense expense = new Expense();
        expense.setName(rule.getName());
        expense.setDescription("Pagamento recorrente");
        expense.setAmount(value.setScale(2, RoundingMode.HALF_UP));
        expense.setDate(date);
        expense.setType(rule.getType());
        expense.setCategory(rule.getCategory());
        expense.setAccount(accountId == null ? rule.getAccount() : accountService.getOrThrow(accountId));
        expense.setPaymentMethod(paymentMethodId == null ? rule.getPaymentMethod() : paymentMethodService.getOrThrow(paymentMethodId));
        Expense saved = expenseService.save(expense);

        occurrence.setStatus(OccurrenceStatus.PAID);
        occurrence.setPaidDate(date);
        occurrence.setAmount(saved.getAmount());
        occurrence.setExpense(saved);
        return occurrences.save(occurrence);
    }

    private RecurringOccurrence getOccurrence(Long id) {
        return occurrences.findById(id).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "Ocorrência não encontrada: " + id));
    }

    /** Day 30 or 31 in a shorter month falls on the last day of that month. */
    public static LocalDate dueDate(YearMonth month, int dayOfMonth) {
        return month.atDay(Math.min(dayOfMonth, month.lengthOfMonth()));
    }

    private void apply(RecurringPayment payment, Draft d) {
        if (d.name() == null || d.name().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Informe o nome do pagamento.");
        }
        if (d.dayOfMonth() < 1 || d.dayOfMonth() > 31) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "O dia do mês deve estar entre 1 e 31.");
        }
        if (!d.variableAmount() && (d.amount() == null || d.amount().signum() <= 0)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Informe o valor ou marque como variável.");
        }
        YearMonth start = d.startMonth() == null || d.startMonth().isBlank() ? YearMonth.now() : parseMonth(d.startMonth());
        YearMonth end = d.endMonth() == null || d.endMonth().isBlank() ? null : parseMonth(d.endMonth());
        if (end != null && end.isBefore(start)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "O mês final não pode ser anterior ao inicial.");
        }
        payment.setName(d.name().trim());
        payment.setType(d.type() == null ? TransactionType.EXPENSE : d.type());
        payment.setVariableAmount(d.variableAmount());
        payment.setAmount(d.variableAmount() ? null : d.amount().setScale(2, RoundingMode.HALF_UP));
        payment.setDayOfMonth(d.dayOfMonth());
        payment.setAccount(d.accountId() == null ? accountService.defaultAccount() : accountService.getOrThrow(d.accountId()));
        payment.setPaymentMethod(d.paymentMethodId() == null ? null : paymentMethodService.getOrThrow(d.paymentMethodId()));
        payment.setCategory(d.categoryId() == null ? null : categoryService.getOrThrow(d.categoryId()));
        payment.setActive(d.active());
        payment.setStartMonth(start.toString());
        payment.setEndMonth(end == null ? null : end.toString());
    }

    private static YearMonth parseMonth(String text) {
        try {
            return YearMonth.parse(text);
        } catch (RuntimeException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Mês inválido: " + text + " (use aaaa-mm).");
        }
    }
}
