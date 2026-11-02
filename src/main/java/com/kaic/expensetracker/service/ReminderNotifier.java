package com.kaic.expensetracker.service;

import com.kaic.expensetracker.profile.Messages;
import com.kaic.expensetracker.profile.ProfileService;
import com.kaic.expensetracker.ui.TrayNotifier;
import org.springframework.stereotype.Component;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Shows each new reminder once in the system tray (desktop window mode only), for every profile. */
@Component
public class ReminderNotifier {

    private static final int MAX_SEPARATE = 3;

    private final ReminderService reminders;
    private final ProfileService profiles;
    private final Messages messages;
    private final Set<String> alreadyShown = new HashSet<>();

    public ReminderNotifier(ReminderService reminders, ProfileService profiles, Messages messages) {
        this.messages = messages;
        this.reminders = reminders;
        this.profiles = profiles;
    }

    /** Checks every profile; with more than one, each notification says which profile it belongs to. */
    public synchronized void notifyNew() {
        if (!TrayNotifier.isInstalled()) {
            return;
        }
        boolean several = profiles.list().size() > 1;
        profiles.forEach(profile -> notifyProfile(profile, several ? profile.name() + ": " : ""));
    }

    private void notifyProfile(ProfileService.Profile profile, String prefix) {
        List<ReminderService.Reminder> fresh = reminders.current().stream()
                .filter(r -> r.level() != ReminderService.Level.INFO || r.kind().equals("DUE") || r.kind().equals("MONTH_END"))
                .filter(r -> !alreadyShown.contains(profile.id() + "/" + r.key()))
                .toList();
        if (fresh.isEmpty()) {
            return;
        }
        fresh.forEach(r -> alreadyShown.add(profile.id() + "/" + r.key()));
        if (fresh.size() <= MAX_SEPARATE) {
            fresh.forEach(r -> TrayNotifier.show(prefix + r.title(), r.detail()));
        } else {
            TrayNotifier.show(prefix + messages.t("Expense Tracker: {0} lembretes", fresh.size()),
                    fresh.stream().limit(3).map(ReminderService.Reminder::title).reduce((a, b) -> a + "\n" + b).orElse("")
                            + "\n" + messages.t("…abra o app para ver todos."));
        }
    }
}
