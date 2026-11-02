package com.kaic.expensetracker.repository;

import com.kaic.expensetracker.model.OccurrenceStatus;
import com.kaic.expensetracker.model.RecurringOccurrence;
import com.kaic.expensetracker.model.RecurringPayment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.time.LocalDate;
import java.util.List;

public interface RecurringOccurrenceRepository extends JpaRepository<RecurringOccurrence, Long> {

    List<RecurringOccurrence> findByMonthOrderByDueDateAscIdAsc(String month);

    List<RecurringOccurrence> findByRecurring(RecurringPayment recurring);

    boolean existsByRecurringAndMonth(RecurringPayment recurring, String month);

    List<RecurringOccurrence> findByStatusAndDueDateLessThanEqual(OccurrenceStatus status, LocalDate date);

    void deleteByRecurring(RecurringPayment recurring);

    /** A transaction that was deleted no longer backs its occurrence: skip it so auto-pay does not recreate it. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update RecurringOccurrence o set o.expense = null, o.status = :status, o.paidDate = null "
            + "where o.expense.id = :expenseId")
    void detachExpense(Long expenseId, OccurrenceStatus status);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update RecurringOccurrence o set o.expense = null, o.status = :status, o.paidDate = null "
            + "where o.expense is not null")
    void detachAllExpenses(OccurrenceStatus status);
}
