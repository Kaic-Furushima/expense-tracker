package com.kaic.expensetracker.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.YearMonth;

/** A payment (or income) that repeats every month on a given day. */
@Entity
@Table(name = "recurring_payments")
@Getter
@Setter
public class RecurringPayment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 120)
    private String name;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(nullable = false, length = 10)
    private TransactionType type = TransactionType.EXPENSE;

    /** Null when the amount changes every month (variable); then it is typed at payment time. */
    @Column(precision = 15, scale = 2)
    private BigDecimal amount;

    @Column(name = "variable_amount", nullable = false)
    private boolean variableAmount;

    @Column(name = "day_of_month", nullable = false)
    private int dayOfMonth;

    @ManyToOne(optional = false, fetch = FetchType.EAGER)
    @JoinColumn(name = "account_id", nullable = false)
    private Account account;

    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumn(name = "payment_method_id")
    private PaymentMethod paymentMethod;

    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumn(name = "category_id")
    private Category category;

    @Column(nullable = false)
    private boolean active = true;

    /** First month (yyyy-MM) that gets an occurrence. */
    @Column(name = "start_month", nullable = false, length = 7)
    private String startMonth;

    /** Last month (yyyy-MM) that gets an occurrence; null means it never ends. */
    @Column(name = "end_month", length = 7)
    private String endMonth;

    public YearMonth start() {
        return YearMonth.parse(startMonth);
    }

    public YearMonth end() {
        return endMonth == null || endMonth.isBlank() ? null : YearMonth.parse(endMonth);
    }
}
