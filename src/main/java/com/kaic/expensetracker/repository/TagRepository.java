package com.kaic.expensetracker.repository;

import com.kaic.expensetracker.model.Tag;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface TagRepository extends JpaRepository<Tag, Long> {

    List<Tag> findAllByOrderByNameAsc();

    Optional<Tag> findByNameIgnoreCase(String name);
}
