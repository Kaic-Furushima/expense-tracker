package com.kaic.expensetracker.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.YearMonth;

/** A "caixinha": money set aside that grows month after month (automatically or by hand). */
@Entity
@Table(name = "pots")
@Getter
@Setter
public class Pot {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 80)
    private String name;

    @Column(length = 7)
    private String color;

    @Column(length = 16)
    private String icon;

    /** Optional target amount. */
    @Column(precision = 15, scale = 2)
    private BigDecimal goal;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.VARCHAR)
    @Column(nullable = false, length = 10)
    private PotMode mode = PotMode.VARIABLE;

    @Column(name = "monthly_amount", precision = 15, scale = 2)
    private BigDecimal monthlyAmount;

    @Column(name = "start_month", nullable = false, length = 7)
    private String startMonth;

    @Column(nullable = false)
    private boolean active = true;

    public YearMonth start() {
        return YearMonth.parse(startMonth);
    }
}
