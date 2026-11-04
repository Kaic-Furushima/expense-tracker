package com.kaic.expensetracker.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.YearMonth;

/**
 * A spending limit that is valid from {@code fromMonth} until the next row of the same category. A null category is
 * the overall monthly limit; a null amount means "no budget from this month on".
 */
@Entity
@Table(name = "budgets")
@Getter
@Setter
public class Budget extends SyncEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumn(name = "category_id")
    private Category category;

    /** First month (yyyy-MM) this row applies to. */
    @Column(name = "from_month", nullable = false, length = 7)
    private String fromMonth;

    @Column(precision = 15, scale = 2)
    private BigDecimal amount;

    public YearMonth from() {
        return YearMonth.parse(fromMonth);
    }
}
