package com.kaic.expensetracker.model;

public enum PotEntryKind {
    /** Monthly fixed contribution added by the app. */
    AUTO,
    /** Contribution typed in by the user. */
    MANUAL,
    /** Money taken out of the pot. */
    WITHDRAWAL,
    /** Money used to buy a wish-list item. */
    PURCHASE
}
