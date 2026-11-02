package com.kaic.expensetracker.service;

import com.kaic.expensetracker.model.Budget;
import com.kaic.expensetracker.model.Category;
import com.kaic.expensetracker.repository.BudgetRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Spending limits with validity: each row applies from its month until the next row of the same category, so changing
 * December's limit never rewrites October's. A null category is the overall monthly limit; a null amount in a row
 * means "no budget from this month on".
 */
@Service
@Transactional(readOnly = true)
public class BudgetService {

    /** Used by {@link #upsert}: a limit that applies to every month. */
    static final String ALWAYS = "2000-01";

    private static final BigDecimal MAX = new BigDecimal("999999999.99");

    /** How far a change reaches. */
    public enum Scope {
        /** From the chosen month on, until another change. */
        FROM_MONTH,
        /** Only the chosen month: the following month goes back to the previous limit. */
        ONLY_MONTH
    }

    /** The limit in force in a month and the month it started to apply. */
    public record Effective(Long categoryId, BigDecimal amount, String fromMonth) {
    }

    /** All budget rows in memory, to answer "what limit applied in month X?" many times without hitting the database. */
    public static final class Book {
        private final Map<Long, List<Budget>> byCategory = new HashMap<>();
        private final List<Budget> total = new ArrayList<>();

        Book(List<Budget> rows) {
            rows.stream().sorted((a, b) -> a.getFromMonth().compareTo(b.getFromMonth())).forEach(row -> {
                if (row.getCategory() == null) {
                    total.add(row);
                } else {
                    byCategory.computeIfAbsent(row.getCategory().getId(), k -> new ArrayList<>()).add(row);
                }
            });
        }

        /** Limit in force for a category (null = the overall limit) in a month, if any. */
        public Optional<Effective> effective(Long categoryId, YearMonth month) {
            List<Budget> rows = categoryId == null ? total : byCategory.getOrDefault(categoryId, List.of());
            Budget current = null;
            for (Budget row : rows) {
                if (row.from().isAfter(month)) {
                    break;
                }
                current = row;
            }
            if (current == null || current.getAmount() == null) {
                return Optional.empty();
            }
            return Optional.of(new Effective(categoryId, current.getAmount(), current.getFromMonth()));
        }

        public Optional<BigDecimal> base(Long categoryId, YearMonth month) {
            return effective(categoryId, month).map(Effective::amount);
        }

        public java.util.Set<Long> categoryIds() {
            return byCategory.keySet();
        }
    }

    private final BudgetRepository budgetRepository;
    private final CategoryService categoryService;

    public BudgetService(BudgetRepository budgetRepository, CategoryService categoryService) {
        this.budgetRepository = budgetRepository;
        this.categoryService = categoryService;
    }

    public Book book() {
        return new Book(budgetRepository.findAll());
    }

    public List<Budget> findAll() {
        return budgetRepository.findAll();
    }

    /** Limits of every category in force in a month (categories without one are absent). */
    public List<Effective> effectiveInMonth(YearMonth month) {
        Book book = book();
        return book.categoryIds().stream()
                .map(id -> book.effective(id, month))
                .flatMap(Optional::stream)
                .toList();
    }

    public Optional<Effective> effectiveTotal(YearMonth month) {
        return book().effective(null, month);
    }

    /** Sets the limit of a category (null category = overall limit) from a month on, or only for that month. */
    @Transactional
    public void set(Long categoryId, YearMonth month, BigDecimal amount, Scope scope) {
        BigDecimal value = normalize(amount);
        Category category = categoryId == null ? null : categoryService.getOrThrow(categoryId);
        Optional<BigDecimal> before = book().base(categoryId, month);
        upsertRow(category, month.toString(), value);
        if (scope == Scope.ONLY_MONTH) {
            String next = month.plusMonths(1).toString();
            if (findRow(category, next).isEmpty()) {
                upsertRow(category, next, before.orElse(null));
            }
        }
    }

    /** From this month on there is no limit for the category (the months before keep theirs). */
    @Transactional
    public void remove(Long categoryId, YearMonth month) {
        Category category = categoryId == null ? null : categoryService.getOrThrow(categoryId);
        upsertRow(category, month.toString(), null);
    }

    /** A limit that applies to every month (used by the sample data). */
    @Transactional
    public Budget upsert(Long categoryId, BigDecimal amount) {
        Category category = categoryService.getOrThrow(categoryId);
        return upsertRow(category, ALWAYS, normalize(amount));
    }

    private Budget upsertRow(Category category, String fromMonth, BigDecimal amount) {
        Budget row = findRow(category, fromMonth).orElseGet(() -> {
            Budget b = new Budget();
            b.setCategory(category);
            b.setFromMonth(fromMonth);
            return b;
        });
        row.setAmount(amount);
        return budgetRepository.save(row);
    }

    private Optional<Budget> findRow(Category category, String fromMonth) {
        return category == null
                ? budgetRepository.findByCategoryIsNullAndFromMonth(fromMonth)
                : budgetRepository.findByCategoryAndFromMonth(category, fromMonth);
    }

    private static BigDecimal normalize(BigDecimal amount) {
        if (amount == null) {
            return null;
        }
        if (amount.signum() <= 0 || amount.compareTo(MAX) > 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Informe um limite entre 0,01 e 999.999.999,99.");
        }
        return amount.setScale(2, RoundingMode.HALF_UP);
    }
}
