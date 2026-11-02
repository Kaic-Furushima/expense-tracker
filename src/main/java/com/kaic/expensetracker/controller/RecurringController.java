package com.kaic.expensetracker.controller;

import com.kaic.expensetracker.model.OccurrenceStatus;
import com.kaic.expensetracker.model.RecurringOccurrence;
import com.kaic.expensetracker.model.RecurringPayment;
import com.kaic.expensetracker.model.TransactionType;
import com.kaic.expensetracker.service.RecurringService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
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

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.List;

/** Recurring payments and their monthly occurrences. */
@RestController
@RequestMapping("/recurring")
public class RecurringController {

    private final RecurringService service;

    public RecurringController(RecurringService service) {
        this.service = service;
    }

    @GetMapping
    public List<RecurringResponse> getAll() {
        return service.findAll().stream().map(RecurringResponse::fromEntity).toList();
    }

    @PostMapping
    public ResponseEntity<RecurringResponse> create(@Valid @RequestBody RecurringRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(RecurringResponse.fromEntity(service.create(request.toDraft())));
    }

    @PutMapping("/{id}")
    public RecurringResponse update(@PathVariable Long id, @Valid @RequestBody RecurringRequest request) {
        return RecurringResponse.fromEntity(service.update(id, request.toDraft()));
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id) {
        service.delete(id);
    }

    /** What is due in a month (default: the current one), including what was already paid or skipped. */
    @GetMapping("/occurrences")
    public List<OccurrenceResponse> occurrences(@RequestParam(required = false) YearMonth month) {
        return service.occurrencesOf(month == null ? YearMonth.now() : month).stream()
                .map(OccurrenceResponse::fromEntity)
                .toList();
    }

    /** Pays an occurrence now or on the chosen date (for example the 28th for a payment due on the 30th). */
    @PostMapping("/occurrences/{id}/pay")
    public OccurrenceResponse pay(@PathVariable Long id, @RequestBody(required = false) PayRequest request) {
        PayRequest body = request == null ? new PayRequest(null, null, null, null) : request;
        return OccurrenceResponse.fromEntity(service.pay(id, body.date(), body.amount(), body.accountId(), body.paymentMethodId()));
    }

    @PostMapping("/occurrences/{id}/skip")
    public OccurrenceResponse skip(@PathVariable Long id) {
        return OccurrenceResponse.fromEntity(service.skip(id));
    }

    @PostMapping("/occurrences/{id}/reopen")
    public OccurrenceResponse reopen(@PathVariable Long id) {
        return OccurrenceResponse.fromEntity(service.reopen(id));
    }

    public record PayRequest(LocalDate date,
                             @DecimalMin(value = "0.01", message = "O valor deve ser de pelo menos 0,01.")
                             @DecimalMax(value = "999999999.99", message = "O valor é alto demais.") BigDecimal amount,
                             Long accountId, Long paymentMethodId) {
    }

    public record RecurringRequest(
            @NotBlank(message = "Informe o nome do pagamento.") @Size(max = 120, message = "O nome pode ter até 120 caracteres.") String name,
            TransactionType type,
            @DecimalMax(value = "999999999.99", message = "O valor é alto demais.") BigDecimal amount,
            Boolean variableAmount,
            @Min(value = 1, message = "O dia deve estar entre 1 e 31.") @Max(value = 31, message = "O dia deve estar entre 1 e 31.") int dayOfMonth,
            Long accountId,
            Long paymentMethodId,
            Long categoryId,
            Boolean active,
            String startMonth,
            String endMonth) {

        RecurringService.Draft toDraft() {
            return new RecurringService.Draft(name, type, amount, Boolean.TRUE.equals(variableAmount), dayOfMonth,
                    accountId, paymentMethodId, categoryId,
                    active == null || active, startMonth, endMonth);
        }
    }

    public record RecurringResponse(Long id, String name, TransactionType type, BigDecimal amount, boolean variableAmount,
                                    int dayOfMonth, Long accountId, String accountName, Long paymentMethodId,
                                    String paymentMethodName, Long categoryId, String categoryName, String categoryIcon,
                                    String categoryColor, boolean active,
                                    String startMonth, String endMonth) {
        static RecurringResponse fromEntity(RecurringPayment p) {
            return new RecurringResponse(p.getId(), p.getName(), p.getType(), p.getAmount(), p.isVariableAmount(),
                    p.getDayOfMonth(), p.getAccount().getId(), p.getAccount().getName(),
                    p.getPaymentMethod() == null ? null : p.getPaymentMethod().getId(),
                    p.getPaymentMethod() == null ? null : p.getPaymentMethod().getName(),
                    p.getCategory() == null ? null : p.getCategory().getId(),
                    p.getCategory() == null ? null : p.getCategory().getName(),
                    p.getCategory() == null ? null : p.getCategory().getIcon(),
                    p.getCategory() == null ? null : p.getCategory().getColor(),
                    p.isActive(), p.getStartMonth(), p.getEndMonth());
        }
    }

    public record OccurrenceResponse(Long id, Long recurringId, String name, TransactionType type, String month,
                                     LocalDate dueDate, OccurrenceStatus status, LocalDate paidDate, BigDecimal amount,
                                     boolean variableAmount, Long expenseId, Long accountId, String accountName,
                                     Long paymentMethodId, String paymentMethodName, String categoryIcon, String categoryColor) {
        static OccurrenceResponse fromEntity(RecurringOccurrence o) {
            RecurringPayment p = o.getRecurring();
            return new OccurrenceResponse(o.getId(), p.getId(), p.getName(), p.getType(), o.getMonth(), o.getDueDate(),
                    o.getStatus(), o.getPaidDate(), o.getAmount(), p.isVariableAmount(),
                    o.getExpense() == null ? null : o.getExpense().getId(),
                    p.getAccount().getId(), p.getAccount().getName(),
                    p.getPaymentMethod() == null ? null : p.getPaymentMethod().getId(),
                    p.getPaymentMethod() == null ? null : p.getPaymentMethod().getName(),
                    p.getCategory() == null ? null : p.getCategory().getIcon(),
                    p.getCategory() == null ? null : p.getCategory().getColor());
        }
    }
}
