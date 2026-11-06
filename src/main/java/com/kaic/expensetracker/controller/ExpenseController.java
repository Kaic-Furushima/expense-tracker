package com.kaic.expensetracker.controller;

import com.kaic.expensetracker.model.Account;
import com.kaic.expensetracker.model.Category;
import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.model.ExpenseStatus;
import com.kaic.expensetracker.model.PaymentMethod;
import com.kaic.expensetracker.model.Tag;
import com.kaic.expensetracker.model.TransactionType;
import com.kaic.expensetracker.service.AccountService;
import com.kaic.expensetracker.service.CategoryService;
import com.kaic.expensetracker.service.ExpenseService;
import com.kaic.expensetracker.service.PaymentMethodService;
import com.kaic.expensetracker.service.TagService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/expenses")
public class ExpenseController {

    private static final int MIN_YEAR = 2000;
    private static final int MAX_YEAR = 2100;

    private final ExpenseService expenseService;
    private final CategoryService categoryService;
    private final AccountService accountService;
    private final PaymentMethodService paymentMethodService;
    private final TagService tagService;

    public ExpenseController(ExpenseService expenseService, CategoryService categoryService,
                             AccountService accountService, PaymentMethodService paymentMethodService,
                             TagService tagService) {
        this.expenseService = expenseService;
        this.categoryService = categoryService;
        this.accountService = accountService;
        this.paymentMethodService = paymentMethodService;
        this.tagService = tagService;
    }

    /**
     * Lists transactions, newest first. All filters are optional:
     * {@code month=2026-05}, {@code type=INCOME|EXPENSE}, {@code status=PAID|PENDING}, {@code categoryId},
     * {@code accountId}, {@code paymentMethodId}, {@code tag}, free text {@code q}, a date range ({@code from},
     * {@code to}) and an amount range ({@code minAmount}, {@code maxAmount}). {@code sort} is {@code date,desc}
     * (default), {@code date,asc}, {@code amount,desc}, {@code amount,asc} or {@code name,asc}. Without
     * {@code month}, a {@code status=PENDING} request lists every pending transaction of every month. With
     * {@code size}, returns one page of that size ({@code page} counts from 0, default 0): a shorter page is the last.
     */
    @GetMapping
    public List<ExpenseResponse> getAll(@RequestParam(required = false) YearMonth month,
                                        @RequestParam(required = false) TransactionType type,
                                        @RequestParam(required = false) Long categoryId,
                                        @RequestParam(required = false) Long accountId,
                                        @RequestParam(required = false) Long paymentMethodId,
                                        @RequestParam(required = false) String q,
                                        @RequestParam(required = false) ExpenseStatus status,
                                        @RequestParam(required = false) String tag,
                                        @RequestParam(required = false) LocalDate from,
                                        @RequestParam(required = false) LocalDate to,
                                        @RequestParam(required = false) BigDecimal minAmount,
                                        @RequestParam(required = false) BigDecimal maxAmount,
                                        @RequestParam(required = false, defaultValue = "date,desc") String sort,
                                        @RequestParam(required = false) Integer page,
                                        @RequestParam(required = false) Integer size) {
        ExpenseService.Filter filter = new ExpenseService.Filter(month, type, categoryId, accountId, paymentMethodId,
                q, status, tag, from, to, minAmount, maxAmount);
        return expenseService.list(filter, sort, page, size).stream().map(ExpenseResponse::fromEntity).toList();
    }

    /** The list without the date range, amount range, sort order and paging (newest first). */
    public List<ExpenseResponse> getAll(YearMonth month, TransactionType type, Long categoryId, Long accountId,
                                        Long paymentMethodId, String q, ExpenseStatus status, String tag) {
        return getAll(month, type, categoryId, accountId, paymentMethodId, q, status, tag, null, null, null, null,
                "date,desc", null, null);
    }


    /** Earlier transactions whose description contains {@code q}, to autocomplete the form. */
    @GetMapping("/suggestions")
    public List<ExpenseResponse> suggestions(@RequestParam String q) {
        return expenseService.suggest(q, 6).stream().map(s -> ExpenseResponse.fromEntity(s.last())).toList();
    }

    /**
     * Changes several transactions at once. {@code action}: DELETE (to the trash), SET_CATEGORY, SET_ACCOUNT,
     * SET_PAYMENT_METHOD (a null id clears category and payment method), ADD_TAG or MARK_PAID (only the pending ones).
     */
    @PostMapping("/batch")
    public Map<String, Object> batch(@RequestBody BatchRequest request) {
        List<Long> ids = request.ids() == null ? List.of() : request.ids();
        String action = request.action() == null ? "" : request.action().toUpperCase();
        switch (action) {
            case "DELETE":
                List<Long> deleted = expenseService.deleteAllOf(ids);
                return Map.of("count", deleted.size(), "ids", deleted);
            case "MARK_PAID":
                return Map.of("count", expenseService.markPaidAll(ids));
            case "SET_CATEGORY": {
                Category category = request.categoryId() == null ? null : categoryService.getOrThrow(request.categoryId());
                return Map.of("count", expenseService.updateAll(ids, e -> e.setCategory(category)));
            }
            case "SET_ACCOUNT": {
                Account account = accountService.getOrThrow(request.accountId());
                return Map.of("count", expenseService.updateAll(ids, e -> e.setAccount(account)));
            }
            case "SET_PAYMENT_METHOD": {
                PaymentMethod method = request.paymentMethodId() == null ? null
                        : paymentMethodService.getOrThrow(request.paymentMethodId());
                return Map.of("count", expenseService.updateAll(ids, e -> e.setPaymentMethod(method)));
            }
            case "ADD_TAG": {
                if (request.tag() == null || request.tag().isBlank()) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Informe a tag.");
                }
                return Map.of("count", expenseService.updateAll(ids, e -> {
                    List<String> names = new java.util.ArrayList<>(e.getTags().stream().map(Tag::getName).toList());
                    names.add(request.tag());
                    e.getTags().clear();
                    e.getTags().addAll(tagService.resolve(names));
                }));
            }
            default:
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Ação desconhecida: " + request.action());
        }
    }

    public record BatchRequest(List<Long> ids, String action, Long categoryId, Long accountId, Long paymentMethodId,
                               String tag) {
    }

    @GetMapping("/{id}")
    public ExpenseResponse getById(@PathVariable Long id) {
        return expenseService.findById(id)
                .map(ExpenseResponse::fromEntity)
                .orElseThrow(() -> notFound(id));
    }

    /**
     * Creates a transaction. With {@code installments >= 2} the amount is the purchase total, split into that many
     * monthly installments; the response is then the first one.
     */
    @PostMapping
    public ResponseEntity<ExpenseResponse> create(@Valid @RequestBody ExpenseRequest request) {
        Expense expense = new Expense();
        apply(expense, request);
        List<ExpenseService.Slot> plan = request.installmentPlan() == null ? List.of()
                : request.installmentPlan().stream()
                        .map(s -> new ExpenseService.Slot(s.date(), s.status(), s.amount())).toList();
        int installments = request.installments() == null ? 1 : request.installments();
        Expense saved;
        if (plan.size() > 1 && expense.getType() == TransactionType.EXPENSE) {
            saved = expenseService.saveInstallments(expense, plan).get(0);
        } else if (installments > 1 && expense.getType() == TransactionType.EXPENSE) {
            saved = expenseService.saveInstallments(expense, installments).get(0);
        } else {
            saved = expenseService.save(expense);
        }
        return ResponseEntity.status(HttpStatus.CREATED).body(ExpenseResponse.fromEntity(saved));
    }

    @PutMapping("/{id}")
    public ExpenseResponse update(@PathVariable Long id, @Valid @RequestBody ExpenseRequest request) {
        Expense expense = expenseService.findById(id).orElseThrow(() -> notFound(id));
        apply(expense, request);
        return ExpenseResponse.fromEntity(expenseService.save(expense));
    }

    /** Marks a pending transaction as paid (on the given date, today by default). */
    @PostMapping("/{id}/pay")
    public ExpenseResponse pay(@PathVariable Long id, @RequestBody(required = false) PayRequest request) {
        return ExpenseResponse.fromEntity(expenseService.markPaid(id, request == null ? null : request.date()));
    }

    /**
     * Moves the transaction to the trash (it can be restored for 30 days). With {@code scope=FOLLOWING} an
     * installment goes together with the ones after it, and the ids sent to the trash are returned.
     */
    @DeleteMapping("/{id}")
    public ResponseEntity<Object> delete(@PathVariable Long id, @RequestParam(required = false) String scope) {
        if (expenseService.findById(id).isEmpty()) {
            throw notFound(id);
        }
        if ("FOLLOWING".equalsIgnoreCase(scope)) {
            return ResponseEntity.ok(Map.of("ids", expenseService.deleteFollowing(id)));
        }
        expenseService.deleteById(id);
        return ResponseEntity.noContent().build();
    }

    private void apply(Expense expense, ExpenseRequest request) {
        if (request.date().getYear() < MIN_YEAR || request.date().getYear() > MAX_YEAR) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "A data deve estar entre os anos " + MIN_YEAR + " e " + MAX_YEAR + ".");
        }
        Category category = request.categoryId() == null ? null : categoryService.getOrThrow(request.categoryId());
        // Every transaction belongs to an account; when the client does not say which, the main account is used.
        Account account = request.accountId() == null ? accountService.defaultAccount() : accountService.getOrThrow(request.accountId());
        PaymentMethod method = request.paymentMethodId() == null ? null : paymentMethodService.getOrThrow(request.paymentMethodId());
        TransactionType kind = request.type() == null ? TransactionType.EXPENSE : request.type();
        categoryService.requireKind(category, kind);
        expense.setName(request.name().trim());
        expense.setDescription(request.description());
        expense.setAmount(request.amount().setScale(2, RoundingMode.HALF_UP));
        expense.setDate(request.date());
        expense.setType(request.type() == null ? TransactionType.EXPENSE : request.type());
        expense.setStatus(request.status() == null ? ExpenseStatus.PAID : request.status());
        expense.setCategory(category);
        expense.setAccount(account);
        expense.setPaymentMethod(method);
        expense.getTags().clear();
        expense.getTags().addAll(tagService.resolve(request.tags()));
    }

    private static ResponseStatusException notFound(Long id) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "Lançamento não encontrado: " + id);
    }

    public record PayRequest(LocalDate date) {
    }

    public record ExpenseRequest(
            @NotBlank(message = "Informe uma descrição.") @Size(max = 120, message = "A descrição pode ter até 120 caracteres.") String name,
            @Size(max = 255, message = "A observação pode ter até 255 caracteres.") String description,
            @NotNull(message = "Informe o valor.")
            @DecimalMin(value = "0.01", message = "O valor deve ser de pelo menos 0,01.")
            @DecimalMax(value = "999999999.99", message = "O valor é alto demais.") BigDecimal amount,
            @NotNull(message = "Informe a data.") LocalDate date,
            TransactionType type,
            Long categoryId,
            Long accountId,
            Long paymentMethodId,
            ExpenseStatus status,
            List<String> tags,
            @Min(value = 1, message = "O número de parcelas deve ser de pelo menos 1.")
            @Max(value = 60, message = "O número de parcelas pode ser de até 60.") Integer installments,
            @Size(max = 60, message = "O número de parcelas pode ser de até 60.") List<InstallmentSlot> installmentPlan
    ) {
        /** Same as the full constructor, with only a count of installments (monthly, same day). */
        public ExpenseRequest(String name, String description, BigDecimal amount, LocalDate date, TransactionType type,
                              Long categoryId, Long accountId, Long paymentMethodId, ExpenseStatus status,
                              List<String> tags, Integer installments) {
            this(name, description, amount, date, type, categoryId, accountId, paymentMethodId, status, tags,
                    installments, null);
        }

        /** Same as the full constructor, for a single (not installment) transaction. */
        public ExpenseRequest(String name, String description, BigDecimal amount, LocalDate date, TransactionType type,
                              Long categoryId, Long accountId, Long paymentMethodId, ExpenseStatus status,
                              List<String> tags) {
            this(name, description, amount, date, type, categoryId, accountId, paymentMethodId, status, tags, null, null);
        }

        /** Shortcut for a plain paid expense in the main account, without category, payment method or tags. */
        public ExpenseRequest(String name, String description, BigDecimal amount, LocalDate date) {
            this(name, description, amount, date, null, null, null, null, null, null, null, null);
        }

        /** Same, with the fields most tests care about. */
        public ExpenseRequest(String name, String description, BigDecimal amount, LocalDate date,
                              TransactionType type, Long categoryId, Long accountId, Long paymentMethodId) {
            this(name, description, amount, date, type, categoryId, accountId, paymentMethodId, null, null, null, null);
        }
    }

    /** One installment of a custom plan: its due date, whether it is already paid and, optionally, its own amount. */
    public record InstallmentSlot(@NotNull(message = "Informe a data de cada parcela.") LocalDate date,
                                  ExpenseStatus status, BigDecimal amount) {
    }

    public record ExpenseResponse(
            Long id,
            String name,
            String description,
            BigDecimal amount,
            LocalDate date,
            TransactionType type,
            ExpenseStatus status,
            Long categoryId,
            String categoryName,
            String categoryIcon,
            String categoryColor,
            Long categoryParentId,
            Long accountId,
            String accountName,
            String accountColor,
            Long paymentMethodId,
            String paymentMethodName,
            List<String> tags,
            Integer installmentNumber,
            Integer installmentTotal,
            LocalDateTime createdAt,
            LocalDateTime updatedAt,
            boolean adjustment
    ) {
        public static ExpenseResponse fromEntity(Expense e) {
            Category c = e.getCategory();
            Account a = e.getAccount();
            PaymentMethod m = e.getPaymentMethod();
            return new ExpenseResponse(
                    e.getId(), e.getName(), e.getDescription(), e.getAmount(), e.getDate(), e.getType(),
                    e.isPaid() ? ExpenseStatus.PAID : ExpenseStatus.PENDING,
                    c == null ? null : c.getId(),
                    c == null ? null : c.getName(),
                    c == null ? null : c.getIcon(),
                    c == null ? null : c.getColor(),
                    c == null || c.getParent() == null ? null : c.getParent().getId(),
                    a == null ? null : a.getId(),
                    a == null ? null : a.getName(),
                    a == null ? null : a.getColor(),
                    m == null ? null : m.getId(),
                    m == null ? null : m.getName(),
                    e.getTags().stream().map(Tag::getName).sorted().toList(),
                    e.getInstallmentNumber(), e.getInstallmentTotal(),
                    e.getCreatedAt(), e.getUpdatedAt(), e.isAdjustment());
        }
    }
}
