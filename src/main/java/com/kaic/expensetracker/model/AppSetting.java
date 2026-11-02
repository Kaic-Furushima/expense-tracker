package com.kaic.expensetracker.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

/** A simple key/value application setting (for example {@code autoPayRecurring}). */
@Entity
@Table(name = "app_settings")
@Getter
@Setter
public class AppSetting {

    @Id
    @Column(name = "setting_key", length = 60)
    private String key;

    @Column(name = "setting_value", nullable = false)
    private String value;
}
