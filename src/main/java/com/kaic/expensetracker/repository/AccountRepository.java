package com.kaic.expensetracker.repository;

import com.kaic.expensetracker.model.Account;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AccountRepository extends JpaRepository<Account, Long> {

    List<Account> findAllByOrderByNameAsc();

    Optional<Account> findFirstByArchivedFalseAndParentIsNullOrderByIdAsc();

    boolean existsByNameIgnoreCase(String name);

    boolean existsByParent(com.kaic.expensetracker.model.Account parent);

    boolean existsByParentAndArchivedFalse(com.kaic.expensetracker.model.Account parent);

    Optional<Account> findByNameIgnoreCase(String name);
}
