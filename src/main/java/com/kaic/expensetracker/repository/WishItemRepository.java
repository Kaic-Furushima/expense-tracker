package com.kaic.expensetracker.repository;

import com.kaic.expensetracker.model.Pot;
import com.kaic.expensetracker.model.WishItem;
import com.kaic.expensetracker.model.WishStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface WishItemRepository extends JpaRepository<WishItem, Long> {

    List<WishItem> findAllByOrderByIdDesc();

    Optional<WishItem> findByExpenseId(Long expenseId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update WishItem w set w.pot = null where w.pot = :pot")
    void detachPot(Pot pot);

    /** Deleting the purchase transaction puts the item back on the wish list. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update WishItem w set w.status = :status, w.expense = null, w.realPrice = null, w.purchaseDate = null "
            + "where w.expense.id = :expenseId")
    void revertPurchase(Long expenseId, WishStatus status);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update WishItem w set w.status = :status, w.expense = null, w.realPrice = null, w.purchaseDate = null "
            + "where w.expense is not null")
    void revertAllPurchases(WishStatus status);
}
