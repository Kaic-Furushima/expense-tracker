package com.kaic.expensetracker.model;

import jakarta.persistence.*;
import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;

/** Where the money lives (Santander, Bradesco, wallet...). Every transaction belongs to exactly one account. */
@Entity
@Table(name = "accounts")
@Getter
@Setter
public class Account extends SyncEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @NotBlank(message = "Informe o nome da conta.")
    @Column(nullable = false, unique = true, length = 80)
    private String name;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(nullable = false, length = 20)
    private AccountType type = AccountType.CHECKING;

    @Column(length = 7)
    private String color;

    @Column(length = 16)
    private String icon;

    @Column(name = "initial_balance", nullable = false, precision = 15, scale = 2)
    private BigDecimal initialBalance = BigDecimal.ZERO;

    /**
     * When set, this account is a part of another one (for example a Nubank "caixinha"): its balance is kept
     * separate from the parent's available balance. Only one level is allowed.
     */
    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumn(name = "parent_id")
    private Account parent;

    /** Credit cards only: day of the month the invoice closes and the day it is due (1 to 31, clamped to the month). */
    @Column(name = "closing_day")
    private Integer closingDay;

    @Column(name = "due_day")
    private Integer dueDay;

    /** Archived accounts keep their history but are not offered for new transactions. */
    @Column(nullable = false)
    private boolean archived;
}
