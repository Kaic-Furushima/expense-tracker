package com.kaic.expensetracker.repository;

import com.kaic.expensetracker.model.ExpenseTemplate;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ExpenseTemplateRepository extends JpaRepository<ExpenseTemplate, Long> {

    List<ExpenseTemplate> findAllByOrderByNameAsc();
}
