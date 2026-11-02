package com.kaic.expensetracker.service;

import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.model.Transfer;
import com.kaic.expensetracker.repository.ExpenseRepository;
import com.kaic.expensetracker.repository.TransferRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Comparator;
import java.util.List;

/**
 * The trash: transactions and transfers that were deleted can be restored until they are removed for good, either by
 * hand or automatically after {@value #RETENTION_DAYS} days.
 */
@Service
@Transactional(readOnly = true)
public class TrashService {

    public static final int RETENTION_DAYS = 30;

    public enum Kind { EXPENSE, TRANSFER }

    /** One thing in the trash, shown the same way whether it was a transaction or a transfer. */
    public record Item(Kind kind, Long id, String title, BigDecimal amount, LocalDate date, String detail,
                       LocalDateTime deletedAt) {
    }

    private final ExpenseRepository expenses;
    private final TransferRepository transfers;

    public TrashService(ExpenseRepository expenses, TransferRepository transfers) {
        this.expenses = expenses;
        this.transfers = transfers;
    }

    public List<Item> list() {
        return java.util.stream.Stream.concat(
                        expenses.findTrashed().stream().map(TrashService::toItem),
                        transfers.findTrashed().stream().map(TrashService::toItem))
                .sorted(Comparator.comparing(Item::deletedAt).reversed())
                .toList();
    }

    @Transactional
    public void restore(Kind kind, Long id) {
        if (kind == Kind.EXPENSE) {
            expenses.findTrashedById(id).orElseThrow(() -> notFound(id));
            expenses.restore(id);
        } else {
            transfers.findTrashedById(id).orElseThrow(() -> notFound(id));
            transfers.restore(id);
        }
    }

    /** Removes one item for good. */
    @Transactional
    public void purge(Kind kind, Long id) {
        if (kind == Kind.EXPENSE) {
            expenses.findTrashedById(id).orElseThrow(() -> notFound(id));
            expenses.deleteTagLinks(id);
            expenses.purgeTrashed(id);
        } else {
            transfers.findTrashedById(id).orElseThrow(() -> notFound(id));
            transfers.purgeTrashed(id);
        }
    }

    @Transactional
    public void empty() {
        purgeBefore(LocalDateTime.now().plusDays(1));
    }

    /** Removes what has been in the trash for more than the retention period. */
    @Transactional
    public void purgeExpired() {
        purgeBefore(LocalDateTime.now().minusDays(RETENTION_DAYS));
    }

    private void purgeBefore(LocalDateTime before) {
        expenses.deleteTagLinksOfTrashedBefore(before);
        expenses.purgeTrashedBefore(before);
        transfers.purgeTrashedBefore(before);
    }

    private static Item toItem(Expense e) {
        String detail = e.getAccount().getName() + (e.getCategory() == null ? "" : " · " + e.getCategory().getName());
        return new Item(Kind.EXPENSE, e.getId(), e.getName(), e.getAmount(), e.getDate(), detail, e.getDeletedAt());
    }

    private static Item toItem(Transfer t) {
        String title = t.getDescription() == null ? "Transferência" : t.getDescription();
        String detail = t.getFromAccount().getName() + " → " + t.getToAccount().getName();
        return new Item(Kind.TRANSFER, t.getId(), title, t.getAmount(), t.getDate(), detail, t.getDeletedAt());
    }

    private static ResponseStatusException notFound(Long id) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "Item não encontrado na lixeira: " + id);
    }
}
