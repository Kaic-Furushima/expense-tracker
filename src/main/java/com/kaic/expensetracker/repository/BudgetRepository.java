package com.kaic.expensetracker.repository;

import com.kaic.expensetracker.model.Budget;
import com.kaic.expensetracker.model.Category;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface BudgetRepository extends JpaRepository<Budget, Long> {

    /** All rows of a category, oldest first. */
    List<Budget> findByCategoryOrderByFromMonthAsc(Category category);

    /** All rows of the overall monthly limit, oldest first. */
    List<Budget> findByCategoryIsNullOrderByFromMonthAsc();

    Optional<Budget> findByCategoryAndFromMonth(Category category, String fromMonth);

    Optional<Budget> findByCategoryIsNullAndFromMonth(String fromMonth);

    void deleteByCategory(Category category);
}
