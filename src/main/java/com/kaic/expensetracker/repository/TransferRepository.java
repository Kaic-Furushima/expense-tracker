package com.kaic.expensetracker.repository;

import com.kaic.expensetracker.model.Transfer;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/** Like {@link ExpenseRepository}: normal queries skip the trash, the native ones reach it. */
public interface TransferRepository extends JpaRepository<Transfer, Long> {

    List<Transfer> findByDateBetweenOrderByDateDescIdDesc(LocalDate start, LocalDate end);

    /** Payments of credit-card invoices made into an account. */
    List<Transfer> findByToAccountIdAndInvoiceMonthIsNotNullOrderByDateAscIdAsc(Long toAccountId);

    /** Rows of {account id, total} for the money that left each account. */
    @Query("select t.fromAccount.id, sum(t.amount) from Transfer t group by t.fromAccount.id")
    List<Object[]> sumOutByAccount();

    /** Rows of {account id, total} for the money that entered each account. */
    @Query("select t.toAccount.id, sum(coalesce(t.toAmount, t.amount)) from Transfer t group by t.toAccount.id")
    List<Object[]> sumInByAccount();

    @Query(value = "select count(*) from transfers where from_account_id = :accountId or to_account_id = :accountId",
            nativeQuery = true)
    long countAllByAccountId(Long accountId);

    @Query(value = "select * from transfers where deleted_at is not null order by deleted_at desc", nativeQuery = true)
    List<Transfer> findTrashed();

    @Query(value = "select * from transfers where id = :id and deleted_at is not null", nativeQuery = true)
    Optional<Transfer> findTrashedById(Long id);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = "update transfers set deleted_at = null, updated_at = current_timestamp where id = :id and deleted_at is not null", nativeQuery = true)
    void restore(Long id);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = "update transfers set deleted_at = :at, updated_at = current_timestamp where deleted_at is null", nativeQuery = true)
    void trashAll(LocalDateTime at);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = "delete from transfers where deleted_at is not null and deleted_at < :before", nativeQuery = true)
    void purgeTrashedBefore(LocalDateTime before);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = "delete from transfers where id = :id and deleted_at is not null", nativeQuery = true)
    void purgeTrashed(Long id);
}
