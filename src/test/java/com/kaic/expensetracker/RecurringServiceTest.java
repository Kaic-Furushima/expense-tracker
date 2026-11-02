package com.kaic.expensetracker;

import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.model.OccurrenceStatus;
import com.kaic.expensetracker.model.RecurringOccurrence;
import com.kaic.expensetracker.model.RecurringPayment;
import com.kaic.expensetracker.model.TransactionType;
import com.kaic.expensetracker.service.ExpenseService;
import com.kaic.expensetracker.service.RecurringService;
import com.kaic.expensetracker.service.SettingsService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class RecurringServiceTest {

    @Autowired private RecurringService recurringService;
    @Autowired private ExpenseService expenseService;
    @Autowired private SettingsService settings;

    @BeforeEach
    @AfterEach
    void clean() {
        settings.setBoolean(SettingsService.AUTO_PAY_RECURRING, false);
        expenseService.deleteAll();
        recurringService.findAll().forEach(p -> recurringService.delete(p.getId()));
    }

    private RecurringPayment rule(String name, String amount, boolean variable, int day, String startMonth) {
        return recurringService.create(new RecurringService.Draft(name, TransactionType.EXPENSE,
                amount == null ? null : new BigDecimal(amount), variable, day, null, null, null,
                true, startMonth, null));
    }

    private List<RecurringOccurrence> thisMonth() {
        return recurringService.occurrencesOf(YearMonth.now());
    }

    @Test
    void createsOneOccurrenceForEveryMonthFromTheStartUpToNow() {
        YearMonth start = YearMonth.now().minusMonths(2);
        RecurringPayment p = rule("Internet", "99.90", false, 10, start.toString());
        recurringService.sync();
        recurringService.sync(); // idempotent
        long count = java.util.stream.Stream.of(0, 1, 2)
                .flatMap(i -> recurringService.occurrencesOf(start.plusMonths(i)).stream())
                .filter(o -> o.getRecurring().getId().equals(p.getId()))
                .count();
        assertEquals(3, count);
    }

    @Test
    void shortMonthsClampDayThirtyToTheLastDay() {
        assertEquals(LocalDate.of(2026, 2, 28), RecurringService.dueDate(YearMonth.of(2026, 2), 30));
        assertEquals(LocalDate.of(2028, 2, 29), RecurringService.dueDate(YearMonth.of(2028, 2), 31));
        assertEquals(LocalDate.of(2026, 4, 30), RecurringService.dueDate(YearMonth.of(2026, 4), 31));
    }

    @Test
    void withAutoPayOffNothingIsChargedUntilYouPay() {
        rule("Aluguel", "1450.00", false, 1, null);
        RecurringOccurrence o = thisMonth().get(0);
        assertEquals(OccurrenceStatus.PENDING, o.getStatus());
        assertEquals(0, expenseService.getCount());
    }

    @Test
    void withAutoPayOnDueFixedPaymentsBecomeTransactions() {
        rule("Aluguel", "1450.00", false, 1, null);
        rule("Luz", null, true, 1, null);
        settings.setBoolean(SettingsService.AUTO_PAY_RECURRING, true);
        recurringService.sync();
        recurringService.sync();

        assertEquals(1, expenseService.getCount()); // only the fixed one; the variable one asks for confirmation
        List<RecurringOccurrence> occurrences = thisMonth();
        RecurringOccurrence rent = occurrences.stream().filter(o -> o.getRecurring().getName().equals("Aluguel")).findFirst().orElseThrow();
        RecurringOccurrence power = occurrences.stream().filter(o -> o.getRecurring().getName().equals("Luz")).findFirst().orElseThrow();
        assertEquals(OccurrenceStatus.PAID, rent.getStatus());
        assertEquals(YearMonth.now().atDay(1), rent.getPaidDate());
        assertEquals(OccurrenceStatus.PENDING, power.getStatus());
    }

    @Test
    void canPayAheadOnADifferentDate() {
        rule("Condomínio", "300.00", false, 28, null);
        RecurringOccurrence o = thisMonth().get(0);
        LocalDate early = YearMonth.now().atDay(2);

        RecurringOccurrence paid = recurringService.pay(o.getId(), early, null, null, null);
        assertEquals(OccurrenceStatus.PAID, paid.getStatus());
        assertEquals(early, paid.getPaidDate());
        Expense e = paid.getExpense();
        assertEquals(early, e.getDate());
        assertEquals(new BigDecimal("300.00"), e.getAmount());

        assertThrows(ResponseStatusException.class, () -> recurringService.pay(o.getId(), early, null, null, null));
    }

    @Test
    void variablePaymentNeedsAnAmount() {
        rule("Água", null, true, 15, null);
        RecurringOccurrence o = thisMonth().get(0);
        assertThrows(ResponseStatusException.class, () -> recurringService.pay(o.getId(), null, null, null, null));
        RecurringOccurrence paid = recurringService.pay(o.getId(), null, new BigDecimal("87.35"), null, null);
        assertEquals(new BigDecimal("87.35"), paid.getAmount());
    }

    @Test
    void skipAndReopen() {
        rule("Academia", "100.00", false, 5, null);
        RecurringOccurrence o = thisMonth().get(0);
        assertEquals(OccurrenceStatus.SKIPPED, recurringService.skip(o.getId()).getStatus());
        assertEquals(OccurrenceStatus.PENDING, recurringService.reopen(o.getId()).getStatus());
    }

    @Test
    void deletingThePaymentTransactionSkipsTheOccurrenceSoAutoPayDoesNotRecreateIt() {
        rule("Seguro", "80.00", false, 1, null);
        settings.setBoolean(SettingsService.AUTO_PAY_RECURRING, true);
        recurringService.sync();
        RecurringOccurrence paid = thisMonth().get(0);
        assertEquals(OccurrenceStatus.PAID, paid.getStatus());

        expenseService.deleteById(paid.getExpense().getId());
        recurringService.sync();

        RecurringOccurrence after = thisMonth().get(0);
        assertEquals(OccurrenceStatus.SKIPPED, after.getStatus());
        assertEquals(0, expenseService.getCount());
    }

    @Test
    void validatesTheRule() {
        assertThrows(ResponseStatusException.class, () -> rule("X", "10", false, 32, null));
        assertThrows(ResponseStatusException.class, () -> rule("X", null, false, 10, null));
        assertThrows(ResponseStatusException.class, () -> rule(" ", "10", false, 10, null));
    }
}
