package com.kaic.expensetracker.service;

import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

/**
 * "Limpar tudo": a full copy of the data goes to the trash (as one item, kept {@value TrashService#RETENTION_DAYS} days)
 * and the app goes back to what a fresh install has. Restoring that item brings every record back as it was. The copy is
 * the same JSON the phone's backup uses, so both apps handle it the same way (see {@link MobileBackupImporter}).
 */
@Service
public class TrashSnapshotService {

    public record Snapshot(Long id, String summary, LocalDateTime createdAt) {
    }

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final DefaultCategories.Seeder categorySeeder;

    public TrashSnapshotService(JdbcTemplate jdbc, PlatformTransactionManager transactions,
                                DefaultCategories.Seeder categorySeeder) {
        this.jdbc = jdbc;
        this.transaction = new TransactionTemplate(transactions);
        this.categorySeeder = categorySeeder;
    }

    public List<Snapshot> list() {
        return jdbc.query("select id, summary, created_at from trash_snapshots order by created_at desc",
                (rs, i) -> new Snapshot(rs.getLong("id"), rs.getString("summary"), rs.getTimestamp("created_at").toLocalDateTime()));
    }

    /** Saves a full copy in the trash, then leaves the app as a new install (main account, payment methods, categories). */
    public void trashEverything() {
        transaction.executeWithoutResult(status -> {
            saveSnapshot();
            MobileBackupImporter importer = new MobileBackupImporter(jdbc);
            importer.wipe();
            seedDefaults();
        });
    }

    /** Puts everything back as it was in the copy. What exists now is kept in the trash too, so nothing is lost. */
    public void restore(Long id) {
        transaction.executeWithoutResult(status -> {
            List<String> payload = jdbc.queryForList("select payload from trash_snapshots where id = ?", String.class, id);
            if (payload.isEmpty()) throw notFound(id);
            if (hasUserData()) saveSnapshot();
            new MobileBackupImporter(jdbc).restore(payload.get(0));
            jdbc.update("delete from trash_snapshots where id = ?", id);
        });
    }

    public void purge(Long id) {
        if (jdbc.update("delete from trash_snapshots where id = ?", id) == 0) throw notFound(id);
    }

    public void empty() {
        jdbc.update("delete from trash_snapshots");
    }

    public void purgeBefore(LocalDateTime before) {
        jdbc.update("delete from trash_snapshots where created_at < ?", Timestamp.valueOf(before));
    }

    private void saveSnapshot() {
        String payload = new MobileBackupImporter(jdbc).dump();
        jdbc.update("insert into trash_snapshots (created_at, summary, payload) values (?, ?, ?)",
                Timestamp.valueOf(LocalDateTime.now()), describe(), payload);
    }

    private long count(String sql) {
        Long n = jdbc.queryForObject(sql, Long.class);
        return n == null ? 0 : n;
    }

    /** "22 lançamentos · 5 contas · …": what the copy holds, so it can be recognised. */
    private String describe() {
        String[][] parts = {
                {"select count(*) from expenses where deleted_at is null", "lançamentos", "lançamento"},
                {"select count(*) from accounts", "contas", "conta"},
                {"select count(*) from categories", "categorias", "categoria"},
                {"select count(*) from budgets", "orçamentos", "orçamento"},
                {"select count(*) from recurring_payments", "recorrentes", "recorrente"},
                {"select count(*) from pots", "caixinhas", "caixinha"}};
        List<String> out = new java.util.ArrayList<>();
        for (String[] p : parts) {
            long n = count(p[0]);
            if (n > 0) out.add(n + " " + (n == 1 ? p[2] : p[1]));
        }
        return String.join(" · ", out);
    }

    /** Is there anything beyond what a new install already has? */
    private boolean hasUserData() {
        long n = 0;
        for (String table : new String[]{"expenses", "transfers", "budgets", "pots", "recurring_payments", "wish_items", "expense_templates"}) {
            n += count("select count(*) from " + table);
        }
        return n > 0 || count("select count(*) from accounts") > 1;
    }

    private void seedDefaults() {
        for (String method : new String[]{"Pix", "Débito", "Crédito", "Dinheiro", "Boleto", "Transferência"}) {
            jdbc.update("insert into payment_methods (name, uuid, updated_at) values (?, ?, ?)",
                    method, UUID.randomUUID().toString(), Timestamp.valueOf(LocalDateTime.now()));
        }
        jdbc.update("insert into accounts (name, type, color, icon, initial_balance, archived, uuid, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)",
                "Conta principal", "CHECKING", "#2F7D6D", "wallet", 0, false, UUID.randomUUID().toString(), Timestamp.valueOf(LocalDateTime.now()));
        categorySeeder.seed();
    }

    private static ResponseStatusException notFound(Long id) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "Item não encontrado na lixeira: " + id);
    }
}
