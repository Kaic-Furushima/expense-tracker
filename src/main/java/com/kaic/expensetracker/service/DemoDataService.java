package com.kaic.expensetracker.service;

import com.kaic.expensetracker.model.Account;
import com.kaic.expensetracker.model.AccountType;
import com.kaic.expensetracker.model.Category;
import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.model.ExpenseStatus;
import com.kaic.expensetracker.model.PaymentMethod;
import com.kaic.expensetracker.model.TransactionType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.time.YearMonth;

/** Fills the app with sample transactions so a new install has something to look at. */
@Service
public class DemoDataService {

    private static final String[] PALETTE =
            {"#E57373", "#81C784", "#64B5F6", "#FFB74D", "#BA68C8", "#4DB6AC", "#F06292", "#A1887F"};

    private final ExpenseService expenseService;
    private final CategoryService categoryService;
    private final BudgetService budgetService;
    private final AccountService accountService;
    private final PaymentMethodService paymentMethodService;
    private final TransferService transferService;
    private final Clock clock;

    public DemoDataService(ExpenseService expenseService, CategoryService categoryService, BudgetService budgetService,
                           AccountService accountService, PaymentMethodService paymentMethodService,
                           TransferService transferService, Clock clock) {
        this.clock = clock;
        this.expenseService = expenseService;
        this.categoryService = categoryService;
        this.budgetService = budgetService;
        this.accountService = accountService;
        this.paymentMethodService = paymentMethodService;
        this.transferService = transferService;
    }

    @Transactional
    public void load() {
        Account santander = accountService.findOrCreate("Santander", AccountType.CHECKING, "#E53935");
        Account bradesco = accountService.findOrCreate("Bradesco", AccountType.CHECKING, "#D81B60");
        Account nubank = accountService.findOrCreate("Nubank", AccountType.CHECKING, "#8E24AA");
        // The investment is a part of the Nubank account (its "caixinha"): money moved there leaves the available balance.
        Account caixinha = accountService.findOrCreate("Caixinha Nubank", AccountType.INVESTMENT, "#43A047");
        if (caixinha.getParent() == null) {
            accountService.update(caixinha.getId(), new AccountService.Draft(caixinha.getName(), caixinha.getType(),
                    caixinha.getColor(), caixinha.getIcon(), caixinha.getInitialBalance(), nubank.getId(), false));
        }

        YearMonth now = YearMonth.now();
        int today = LocalDate.now(clock).getDayOfMonth();
        for (int back = 2; back >= 0; back--) {
            YearMonth m = now.minusMonths(back);
            int last = back == 0 ? today : m.lengthOfMonth();
            add(m, Math.min(5, last), TransactionType.INCOME, "Salário", "Salário", "5200.00", santander, "Transferência");
            add(m, 1, TransactionType.EXPENSE, "Aluguel", "Moradia", "1450.00", santander, "Pix");
            add(m, Math.min(3, last), TransactionType.EXPENSE, "Mercado", "Mercado", (380 + back * 25) + ".90", bradesco, "Débito");
            add(m, Math.min(9, last), TransactionType.EXPENSE, "Internet", "Moradia", "99.90", bradesco, "Crédito");
            add(m, Math.min(12, last), TransactionType.EXPENSE, "Streaming", "Assinaturas", "55.90", bradesco, "Crédito");
            add(m, Math.min(14, last), TransactionType.EXPENSE, "Restaurante", "Alimentação", (88 + back * 12) + ".50", bradesco, "Crédito");
            add(m, Math.min(17, last), TransactionType.EXPENSE, "Transporte por app", "Transporte", (42 + back * 6) + ".30", santander, "Pix");
            transfer(m, Math.min(20, last), santander, caixinha, "400.00", "Aporte mensal na caixinha");
            if (back == 0) {
                addPending(m, 28, "Conta de luz", "Moradia", "142.30", santander);
            }
        }
        budgetService.upsert(category("Alimentação", TransactionType.EXPENSE).getId(), new BigDecimal("500"));
        budgetService.upsert(category("Mercado", TransactionType.EXPENSE).getId(), new BigDecimal("700"));
        budgetService.upsert(category("Transporte", TransactionType.EXPENSE).getId(), new BigDecimal("150"));
    }

    /** Sends every transaction and transfer to the trash. */
    @Transactional
    public void clear() {
        expenseService.deleteAll();
    }

    private Category category(String name, TransactionType kind) {
        return categoryService.findOrCreate(name, null, PALETTE[Math.floorMod(name.hashCode(), PALETTE.length)], kind);
    }

    private PaymentMethod method(String name) {
        return paymentMethodService.findAll().stream()
                .filter(m -> m.getName().equalsIgnoreCase(name))
                .findFirst()
                .orElseGet(() -> paymentMethodService.create(name));
    }

    private void add(YearMonth month, int day, TransactionType type, String name, String category,
                     String amount, Account account, String paymentMethod) {
        create(month, day, type, name, category, amount, account, paymentMethod, ExpenseStatus.PAID);
    }

    /** A bill still to pay this month. */
    private void addPending(YearMonth month, int day, String name, String category, String amount, Account account) {
        create(month, day, TransactionType.EXPENSE, name, category, amount, account, null, ExpenseStatus.PENDING);
    }

    private void create(YearMonth month, int day, TransactionType type, String name, String category,
                        String amount, Account account, String paymentMethod, ExpenseStatus status) {
        LocalDate date = month.atDay(Math.max(1, Math.min(day, month.lengthOfMonth())));
        boolean alreadyThere = expenseService.findByMonth(month).stream().anyMatch(x ->
                x.getName().equals(name) && x.getType() == type && x.getDate().equals(date)
                        && x.getAmount().compareTo(new BigDecimal(amount)) == 0);
        if (alreadyThere) {
            return;
        }
        Expense e = new Expense();
        e.setName(name);
        e.setAmount(new BigDecimal(amount));
        e.setDate(date);
        e.setType(type);
        e.setStatus(status);
        e.setCategory(category(category, type));
        e.setAccount(account);
        e.setPaymentMethod(paymentMethod == null ? null : method(paymentMethod));
        expenseService.save(e);
    }

    private void transfer(YearMonth month, int day, Account from, Account to, String amount, String description) {
        LocalDate date = month.atDay(Math.max(1, Math.min(day, month.lengthOfMonth())));
        boolean alreadyThere = transferService.findByMonth(month, null).stream().anyMatch(t ->
                t.getFromAccount().getId().equals(from.getId()) && t.getToAccount().getId().equals(to.getId())
                        && t.getDate().equals(date) && t.getAmount().compareTo(new BigDecimal(amount)) == 0);
        if (!alreadyThere) {
            transferService.create(new TransferService.Draft(from.getId(), to.getId(), new BigDecimal(amount), date, description));
        }
    }
}
