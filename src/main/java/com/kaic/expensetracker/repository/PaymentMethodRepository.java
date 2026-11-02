package com.kaic.expensetracker.repository;

import com.kaic.expensetracker.model.PaymentMethod;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface PaymentMethodRepository extends JpaRepository<PaymentMethod, Long> {

    List<PaymentMethod> findAllByOrderByNameAsc();

    boolean existsByNameIgnoreCase(String name);

    Optional<PaymentMethod> findByNameIgnoreCase(String name);
}
