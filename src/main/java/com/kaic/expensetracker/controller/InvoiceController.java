package com.kaic.expensetracker.controller;

import com.kaic.expensetracker.service.InvoiceService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.List;

/** Invoices of a credit-card account. */
@RestController
@RequestMapping("/accounts/{accountId}/invoices")
public class InvoiceController {

    private final InvoiceService service;

    public InvoiceController(InvoiceService service) {
        this.service = service;
    }

    /** Every invoice with activity (newest first), without the purchases. */
    @GetMapping
    public List<InvoiceResponse> list(@PathVariable Long accountId) {
        return service.list(accountId).stream().map(InvoiceResponse::fromInvoice).toList();
    }

    /** One invoice, identified by the month it closes (yyyy-MM), with its purchases and payments. */
    @GetMapping("/{month}")
    public InvoiceResponse get(@PathVariable Long accountId, @PathVariable YearMonth month) {
        return InvoiceResponse.fromInvoice(service.get(accountId, month));
    }

    /** Pays the invoice from another account (the whole remaining amount unless {@code amount} is given). */
    @PostMapping("/{month}/pay")
    public ResponseEntity<InvoiceResponse> pay(@PathVariable Long accountId, @PathVariable YearMonth month,
                                               @Valid @RequestBody PayRequest request) {
        service.pay(accountId, month, request.fromAccountId(), request.amount(), request.date());
        return ResponseEntity.status(HttpStatus.CREATED).body(InvoiceResponse.fromInvoice(service.get(accountId, month)));
    }

    public record PayRequest(
            @NotNull(message = "Informe de qual conta sai o pagamento.") Long fromAccountId,
            @DecimalMin(value = "0.01", message = "O valor deve ser de pelo menos 0,01.")
            @DecimalMax(value = "999999999.99", message = "O valor é alto demais.") BigDecimal amount,
            LocalDate date) {
    }

    public record InvoiceResponse(String month, LocalDate startDate, LocalDate closingDate, LocalDate dueDate,
                                  BigDecimal total, BigDecimal paid, BigDecimal remaining, String status,
                                  List<ExpenseController.ExpenseResponse> items,
                                  List<TransferController.TransferResponse> payments) {
        static InvoiceResponse fromInvoice(InvoiceService.Invoice i) {
            return new InvoiceResponse(i.month().toString(), i.startDate(), i.closingDate(), i.dueDate(), i.total(),
                    i.paid(), i.remaining(), i.status().name(),
                    i.items().stream().map(ExpenseController.ExpenseResponse::fromEntity).toList(),
                    i.payments().stream().map(TransferController.TransferResponse::fromEntity).toList());
        }
    }
}
