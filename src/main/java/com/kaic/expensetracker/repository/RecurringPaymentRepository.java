package com.kaic.expensetracker.repository;

import com.kaic.expensetracker.model.Account;
import com.kaic.expensetracker.model.Category;
import com.kaic.expensetracker.model.PaymentMethod;
import com.kaic.expensetracker.model.RecurringPayment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.util.List;

public interface RecurringPaymentRepository extends JpaRepository<RecurringPayment, Long> {

    List<RecurringPayment> findAllByOrderByNameAsc();

    List<RecurringPayment> findByActiveTrue();

    long countByAccount(Account account);

    @Modifying
    @Query("update RecurringPayment r set r.category = null, r.updatedAt = current_timestamp where r.category = :category")
    void detachCategory(Category category);

    @Modifying
    @Query("update RecurringPayment r set r.paymentMethod = null, r.updatedAt = current_timestamp where r.paymentMethod = :method")
    void detachPaymentMethod(PaymentMethod method);
}
