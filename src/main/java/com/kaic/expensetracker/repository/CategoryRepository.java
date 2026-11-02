package com.kaic.expensetracker.repository;

import com.kaic.expensetracker.model.Category;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

import java.util.List;

public interface CategoryRepository extends JpaRepository<Category, Long> {

    List<Category> findAllByOrderByNameAsc();

    boolean existsByNameIgnoreCase(String name);

    boolean existsByParent(Category parent);

    /** Deleting a category promotes its subcategories to top-level ones. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update Category c set c.parent = null where c.parent = :parent")
    void detachChildren(Category parent);
}
