package com.kaic.expensetracker.service;

import com.kaic.expensetracker.model.Account;
import com.kaic.expensetracker.model.AccountType;
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
import java.time.Clock;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/**
 * "Por vir": what is still to come in and go out of the accounts in a period, and what is left afterwards. It adds up
 * transactions marked "a pagar / receber", pending (and not yet created) recurring payments and credit-card invoices
 * still to pay.
 */
@Service
@Transactional
public class UpcomingService {

    private static final int MAX_MONTHS = 36;

    public enum Kind { EXPENSE, OCCURRENCE, INVOICE }

    /** One thing still to come. {@code amount} is null for a recurring payment of variable value. */
    public record Item(Kind kind, Long id, LocalDate date, String name, TransactionType type, BigDecimal amount,
                       String accountName, boolean overdue) {
    }

    public record Upcoming(LocalDate from, LocalDate to, BigDecimal startBalance, BigDecimal incoming,
                           BigDecimal outgoing, BigDecimal endBalance, int unknownAmounts, List<Item> items,
                           String currency) {
    }

    private final ExpenseService expenseService;
    private final AccountService accountService;
    private final InvoiceService invoiceService;
    private final RecurringService recurringService;
    private final RecurringPaymentRepository payments;
    private final RecurringOccurrenceRepository occurrences;
    private final Clock clock;

    public UpcomingService(ExpenseService expenseService, AccountService accountService, InvoiceService invoiceService,
                           RecurringService recurringService, RecurringPaymentRepository payments,
                           RecurringOccurrenceRepository occurrences, Clock clock) {
        this.clock = clock;
        this.expenseService = expenseService;
        this.accountService = accountService;
        this.invoiceService = invoiceService;
        this.recurringService = recurringService;
        this.payments = payments;
        this.occurrences = occurrences;
    }

    /**
     * The period is {@code from} to {@code to}, both included. Whatever is overdue counts as still to come. When
     * {@code from} is in the future, what falls before it is applied to the starting balance, so that the ending
     * balance is the balance expected at the end of the period.
     */
    public Upcoming compute(LocalDate from, LocalDate to, Long accountId) {
        return compute(from, to, accountId, null);
    }

    /** Only what is in one currency counts: the one of the account being viewed, the one asked for, or the main one. */
    public Upcoming compute(LocalDate from, LocalDate to, Long accountId, String currency) {
        LocalDate today = LocalDate.now(clock);
        LocalDate start = from == null ? today : from;
        LocalDate end = to == null ? start.plusMonths(1) : to;
        if (end.isBefore(start)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A data final deve ser depois da inicial.");
        }
        if (end.isAfter(today.plusMonths(MAX_MONTHS))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "O período pode ir até " + MAX_MONTHS + " meses à frente.");
        }
        recurringService.sync();

        List<Item> all = new ArrayList<>();
        Map<Long, Account> accounts = new java.util.HashMap<>();
        accountService.findAll().forEach(a -> accounts.put(a.getId(), a));

        // transactions marked to pay / receive (the ones on a card with invoices are already inside the invoice)
        for (Expense e : expenseService.findPending()) {
            Account a = e.getAccount();
            if (e.getDate().isAfter(end) || (accountId != null && !accountId.equals(a.getId())) || hasInvoices(a)) {
                continue;
            }
            all.add(new Item(Kind.EXPENSE, e.getId(), e.getDate(), e.getName(), e.getType(), e.getAmount(), a.getName(),
                    e.getDate().isBefore(today)));
        }

        // recurring payments: the pending occurrences, plus the ones of future months that do not exist yet
        for (RecurringOccurrence o : occurrences.findByStatusAndDueDateLessThanEqual(OccurrenceStatus.PENDING, end)) {
            RecurringPayment p = o.getRecurring();
            if (!p.isActive() || (accountId != null && !accountId.equals(p.getAccount().getId()))) {
                continue;
            }
            all.add(new Item(Kind.OCCURRENCE, o.getId(), o.getDueDate(), p.getName(), p.getType(),
                    o.getAmount() != null ? o.getAmount() : p.isVariableAmount() ? null : p.getAmount(),
                    p.getAccount().getName(), o.getDueDate().isBefore(today)));
        }
        YearMonth current = YearMonth.from(today);
        for (RecurringPayment p : payments.findByActiveTrue()) {
            if (accountId != null && !accountId.equals(p.getAccount().getId())) {
                continue;
            }
            YearMonth last = p.end() == null || p.end().isAfter(YearMonth.from(end)) ? YearMonth.from(end) : p.end();
            for (YearMonth m = current.plusMonths(1); !m.isAfter(last); m = m.plusMonths(1)) {
                LocalDate due = RecurringService.dueDate(m, p.getDayOfMonth());
                if (m.isBefore(p.start()) || due.isAfter(end) || occurrences.existsByRecurringAndMonth(p, m.toString())) {
                    continue;
                }
                all.add(new Item(Kind.OCCURRENCE, null, due, p.getName(), p.getType(),
                        p.isVariableAmount() ? null : p.getAmount(), p.getAccount().getName(), false));
            }
        }

        // invoices of credit cards still to pay
        for (Account card : accounts.values()) {
            if (card.isArchived() || !hasInvoices(card) || (accountId != null && !accountId.equals(card.getId()))) {
                continue;
            }
            for (InvoiceService.Invoice inv : invoiceService.list(card.getId())) {
                if (inv.remaining().signum() > 0 && !inv.dueDate().isAfter(end)) {
                    all.add(new Item(Kind.INVOICE, card.getId(), inv.dueDate(),
                            "Fatura " + card.getName() + " " + String.format("%02d/%d", inv.month().getMonthValue(), inv.month().getYear()),
                            TransactionType.EXPENSE, inv.remaining(), card.getName(), inv.dueDate().isBefore(today)));
                }
            }
        }

        Map<Long, String> currencies = accountService.accountCurrencies();
        String view = accountId != null ? currencies.getOrDefault(accountId, accountService.mainCurrency())
                : currency == null || currency.isBlank() ? accountService.mainCurrency() : currency.trim().toUpperCase();
        if (accountId == null) { // other currencies are not mixed into the forecast
            java.util.Set<String> keptNames = new java.util.HashSet<>();
            accounts.values().stream().filter(a -> view.equals(currencies.get(a.getId()))).forEach(a -> keptNames.add(a.getName()));
            all.removeIf(i -> !keptNames.contains(i.accountName()));
        }
        BigDecimal startBalance = currentBalance(accounts, accountId, currencies, view);
        List<Item> inPeriod = new ArrayList<>();
        for (Item item : all) {
            if (start.isAfter(today) && item.date().isBefore(start)) {
                startBalance = startBalance.add(signed(item)); // happens before the period starts
            } else {
                inPeriod.add(item);
            }
        }
        inPeriod.sort(Comparator.comparing(Item::date).thenComparing(Item::name));
        BigDecimal incoming = BigDecimal.ZERO, outgoing = BigDecimal.ZERO;
        int unknown = 0;
        for (Item item : inPeriod) {
            if (item.amount() == null) {
                unknown++;
            } else if (item.type() == TransactionType.INCOME) {
                incoming = incoming.add(item.amount());
            } else {
                outgoing = outgoing.add(item.amount());
            }
        }
        return new Upcoming(start, end, startBalance, incoming, outgoing,
                startBalance.add(incoming).subtract(outgoing), unknown, inPeriod, view);
    }

    private static BigDecimal signed(Item item) {
        if (item.amount() == null) {
            return BigDecimal.ZERO;
        }
        return item.type() == TransactionType.INCOME ? item.amount() : item.amount().negate();
    }

    private static boolean hasInvoices(Account a) {
        return a.getType() == AccountType.CREDIT_CARD && a.getClosingDay() != null && a.getDueDay() != null;
    }

    /** Money available today: every active own account except credit cards (their debt shows up as invoices). */
    private BigDecimal currentBalance(Map<Long, Account> accounts, Long accountId, Map<Long, String> currencies, String view) {
        Map<Long, BigDecimal> balances = accountService.balances();
        BigDecimal total = BigDecimal.ZERO;
        for (Account a : accounts.values()) {
            boolean counts = accountId != null ? accountId.equals(a.getId())
                    : !a.isArchived() && !Boolean.TRUE.equals(a.getSaved()) && a.getType() != AccountType.CREDIT_CARD
                    && view.equals(currencies.get(a.getId()));
            if (counts) {
                total = total.add(balances.getOrDefault(a.getId(), a.getInitialBalance()));
            }
        }
        return total;
    }
}
