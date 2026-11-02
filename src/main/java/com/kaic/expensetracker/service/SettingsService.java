package com.kaic.expensetracker.service;

import com.kaic.expensetracker.model.AppSetting;
import com.kaic.expensetracker.repository.AppSettingRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.YearMonth;
import java.util.Optional;
import java.util.Set;

@Service
@Transactional(readOnly = true)
public class SettingsService {

    /** When on, recurring payments are turned into transactions automatically on their due date. */
    public static final String AUTO_PAY_RECURRING = "autoPayRecurring";
    /** When on, what is left (or overspent) of a budget is carried to the next month. */
    public static final String BUDGET_ROLLOVER = "budgetRollover";
    /** Month the rollover started to count (yyyy-MM); earlier months do not feed the carry. */
    public static final String BUDGET_ROLLOVER_FROM = "budgetRolloverFrom";
    public static final String CURRENCY = "currency";
    public static final String REMINDERS_ENABLED = "remindersEnabled";
    public static final String REMINDER_DAYS = "reminderDays";
    /** When on, the database is copied once a day while the app runs (see {@link BackupService#automaticIfDue()}). */
    public static final String AUTO_BACKUP = "autoBackup";

    /** Display currencies (ISO 4217). Changing it only changes the symbol: values are not converted. */
    public static final Set<String> CURRENCIES = Set.of("BRL", "USD", "EUR", "GBP", "ARS", "CLP", "MXN", "JPY");
    public static final String DEFAULT_CURRENCY = "BRL";

    private final AppSettingRepository repository;

    public SettingsService(AppSettingRepository repository) {
        this.repository = repository;
    }

    public Optional<String> getString(String key) {
        return repository.findById(key).map(AppSetting::getValue);
    }

    @Transactional
    public void setString(String key, String value) {
        AppSetting setting = repository.findById(key).orElseGet(() -> {
            AppSetting s = new AppSetting();
            s.setKey(key);
            return s;
        });
        setting.setValue(value);
        repository.save(setting);
    }

    @Transactional
    public void remove(String key) {
        repository.findById(key).ifPresent(repository::delete);
    }

    public boolean getBoolean(String key, boolean defaultValue) {
        return getString(key).map(Boolean::parseBoolean).orElse(defaultValue);
    }

    @Transactional
    public void setBoolean(String key, boolean value) {
        setString(key, String.valueOf(value));
    }

    public boolean autoPayRecurring() {
        return getBoolean(AUTO_PAY_RECURRING, false);
    }

    public boolean budgetRollover() {
        return getBoolean(BUDGET_ROLLOVER, false);
    }

    /** Month the rollover started, present only while it is on. */
    public Optional<YearMonth> budgetRolloverFrom() {
        if (!budgetRollover()) {
            return Optional.empty();
        }
        return Optional.of(getString(BUDGET_ROLLOVER_FROM).map(YearMonth::parse).orElse(YearMonth.now()));
    }

    /** Turning it on starts counting at the current month, so past months do not suddenly produce a carry. */
    @Transactional
    public void setBudgetRollover(boolean on) {
        if (on && !budgetRollover()) {
            setString(BUDGET_ROLLOVER_FROM, YearMonth.now().toString());
        }
        setBoolean(BUDGET_ROLLOVER, on);
        if (!on) {
            remove(BUDGET_ROLLOVER_FROM);
        }
    }

    /** Off by default: a copy is only kept if the person turns it on. */
    public boolean autoBackup() {
        return getBoolean(AUTO_BACKUP, false);
    }

    public boolean remindersEnabled() {
        return getBoolean(REMINDERS_ENABLED, true);
    }

    /** How many days ahead bills are announced (1 to 15, default 3). */
    public int reminderDays() {
        try {
            return Math.max(1, Math.min(15, Integer.parseInt(getString(REMINDER_DAYS).orElse("3"))));
        } catch (NumberFormatException e) {
            return 3;
        }
    }

    @Transactional
    public void setReminderDays(int days) {
        if (days < 1 || days > 15) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Avise de 1 a 15 dias antes.");
        }
        setString(REMINDER_DAYS, String.valueOf(days));
    }

    public String currency() {
        return getString(CURRENCY).filter(CURRENCIES::contains).orElse(DEFAULT_CURRENCY);
    }

    @Transactional
    public void setCurrency(String code) {
        String upper = code == null ? "" : code.trim().toUpperCase();
        if (!CURRENCIES.contains(upper)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Moeda não suportada: " + code);
        }
        setString(CURRENCY, upper);
    }
}
