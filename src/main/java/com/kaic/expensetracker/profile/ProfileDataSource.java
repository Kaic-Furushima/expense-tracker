package com.kaic.expensetracker.profile;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.flywaydb.core.Flyway;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.datasource.AbstractDataSource;

import javax.sql.DataSource;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Hands every connection to the database of the current profile. The main profile is the original data source;
 * the others are H2 files under {@code <data>/profiles/<id>}, opened (and migrated) the first time they are used.
 */
public class ProfileDataSource extends AbstractDataSource {

    private static final Logger log = LoggerFactory.getLogger(ProfileDataSource.class);

    private final DataSource main;
    private final Path root;
    private final Map<String, HikariDataSource> others = new ConcurrentHashMap<>();

    public ProfileDataSource(DataSource main, Path root) {
        this.main = main;
        this.root = root;
    }

    @Override
    public Connection getConnection() throws SQLException {
        return forProfile(ProfileContext.current()).getConnection();
    }

    @Override
    public Connection getConnection(String username, String password) throws SQLException {
        return forProfile(ProfileContext.current()).getConnection(username, password);
    }

    public DataSource forProfile(String id) {
        if (ProfileContext.MAIN.equals(id)) {
            return main;
        }
        return others.computeIfAbsent(id, this::open);
    }

    public Path folderOf(String id) {
        return ProfileContext.MAIN.equals(id) ? root : root.resolve("profiles").resolve(id);
    }

    /** Only the built-in H2 database can hold several profiles. */
    public boolean supportsProfiles() {
        try (Connection c = main.getConnection()) {
            return c.getMetaData().getDatabaseProductName().toLowerCase().contains("h2");
        } catch (SQLException e) {
            return false;
        }
    }

    private HikariDataSource open(String id) {
        try {
            Files.createDirectories(folderOf(id));
        } catch (IOException e) {
            throw new IllegalStateException("Não foi possível criar a pasta do perfil", e);
        }
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:h2:file:" + folderOf(id).toAbsolutePath().toString().replace('\\', '/') + "/expenses;DB_CLOSE_DELAY=-1");
        config.setUsername("sa");
        config.setPassword("");
        config.setMaximumPoolSize(4);
        config.setMinimumIdle(0);
        config.setPoolName("profile-" + id);
        HikariDataSource ds = new HikariDataSource(config);
        try {
            migrate(ds);
        } catch (RuntimeException e) {
            ds.close();
            throw e;
        }
        log.info("Perfil {} aberto em {}", id, folderOf(id));
        return ds;
    }

    /** Brings a database up to the current schema. */
    public static void migrate(DataSource dataSource) {
        Flyway.configure().dataSource(dataSource).locations("classpath:db/migration")
                .baselineOnMigrate(true).baselineVersion("1").load().migrate();
    }

    public void close(String id) {
        HikariDataSource ds = others.remove(id);
        if (ds != null) {
            // DB_CLOSE_DELAY=-1 keeps H2 open after the pool closes; shut it down so the files are released
            try (Connection c = ds.getConnection(); java.sql.Statement s = c.createStatement()) {
                s.execute("SHUTDOWN");
            } catch (SQLException e) {
                log.warn("Não foi possível fechar o banco do perfil {}", id, e);
            }
            ds.close();
        }
    }

    public void closeAll() {
        new ArrayList<>(others.keySet()).forEach(this::close);
    }
}
