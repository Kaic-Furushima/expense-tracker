package com.kaic.expensetracker.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.SQLRestriction;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * Money moved from one account to another. It is neither income nor expense: it only changes the balance of the two
 * accounts. Moving money into a sub-account (a "cofrinho") is how an investment is recorded.
 */
@Entity
@Table(name = "transfers")
@SQLRestriction("deleted_at is null")
@Getter
@Setter
public class Transfer extends SyncEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false, fetch = FetchType.EAGER)
    @JoinColumn(name = "from_account_id", nullable = false)
    private Account fromAccount;

    @ManyToOne(optional = false, fetch = FetchType.EAGER)
    @JoinColumn(name = "to_account_id", nullable = false)
    private Account toAccount;

    @Column(nullable = false, precision = 15, scale = 2)
    private BigDecimal amount;

    @Column(nullable = false)
    private LocalDate date;

    private String description;

    /** Set when this transfer pays a credit-card invoice (the month the invoice closes, yyyy-MM). */
    @Column(name = "invoice_month", length = 7)
    private String invoiceMonth;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "deleted_at")
    private LocalDateTime deletedAt;
}
