package com.kaic.expensetracker.repository;

import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.model.ExpenseStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/**
 * Normal (derived and JPQL) queries never see trashed rows: {@code Expense} carries a soft-delete restriction. The
 * native queries below are the ones that must also reach the trash.
 */
public interface ExpenseRepository extends JpaRepository<Expense, Long>, JpaSpecificationExecutor<Expense> {

    List<Expense> findByDateBetweenOrderByDateDescIdDesc(LocalDate start, LocalDate end);

    List<Expense> findByStatusOrderByDateAscIdAsc(ExpenseStatus status);

    List<Expense> findByAccountIdOrderByDateAscIdAsc(Long accountId);

    /** The installments of a purchase from the given one on (same group, number >= given), in order. */
    List<Expense> findByInstallmentGroupAndInstallmentNumberGreaterThanEqualOrderByInstallmentNumberAsc(
            String installmentGroup, Integer installmentNumber);

    /**
     * Totals of the transactions between two dates, grouped by month, kind, status, category and account. Each row is
     * {year, month, type, status, category id, account id, sum, count}; the summary is built from these few rows
     * instead of loading every transaction of the period.
     */
    @Query("select year(e.date), month(e.date), e.type, e.status, c.id, a.id, sum(e.amount), count(e) "
            + "from Expense e left join e.category c left join e.account a "
            + "where e.date between :start and :end "
            + "group by year(e.date), month(e.date), e.type, e.status, c.id, a.id")
    List<Object[]> totalsBetween(LocalDate start, LocalDate end);

    /** Sum of the paid transactions that are not income (every account); null when there are none. */
    @Query("select sum(e.amount) from Expense e "
            + "where (e.status is null or e.status = com.kaic.expensetracker.model.ExpenseStatus.PAID) "
            + "and (e.type is null or e.type <> com.kaic.expensetracker.model.TransactionType.INCOME)")
    BigDecimal sumPaidExpenses();

    /** Rows of {account id, type, total} for paid transactions, used to compute account balances. */
    @Query("select e.account.id, e.type, sum(e.amount) from Expense e "
            + "where e.status = com.kaic.expensetracker.model.ExpenseStatus.PAID group by e.account.id, e.type")
    List<Object[]> sumByAccountAndType();

    /** How many rows (trash included) point to an account, so it is never deleted while still referenced. */
    @Query(value = "select count(*) from expenses where account_id = :accountId", nativeQuery = true)
    long countAllByAccountId(Long accountId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = "update expenses set category_id = null where category_id = :categoryId", nativeQuery = true)
    void detachCategory(Long categoryId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = "update expenses set payment_method_id = null where payment_method_id = :methodId", nativeQuery = true)
    void detachPaymentMethod(Long methodId);

    /* ---- trash ---- */

    @Query(value = "select * from expenses where deleted_at is not null order by deleted_at desc", nativeQuery = true)
    List<Expense> findTrashed();

    @Query(value = "select * from expenses where id = :id and deleted_at is not null", nativeQuery = true)
    Optional<Expense> findTrashedById(Long id);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = "update expenses set deleted_at = null where id = :id and deleted_at is not null", nativeQuery = true)
    void restore(Long id);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = "update expenses set deleted_at = :at where deleted_at is null", nativeQuery = true)
    void trashAll(LocalDateTime at);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = "delete from expense_tags where expense_id in "
            + "(select id from expenses where deleted_at is not null and deleted_at < :before)", nativeQuery = true)
    void deleteTagLinksOfTrashedBefore(LocalDateTime before);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = "delete from expenses where deleted_at is not null and deleted_at < :before", nativeQuery = true)
    void purgeTrashedBefore(LocalDateTime before);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = "delete from expense_tags where expense_id = :id", nativeQuery = true)
    void deleteTagLinks(Long id);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query(value = "delete from expenses where id = :id and deleted_at is not null", nativeQuery = true)
    void purgeTrashed(Long id);
}
