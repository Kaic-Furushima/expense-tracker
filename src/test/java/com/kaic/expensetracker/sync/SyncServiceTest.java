package com.kaic.expensetracker.sync;

import com.kaic.expensetracker.profile.ProfileContext;
import com.kaic.expensetracker.sync.SyncService.Connect;
import com.kaic.expensetracker.sync.SyncService.Status;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** The connection and automatic behaviour around the engines, against a hub in memory. */
class SyncServiceTest {

    @Test
    void connectsSyncsAndReportsTheState() {
        MemoryHub hub = new MemoryHub();
        PcDevice a = new PcDevice().connectTo(hub);
        Status before = a.service.status();
        assertTrue(before.available());
        assertFalse(before.configured());

        Status status = a.service.connect(a.login("senha-de-sync", true));
        assertTrue(status.configured());
        assertEquals("eu@exemplo.com", status.email());
        assertNotNull(status.lastSyncAt());
        assertNull(status.lastError());
        assertFalse(status.running());
    }

    @Test
    void theConnectionIsKeptOutsideTheProfilesAndNeverShown() {
        PcDevice a = new PcDevice().connectTo(new MemoryHub());
        a.service.connect(a.login("senha-de-sync", true));
        assertTrue(java.nio.file.Files.isRegularFile(a.dir.resolve("sync.json")));
        assertFalse(a.service.status().toString().contains("senha-de-sync"));
        assertEquals(0, a.count(ProfileContext.MAIN, "select count(*) from sync_state where state_key = 'cfg'"));
    }

    @Test
    void theSecondComputerGetsTheDataAndAWrongSyncPasswordIsRefused() {
        MemoryHub hub = new MemoryHub();
        PcDevice a = new PcDevice().connectTo(hub);
        PcDevice b = new PcDevice().connectTo(hub);
        a.spend(ProfileContext.MAIN, "Do primeiro", "5.00");
        a.service.connect(a.login("senha-de-sync", true));

        IllegalArgumentException wrong = assertThrows(IllegalArgumentException.class, () -> b.service.connect(b.login("outra-senha-aqui", false)));
        assertTrue(wrong.getMessage().contains("incorreta"));
        assertFalse(b.service.status().configured(), "nothing is kept when it fails");

        b.service.connect(b.login("senha-de-sync", false));
        assertEquals(List.of("Do primeiro"), b.expenses(ProfileContext.MAIN));
    }

    @Test
    void validatesTheForm() {
        PcDevice a = new PcDevice().connectTo(new MemoryHub());
        assertThrows(IllegalArgumentException.class, () -> a.service.connect(new Connect("", "k", "e@x", "p", "senha-de-sync", false, false)));
        assertThrows(IllegalArgumentException.class, () -> a.service.connect(a.login("curta", true)));
    }

    @Test
    void failuresAreRememberedAndTheNextTryWorks() {
        MemoryHub hub = new MemoryHub();
        PcDevice a = new PcDevice().connectTo(hub);
        a.service.connect(a.login("senha-de-sync", true));
        long first = a.service.status().lastSyncAt();

        hub.failNext = new IllegalStateException("Sem conexão com o servidor de sync.");
        Status failed = a.service.syncNow();
        assertNotNull(failed.lastError());
        assertEquals(first, failed.lastSyncAt(), "keeps the last good sync");
        assertNull(a.service.syncNow().lastError());
    }

    @Test
    void theAutomaticSwitchAndDisconnect() {
        MemoryHub hub = new MemoryHub();
        PcDevice a = new PcDevice().connectTo(hub);
        a.service.connect(a.login("senha-de-sync", true));
        assertFalse(a.service.setAuto(false).autoSync());

        a.spend(ProfileContext.MAIN, "Nao sobe sozinho", "1.00");
        a.service.maybeSync();
        assertTrue(hub.rows.values().stream().noneMatch(c -> c.table().equals("expenses")), "off: automatic does nothing");
        a.service.setAuto(true);
        a.service.maybeSync();
        assertTrue(hub.rows.values().stream().anyMatch(c -> c.table().equals("expenses")));

        Status off = a.service.disconnect();
        assertFalse(off.configured());
        assertEquals(1, a.count(ProfileContext.MAIN, "select count(*) from expenses"), "disconnecting keeps the data");
        assertThrows(IllegalStateException.class, a.service::syncNow);
    }

    @Test
    void theDefaultServerIsUsedOnlyWhenTheBuildHasOne() {
        PcDevice a = new PcDevice();
        MemoryHub hub = new MemoryHub();
        Connect viaDefault = new Connect(null, null, "eu@exemplo.com", "senha-conta", "senha-de-sync", true, true);

        SyncService without = new SyncService(a.jdbc, a.tx, a.profiles, a.store, cfg -> hub, "", "");
        assertFalse(without.status().central());
        IllegalArgumentException none = assertThrows(IllegalArgumentException.class, () -> without.connect(viaDefault));
        assertTrue(none.getMessage().contains("servidor padrão"));

        SyncService with = new SyncService(a.jdbc, a.tx, a.profiles, a.store, cfg -> {
            assertEquals("https://central.example", cfg.get("url"), "the build's address is used, not what the form sent");
            return hub;
        }, "https://central.example", "chave-publica");
        assertTrue(with.status().central());
        Status status = with.connect(viaDefault);
        assertEquals("central", status.mode());
        assertNull(status.url(), "the screen says \"Servidor padrão\" instead of an address");
    }
}
