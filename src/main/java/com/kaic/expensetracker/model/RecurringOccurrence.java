package com.kaic.expensetracker.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.LocalDate;

/** One month of a {@link RecurringPayment}: pending until it is paid (manually or automatically) or skipped. */
@Entity
@Table(name = "recurring_occurrences")
@Getter
@Setter
public class RecurringOccurrence {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false, fetch = FetchType.EAGER)
    @JoinColumn(name = "recurring_id", nullable = false)
    private RecurringPayment recurring;

    @Column(name = "occurrence_month", nullable = false, length = 7)
    private String month;

    @Column(name = "due_date", nullable = false)
    private LocalDate dueDate;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(nullable = false, length = 10)
    private OccurrenceStatus status = OccurrenceStatus.PENDING;

    @Column(name = "paid_date")
    private LocalDate paidDate;

    @Column(precision = 15, scale = 2)
    private BigDecimal amount;

    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumn(name = "expense_id")
    private Expense expense;
}
