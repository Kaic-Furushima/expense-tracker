package com.kaic.expensetracker.service;

import com.kaic.expensetracker.model.Account;
import com.kaic.expensetracker.model.Transfer;
import com.kaic.expensetracker.repository.TransferRepository;
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
import java.util.List;

/**
 * Transfers between accounts. They are neither income nor expense; they only move balance. Moving money into a
 * sub-account (a "cofrinho") is how an investment is recorded.
 */
@Service
@Transactional(readOnly = true)
public class TransferService {

    private static final BigDecimal MIN = new BigDecimal("0.01");
    private static final BigDecimal MAX = new BigDecimal("999999999.99");

    private final TransferRepository transfers;
    private final AccountService accountService;
    private final Clock clock;

    public TransferService(TransferRepository transfers, AccountService accountService, Clock clock) {
        this.clock = clock;
        this.transfers = transfers;
        this.accountService = accountService;
    }

    public record Draft(Long fromAccountId, Long toAccountId, BigDecimal amount, LocalDate date, String description,
                        String invoiceMonth) {

        public Draft(Long fromAccountId, Long toAccountId, BigDecimal amount, LocalDate date, String description) {
            this(fromAccountId, toAccountId, amount, date, description, null);
        }
    }

    /** Transfers of a month, newest first; with an account, only those that left or entered it. */
    public List<Transfer> findByMonth(YearMonth month, Long accountId) {
        return transfers.findByDateBetweenOrderByDateDescIdDesc(month.atDay(1), month.atEndOfMonth()).stream()
                .filter(t -> accountId == null || accountId.equals(t.getFromAccount().getId())
                        || accountId.equals(t.getToAccount().getId()))
                .toList();
    }

    public List<Transfer> findAll() {
        return transfers.findAll();
    }

    public Transfer getOrThrow(Long id) {
        return transfers.findById(id).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "Transferência não encontrada: " + id));
    }

    @Transactional
    public Transfer create(Draft draft) {
        Transfer transfer = new Transfer();
        apply(transfer, draft);
        return transfers.save(transfer);
    }

    @Transactional
    public Transfer update(Long id, Draft draft) {
        Transfer transfer = getOrThrow(id);
        apply(transfer, draft);
        return transfers.save(transfer);
    }

    /** Moves the transfer to the trash. */
    @Transactional
    public void delete(Long id) {
        Transfer transfer = getOrThrow(id);
        transfer.setDeletedAt(LocalDateTime.now());
        transfers.save(transfer);
    }

    private void apply(Transfer transfer, Draft d) {
        if (d.fromAccountId() == null || d.toAccountId() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Informe a conta de origem e a de destino.");
        }
        if (d.fromAccountId().equals(d.toAccountId())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A origem e o destino devem ser contas diferentes.");
        }
        if (d.amount() == null || d.amount().compareTo(MIN) < 0 || d.amount().compareTo(MAX) > 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Informe um valor entre 0,01 e 999.999.999,99.");
        }
        LocalDate date = d.date() == null ? LocalDate.now(clock) : d.date();
        if (date.getYear() < 2000 || date.getYear() > 2100) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A data deve estar entre os anos 2000 e 2100.");
        }
        Account from = accountService.getOrThrow(d.fromAccountId());
        Account to = accountService.getOrThrow(d.toAccountId());
        requireUsable(from, transfer.getFromAccount());
        requireUsable(to, transfer.getToAccount());
        transfer.setFromAccount(from);
        transfer.setToAccount(to);
        transfer.setAmount(d.amount().setScale(2, RoundingMode.HALF_UP));
        transfer.setDate(date);
        if (d.invoiceMonth() != null) {
            transfer.setInvoiceMonth(d.invoiceMonth());
        }
        transfer.setDescription(d.description() == null || d.description().isBlank() ? null : d.description().trim());
    }

    /** An archived account cannot receive new transfers (an old transfer may keep pointing to it). */
    private static void requireUsable(Account account, Account current) {
        boolean unchanged = current != null && current.getId().equals(account.getId());
        if (account.isArchived() && !unchanged) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "A conta “" + account.getName() + "” está arquivada.");
        }
    }
}
