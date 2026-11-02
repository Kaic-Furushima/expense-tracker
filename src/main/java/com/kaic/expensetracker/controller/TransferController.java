package com.kaic.expensetracker.controller;

import com.kaic.expensetracker.model.Transfer;
import com.kaic.expensetracker.service.TransferService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
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

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.util.List;

/** Transfers between accounts (including into a sub-account such as a bank "caixinha"). */
@RestController
@RequestMapping("/transfers")
public class TransferController {

    private final TransferService service;

    public TransferController(TransferService service) {
        this.service = service;
    }

    /** Transfers of a month (default: the current one); with {@code accountId}, those that left or entered it. */
    @GetMapping
    public List<TransferResponse> getAll(@RequestParam(required = false) YearMonth month,
                                         @RequestParam(required = false) Long accountId) {
        return service.findByMonth(month == null ? YearMonth.now() : month, accountId).stream()
                .map(TransferResponse::fromEntity)
                .toList();
    }

    @PostMapping
    public ResponseEntity<TransferResponse> create(@Valid @RequestBody TransferRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(TransferResponse.fromEntity(service.create(request.toDraft())));
    }

    @PutMapping("/{id}")
    public TransferResponse update(@PathVariable Long id, @Valid @RequestBody TransferRequest request) {
        return TransferResponse.fromEntity(service.update(id, request.toDraft()));
    }

    /** Moves the transfer to the trash. */
    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id) {
        service.delete(id);
    }

    public record TransferRequest(
            @NotNull(message = "Informe a conta de origem.") Long fromAccountId,
            @NotNull(message = "Informe a conta de destino.") Long toAccountId,
            @NotNull(message = "Informe o valor.")
            @DecimalMin(value = "0.01", message = "O valor deve ser de pelo menos 0,01.")
            @DecimalMax(value = "999999999.99", message = "O valor é alto demais.") BigDecimal amount,
            LocalDate date,
            @Size(max = 255, message = "A observação pode ter até 255 caracteres.") String description) {

        TransferService.Draft toDraft() {
            return new TransferService.Draft(fromAccountId, toAccountId, amount, date, description);
        }
    }

    public record TransferResponse(Long id, LocalDate date, BigDecimal amount, String description,
                                   Long fromAccountId, String fromAccountName, String fromAccountColor,
                                   Long toAccountId, String toAccountName, String toAccountColor,
                                   LocalDateTime createdAt, LocalDateTime updatedAt) {
        public static TransferResponse fromEntity(Transfer t) {
            return new TransferResponse(t.getId(), t.getDate(), t.getAmount(), t.getDescription(),
                    t.getFromAccount().getId(), t.getFromAccount().getName(), t.getFromAccount().getColor(),
                    t.getToAccount().getId(), t.getToAccount().getName(), t.getToAccount().getColor(),
                    t.getCreatedAt(), t.getUpdatedAt());
        }
    }
}
