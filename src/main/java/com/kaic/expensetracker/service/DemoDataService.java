package com.kaic.expensetracker.service;

import com.kaic.expensetracker.model.Account;
import com.kaic.expensetracker.model.AccountType;
import com.kaic.expensetracker.model.Category;
import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.model.ExpenseStatus;
import com.kaic.expensetracker.model.PaymentMethod;
import com.kaic.expensetracker.model.Pot;
import com.kaic.expensetracker.model.PotMode;
import com.kaic.expensetracker.model.TransactionType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.List;

/**
 * Fills the app with sample data (six months of entries on several accounts and a card, installments, tags, budgets,
 * recurring payments, pots, wishes and templates) so a new install has something to look at. Running it again does not
 * duplicate anything. The phone app has the same scenario (mobile/src/local-api/demo.js); keep the two in step.
 */
@Service
public class DemoDataService {

    private static final String[] PALETTE =
            {"#E57373", "#81C784", "#64B5F6", "#FFB74D", "#BA68C8", "#4DB6AC", "#F06292", "#A1887F"};
    private static final int MONTHS = 6;

    private final ExpenseService expenseService;
    private final CategoryService categoryService;
    private final BudgetService budgetService;
    private final AccountService accountService;
    private final PaymentMethodService paymentMethodService;
    private final TransferService transferService;
    private final RecurringService recurringService;
    private final PotService potService;
    private final WishService wishService;
    private final TemplateService templateService;
    private final TagService tagService;
    private final Clock clock;

    public DemoDataService(ExpenseService expenseService, CategoryService categoryService, BudgetService budgetService,
                           AccountService accountService, PaymentMethodService paymentMethodService,
                           TransferService transferService, RecurringService recurringService, PotService potService,
                           WishService wishService, TemplateService templateService, TagService tagService, Clock clock) {
        this.clock = clock;
        this.expenseService = expenseService;
        this.categoryService = categoryService;
        this.budgetService = budgetService;
        this.accountService = accountService;
        this.paymentMethodService = paymentMethodService;
        this.transferService = transferService;
        this.recurringService = recurringService;
        this.potService = potService;
        this.wishService = wishService;
        this.templateService = templateService;
        this.tagService = tagService;
    }

    @Transactional
    public void load() {
        Account santander = account("Santander", AccountType.CHECKING, "#E53935", "4000", null, null);
        Account bradesco = account("Bradesco", AccountType.CHECKING, "#D81B60", "6000", null, null);
        Account nubank = account("Nubank", AccountType.CHECKING, "#8E24AA", "800", null, null);
        // The investment is a part of the Nubank account (its "caixinha"): money moved there leaves the available balance.
        Account caixinha = accountService.findOrCreate("Caixinha Nubank", AccountType.INVESTMENT, "#43A047");
        if (caixinha.getParent() == null) {
            accountService.update(caixinha.getId(), new AccountService.Draft(caixinha.getName(), caixinha.getType(),
                    caixinha.getColor(), caixinha.getIcon(), caixinha.getInitialBalance(), nubank.getId(), false, null, null,
                    true, null)); // marked as saved money: it is left out of the total and shown small below it
        }
        Account carteira = account("Carteira", AccountType.WALLET, "#FB8C00", "200", null, null);
        Account cartao = account("Cartão Nubank", AccountType.CREDIT_CARD, "#7B1FA2", "0", 25, 5);
        // An account in dollars: it has its own totals, charts and budgets.
        Account wise = account("Wise", AccountType.CHECKING, "#00B9A0", "1500", null, null, "USD");

        YearMonth now = YearMonth.now();
        int today = LocalDate.now(clock).getDayOfMonth();
        for (int back = MONTHS - 1; back >= 0; back--) {
            YearMonth m = now.minusMonths(back);
            int last = back == 0 ? today : m.lengthOfMonth();
            final int b = back;
            java.util.function.IntUnaryOperator day = d -> Math.min(d, last);

            add(m, day.applyAsInt(5), TransactionType.INCOME, "Salário", "Salário", "5200.00", santander, "Transferência");
            add(m, 1, TransactionType.EXPENSE, "Aluguel", "Moradia", "1450.00", santander, "Pix");
            add(m, day.applyAsInt(3), TransactionType.EXPENSE, "Mercado", "Mercado", (380 + b * 25) + ".90", bradesco, "Débito");
            add(m, day.applyAsInt(9), TransactionType.EXPENSE, "Internet", "Moradia", "99.90", bradesco, "Crédito");
            add(m, day.applyAsInt(12), TransactionType.EXPENSE, "Streaming", "Assinaturas", "55.90", bradesco, "Crédito");
            add(m, day.applyAsInt(14), TransactionType.EXPENSE, "Restaurante", "Alimentação", (88 + b * 12) + ".50", bradesco, "Crédito");
            add(m, day.applyAsInt(17), TransactionType.EXPENSE, "Transporte por app", "Transporte", (42 + b * 6) + ".30", santander, "Pix");
            transfer(m, day.applyAsInt(20), santander, caixinha, "400.00", "Aporte mensal na caixinha");

            add(m, day.applyAsInt(6), TransactionType.EXPENSE, "Academia", "Saúde", "99.90", bradesco, "Débito");
            add(m, day.applyAsInt(8), TransactionType.EXPENSE, "Combustível", "Transporte", (160 + b * 5) + ".00", santander, "Débito");
            add(m, day.applyAsInt(10), TransactionType.EXPENSE, "Padaria", "Alimentação", (18 + b) + ".40", carteira, "Dinheiro");
            add(m, day.applyAsInt(11), TransactionType.EXPENSE, "Curso online", "Educação", "49.90", cartao, "Crédito");
            add(m, day.applyAsInt(18), TransactionType.EXPENSE, "Mercado", "Mercado", (150 + b * 7) + ".60", bradesco, "Débito");
            add(m, day.applyAsInt(21), TransactionType.EXPENSE, "Padaria", "Alimentação", (22 + b) + ".70", carteira, "Dinheiro");
            add(m, day.applyAsInt(28), TransactionType.INCOME, "Rendimentos", "Rendimentos", (12 + b) + ".35", caixinha, null);
            if (b % 2 == 0) {
                add(m, day.applyAsInt(16), TransactionType.EXPENSE, "Cinema", "Lazer", "64.00", cartao, "Crédito");
                transfer(m, day.applyAsInt(11), santander, carteira, "200.00", "Saque para a carteira");
            }
            if (b % 2 == 1) {
                add(m, day.applyAsInt(13), TransactionType.EXPENSE, "Farmácia", "Saúde", (35 + b * 4) + ".80", bradesco, "Débito");
                add(m, day.applyAsInt(18), TransactionType.INCOME, "Freelance", "Freelance", "850.00", nubank, "Pix", "trabalho");
            }
            if (b % 3 == 0) {
                add(m, day.applyAsInt(19), TransactionType.EXPENSE, "Pet shop", "Pets", "120.00", cartao, "Crédito");
            }
            if (b == 2) {
                add(m, day.applyAsInt(15), TransactionType.EXPENSE, "Passagem aérea", "Viagem", "1240.00", cartao, "Crédito", "viagem");
                add(m, day.applyAsInt(16), TransactionType.EXPENSE, "Hospedagem", "Viagem", "980.00", cartao, "Crédito", "viagem");
                add(m, day.applyAsInt(23), TransactionType.EXPENSE, "Presente", "Presentes", "180.00", cartao, "Crédito", "presente");
            }
            add(m, day.applyAsInt(7), TransactionType.INCOME, "Freelance internacional", "Freelance", (420 + b * 15) + ".00", wise, "Transferência");
            add(m, day.applyAsInt(4), TransactionType.EXPENSE, "Hospedagem de site", "Assinaturas", "12.00", wise, "Débito");
            add(m, day.applyAsInt(15), TransactionType.EXPENSE, "Ferramenta de design", "Software", "29.00", wise, "Débito");
            if (b % 2 == 0) {
                add(m, day.applyAsInt(22), TransactionType.EXPENSE, "Livros", "Educação", "34.90", wise, "Débito");
            }
            if (b == 3) {
                transfer(m, day.applyAsInt(12), santander, wise, "2000.00", "Envio para a Wise", "380.00");
            }
            if (b == 0) {
                addPending(m, 28, TransactionType.EXPENSE, "Conta de luz", "Moradia", "142.30", santander);
                addPending(m, 27, TransactionType.INCOME, "Freelance a receber", "Freelance", "600.00", nubank, "trabalho");
            }
        }
        installments(now.minusMonths(3), 10, "Notebook", "Outros", "4500.00", 10, cartao);
        installments(now.minusMonths(1), 7, "Geladeira", "Moradia", "2400.00", 12, cartao);

        budget("Alimentação", "500");
        budget("Mercado", "700");
        budget("Transporte", "150");
        budget("Lazer", "250");
        budget("Saúde", "300");
        budget("Assinaturas", "120");
        budget("Pets", "150");
        budgetService.upsert(category("Software", TransactionType.EXPENSE).getId(), new BigDecimal("50"), "USD");

        recurring("Plano de saúde", TransactionType.EXPENSE, "389.90", false, 10, santander, "Débito", "Saúde");
        recurring("Seguro do carro", TransactionType.EXPENSE, "210.00", false, 15, bradesco, "Débito", "Transporte");
        recurring("Conta de água", TransactionType.EXPENSE, null, true, 20, santander, "Débito", "Moradia");
        recurring("Aluguel recebido", TransactionType.INCOME, "700.00", false, 8, santander, "Pix", "Outros");

        Pot viagem = pot("Viagem", "#64B5F6", "plane", "8000", PotMode.VARIABLE, null, null, nubank);
        if (viagem != null) {
            deposit(viagem, now.minusMonths(4), 5, "500.00", "Primeiro aporte");
            deposit(viagem, now.minusMonths(2), 20, "800.00", "Bônus");
            deposit(viagem, now, Math.min(2, today), "400.00", null);
        }
        pot("Reserva de emergência", "#43A047", "landmark", "20000", PotMode.FIXED, "300", now.minusMonths(5).toString(), santander);
        Pot equipamentos = pot("Equipamentos", "#FFB74D", "phone", "3000", PotMode.VARIABLE, null, null, null);
        if (equipamentos != null) {
            deposit(equipamentos, now.minusMonths(1), 12, "600.00", null);
        }
        // A pot in dollars, with no account linked.
        Pot viagemUsd = pot("Viagem internacional", "#4DB6AC", "plane", "3000", PotMode.VARIABLE, null, null, null, "USD");
        if (viagemUsd != null) {
            deposit(viagemUsd, now.minusMonths(1), 10, "250.00", null);
            deposit(viagemUsd, now, Math.min(2, today), "150.00", null);
        }
        // A pot linked to a saved-money account: it shows that account's balance.
        pot("Reserva Nubank", "#43A047", "landmark", "10000", PotMode.VARIABLE, null, null, caixinha, null);
        Long equipamentosId = potService.findAll().stream().filter(p -> p.getName().equals("Equipamentos")).map(Pot::getId).findFirst().orElse(null);
        wish("Fone de ouvido", "450.00", "Com cancelamento de ruído", null, equipamentosId);
        wish("Cadeira ergonômica", "1200.00", null, null, equipamentosId);
        wish("Bicicleta", "1800.00", null, "https://exemplo.com/bicicleta", null);
        if (wishService.findAll().stream().noneMatch(w -> w.getName().equals("Kindle"))) {
            wishService.create(new WishService.Draft("Kindle", new BigDecimal("120.00"), null, null, null, "USD"));
        }

        template("Almoço", TransactionType.EXPENSE, "35.00", "Alimentação", bradesco, "Débito");
        template("Uber", TransactionType.EXPENSE, "25.00", "Transporte", santander, "Pix");
        template("Café", TransactionType.EXPENSE, "12.00", "Alimentação", carteira, "Dinheiro");
    }

    /** Sends every transaction and transfer to the trash. */
    @Transactional
    public void clear() {
        expenseService.deleteAll();
    }

    private Account account(String name, AccountType type, String color, String initial, Integer closingDay, Integer dueDay) {
        return account(name, type, color, initial, closingDay, dueDay, null);
    }

    private Account account(String name, AccountType type, String color, String initial, Integer closingDay, Integer dueDay,
                            String currency) {
        return accountService.findAll().stream().filter(a -> a.getName().equals(name)).findFirst()
                .orElseGet(() -> accountService.create(new AccountService.Draft(name, type, color, null,
                        new BigDecimal(initial), null, false, closingDay, dueDay, null, currency)));
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

    private void budget(String category, String limit) {
        budgetService.upsert(category(category, TransactionType.EXPENSE).getId(), new BigDecimal(limit));
    }

    private void add(YearMonth month, int day, TransactionType type, String name, String category,
                     String amount, Account account, String paymentMethod, String... tags) {
        create(month, day, type, name, category, amount, account, paymentMethod, ExpenseStatus.PAID, tags);
    }

    /** An entry still to pay (or to receive) this month. */
    private void addPending(YearMonth month, int day, TransactionType type, String name, String category, String amount,
                            Account account, String... tags) {
        create(month, day, type, name, category, amount, account, null, ExpenseStatus.PENDING, tags);
    }

    private void create(YearMonth month, int day, TransactionType type, String name, String category,
                        String amount, Account account, String paymentMethod, ExpenseStatus status, String... tags) {
        LocalDate date = month.atDay(Math.max(1, Math.min(day, month.lengthOfMonth())));
        boolean alreadyThere = expenseService.findByMonth(month).stream().anyMatch(x ->
                x.getName().equals(name) && x.getType() == type && x.getDate().equals(date)
                        && x.getAmount().compareTo(new BigDecimal(amount)) == 0);
        if (alreadyThere) {
            return;
        }
        expenseService.save(entry(date, type, name, category, amount, account, paymentMethod, status, tags));
    }

    private Expense entry(LocalDate date, TransactionType type, String name, String category, String amount,
                          Account account, String paymentMethod, ExpenseStatus status, String... tags) {
        Expense e = new Expense();
        e.setName(name);
        e.setAmount(new BigDecimal(amount));
        e.setDate(date);
        e.setType(type);
        e.setStatus(status);
        e.setCategory(category(category, type));
        e.setAccount(account);
        e.setPaymentMethod(paymentMethod == null ? null : method(paymentMethod));
        if (tags.length > 0) {
            e.getTags().addAll(tagService.resolve(List.of(tags)));
        }
        return e;
    }

    /** A purchase split in {@code count} installments, the first one in {@code month}. */
    private void installments(YearMonth month, int day, String name, String category, String total, int count, Account account) {
        LocalDate first = month.atDay(Math.min(day, month.lengthOfMonth()));
        boolean alreadyThere = expenseService.findByMonth(month).stream().anyMatch(x ->
                x.getName().equals(name) && x.getDate().equals(first) && x.getInstallmentTotal() != null);
        if (!alreadyThere) {
            expenseService.saveInstallments(entry(first, TransactionType.EXPENSE, name, category, total, account, "Crédito",
                    ExpenseStatus.PAID), count);
        }
    }

    private void transfer(YearMonth month, int day, Account from, Account to, String amount, String description) {
        transfer(month, day, from, to, amount, description, null);
    }

    /** toAmount: what arrived, when the two accounts are in different currencies. */
    private void transfer(YearMonth month, int day, Account from, Account to, String amount, String description, String toAmount) {
        LocalDate date = month.atDay(Math.max(1, Math.min(day, month.lengthOfMonth())));
        boolean alreadyThere = transferService.findByMonth(month, null).stream().anyMatch(t ->
                t.getFromAccount().getId().equals(from.getId()) && t.getToAccount().getId().equals(to.getId())
                        && t.getDate().equals(date) && t.getAmount().compareTo(new BigDecimal(amount)) == 0);
        if (!alreadyThere) {
            transferService.create(new TransferService.Draft(from.getId(), to.getId(), new BigDecimal(amount), date, description,
                    null, toAmount == null ? null : new BigDecimal(toAmount)));
        }
    }

    private void recurring(String name, TransactionType type, String amount, boolean variable, int day, Account account,
                           String paymentMethod, String category) {
        if (recurringService.findAll().stream().anyMatch(r -> r.getName().equals(name))) {
            return;
        }
        recurringService.create(new RecurringService.Draft(name, type, amount == null ? null : new BigDecimal(amount), variable, day,
                account.getId(), method(paymentMethod).getId(), category(category, type).getId(), true,
                YearMonth.now().toString(), null));
    }

    /** Creates the pot unless it exists; returns it only when it was just created (so its deposits are not repeated). */
    private Pot pot(String name, String color, String icon, String goal, PotMode mode, String monthly, String startMonth, Account account) {
        return pot(name, color, icon, goal, mode, monthly, startMonth, account, null);
    }

    private Pot pot(String name, String color, String icon, String goal, PotMode mode, String monthly, String startMonth, Account account,
                    String currency) {
        if (potService.findAll().stream().anyMatch(p -> p.getName().equals(name))) {
            return null;
        }
        return potService.create(new PotService.Draft(name, color, icon, new BigDecimal(goal), mode,
                monthly == null ? null : new BigDecimal(monthly), startMonth, true, account == null ? null : account.getId(), currency));
    }

    private void deposit(Pot pot, YearMonth month, int day, String amount, String note) {
        potService.deposit(pot.getId(), new BigDecimal(amount), month.atDay(Math.max(1, Math.min(day, month.lengthOfMonth()))), note);
    }

    private void wish(String name, String price, String notes, String url, Long potId) {
        if (wishService.findAll().stream().noneMatch(w -> w.getName().equals(name))) {
            wishService.create(new WishService.Draft(name, new BigDecimal(price), notes, url, potId));
        }
    }

    private void template(String name, TransactionType type, String amount, String category, Account account, String paymentMethod) {
        if (templateService.findAll().stream().noneMatch(t -> t.getName().equals(name))) {
            templateService.create(new TemplateService.Draft(name, type, new BigDecimal(amount), category(category, type).getId(),
                    account.getId(), method(paymentMethod).getId(), null, List.of()));
        }
    }
}
