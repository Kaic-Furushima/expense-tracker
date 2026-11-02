package com.kaic.expensetracker.repository;

import com.kaic.expensetracker.model.Pot;
import com.kaic.expensetracker.model.PotEntry;
import com.kaic.expensetracker.model.PotEntryKind;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.math.BigDecimal;
import java.util.List;

public interface PotEntryRepository extends JpaRepository<PotEntry, Long> {

    List<PotEntry> findByPotOrderByEntryDateDescIdDesc(Pot pot);

    boolean existsByPotAndAutoMonth(Pot pot, String autoMonth);

    @Query("select coalesce(sum(e.amount), 0) from PotEntry e where e.pot = :pot")
    BigDecimal balanceOf(Pot pot);

    void deleteByPot(Pot pot);

    void deleteByWishItemIdAndKind(Long wishItemId, PotEntryKind kind);

    void deleteByKind(PotEntryKind kind);
}
