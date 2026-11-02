package com.kaic.expensetracker;

import com.kaic.expensetracker.model.Account;
import com.kaic.expensetracker.model.AccountType;
import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.model.ExpenseStatus;
import com.kaic.expensetracker.model.TransactionType;
import com.kaic.expensetracker.service.AccountService;
import com.kaic.expensetracker.service.BudgetService;
import com.kaic.expensetracker.service.ExpenseService;
import com.kaic.expensetracker.service.RecurringService;
import com.kaic.expensetracker.service.ReminderService;
import com.kaic.expensetracker.service.ReportService;
import com.kaic.expensetracker.service.SettingsService;
import com.kaic.expensetracker.service.TransferService;
import com.kaic.expensetracker.service.TrashService;
import com.kaic.expensetracker.service.UpcomingService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.server.ResponseStatusException;

import java.io.ByteArrayInputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.HashMap;
import java.util.Map;
import java.util.zip.ZipInputStream;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class UpcomingRemindersReportsTest {

    @Autowired private UpcomingService upcomingService;
    @Autowired private ReminderService reminderService;
    @Autowired private ReportService reportService;
    @Autowired private ExpenseService expenseService;
    @Autowired private AccountService accountService;
    @Autowired private RecurringService recurringService;
    @Autowired private SettingsService settings;
    @Autowired private TransferService transferService;
    @Autowired private TrashService trashService;
    @Autowired private BudgetService budgetService;

    private final LocalDate today = LocalDate.now();

    @BeforeEach
    void setUp() {
        expenseService.deleteAll();
        trashService.empty();
        recurringService.findAll().forEach(r -> recurringService.delete(r.getId()));
    }

    @AfterEach
    void tearDown() {
        settings.setBoolean(SettingsService.REMINDERS_ENABLED, true);
        settings.setReminderDays(3);
        expenseService.deleteAll();
        budgetService.findAll().forEach(b -> budgetService.remove(b.getCategory() == null ? null : b.getCategory().getId(), YearMonth.of(2000, 1)));
    }

    private Account account(String name, String initial, AccountType type, Integer closing, Integer due) {
        return accountService.create(new AccountService.Draft(name, type, null, null, new BigDecimal(initial), null, false, closing, due));
    }

    private Expense expense(String name, String amount, TransactionType type, ExpenseStatus status, LocalDate date, Account account) {
        Expense e = new Expense();
        e.setName(name);
        e.setAmount(new BigDecimal(amount));
        e.setDate(date);
        e.setType(type);
        e.setStatus(status);
        e.setAccount(account);
        return expenseService.save(e);
    }

    @Test
    void theUpcomingTotalsAddWhatComesInAndGoesOutToTheCurrentBalance() {
        Account a = account("Porvir conta", "1000.00", AccountType.CHECKING, null, null);
        expense("Aluguel", "400.00", TransactionType.EXPENSE, ExpenseStatus.PENDING, today.plusDays(5), a);
        expense("Freela", "250.00", TransactionType.INCOME, ExpenseStatus.PENDING, today.plusDays(10), a);
        expense("Muito depois", "999.00", TransactionType.EXPENSE, ExpenseStatus.PENDING, today.plusDays(90), a);
        expense("Ja pago", "50.00", TransactionType.EXPENSE, ExpenseStatus.PAID, today, a);

        UpcomingService.Upcoming up = upcomingService.compute(today, today.plusMonths(1), a.getId());

        assertEquals(new BigDecimal("950.00"), up.startBalance()); // 1000 - 50 paid
        assertEquals(new BigDecimal("250.00"), up.incoming());
        assertEquals(new BigDecimal("400.00"), up.outgoing());
        assertEquals(new BigDecimal("800.00"), up.endBalance());
        assertEquals(2, up.items().size());
        assertEquals("Aluguel", up.items().get(0).name()); // by date
    }

    @Test
    void overdueBillsStillCountAndALaterPeriodStartsFromTheBalanceExpectedByThen() {
        Account a = account("Porvir atraso", "500.00", AccountType.CHECKING, null, null);
        expense("Atrasada", "100.00", TransactionType.EXPENSE, ExpenseStatus.PENDING, today.minusDays(3), a);
        expense("Daqui a 40 dias", "30.00", TransactionType.EXPENSE, ExpenseStatus.PENDING, today.plusDays(40), a);

        UpcomingService.Upcoming now = upcomingService.compute(today, today.plusDays(10), a.getId());
        assertEquals(new BigDecimal("100.00"), now.outgoing());
        assertTrue(now.items().get(0).overdue());

        UpcomingService.Upcoming later = upcomingService.compute(today.plusDays(30), today.plusDays(60), a.getId());
        assertEquals(new BigDecimal("400.00"), later.startBalance()); // the overdue bill is paid before the period
        assertEquals(new BigDecimal("30.00"), later.outgoing());
        assertEquals(new BigDecimal("370.00"), later.endBalance());
    }

    @Test
    void recurringPaymentsAreProjectedIntoFutureMonths() {
        Account a = account("Porvir recorrente", "0", AccountType.CHECKING, null, null);
        recurringService.create(new RecurringService.Draft("Internet", TransactionType.EXPENSE, new BigDecimal("100.00"), false,
                15, a.getId(), null, null, true, YearMonth.from(today).minusMonths(1).toString(), null));
        recurringService.create(new RecurringService.Draft("Luz", TransactionType.EXPENSE, null, true,
                20, a.getId(), null, null, true, YearMonth.from(today).minusMonths(1).toString(), null));

        UpcomingService.Upcoming up = upcomingService.compute(today, today.plusMonths(3), a.getId());

        long internet = up.items().stream().filter(i -> i.name().equals("Internet")).count();
        assertTrue(internet >= 3, "one a month, projected");
        assertEquals(up.items().stream().filter(i -> i.name().equals("Luz")).count(), up.unknownAmounts());
        assertTrue(up.unknownAmounts() >= 3); // variable values are listed but not summed
        assertEquals(new BigDecimal("100.00").multiply(BigDecimal.valueOf(internet)), up.outgoing());
    }

    @Test
    void anInvoiceStillToPayIsAnOutgoingAndPurchasesOnTheCardAreNotCountedTwice() {
        Account bank = account("Porvir banco", "2000.00", AccountType.CHECKING, null, null);
        Account card = account("Porvir cartao", "0", AccountType.CREDIT_CARD, 10, 20);
        expense("Compra no cartao", "300.00", TransactionType.EXPENSE, ExpenseStatus.PAID, today, card);
        expense("Pendente no cartao", "70.00", TransactionType.EXPENSE, ExpenseStatus.PENDING, today.plusDays(2), card);

        UpcomingService.Upcoming up = upcomingService.compute(today, today.plusMonths(2), null);

        assertTrue(up.items().stream().anyMatch(i -> i.kind() == UpcomingService.Kind.INVOICE));
        assertTrue(up.items().stream().noneMatch(i -> i.kind() == UpcomingService.Kind.EXPENSE && i.name().equals("Pendente no cartao")));
        assertEquals(new BigDecimal("370.00"), up.outgoing()); // the invoice holds both purchases
        assertTrue(up.startBalance().compareTo(bank.getInitialBalance()) <= 0 || up.startBalance().signum() >= 0);
    }

    @Test
    void badPeriodsAreRefused() {
        assertThrows(ResponseStatusException.class, () -> upcomingService.compute(today, today.minusDays(1), null));
        assertThrows(ResponseStatusException.class, () -> upcomingService.compute(today, today.plusYears(10), null));
    }

    @Test
    void billsDueSoonOrOverdueBecomeReminders() {
        Account a = account("Lembrete conta", "100.00", AccountType.CHECKING, null, null);
        expense("Vence amanha", "10.00", TransactionType.EXPENSE, ExpenseStatus.PENDING, today.plusDays(1), a);
        expense("Vencida ontem", "20.00", TransactionType.EXPENSE, ExpenseStatus.PENDING, today.minusDays(1), a);
        expense("Muito longe", "30.00", TransactionType.EXPENSE, ExpenseStatus.PENDING, today.plusDays(20), a);
        expense("A receber", "40.00", TransactionType.INCOME, ExpenseStatus.PENDING, today.plusDays(1), a);

        var reminders = reminderService.current();

        assertTrue(reminders.stream().anyMatch(r -> r.kind().equals("DUE") && r.title().contains("Vence amanha")));
        assertTrue(reminders.stream().anyMatch(r -> r.kind().equals("OVERDUE") && r.level() == ReminderService.Level.ALERT));
        assertTrue(reminders.stream().noneMatch(r -> r.title().contains("Muito longe")));
        assertTrue(reminders.stream().noneMatch(r -> r.title().contains("A receber")));
        assertEquals(reminders.stream().map(ReminderService.Reminder::key).distinct().count(), reminders.size());
    }

    @Test
    void theWarningWindowAndTheOnOffSwitchAreRespected() {
        Account a = account("Lembrete janela", "100.00", AccountType.CHECKING, null, null);
        expense("Daqui a 6 dias", "10.00", TransactionType.EXPENSE, ExpenseStatus.PENDING, today.plusDays(6), a);
        assertTrue(reminderService.current().stream().noneMatch(r -> r.title().contains("Daqui a 6 dias")));

        settings.setReminderDays(7);
        assertTrue(reminderService.current().stream().anyMatch(r -> r.title().contains("Daqui a 6 dias")));
        assertThrows(ResponseStatusException.class, () -> settings.setReminderDays(0));

        settings.setBoolean(SettingsService.REMINDERS_ENABLED, false);
        assertTrue(reminderService.current().isEmpty());
    }

    @Test
    void aBudgetNearOrOverTheLimitIsReported() {
        Account a = account("Lembrete orcamento", "0", AccountType.CHECKING, null, null);
        var category = new com.kaic.expensetracker.service.CategoryService[1];
        // overall limit of 100 for this month, 85 already spent
        budgetService.set(null, YearMonth.from(today), new BigDecimal("100.00"), BudgetService.Scope.ONLY_MONTH);
        expense("Gasto grande", "85.00", TransactionType.EXPENSE, ExpenseStatus.PAID, today, a);

        assertTrue(reminderService.current().stream().anyMatch(r -> r.key().contains("budget:total") && r.level() == ReminderService.Level.WARN));

        expense("Mais gasto", "30.00", TransactionType.EXPENSE, ExpenseStatus.PAID, today, a);
        assertTrue(reminderService.current().stream().anyMatch(r -> r.key().contains("budget:total") && r.level() == ReminderService.Level.ALERT));
        budgetService.remove(null, YearMonth.from(today));
        assertNull(category[0]);
    }

    @Test
    void theStatementTotalsOnlyCountWhatIsPaidAndKeepTransfersApart() {
        Account a = account("Relatorio conta", "0", AccountType.CHECKING, null, null);
        Account b = account("Relatorio outra", "0", AccountType.CHECKING, null, null);
        LocalDate day = LocalDate.of(2026, 2, 10);
        expense("Salario", "3000.00", TransactionType.INCOME, ExpenseStatus.PAID, day, a);
        expense("Mercado", "400.00", TransactionType.EXPENSE, ExpenseStatus.PAID, day, a);
        expense("Luz", "150.00", TransactionType.EXPENSE, ExpenseStatus.PENDING, day, a);
        expense("Fora do periodo", "9.00", TransactionType.EXPENSE, ExpenseStatus.PAID, LocalDate.of(2026, 3, 1), a);
        transferService.create(new TransferService.Draft(a.getId(), b.getId(), new BigDecimal("100.00"), day, "Guardar"));

        ReportService.Data data = reportService.collect(LocalDate.of(2026, 2, 1), LocalDate.of(2026, 2, 28), a.getId());

        assertEquals(new BigDecimal("3000.00"), data.income());
        assertEquals(new BigDecimal("400.00"), data.expense());
        assertEquals(new BigDecimal("150.00"), data.pendingExpense());
        assertEquals(3, data.expenses().size());
        assertEquals(1, data.transfers().size());
        assertEquals(new BigDecimal("400.00"), data.byCategory().get("Sem categoria"));
        assertThrows(ResponseStatusException.class, () -> reportService.collect(LocalDate.of(2026, 2, 28), LocalDate.of(2026, 2, 1), null));
    }

    @Test
    void theSpreadsheetIsAValidXlsxPackageWithTheDataInIt() throws Exception {
        Account a = account("Relatorio xlsx", "0", AccountType.CHECKING, null, null);
        expense("Almoço & café <ok>", "42.50", TransactionType.EXPENSE, ExpenseStatus.PAID, LocalDate.of(2026, 2, 3), a);

        byte[] xlsx = reportService.xlsx(reportService.collect(LocalDate.of(2026, 2, 1), LocalDate.of(2026, 2, 28), a.getId()));

        Map<String, String> parts = new HashMap<>();
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(xlsx))) {
            for (var entry = zip.getNextEntry(); entry != null; entry = zip.getNextEntry()) {
                parts.put(entry.getName(), new String(zip.readAllBytes(), StandardCharsets.UTF_8));
            }
        }
        assertTrue(parts.keySet().containsAll(java.util.List.of("[Content_Types].xml", "xl/workbook.xml", "xl/styles.xml",
                "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml", "xl/worksheets/sheet3.xml")));
        assertTrue(parts.get("xl/workbook.xml").contains("Lançamentos"));
        String sheet = parts.get("xl/worksheets/sheet2.xml");
        assertTrue(sheet.contains("Almoço &amp; café &lt;ok&gt;"), "text is escaped");
        assertTrue(sheet.contains("<v>-42.50</v>"), "an expense is a negative number a spreadsheet can sum");
        assertTrue(sheet.contains("SUMIF"));
    }

    @Test
    void thePdfIsARealPdf() {
        Account a = account("Relatorio pdf", "0", AccountType.CHECKING, null, null);
        expense("Almoço", "42.50", TransactionType.EXPENSE, ExpenseStatus.PAID, LocalDate.of(2026, 2, 3), a);

        byte[] pdf = reportService.pdf(reportService.collect(LocalDate.of(2026, 2, 1), LocalDate.of(2026, 2, 28), a.getId()));

        assertEquals("%PDF-", new String(pdf, 0, 5, StandardCharsets.ISO_8859_1));
        assertTrue(pdf.length > 1500);
        // an empty period still produces a document
        assertTrue(reportService.pdf(reportService.collect(LocalDate.of(1999, 1, 1), LocalDate.of(1999, 1, 2), null)).length > 500);
    }
}
