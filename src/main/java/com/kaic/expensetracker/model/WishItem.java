package com.kaic.expensetracker.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * A product on the wish list. While it is wished for it belongs to no account; buying it records the real price and
 * the account and creates the matching expense.
 */
@Entity
@Table(name = "wish_items")
@Getter
@Setter
public class WishItem extends SyncEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 120)
    private String name;

    @Column(name = "estimated_price", precision = 15, scale = 2)
    private BigDecimal estimatedPrice;

    /** ISO code of the item's currency; null means the main one. */
    @Column(length = 3)
    private String currency;

    private String notes;

    @Column(length = 500)
    private String url;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(nullable = false, length = 10)
    private WishStatus status = WishStatus.WISHED;

    /** Pot that is meant to pay for it (optional). */
    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumn(name = "pot_id")
    private Pot pot;

    @Column(name = "real_price", precision = 15, scale = 2)
    private BigDecimal realPrice;

    @Column(name = "purchase_date")
    private LocalDate purchaseDate;

    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumn(name = "expense_id")
    private Expense expense;

    @Column(name = "created_at", nullable = false)
    private LocalDate createdAt = LocalDate.now();
}
