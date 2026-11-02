package com.kaic.expensetracker.model;

public enum ExpenseStatus {
    /** Already happened: counts in balances and summaries. */
    PAID,
    /** Still to pay (or to receive): shown as "a pagar" and used only for the month forecast. */
    PENDING
}
