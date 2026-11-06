package com.kaic.expensetracker.model;

import jakarta.persistence.*;
import jakarta.validation.constraints.NotNull;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.SQLRestriction;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * An income or an expense. Deleting one only fills {@code deletedAt} (it moves to the trash); the restriction below
 * hides trashed rows from every normal query.
 */
@Entity
@Table(name = "expenses")
@SQLRestriction("deleted_at is null")
@Getter
@Setter
public class Expense extends SyncEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @NotNull(message = "Informe uma descrição.")
    @Column(nullable = false)
    private String name;

    private String description;

    @NotNull(message = "Informe o valor.")
    @Column(nullable = false, precision = 15, scale = 2)
    private BigDecimal amount;

    /** Date of the transaction; for a pending one it is the due date. */
    @NotNull(message = "Informe a data.")
    @Column(nullable = false)
    private LocalDate date;

    /** Nullable so rows created before this column existed keep working (treated as EXPENSE). */
    @Enumerated(EnumType.STRING)
    private TransactionType type;

    /** PAID counts in balances and summaries; PENDING is a bill still to pay (or income still to receive). */
    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(nullable = false, length = 10)
    private ExpenseStatus status = ExpenseStatus.PAID;

    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumn(name = "category_id")
    private Category category;

    @ManyToOne(optional = false, fetch = FetchType.EAGER)
    @JoinColumn(name = "account_id", nullable = false)
    private Account account;

    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumn(name = "payment_method_id")
    private PaymentMethod paymentMethod;

    @ManyToMany(fetch = FetchType.EAGER)
    @JoinTable(name = "expense_tags",
            joinColumns = @JoinColumn(name = "expense_id"),
            inverseJoinColumns = @JoinColumn(name = "tag_id"))
    private Set<Tag> tags = new LinkedHashSet<>();

    /** Installments of one purchase share a group id; {@code installmentNumber} of {@code installmentTotal}. */
    @Column(name = "installment_group", length = 36)
    private String installmentGroup;

    @Column(name = "installment_number")
    private Integer installmentNumber;

    @Column(name = "installment_total")
    private Integer installmentTotal;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "deleted_at")
    private LocalDateTime deletedAt;

    /**
     * A "correção de saldo": it moves the account balance to the value the person typed, but it is neither income nor
     * expense in the month's totals. Nullable on purpose (devices on an older sync version send rows without it).
     */
    @Getter(AccessLevel.NONE)
    @Setter(AccessLevel.NONE)
    @Column(name = "adjustment")
    private Boolean adjustment = false;

    public boolean isAdjustment() {
        return Boolean.TRUE.equals(adjustment);
    }

    public void setAdjustment(boolean adjustment) {
        this.adjustment = adjustment;
    }

    public TransactionType getType() {
        return type == null ? TransactionType.EXPENSE : type;
    }

    public boolean isIncome() {
        return getType() == TransactionType.INCOME;
    }

    public boolean isPaid() {
        return status == null || status == ExpenseStatus.PAID;
    }
}
