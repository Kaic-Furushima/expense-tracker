package com.kaic.expensetracker.service;

import com.kaic.expensetracker.model.Account;
import com.kaic.expensetracker.model.AccountType;
import com.kaic.expensetracker.model.Category;
import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.model.ExpenseStatus;
import com.kaic.expensetracker.model.OccurrenceStatus;
import com.kaic.expensetracker.model.PaymentMethod;
import com.kaic.expensetracker.model.PotEntryKind;
import com.kaic.expensetracker.model.Tag;
import com.kaic.expensetracker.model.TransactionType;
import com.kaic.expensetracker.model.WishStatus;
import com.kaic.expensetracker.repository.ExpenseRepository;
import com.kaic.expensetracker.repository.PotEntryRepository;
import com.kaic.expensetracker.repository.RecurringOccurrenceRepository;
import com.kaic.expensetracker.repository.TransferRepository;
import com.kaic.expensetracker.repository.WishItemRepository;
import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.CriteriaQuery;
import jakarta.persistence.criteria.Expression;
import jakarta.persistence.criteria.Join;
import jakarta.persistence.criteria.JoinType;
import jakarta.persistence.criteria.Order;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Root;
import jakarta.persistence.criteria.Subquery;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.function.Function;

@Service
@Transactional(readOnly = true)
public class ExpenseService {

    private final ExpenseRepository expenseRepository;
    private final TransferRepository transferRepository;
    private final RecurringOccurrenceRepository occurrenceRepository;
    private final WishItemRepository wishItemRepository;
    private final PotEntryRepository potEntryRepository;
    private final Clock clock;

    public ExpenseService(ExpenseRepository expenseRepository, TransferRepository transferRepository,
                          RecurringOccurrenceRepository occurrenceRepository, WishItemRepository wishItemRepository,
                          PotEntryRepository potEntryRepository, Clock clock) {
        this.clock = clock;
        this.expenseRepository = expenseRepository;
        this.transferRepository = transferRepository;
        this.occurrenceRepository = occurrenceRepository;
        this.wishItemRepository = wishItemRepository;
        this.potEntryRepository = potEntryRepository;
    }

    @Transactional
    public Expense save(Expense expense) {
        return expenseRepository.save(expense);
    }

    public static final int MAX_INSTALLMENTS = 60;

    /**
     * Creates a purchase split in monthly installments, one transaction per installment, linked by a group id. The
     * given amount is the total: cents that do not divide evenly go to the first installment. The first one keeps
     * the requested status; the next ones are "to pay" (pending), except on a credit card, where the whole purchase
     * is already committed and every installment counts.
     */
    @Transactional
    public List<Expense> saveInstallments(Expense template, int count) {
        if (count < 2 || count > MAX_INSTALLMENTS) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "O número de parcelas deve ficar entre 2 e " + MAX_INSTALLMENTS + ".");
        }
        BigDecimal total = template.getAmount();
        BigDecimal each = total.divide(BigDecimal.valueOf(count), 2, RoundingMode.DOWN);
        BigDecimal first = total.subtract(each.multiply(BigDecimal.valueOf(count - 1)));
        if (each.signum() <= 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "O valor é pequeno demais para tantas parcelas.");
        }
        boolean card = template.getAccount().getType() == AccountType.CREDIT_CARD;
        String group = UUID.randomUUID().toString();
        List<Expense> created = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            Expense e = new Expense();
            e.setName(template.getName());
            e.setDescription(template.getDescription());
            e.setAmount(i == 0 ? first : each);
            e.setDate(template.getDate().plusMonths(i));
            e.setType(template.getType());
            e.setStatus(i == 0 || card ? template.getStatus() : ExpenseStatus.PENDING);
            e.setCategory(template.getCategory());
            e.setAccount(template.getAccount());
            e.setPaymentMethod(template.getPaymentMethod());
            e.getTags().addAll(template.getTags());
            e.setInstallmentGroup(group);
            e.setInstallmentNumber(i + 1);
            e.setInstallmentTotal(count);
            created.add(expenseRepository.save(e));
        }
        return created;
    }

    /** One installment of a custom plan: due date, situation (null = the default rule) and amount (null = an equal share). */
    public record Slot(LocalDate date, ExpenseStatus status, BigDecimal amount) {
    }

    /**
     * Creates a purchase split in installments that follow a custom plan: each one has its own date, may be already
     * paid or still to pay, and may have its own amount. When no installment has an amount, the purchase total is
     * split like {@link #saveInstallments(Expense, int)}; otherwise the amounts given are used as they are, and the
     * ones left blank share what is left of the total.
     */
    @Transactional
    public List<Expense> saveInstallments(Expense template, List<Slot> plan) {
        int count = plan.size();
        if (count < 2 || count > MAX_INSTALLMENTS) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "O número de parcelas deve ficar entre 2 e " + MAX_INSTALLMENTS + ".");
        }
        BigDecimal total = template.getAmount();
        BigDecimal[] amounts = new BigDecimal[count];
        BigDecimal given = BigDecimal.ZERO;
        int blank = 0;
        for (int i = 0; i < count; i++) {
            if (plan.get(i).date() == null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Informe a data de cada parcela.");
            }
            BigDecimal a = plan.get(i).amount();
            if (a == null) {
                blank++;
            } else if (a.signum() <= 0) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "O valor de cada parcela deve ser maior que zero.");
            } else {
                amounts[i] = a.setScale(2, RoundingMode.HALF_UP);
                given = given.add(amounts[i]);
            }
        }
        if (blank > 0) {
            BigDecimal rest = total.subtract(given);
            BigDecimal each = rest.divide(BigDecimal.valueOf(blank), 2, RoundingMode.DOWN);
            if (each.signum() <= 0) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "O valor é pequeno demais para tantas parcelas.");
            }
            BigDecimal leftover = rest.subtract(each.multiply(BigDecimal.valueOf(blank)));
            boolean firstBlank = true;
            for (int i = 0; i < count; i++) {
                if (amounts[i] == null) {
                    amounts[i] = firstBlank ? each.add(leftover) : each;
                    firstBlank = false;
                }
            }
        }
        boolean card = template.getAccount().getType() == AccountType.CREDIT_CARD;
        String group = UUID.randomUUID().toString();
        List<Expense> ordered = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            Slot slot = plan.get(i);
            Expense e = new Expense();
            e.setName(template.getName());
            e.setDescription(template.getDescription());
            e.setAmount(amounts[i]);
            e.setDate(slot.date());
            e.setType(template.getType());
            e.setStatus(slot.status() != null ? slot.status()
                    : (i == 0 || card ? template.getStatus() : ExpenseStatus.PENDING));
            e.setCategory(template.getCategory());
            e.setAccount(template.getAccount());
            e.setPaymentMethod(template.getPaymentMethod());
            e.getTags().addAll(template.getTags());
            e.setInstallmentGroup(group);
            e.setInstallmentNumber(i + 1);
            e.setInstallmentTotal(count);
            ordered.add(expenseRepository.save(e));
        }
        return ordered;
    }

    /**
     * Sends an installment and the ones after it to the trash; returns their ids (so the caller can offer "undo").
     * A transaction that is not an installment is trashed alone.
     */
    @Transactional
    public List<Long> deleteFollowing(Long id) {
        Expense expense = expenseRepository.findById(id).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "Lançamento não encontrado: " + id));
        List<Expense> targets = expense.getInstallmentGroup() == null ? List.of(expense)
                : expenseRepository.findByInstallmentGroupAndInstallmentNumberGreaterThanEqualOrderByInstallmentNumberAsc(
                        expense.getInstallmentGroup(), expense.getInstallmentNumber());
        List<Long> ids = targets.stream().map(Expense::getId).toList();
        ids.forEach(this::deleteById);
        return ids;
    }

    public static final int MAX_BATCH = 500;

    /** Applies the same change to several transactions (all or nothing). Returns how many were changed. */
    @Transactional
    public int updateAll(Collection<Long> ids, Consumer<Expense> change) {
        if (ids == null || ids.isEmpty() || ids.size() > MAX_BATCH) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Selecione de 1 a " + MAX_BATCH + " lançamentos.");
        }
        List<Expense> found = expenseRepository.findAllById(ids);
        for (Expense e : found) {
            change.accept(e);
            expenseRepository.save(e);
        }
        return found.size();
    }

    /** Marks the pending ones among the given transactions as paid today; the others are left alone. */
    @Transactional
    public int markPaidAll(Collection<Long> ids) {
        int count = 0;
        for (Expense e : expenseRepository.findAllById(ids)) {
            if (!e.isPaid()) {
                markPaid(e.getId(), LocalDate.now(clock));
                count++;
            }
        }
        return count;
    }

    /** Sends several transactions to the trash; returns the ids that were sent. */
    @Transactional
    public List<Long> deleteAllOf(Collection<Long> ids) {
        if (ids == null || ids.isEmpty() || ids.size() > MAX_BATCH) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Selecione de 1 a " + MAX_BATCH + " lançamentos.");
        }
        List<Long> done = new ArrayList<>();
        for (Expense e : expenseRepository.findAllById(ids)) {
            deleteById(e.getId());
            done.add(e.getId());
        }
        return done;
    }

    /** What was typed before under a name (the latest use of each distinct name), to fill a new transaction. */
    public record Suggestion(String name, Expense last) {
    }

    /** Distinct descriptions that contain the text, most recent first; at most {@code limit}. */
    public List<Suggestion> suggest(String text, int limit) {
        if (text == null || text.trim().length() < 2) {
            return List.of();
        }
        String lower = text.trim().toLowerCase();
        java.util.Map<String, Expense> latest = new java.util.LinkedHashMap<>();
        expenseRepository.findAll().stream()
                .filter(e -> e.getName().toLowerCase().contains(lower))
                .sorted(java.util.Comparator.comparing(Expense::getDate).thenComparing(Expense::getId).reversed())
                .forEach(e -> latest.putIfAbsent(e.getName().toLowerCase(), e));
        return latest.values().stream().limit(limit).map(e -> new Suggestion(e.getName(), e)).toList();
    }

    public List<Expense> findAll() {
        return expenseRepository.findAll();
    }

    /** Transactions of one month, newest first. */
    public List<Expense> findByMonth(YearMonth month) {
        return expenseRepository.findByDateBetweenOrderByDateDescIdDesc(month.atDay(1), month.atEndOfMonth());
    }

    /** Every transaction still to be paid (or received), oldest due date first. */
    public List<Expense> findPending() {
        return expenseRepository.findByStatusOrderByDateAscIdAsc(ExpenseStatus.PENDING);
    }

    public Optional<Expense> findById(Long id) {
        return expenseRepository.findById(id);
    }

    /** Marks a pending transaction as paid on the given date (today by default). */
    @Transactional
    public Expense markPaid(Long id, LocalDate date) {
        Expense expense = expenseRepository.findById(id).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "Lançamento não encontrado: " + id));
        if (expense.isPaid()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Este lançamento já está pago.");
        }
        expense.setStatus(ExpenseStatus.PAID);
        expense.setDate(date == null ? LocalDate.now(clock) : date);
        return expenseRepository.save(expense);
    }

    /**
     * Sends a transaction to the trash. It also releases what pointed to it: a recurring occurrence becomes "skipped"
     * (so automatic payment does not recreate it) and a bought wish-list item goes back to the list, returning the
     * pot's money.
     */
    @Transactional
    public void deleteById(Long id) {
        occurrenceRepository.detachExpense(id, OccurrenceStatus.SKIPPED);
        wishItemRepository.findByExpenseId(id).ifPresent(item ->
                potEntryRepository.deleteByWishItemIdAndKind(item.getId(), PotEntryKind.PURCHASE));
        wishItemRepository.revertPurchase(id, WishStatus.WISHED);
        expenseRepository.findById(id).ifPresent(expense -> {
            expense.setDeletedAt(LocalDateTime.now());
            expenseRepository.save(expense);
        });
    }

    /** Sends every transaction and transfer to the trash (nothing is lost until the trash is emptied). */
    @Transactional
    public void deleteAll() {
        occurrenceRepository.detachAllExpenses(OccurrenceStatus.SKIPPED);
        potEntryRepository.deleteByKind(PotEntryKind.PURCHASE);
        wishItemRepository.revertAllPurchases(WishStatus.WISHED);
        LocalDateTime now = LocalDateTime.now();
        expenseRepository.trashAll(now);
        transferRepository.trashAll(now);
    }

    /** Sum of all paid expenses (income is not counted), computed by the database. */
    public BigDecimal getTotalAmount() {
        BigDecimal total = expenseRepository.sumPaidExpenses();
        return total == null ? BigDecimal.ZERO : total;
    }

    public long getCount() {
        return expenseRepository.count();
    }

    /**
     * Totals of one kind of transaction in one month, for one account and category. Every field of the summary is
     * built from these rows (see {@link SummaryService}).
     */
    public record Bucket(YearMonth month, boolean income, boolean paid, Long categoryId, Long accountId,
                         BigDecimal amount, long count) {
    }

    /** Totals between two months (both included), grouped by month, kind, status, category and account. */
    public List<Bucket> totalsBetween(YearMonth from, YearMonth to) {
        return expenseRepository.totalsBetween(from.atDay(1), to.atEndOfMonth()).stream()
                .map(row -> new Bucket(
                        YearMonth.of(((Number) row[0]).intValue(), ((Number) row[1]).intValue()),
                        row[2] == TransactionType.INCOME,
                        row[3] == null || row[3] == ExpenseStatus.PAID,
                        (Long) row[4],
                        (Long) row[5],
                        row[6] == null ? BigDecimal.ZERO : (BigDecimal) row[6],
                        ((Number) row[7]).longValue()))
                .toList();
    }

    /** The filters of the transaction list; every field is optional. Text is matched without case. */
    public record Filter(YearMonth month, TransactionType type, Long categoryId, Long accountId, Long paymentMethodId,
                         String text, ExpenseStatus status, String tag, LocalDate from, LocalDate to,
                         BigDecimal minAmount, BigDecimal maxAmount) {
    }

    public static final int MAX_PAGE = 500;

    /**
     * The transaction list, filtered and sorted by the database, so only the rows asked for are loaded. {@code sort}
     * is {@code date,desc} (default), {@code date,asc}, {@code amount,desc}, {@code amount,asc} or {@code name,asc}
     * (names are always A to Z); ties are broken by id, newest first. With a {@code size}, returns only that page
     * ({@code page} counts from 0): a page shorter than {@code size} is the last one.
     */
    public List<Expense> list(Filter filter, String sort, Integer page, Integer size) {
        Specification<Expense> spec = matching(filter, sort);
        if (size == null) {
            return expenseRepository.findAll(spec, Sort.unsorted());
        }
        if (size < 1 || size > MAX_PAGE) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "O tamanho da página deve ficar entre 1 e " + MAX_PAGE + ".");
        }
        return expenseRepository.findAll(spec, PageRequest.of(page == null ? 0 : Math.max(0, page), size)).getContent();
    }

    private static Specification<Expense> matching(Filter f, String sort) {
        return (root, query, cb) -> {
            Join<Expense, Category> category = root.join("category", JoinType.LEFT);
            Join<Expense, Account> account = root.join("account", JoinType.LEFT);
            Join<Expense, PaymentMethod> method = root.join("paymentMethod", JoinType.LEFT);
            Join<Category, Category> parent = category.join("parent", JoinType.LEFT);
            List<Predicate> where = new ArrayList<>();
            if (f.month() != null) {
                where.add(cb.between(root.get("date"), f.month().atDay(1), f.month().atEndOfMonth()));
            }
            if (f.from() != null) {
                where.add(cb.greaterThanOrEqualTo(root.get("date"), f.from()));
            }
            if (f.to() != null) {
                where.add(cb.lessThanOrEqualTo(root.get("date"), f.to()));
            }
            if (f.type() != null) {
                where.add(cb.equal(root.get("type"), f.type()));
            }
            if (f.status() == ExpenseStatus.PAID) {
                where.add(cb.or(cb.isNull(root.get("status")), cb.equal(root.get("status"), ExpenseStatus.PAID)));
            } else if (f.status() == ExpenseStatus.PENDING) {
                where.add(cb.equal(root.get("status"), ExpenseStatus.PENDING));
            }
            if (f.categoryId() != null) { // a category also finds what was filed under its subcategories
                where.add(cb.or(cb.equal(category.get("id"), f.categoryId()),
                        cb.equal(category.get("parent").get("id"), f.categoryId())));
            }
            if (f.accountId() != null) {
                where.add(cb.equal(account.get("id"), f.accountId()));
            }
            if (f.paymentMethodId() != null) {
                where.add(cb.equal(method.get("id"), f.paymentMethodId()));
            }
            if (f.minAmount() != null) {
                where.add(cb.greaterThanOrEqualTo(root.get("amount"), f.minAmount()));
            }
            if (f.maxAmount() != null) {
                where.add(cb.lessThanOrEqualTo(root.get("amount"), f.maxAmount()));
            }
            if (f.tag() != null && !withoutHash(f.tag()).isEmpty()) {
                String wanted = withoutHash(f.tag());
                where.add(cb.exists(tagged(query, root, cb, tag -> cb.equal(tag.get("name"), wanted))));
            }
            if (f.text() != null && !f.text().isBlank()) {
                String lower = f.text().trim().toLowerCase();
                String like = "%" + escapeLike(lower) + "%";
                String tagLike = "%" + escapeLike(withoutHash(lower)) + "%";
                where.add(cb.or(
                        containsIgnoreCase(cb, root.<String>get("name"), like),
                        containsIgnoreCase(cb, root.<String>get("description"), like),
                        containsIgnoreCase(cb, account.<String>get("name"), like),
                        containsIgnoreCase(cb, method.<String>get("name"), like),
                        containsIgnoreCase(cb, category.<String>get("name"), like),
                        containsIgnoreCase(cb, parent.<String>get("name"), like),
                        cb.exists(tagged(query, root, cb, tag -> cb.like(cb.lower(tag.<String>get("name")), tagLike, '\\')))));
            }
            if (!Long.class.equals(query.getResultType())) { // the count query does not sort
                query.orderBy(sortOrder(root, cb, sort), cb.desc(root.get("id")));
            }
            return cb.and(where.toArray(Predicate[]::new));
        };
    }

    private static Order sortOrder(Root<Expense> root, CriteriaBuilder cb, String sort) {
        boolean ascending = sort != null && sort.toLowerCase().endsWith(",asc");
        String field = sort == null ? "date" : sort.toLowerCase().split(",")[0];
        return switch (field) {
            case "amount" -> ascending ? cb.asc(root.get("amount")) : cb.desc(root.get("amount"));
            case "name" -> cb.asc(cb.lower(root.<String>get("name")));
            default -> ascending ? cb.asc(root.get("date")) : cb.desc(root.get("date"));
        };
    }

    /** A subquery that finds the transactions having at least one tag matching {@code match}. */
    private static Subquery<Long> tagged(CriteriaQuery<?> query, Root<Expense> root, CriteriaBuilder cb,
                                         Function<Join<Expense, Tag>, Predicate> match) {
        Subquery<Long> sub = query.subquery(Long.class);
        Root<Expense> outer = sub.correlate(root);
        Join<Expense, Tag> tag = outer.join("tags");
        return sub.select(outer.<Long>get("id")).where(match.apply(tag));
    }

    private static Predicate containsIgnoreCase(CriteriaBuilder cb, Expression<String> value, String like) {
        return cb.like(cb.lower(value), like, '\\');
    }

    /** Escapes the characters that LIKE treats as wildcards, so the text is matched as typed. */
    private static String escapeLike(String text) {
        return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    private static String withoutHash(String text) {
        return text.trim().toLowerCase().replaceFirst("^#", "");
    }
}
