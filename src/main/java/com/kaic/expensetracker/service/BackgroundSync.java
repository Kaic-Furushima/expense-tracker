package com.kaic.expensetracker.service;

import com.kaic.expensetracker.profile.ProfileService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Keeps time-based data up to date while the app is open: creates and (when enabled) pays recurring occurrences and
 * adds the automatic monthly contribution of fixed pots and empties what has been in the trash too long. Also makes the
 * daily automatic backup, when it is turned on. Runs once at startup (catching up after the app was closed for days)
 * and then every 15 minutes.
 */
@Component
@ConditionalOnProperty(name = "app.background-sync", havingValue = "true", matchIfMissing = true)
public class BackgroundSync {

    private static final Logger log = LoggerFactory.getLogger(BackgroundSync.class);

    private final RecurringService recurringService;
    private final PotService potService;
    private final TrashService trashService;
    private final ReminderNotifier reminderNotifier;
    private final ProfileService profiles;
    private final BackupService backupService;

    public BackgroundSync(RecurringService recurringService, PotService potService, TrashService trashService,
                          ReminderNotifier reminderNotifier, ProfileService profiles, BackupService backupService) {
        this.profiles = profiles;
        this.backupService = backupService;
        this.reminderNotifier = reminderNotifier;
        this.recurringService = recurringService;
        this.potService = potService;
        this.trashService = trashService;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onStartup() {
        run();
    }

    /** Reminders in the tray: soon after the window opens, then every 15 minutes (each one is shown only once). */
    @Scheduled(fixedDelay = 15 * 60 * 1000L, initialDelay = 20 * 1000L)
    public void remind() {
        try {
            reminderNotifier.notifyNew();
        } catch (RuntimeException e) {
            log.warn("Falha ao verificar lembretes", e);
        }
    }

    @Scheduled(fixedDelay = 15 * 60 * 1000L, initialDelay = 15 * 60 * 1000L)
    public void run() {
        profiles.forEach(profile -> {
            try {
                recurringService.sync();
                potService.sync();
                trashService.purgeExpired();
            } catch (RuntimeException e) {
                log.warn("Falha ao sincronizar pagamentos recorrentes e caixinhas do perfil {}", profile.name(), e);
            }
            try {
                backupService.automaticIfDue();
            } catch (RuntimeException e) {
                log.warn("Falha no backup automático do perfil {}", profile.name(), e);
            }
        });
    }
}
