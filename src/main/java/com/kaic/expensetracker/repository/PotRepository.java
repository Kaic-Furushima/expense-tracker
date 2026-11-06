package com.kaic.expensetracker.repository;

import com.kaic.expensetracker.model.Pot;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface PotRepository extends JpaRepository<Pot, Long> {

    List<Pot> findAllByOrderByNameAsc();

    List<Pot> findByActiveTrue();

    boolean existsByNameIgnoreCase(String name);

    List<Pot> findByAccount(com.kaic.expensetracker.model.Account account);
}
