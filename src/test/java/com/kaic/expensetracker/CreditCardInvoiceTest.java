package com.kaic.expensetracker;

import com.kaic.expensetracker.model.Account;
import com.kaic.expensetracker.model.AccountType;
import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.model.TransactionType;
import com.kaic.expensetracker.service.AccountService;
import com.kaic.expensetracker.service.ExpenseService;
import com.kaic.expensetracker.service.InvoiceService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class CreditCardInvoiceTest {

    @Autowired private AccountService accountService;
    @Autowired private ExpenseService expenseService;
    @Autowired private InvoiceService invoiceService;

    @BeforeEach
    void setUp() {
        expenseService.deleteAll();
    }

    private Account card(String name, int closing, int due) {
        return accountService.create(new AccountService.Draft(name, AccountType.CREDIT_CARD, null, null, BigDecimal.ZERO,
                null, false, closing, due));
    }

    private Account bank(String name, String initial) {
        return accountService.create(new AccountService.Draft(name, AccountType.CHECKING, null, null,
                new BigDecimal(initial), null, false));
    }

    private void spend(Account account, String amount, LocalDate date, TransactionType type) {
        Expense e = new Expense();
        e.setName("Compra");
        e.setAmount(new BigDecimal(amount));
        e.setDate(date);
        e.setType(type);
        e.setAccount(account);
        expenseService.save(e);
    }

    @Test
    void aPurchaseAfterTheClosingDayFallsIntoTheNextInvoice() {
        Account card = card("Cartao fechamento", 10, 20);
        assertEquals(YearMonth.of(2026, 8), InvoiceService.invoiceMonthOf(card, LocalDate.of(2026, 8, 10)));
        assertEquals(YearMonth.of(2026, 9), InvoiceService.invoiceMonthOf(card, LocalDate.of(2026, 8, 11)));
        assertEquals(YearMonth.of(2027, 1), InvoiceService.invoiceMonthOf(card, LocalDate.of(2026, 12, 31)));
    }

    @Test
    void theDueDateIsInTheNextMonthWhenTheDueDayComesBeforeTheClosingDay() {
        Account sameMonth = card("Cartao vence no mes", 10, 20);
        Account nextMonth = card("Cartao vence no outro", 25, 5);
        assertEquals(LocalDate.of(2026, 8, 20), InvoiceService.dueDate(sameMonth, YearMonth.of(2026, 8)));
        assertEquals(LocalDate.of(2026, 9, 5), InvoiceService.dueDate(nextMonth, YearMonth.of(2026, 8)));
    }

    @Test
    void daysBeyondTheEndOfAShortMonthAreClamped() {
        Account card = card("Cartao dia 31", 31, 31);
        assertEquals(LocalDate.of(2026, 2, 28), InvoiceService.closingDate(card, YearMonth.of(2026, 2)));
    }

    @Test
    void invoicesTotalThePurchasesRefundsReduceThemAndPayingClearsTheDebt() {
        Account card = card("Cartao fatura", 10, 20);
        Account bank = bank("Banco fatura", "1000.00");
        spend(card, "100.00", LocalDate.of(2026, 8, 5), TransactionType.EXPENSE);   // August invoice
        spend(card, "50.00", LocalDate.of(2026, 8, 10), TransactionType.EXPENSE);   // August invoice (closing day included)
        spend(card, "30.00", LocalDate.of(2026, 8, 11), TransactionType.EXPENSE);   // September invoice
        spend(card, "20.00", LocalDate.of(2026, 8, 6), TransactionType.INCOME);     // refund, August invoice

        InvoiceService.Invoice august = invoiceService.get(card.getId(), YearMonth.of(2026, 8));
        assertEquals(new BigDecimal("130.00"), august.total());
        assertEquals(3, august.items().size());
        assertEquals(LocalDate.of(2026, 7, 11), august.startDate());
        assertEquals(LocalDate.of(2026, 8, 10), august.closingDate());
        assertEquals(InvoiceService.Status.CLOSED, august.status());
        assertEquals(new BigDecimal("-160.00"), accountService.balances().get(card.getId()));

        invoiceService.pay(card.getId(), YearMonth.of(2026, 8), bank.getId(), null, LocalDate.of(2026, 8, 20));

        InvoiceService.Invoice paid = invoiceService.get(card.getId(), YearMonth.of(2026, 8));
        assertEquals(InvoiceService.Status.PAID, paid.status());
        assertEquals(new BigDecimal("130.00"), paid.paid());
        assertEquals(0, paid.remaining().signum());
        assertEquals(1, paid.payments().size());
        assertEquals(new BigDecimal("870.00"), accountService.balances().get(bank.getId()));
        assertEquals(new BigDecimal("-30.00"), accountService.balances().get(card.getId())); // only September is left
        assertThrows(ResponseStatusException.class,
                () -> invoiceService.pay(card.getId(), YearMonth.of(2026, 8), bank.getId(), null, null)); // nothing left
    }

    @Test
    void anInvoiceCanBePaidInParts() {
        Account card = card("Cartao parcial", 10, 20);
        Account bank = bank("Banco parcial", "500.00");
        spend(card, "200.00", LocalDate.of(2026, 8, 1), TransactionType.EXPENSE);

        invoiceService.pay(card.getId(), YearMonth.of(2026, 8), bank.getId(), new BigDecimal("50.00"), LocalDate.of(2026, 8, 15));

        InvoiceService.Invoice invoice = invoiceService.get(card.getId(), YearMonth.of(2026, 8));
        assertEquals(new BigDecimal("150.00"), invoice.remaining());
        assertEquals(InvoiceService.Status.CLOSED, invoice.status());
    }

    @Test
    void theCurrentInvoiceIsAlwaysListedAndOnlyConfiguredCardsHaveInvoices() {
        Account card = card("Cartao lista", 10, 20);
        var list = invoiceService.list(card.getId());
        assertEquals(1, list.size());
        assertEquals(InvoiceService.invoiceMonthOf(card, LocalDate.now()), list.get(0).month());

        Account plain = bank("Banco sem fatura", "0");
        assertThrows(ResponseStatusException.class, () -> invoiceService.list(plain.getId()));
        Account unconfigured = accountService.create(new AccountService.Draft("Cartao sem dias", AccountType.CREDIT_CARD,
                null, null, BigDecimal.ZERO, null, false));
        assertThrows(ResponseStatusException.class, () -> invoiceService.list(unconfigured.getId()));
    }
}
