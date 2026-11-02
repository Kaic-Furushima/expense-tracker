package com.kaic.expensetracker.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.LocalDate;

/** A movement of a pot. Positive amounts add money, negative amounts take it out. */
@Entity
@Table(name = "pot_entries")
@Getter
@Setter
public class PotEntry {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false, fetch = FetchType.EAGER)
    @JoinColumn(name = "pot_id", nullable = false)
    private Pot pot;

    @Column(name = "entry_date", nullable = false)
    private LocalDate entryDate;

    @Column(nullable = false, precision = 15, scale = 2)
    private BigDecimal amount;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(nullable = false, length = 12)
    private PotEntryKind kind;

    private String note;

    /** Month (yyyy-MM) of an automatic contribution; guarantees one automatic entry per month. */
    @Column(name = "auto_month", length = 7)
    private String autoMonth;

    @Column(name = "wish_item_id")
    private Long wishItemId;
}
