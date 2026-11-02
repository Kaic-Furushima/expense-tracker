package com.kaic.expensetracker;

import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.service.AccountService;
import com.kaic.expensetracker.service.BackupService;
import com.kaic.expensetracker.service.ExpenseService;
import com.kaic.expensetracker.service.SettingsService;
import com.kaic.expensetracker.service.TrashService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class BackupTest {

    @Autowired private BackupService backupService;
    @Autowired private ExpenseService expenseService;
    @Autowired private AccountService accountService;
    @Autowired private TrashService trashService;
    @Autowired private SettingsService settings;

    @BeforeEach
    void setUp() {
        expenseService.deleteAll();
        trashService.empty();
    }

    private void spend(String name) {
        Expense e = new Expense();
        e.setName(name);
        e.setAmount(new BigDecimal("12.34"));
        e.setDate(LocalDate.of(2026, 4, 1));
        e.setAccount(accountService.defaultAccount());
        expenseService.save(e);
    }

    private boolean has(String name) {
        return expenseService.findAll().stream().anyMatch(e -> e.getName().equals(name));
    }

    private List<BackupService.BackupInfo> automaticBackups() {
        return backupService.list().stream().filter(b -> b.name().endsWith("-auto.sql")).toList();
    }

    @Test
    void automaticBackupIsOffByDefaultAndIsMadeOncePerDay() {
        settings.remove(SettingsService.AUTO_BACKUP);
        automaticBackups().forEach(b -> backupService.delete(b.name()));

        backupService.automaticIfDue();
        assertEquals(0, automaticBackups().size(), "desligado por padrão: nada é copiado");

        settings.setBoolean(SettingsService.AUTO_BACKUP, true);
        backupService.automaticIfDue();
        backupService.automaticIfDue();
        assertEquals(1, automaticBackups().size(), "uma cópia por dia, não uma a cada verificação");

        settings.remove(SettingsService.AUTO_BACKUP);
    }

    @Test
    void restoringABackupBringsBackTheDataAsItWas() {
        spend("Antes do backup");
        BackupService.BackupInfo backup = backupService.create();
        assertTrue(backup.sizeBytes() > 0);
        assertTrue(backupService.list().stream().anyMatch(b -> b.name().equals(backup.name())));

        expenseService.deleteAll();
        trashService.empty();
        spend("Depois do backup");
        assertFalse(has("Antes do backup"));

        backupService.restoreSaved(backup.name());

        assertTrue(has("Antes do backup"));
        assertFalse(has("Depois do backup"));
        // the app keeps working after the restore, and a safety copy of what was there before was kept
        spend("Depois da restauracao");
        assertTrue(has("Depois da restauracao"));
        assertTrue(backupService.list().stream().anyMatch(b -> b.name().endsWith("-antes-de-restaurar.sql")));
    }

    @Test
    void aBackupFileThePersonPickedCanBeRestoredFromItsText() {
        spend("Do arquivo");
        String text = backupService.read(backupService.create().name());
        expenseService.deleteAll();
        trashService.empty();

        backupService.restoreContent("﻿" + text); // the desktop "save" adds a byte-order mark

        assertTrue(has("Do arquivo"));
    }

    @Test
    void aFileThatIsNotABackupIsRefusedAndTheDataStays() {
        spend("Fica");
        assertThrows(ResponseStatusException.class, () -> backupService.restoreContent("isto nao e um backup"));
        assertThrows(ResponseStatusException.class, () -> backupService.restoreContent(null));
        // looks like a backup but would run code
        String evil = "CREATE TABLE EXPENSES(ID INT);\nCREATE TABLE ACCOUNTS(ID INT);\nCREATE ALIAS EVIL AS 'void x() {}';";
        assertThrows(ResponseStatusException.class, () -> backupService.restoreContent(evil));
        // and one that is valid text but breaks half way: the data must come back
        String broken = "CREATE TABLE EXPENSES(ID INT);\nCREATE TABLE ACCOUNTS(ID INT);\nINSERT INTO NOPE VALUES(1);";
        assertThrows(ResponseStatusException.class, () -> backupService.restoreContent(broken));
        assertTrue(has("Fica"));
    }

    @Test
    void backupNamesCannotEscapeTheFolder() {
        assertThrows(ResponseStatusException.class, () -> backupService.read("../application.properties"));
        assertThrows(ResponseStatusException.class, () -> backupService.read("backup-1.sql"));
        assertThrows(ResponseStatusException.class, () -> backupService.delete("..\\x.sql"));
    }
}
