package com.kaic.expensetracker.sync;

import com.kaic.expensetracker.profile.ProfileContext;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** Several profiles: each one syncs its own data, and the list of profiles itself is kept equal on every computer. */
class SyncProfilesTest {

    private static final String MAIN = ProfileContext.MAIN;

    private record Pair(MemoryHub hub, PcDevice a, PcDevice b) {
        void settle() {
            for (int i = 0; i < 2; i++) {
                a.service.syncNow();
                b.service.syncNow();
            }
        }
    }

    private static Pair connected() {
        MemoryHub hub = new MemoryHub();
        PcDevice a = new PcDevice().connectTo(hub);
        PcDevice b = new PcDevice().connectTo(hub);
        a.service.connect(a.login("senha-de-sync", true));
        b.service.connect(b.login("senha-de-sync", false));
        return new Pair(hub, a, b);
    }

    @Test
    void aProfileMadeOnOneComputerAppearsOnTheOtherWithItsOwnData() {
        Pair p = connected();
        String casa = p.a.profiles.create("Casa").id();
        p.a.spend(casa, "Luz da casa", "80.00");
        p.a.spend(MAIN, "Do principal", "5.00");
        p.settle();

        String onB = p.b.idByName("Casa");
        assertEquals(List.of("Luz da casa"), p.b.expenses(onB), "the data of the profile came along");
        assertEquals(List.of("Do principal"), p.b.expenses(MAIN), "and the profiles stay apart");
        assertEquals(p.a.profiles.syncIdOf(casa), p.b.profiles.syncIdOf(onB), "same identity on both");
    }

    @Test
    void renamesAndTheTrashTravel() {
        Pair p = connected();
        String id = p.a.profiles.create("Casa").id();
        p.settle();
        String onB = p.b.idByName("Casa");

        p.a.profiles.rename(id, "Apartamento");
        p.settle();
        assertEquals("Apartamento", p.b.profiles.list().stream().filter(x -> x.id().equals(onB)).findFirst().orElseThrow().name());

        p.a.profiles.remove(id); // first deletion: only to the trash, on both
        p.settle();
        assertFalse(p.b.profiles.exists(onB));
        assertEquals(List.of("Apartamento"), p.b.profiles.trashed().stream().map(t -> t.name()).toList());

        p.b.profiles.restore(onB); // restored on the other computer: comes back on both
        p.settle();
        assertTrue(p.a.profiles.exists(id));
        assertTrue(p.a.profiles.trashed().isEmpty());
    }

    @Test
    void deletingForGoodFromTheTrashDeletesEverywhere() {
        Pair p = connected();
        String id = p.a.profiles.create("Temporario").id();
        p.a.spend(id, "x", "1.00");
        p.settle();
        String onB = p.b.idByName("Temporario");
        assertEquals(List.of("x"), p.b.expenses(onB));

        p.a.profiles.remove(id);
        p.settle();
        p.a.profiles.purge(id);
        p.settle();

        assertFalse(p.b.profiles.existsAny(onB), "the official deletion reached the other computer");
        assertTrue(p.a.profiles.purged().isEmpty(), "and the tombstone was delivered");
        assertTrue(p.b.profiles.list().stream().noneMatch(x -> x.name().equals("Temporario")));
    }

    @Test
    void aProfileDeletedForGoodIsNotBroughtBackByTheOtherComputer() {
        Pair p = connected();
        String id = p.a.profiles.create("Fantasma").id();
        p.settle();
        p.a.profiles.remove(id);
        p.a.profiles.purge(id);
        p.settle();
        p.settle();
        assertTrue(p.a.profiles.list().stream().noneMatch(x -> x.name().equals("Fantasma")));
        assertTrue(p.b.profiles.list().stream().noneMatch(x -> x.name().equals("Fantasma")));
    }

    @Test
    void restoringABackupOverAProfileMakesTheCloudAndTheOtherComputerEqualToIt() {
        Pair p = connected();
        p.a.spend(MAIN, "antes 1", "1.00");
        p.a.spend(MAIN, "antes 2", "2.00");
        p.settle();
        assertEquals(List.of("antes 1", "antes 2"), p.b.expenses(MAIN));

        // what a restore does on A: the data becomes something else entirely (the backup's content)
        p.a.in(MAIN, () -> p.a.jdbc.update("delete from expenses"));
        p.a.spend(MAIN, "do backup", "9.00");
        p.a.service.forceOverwrite(MAIN);
        p.settle();

        assertEquals(List.of("do backup"), p.a.expenses(MAIN));
        assertEquals(List.of("do backup"), p.b.expenses(MAIN), "what the backup does not have was deleted on the other computer");
    }

    @Test
    void forceOverwriteBeatsEvenANewerEditMadeOnTheOtherComputer() {
        Pair p = connected();
        p.a.spend(MAIN, "original", "1.00");
        p.settle();
        // B edits afterwards (newer than anything A has)...
        p.b.in(MAIN, () -> p.b.jdbc.update("update expenses set name = 'editado no B', updated_at = ?",
                java.sql.Timestamp.valueOf(java.time.LocalDateTime.now().plusHours(1))));
        p.b.service.syncNow();
        // ...but A restores a backup over the profile: that wins
        p.a.in(MAIN, () -> p.a.jdbc.update("delete from expenses"));
        p.a.spend(MAIN, "restaurado", "3.00");
        p.a.service.forceOverwrite(MAIN);
        p.settle();

        assertEquals(List.of("restaurado"), p.b.expenses(MAIN));
    }
}
