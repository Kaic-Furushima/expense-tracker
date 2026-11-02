package com.kaic.expensetracker.service;

import com.kaic.expensetracker.model.Account;
import com.kaic.expensetracker.model.AccountType;
import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.model.Transfer;
import com.kaic.expensetracker.repository.ExpenseRepository;
import com.kaic.expensetracker.repository.TransferRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Credit-card invoices. A card is an account whose balance goes negative with purchases; each purchase belongs to the
 * invoice whose closing day comes right after it, and paying an invoice is a transfer from another account into the
 * card (tagged with the invoice month), which brings the balance back up.
 */
@Service
@Transactional(readOnly = true)
public class InvoiceService {

    public enum Status { OPEN, CLOSED, PAID }

    private final AccountService accountService;
    private final ExpenseRepository expenseRepository;
    private final TransferRepository transferRepository;
    private final TransferService transferService;
    private final Clock clock;

    public InvoiceService(AccountService accountService, ExpenseRepository expenseRepository,
                          TransferRepository transferRepository, TransferService transferService, Clock clock) {
        this.clock = clock;
        this.accountService = accountService;
        this.expenseRepository = expenseRepository;
        this.transferRepository = transferRepository;
        this.transferService = transferService;
    }

    /** An invoice, identified by the month it closes. {@code items} and {@code payments} are filled for one invoice only. */
    public record Invoice(YearMonth month, LocalDate startDate, LocalDate closingDate, LocalDate dueDate,
                          BigDecimal total, BigDecimal paid, BigDecimal remaining, Status status,
                          List<Expense> items, List<Transfer> payments) {
    }

    /** Month of the invoice a purchase made on {@code date} falls into. */
    public static YearMonth invoiceMonthOf(Account card, LocalDate date) {
        YearMonth month = YearMonth.from(date);
        return date.isAfter(closingDate(card, month)) ? month.plusMonths(1) : month;
    }

    public static LocalDate closingDate(Account card, YearMonth month) {
        return clamp(month, card.getClosingDay());
    }

    /** The due day is in the same month as the closing when it is after it, otherwise in the next month. */
    public static LocalDate dueDate(Account card, YearMonth month) {
        YearMonth dueMonth = card.getDueDay() > card.getClosingDay() ? month : month.plusMonths(1);
        return clamp(dueMonth, card.getDueDay());
    }

    private static LocalDate clamp(YearMonth month, int day) {
        return month.atDay(Math.min(day, month.lengthOfMonth()));
    }

    /** Every invoice with purchases or payments, plus the current one, newest first (without items). */
    public List<Invoice> list(Long accountId) {
        Account card = requireCard(accountId);
        Map<YearMonth, List<Expense>> byMonth = group(card);
        Map<YearMonth, List<Transfer>> payments = paymentsByMonth(accountId);
        TreeMap<YearMonth, Boolean> months = new TreeMap<>();
        byMonth.keySet().forEach(m -> months.put(m, true));
        payments.keySet().forEach(m -> months.put(m, true));
        months.put(invoiceMonthOf(card, LocalDate.now(clock)), true);
        List<Invoice> result = new ArrayList<>();
        months.descendingKeySet().forEach(m -> result.add(build(card, m, byMonth.get(m), payments.get(m), false)));
        return result;
    }

    /** One invoice with its purchases and payments. */
    public Invoice get(Long accountId, YearMonth month) {
        Account card = requireCard(accountId);
        return build(card, month, group(card).get(month), paymentsByMonth(accountId).get(month), true);
    }

    /** Pays (all or part of) an invoice from another account, as a transfer into the card. */
    @Transactional
    public Transfer pay(Long cardId, YearMonth month, Long fromAccountId, BigDecimal amount, LocalDate date) {
        Account card = requireCard(cardId);
        Invoice invoice = build(card, month, group(card).get(month), paymentsByMonth(cardId).get(month), false);
        BigDecimal value = amount != null ? amount : invoice.remaining();
        if (value == null || value.signum() <= 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Esta fatura não tem nada a pagar.");
        }
        String description = "Fatura " + card.getName() + " " + String.format("%02d/%d", month.getMonthValue(), month.getYear());
        return transferService.create(new TransferService.Draft(fromAccountId, cardId, value,
                date == null ? LocalDate.now(clock) : date, description, month.toString()));
    }

    private Invoice build(Account card, YearMonth month, List<Expense> expenses, List<Transfer> payments, boolean withItems) {
        List<Expense> items = expenses == null ? List.of() : expenses;
        List<Transfer> paidList = payments == null ? List.of() : payments;
        BigDecimal total = BigDecimal.ZERO;
        for (Expense e : items) {
            total = total.add(e.isIncome() ? e.getAmount().negate() : e.getAmount());
        }
        BigDecimal paid = paidList.stream().map(Transfer::getAmount).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal remaining = total.subtract(paid).max(BigDecimal.ZERO);
        LocalDate closing = closingDate(card, month);
        Status status = total.signum() > 0 && remaining.signum() == 0 ? Status.PAID
                : total.signum() <= 0 && !paidList.isEmpty() ? Status.PAID
                : LocalDate.now(clock).isAfter(closing) ? Status.CLOSED : Status.OPEN;
        return new Invoice(month, closingDate(card, month.minusMonths(1)).plusDays(1), closing, dueDate(card, month),
                total, paid, remaining, status, withItems ? items : List.of(), withItems ? paidList : List.of());
    }

    private Map<YearMonth, List<Expense>> group(Account card) {
        Map<YearMonth, List<Expense>> result = new TreeMap<>();
        for (Expense e : expenseRepository.findByAccountIdOrderByDateAscIdAsc(card.getId())) {
            result.computeIfAbsent(invoiceMonthOf(card, e.getDate()), k -> new ArrayList<>()).add(e);
        }
        return result;
    }

    private Map<YearMonth, List<Transfer>> paymentsByMonth(Long cardId) {
        Map<YearMonth, List<Transfer>> result = new TreeMap<>();
        for (Transfer t : transferRepository.findByToAccountIdAndInvoiceMonthIsNotNullOrderByDateAscIdAsc(cardId)) {
            result.computeIfAbsent(YearMonth.parse(t.getInvoiceMonth()), k -> new ArrayList<>()).add(t);
        }
        return result;
    }

    private Account requireCard(Long accountId) {
        Account card = accountService.getOrThrow(accountId);
        if (card.getType() != AccountType.CREDIT_CARD) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Esta conta não é um cartão de crédito.");
        }
        if (card.getClosingDay() == null || card.getDueDay() == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Informe o dia de fechamento e o de vencimento do cartão para ver as faturas.");
        }
        return card;
    }
}
