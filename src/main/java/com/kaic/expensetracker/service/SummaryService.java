package com.kaic.expensetracker.service;

import com.kaic.expensetracker.model.Category;
import com.kaic.expensetracker.model.OccurrenceStatus;
import com.kaic.expensetracker.model.RecurringOccurrence;
import com.kaic.expensetracker.model.TransactionType;
import com.kaic.expensetracker.repository.RecurringOccurrenceRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Computes the dashboard numbers for a month directly from the transactions. Only paid transactions count in
 * totals; what is still to pay is reported separately and used for the forecast. Budgets always look at every
 * account, whatever account is being viewed. The numbers are built from a few grouped totals read in one query
 * ({@link ExpenseService#totalsBetween}), not from each transaction.
 */
@Service
@Transactional(readOnly = true)
public class SummaryService {

    private static final int TREND_MONTHS = 6;
    /** How many months back the "sobra acumulada" looks, at most. */
    private static final int ROLLOVER_MAX_MONTHS = 24;
    private static final MonthSpend NO_SPEND = new MonthSpend(Map.of(), BigDecimal.ZERO);

    private final ExpenseService expenseService;
    private final BudgetService budgetService;
    private final CategoryService categoryService;
    private final SettingsService settings;
    private final AccountService accountService;
    private final RecurringOccurrenceRepository occurrenceRepository;

    public SummaryService(ExpenseService expenseService, BudgetService budgetService, CategoryService categoryService,
                          SettingsService settings, AccountService accountService,
                          RecurringOccurrenceRepository occurrenceRepository) {
        this.accountService = accountService;
        this.expenseService = expenseService;
        this.budgetService = budgetService;
        this.categoryService = categoryService;
        this.settings = settings;
        this.occurrenceRepository = occurrenceRepository;
    }

    public MonthSummary summarize(YearMonth month) {
        return summarize(month, null);
    }

    /** Same as {@link #summarize(YearMonth)} but only counting one account (null means all accounts). */
    public MonthSummary summarize(YearMonth month, Long accountId) {
        return summarize(month, accountId, null);
    }

    /**
     * Only what is in one currency counts: the currency of the account being viewed, the one asked for, or the main
     * one. Budgets and totals never mix currencies.
     */
    public MonthSummary summarize(YearMonth month, Long accountId, String currency) {
        // One read covers every month the summary looks at: the month itself, the trend and the rollover carry.
        Map<Long, String> currencies = accountService.accountCurrencies();
        String view = accountId != null ? currencies.getOrDefault(accountId, accountService.mainCurrency())
                : currency == null || currency.isBlank() ? accountService.mainCurrency() : currency.trim().toUpperCase();
        List<ExpenseService.Bucket> totals = expenseService.totalsBetween(month.minusMonths(ROLLOVER_MAX_MONTHS), month).stream()
                .filter(b -> view.equals(currencies.get(b.accountId())))
                .toList();
        Map<YearMonth, MonthSpend> spend = spendByMonth(totals);

        List<ExpenseService.Bucket> scoped = totals.stream()
                .filter(b -> b.month().equals(month) && inAccount(b, accountId))
                .toList();
        BigDecimal income = amount(scoped, true, true);
        BigDecimal spent = amount(scoped, false, true);
        // "correção de saldo": aparece à parte (não é receita nem despesa) mas entra no saldo do mês
        BigDecimal adjustment = adjustments(scoped);
        BigDecimal balance = income.subtract(spent).add(adjustment);

        // What is still to come in the month: pending transactions and pending recurring occurrences.
        BigDecimal pendingIncome = amount(scoped, true, false);
        BigDecimal pendingExpense = amount(scoped, false, false);
        for (RecurringOccurrence o : occurrenceRepository.findByMonthOrderByDueDateAscIdAsc(month.toString())) {
            Long occurrenceAccount = o.getRecurring().getAccount().getId();
            boolean inScope = accountId == null ? view.equals(currencies.get(occurrenceAccount)) : accountId.equals(occurrenceAccount);
            if (o.getStatus() != OccurrenceStatus.PENDING || o.getAmount() == null || !inScope) {
                continue;
            }
            if (o.getRecurring().getType() == TransactionType.INCOME) {
                pendingIncome = pendingIncome.add(o.getAmount());
            } else {
                pendingExpense = pendingExpense.add(o.getAmount());
            }
        }
        BigDecimal projected = balance.add(pendingIncome).subtract(pendingExpense);

        // Budgets (every account).
        List<Category> allCategories = categoryService.findAll();
        Map<Long, Category> byId = new HashMap<>();
        allCategories.forEach(c -> byId.put(c.getId(), c));
        BudgetService.Book book = budgetService.book(view);
        boolean rollover = settings.budgetRolloverFrom().isPresent();
        YearMonth rolloverFrom = settings.budgetRolloverFrom().orElse(month);
        Map<Long, List<Long>> childrenOf = new HashMap<>();
        allCategories.stream().filter(c -> c.getParent() != null)
                .forEach(c -> childrenOf.computeIfAbsent(c.getParent().getId(), k -> new ArrayList<>()).add(c.getId()));
        MonthSpend monthSpend = spendOf(month, spend);

        Map<Long, Tally> byCategory = new LinkedHashMap<>();
        scoped.stream().filter(b -> !b.income() && b.paid() && !b.adjustment())
                .forEach(b -> byCategory.merge(b.categoryId(), new Tally(b.amount(), b.count()), Tally::plus));
        book.categoryIds().stream()
                .filter(id -> book.effective(id, month).isPresent() && byId.containsKey(id))
                .forEach(id -> byCategory.putIfAbsent(id, new Tally(BigDecimal.ZERO, 0)));

        List<CategoryTotal> categories = byCategory.entrySet().stream()
                .map(entry -> toCategoryTotal(entry.getKey(), entry.getValue(), byId, book, month, spent, rollover,
                        rolloverFrom, spend, childrenOf, monthSpend))
                .sorted(Comparator.comparing(CategoryTotal::total).reversed())
                .toList();

        // Overall monthly limit.
        BigDecimal totalBase = book.base(null, month).orElse(null);
        BigDecimal totalCarry = null;
        BigDecimal totalBudget = null;
        if (totalBase != null) {
            totalCarry = rollover ? carryInto(null, month, rolloverFrom, book, spend, childrenOf) : BigDecimal.ZERO;
            totalBudget = totalBase.add(totalCarry);
        }

        List<MonthTotal> trend = new ArrayList<>();
        for (int i = TREND_MONTHS - 1; i >= 0; i--) {
            YearMonth m = month.minusMonths(i);
            List<ExpenseService.Bucket> monthRows = totals.stream()
                    .filter(b -> b.month().equals(m) && inAccount(b, accountId))
                    .toList();
            trend.add(new MonthTotal(m.toString(), amount(monthRows, true, true), amount(monthRows, false, true)));
        }
        BigDecimal previousSpent = trend.get(trend.size() - 2).expense();

        return new MonthSummary(month.toString(), income, spent, balance, previousSpent,
                pendingIncome, pendingExpense, projected,
                totalBudget, totalBase, totalCarry, monthSpend.total(), rollover, categories, trend, adjustment, view);
    }

    private CategoryTotal toCategoryTotal(Long categoryId, Tally tally, Map<Long, Category> byId,
                                          BudgetService.Book book, YearMonth month, BigDecimal totalSpent,
                                          boolean rollover, YearMonth rolloverFrom, Map<YearMonth, MonthSpend> spend,
                                          Map<Long, List<Long>> childrenOf, MonthSpend monthSpend) {
        Category category = categoryId == null ? null : byId.get(categoryId);
        BigDecimal total = tally.total();
        BigDecimal percent = totalSpent.signum() == 0 ? BigDecimal.ZERO
                : total.multiply(BigDecimal.valueOf(100)).divide(totalSpent, 1, RoundingMode.HALF_UP);

        BigDecimal budget = null;
        BigDecimal budgetBase = null;
        BigDecimal carry = null;
        BigDecimal budgetSpent = null;
        if (categoryId != null) {
            Optional<BigDecimal> base = book.base(categoryId, month);
            if (base.isPresent()) {
                budgetBase = base.get();
                carry = rollover ? carryInto(categoryId, month, rolloverFrom, book, spend, childrenOf) : BigDecimal.ZERO;
                budget = budgetBase.add(carry);
                budgetSpent = spentWithChildren(categoryId, monthSpend, childrenOf);
            }
        }
        return new CategoryTotal(
                categoryId,
                category == null || category.getParent() == null ? null : category.getParent().getId(),
                category == null ? "Sem categoria" : category.getName(),
                category == null ? "package" : category.getIcon(),
                category == null ? "#9E9E9E" : category.getColor(),
                total, percent, budget, budgetBase, carry, budgetSpent, (int) tally.count());
    }

    /**
     * What was left over (positive) or overspent (negative) of a limit in the months between the start of the rollover
     * and the given month. A month without a limit resets the carry.
     */
    private BigDecimal carryInto(Long categoryId, YearMonth month, YearMonth from, BudgetService.Book book,
                                 Map<YearMonth, MonthSpend> spend, Map<Long, List<Long>> childrenOf) {
        YearMonth earliest = month.minusMonths(ROLLOVER_MAX_MONTHS);
        YearMonth start = from.isAfter(earliest) ? from : earliest;
        BigDecimal carry = BigDecimal.ZERO;
        for (YearMonth m = start; m.isBefore(month); m = m.plusMonths(1)) {
            Optional<BigDecimal> base = book.base(categoryId, m);
            if (base.isEmpty()) {
                carry = BigDecimal.ZERO;
                continue;
            }
            BigDecimal limit = base.get().add(carry);
            BigDecimal spent = categoryId == null ? spendOf(m, spend).total()
                    : spentWithChildren(categoryId, spendOf(m, spend), childrenOf);
            carry = limit.subtract(spent);
        }
        return carry;
    }

    private static BigDecimal spentWithChildren(Long categoryId, MonthSpend spend, Map<Long, List<Long>> childrenOf) {
        BigDecimal result = spend.own().getOrDefault(categoryId, BigDecimal.ZERO);
        for (Long child : childrenOf.getOrDefault(categoryId, List.of())) {
            result = result.add(spend.own().getOrDefault(child, BigDecimal.ZERO));
        }
        return result;
    }

    private static MonthSpend spendOf(YearMonth month, Map<YearMonth, MonthSpend> spend) {
        return spend.getOrDefault(month, NO_SPEND);
    }

    /** Paid expenses of each month, every account: per category (own, without subcategories) and in total. */
    private static Map<YearMonth, MonthSpend> spendByMonth(List<ExpenseService.Bucket> totals) {
        Map<YearMonth, Map<Long, BigDecimal>> own = new HashMap<>();
        Map<YearMonth, BigDecimal> totalByMonth = new HashMap<>();
        for (ExpenseService.Bucket b : totals) {
            if (b.income() || !b.paid() || b.adjustment()) {
                continue;
            }
            totalByMonth.merge(b.month(), b.amount(), BigDecimal::add);
            if (b.categoryId() != null) {
                own.computeIfAbsent(b.month(), m -> new HashMap<>()).merge(b.categoryId(), b.amount(), BigDecimal::add);
            }
        }
        Map<YearMonth, MonthSpend> result = new HashMap<>();
        totalByMonth.forEach((m, total) -> result.put(m, new MonthSpend(own.getOrDefault(m, Map.of()), total)));
        return result;
    }

    /** Net of the paid balance corrections (positive raised the balance, negative lowered it). */
    private static BigDecimal adjustments(List<ExpenseService.Bucket> rows) {
        return rows.stream()
                .filter(b -> b.adjustment() && b.paid())
                .map(b -> b.income() ? b.amount() : b.amount().negate())
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private static boolean inAccount(ExpenseService.Bucket bucket, Long accountId) {
        return accountId == null || accountId.equals(bucket.accountId());
    }

    /** Sum of the rows of one kind (income or expense) and one status (paid or pending). */
    private static BigDecimal amount(List<ExpenseService.Bucket> rows, boolean income, boolean paid) {
        return rows.stream()
                .filter(b -> !b.adjustment() && b.income() == income && b.paid() == paid)
                .map(ExpenseService.Bucket::amount)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    /** Paid expenses of a month, every account: per category (own, without subcategories) and in total. */
    private record MonthSpend(Map<Long, BigDecimal> own, BigDecimal total) {
    }

    /** The total and the number of transactions of one category in the month. */
    private record Tally(BigDecimal total, long count) {
        Tally plus(Tally other) {
            return new Tally(total.add(other.total), count + other.count);
        }
    }

    /**
     * Spending of one category in the month. {@code budget} is the limit in force including the carry from earlier
     * months (when the rollover is on); {@code budgetBase} is the limit without the carry; {@code budgetSpent}
     * includes the subcategories and always looks at every account.
     */
    public record CategoryTotal(Long categoryId, Long parentId, String name, String icon, String color,
                                BigDecimal total, BigDecimal percent, BigDecimal budget, BigDecimal budgetBase,
                                BigDecimal carry, BigDecimal budgetSpent, int count) {
    }

    public record MonthTotal(String month, BigDecimal income, BigDecimal expense) {
    }

    /**
     * {@code balance} counts what was paid; {@code projectedBalance} adds what is still to receive and subtracts what
     * is still to pay in the month. The {@code totalBudget*} fields are the overall limit (null when there is none).
     */
    public record MonthSummary(String month, BigDecimal income, BigDecimal expense, BigDecimal balance,
                               BigDecimal previousExpense, BigDecimal pendingIncome, BigDecimal pendingExpense,
                               BigDecimal projectedBalance, BigDecimal totalBudget, BigDecimal totalBudgetBase,
                               BigDecimal totalCarry, BigDecimal totalSpent, boolean budgetRollover,
                               List<CategoryTotal> categories, List<MonthTotal> trend, BigDecimal adjustment,
                               String currency) {
    }
}
