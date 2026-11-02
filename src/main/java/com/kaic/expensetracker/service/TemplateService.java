package com.kaic.expensetracker.service;

import com.kaic.expensetracker.model.ExpenseTemplate;
import com.kaic.expensetracker.model.TransactionType;
import com.kaic.expensetracker.repository.ExpenseTemplateRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;

/** Favorite transactions ("modelos") that pre-fill the new-transaction form. */
@Service
@Transactional(readOnly = true)
public class TemplateService {

    private static final int MAX_TEMPLATES = 100;

    private final ExpenseTemplateRepository repository;
    private final CategoryService categoryService;
    private final AccountService accountService;
    private final PaymentMethodService paymentMethodService;

    public TemplateService(ExpenseTemplateRepository repository, CategoryService categoryService,
                           AccountService accountService, PaymentMethodService paymentMethodService) {
        this.repository = repository;
        this.categoryService = categoryService;
        this.accountService = accountService;
        this.paymentMethodService = paymentMethodService;
    }

    public record Draft(String name, TransactionType type, BigDecimal amount, Long categoryId, Long accountId,
                        Long paymentMethodId, String description, List<String> tags) {
    }

    public List<ExpenseTemplate> findAll() {
        return repository.findAllByOrderByNameAsc();
    }

    @Transactional
    public ExpenseTemplate create(Draft d) {
        if (d.name() == null || d.name().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Informe o nome do modelo.");
        }
        if (repository.count() >= MAX_TEMPLATES) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Limite de " + MAX_TEMPLATES + " modelos atingido.");
        }
        if (d.amount() != null && (d.amount().signum() <= 0 || d.amount().compareTo(new BigDecimal("999999999.99")) > 0)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Informe um valor entre 0,01 e 999.999.999,99.");
        }
        ExpenseTemplate t = new ExpenseTemplate();
        t.setName(truncate(d.name().trim(), 120));
        t.setType(d.type() == null ? TransactionType.EXPENSE : d.type());
        t.setAmount(d.amount() == null ? null : d.amount().setScale(2, RoundingMode.HALF_UP));
        t.setCategory(d.categoryId() == null ? null : categoryService.getOrThrow(d.categoryId()));
        t.setAccount(d.accountId() == null ? null : accountService.getOrThrow(d.accountId()));
        t.setPaymentMethod(d.paymentMethodId() == null ? null : paymentMethodService.getOrThrow(d.paymentMethodId()));
        t.setDescription(d.description() == null || d.description().isBlank() ? null : truncate(d.description().trim(), 255));
        t.setTags(d.tags() == null || d.tags().isEmpty() ? null : truncate(String.join(" ", d.tags()), 255));
        return repository.save(t);
    }

    @Transactional
    public void delete(Long id) {
        if (!repository.existsById(id)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Modelo não encontrado: " + id);
        }
        repository.deleteById(id);
    }

    private static String truncate(String text, int max) {
        return text.length() <= max ? text : text.substring(0, max);
    }
}
