package com.kaic.expensetracker.sync;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;

/**
 * The wire format of the rows that travel between devices; the phone has the same in {@code sync/tables.js}.
 * A row becomes a JSON object with the phone's column names; ids never travel (the row's uuid does), foreign keys travel
 * as the uuid of the row they point to (field name ending in {@code _uuid}), money in cents, booleans as 0/1, moments as
 * UTC millis and dates as "yyyy-MM-dd". The computer keeps money as decimals, hence the {@code column} that differs.
 */
public final class SyncTables {

    private SyncTables() {
    }

    public enum Kind { TEXT, INT, BOOL, CENTS, DATE, TS, DATE_AS_TS, FK }

    /** {@code wire} is the field in the payload, {@code column} the database column; {@code target} for foreign keys. */
    public record Col(String wire, String column, Kind kind, String target) {
        String payloadName() {
            return kind == Kind.FK ? wire.replaceAll("_id$", "_uuid") : wire;
        }
    }

    /** {@code natural}: wire names that make two rows "the same thing"; {@code naturalWhen}: only when that field is set. */
    public record Table(String name, List<Col> cols, List<String> natural, String naturalWhen, boolean tags) {
        public Col col(String wire) {
            return cols.stream().filter(c -> c.wire().equals(wire)).findFirst().orElseThrow();
        }
    }

    private static Col text(String n) { return new Col(n, n, Kind.TEXT, null); }
    private static Col integer(String n) { return new Col(n, n, Kind.INT, null); }
    private static Col bool(String n) { return new Col(n, n, Kind.BOOL, null); }
    private static Col cents(String wire, String column) { return new Col(wire, column, Kind.CENTS, null); }
    private static Col date(String n) { return new Col(n, n, Kind.DATE, null); }
    private static Col ts(String n) { return new Col(n, n, Kind.TS, null); }
    private static Col dateAsTs(String n) { return new Col(n, n, Kind.DATE_AS_TS, null); }
    private static Col fk(String n, String target) { return new Col(n, n, Kind.FK, target); }

    private static Table table(String name, List<Col> cols, List<String> natural, String naturalWhen, boolean tags) {
        return new Table(name, cols, natural, naturalWhen, tags);
    }

    /** In dependency order: whoever is referenced comes before who references it. */
    public static final List<Table> ALL = List.of(
            table("categories", List.of(text("name"), text("icon"), text("color"), text("kind"), fk("parent_id", "categories")),
                    List.of("name", "kind"), null, false),
            table("payment_methods", List.of(text("name")), List.of("name"), null, false),
            table("accounts", List.of(text("name"), text("type"), text("color"), text("icon"),
                    cents("initial_cents", "initial_balance"), bool("archived"), fk("parent_id", "accounts"),
                    integer("closing_day"), integer("due_day"), bool("saved"), text("currency")), List.of("name"), null, false),
            table("tags", List.of(text("name")), List.of("name"), null, false),
            table("expenses", List.of(text("name"), text("description"), cents("amount_cents", "amount"), date("date"),
                    text("type"), text("status"), fk("category_id", "categories"), fk("account_id", "accounts"),
                    fk("payment_method_id", "payment_methods"), text("installment_group"), integer("installment_number"),
                    integer("installment_total"), ts("created_at"), ts("deleted_at"), bool("adjustment")), null, null, true),
            table("budgets", List.of(fk("category_id", "categories"), text("from_month"), cents("amount_cents", "amount"), text("currency")),
                    List.of("category_id", "from_month"), null, false),
            table("transfers", List.of(fk("from_account_id", "accounts"), fk("to_account_id", "accounts"),
                    cents("amount_cents", "amount"), cents("to_amount_cents", "to_amount"), date("date"), text("description"), text("invoice_month"),
                    ts("created_at"), ts("deleted_at")), null, null, false),
            table("recurring_payments", List.of(text("name"), text("type"), cents("amount_cents", "amount"),
                    bool("variable_amount"), integer("day_of_month"), fk("account_id", "accounts"),
                    fk("payment_method_id", "payment_methods"), fk("category_id", "categories"), bool("active"),
                    text("start_month"), text("end_month")), null, null, false),
            table("recurring_occurrences", List.of(fk("recurring_id", "recurring_payments"), text("occurrence_month"),
                    date("due_date"), text("status"), date("paid_date"), cents("amount_cents", "amount"),
                    fk("expense_id", "expenses")), List.of("recurring_id", "occurrence_month"), null, false),
            table("pots", List.of(text("name"), text("color"), text("icon"), cents("goal_cents", "goal"), text("mode"),
                    cents("monthly_cents", "monthly_amount"), text("start_month"), bool("active"),
                    fk("account_id", "accounts"), text("currency")),
                    List.of("name"), null, false),
            table("wish_items", List.of(text("name"), cents("estimated_cents", "estimated_price"), text("notes"),
                    text("url"), text("status"), fk("pot_id", "pots"), cents("real_cents", "real_price"),
                    date("purchase_date"), fk("expense_id", "expenses"), dateAsTs("created_at"), text("currency")), null, null, false),
            table("pot_entries", List.of(fk("pot_id", "pots"), date("entry_date"), cents("amount_cents", "amount"),
                    text("kind"), text("note"), text("auto_month"), fk("wish_item_id", "wish_items")),
                    List.of("pot_id", "auto_month"), "auto_month", false),
            table("expense_templates", List.of(text("name"), text("type"), cents("amount_cents", "amount"),
                    fk("category_id", "categories"), fk("account_id", "accounts"),
                    fk("payment_method_id", "payment_methods"), text("description"), text("tags"), ts("created_at")),
                    null, null, false),
            table("attachments", List.of(fk("expense_id", "expenses"), text("file_name"), text("content_type"),
                    integer("size_bytes"), text("data"), ts("created_at")), null, null, false));

    public static Table byName(String name) {
        return ALL.stream().filter(t -> t.name().equals(name)).findFirst().orElseThrow(
                () -> new IllegalArgumentException("Tabela desconhecida no sync: " + name));
    }

    public static int order(String name) {
        for (int i = 0; i < ALL.size(); i++) if (ALL.get(i).name().equals(name)) return i;
        return Integer.MAX_VALUE;
    }

    // ---- conversions between database values and wire values (foreign keys are handled by the engine) ----

    static Object toWire(Col col, Object v) {
        if (v == null) return null;
        return switch (col.kind()) {
            case TEXT -> v.toString();
            case INT -> ((Number) v).longValue();
            case BOOL -> ((Boolean) v) ? 1 : 0;
            case CENTS -> ((BigDecimal) v).setScale(2, RoundingMode.HALF_UP).movePointRight(2).longValue();
            case DATE -> asLocalDate(v).toString();
            case TS -> asLocalDateTime(v).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
            case DATE_AS_TS -> asLocalDate(v).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli();
            case FK -> throw new IllegalStateException("chave estrangeira é tratada pelo motor");
        };
    }

    static Object fromWire(Col col, Object v) {
        if (v == null) return null;
        return switch (col.kind()) {
            case TEXT -> v.toString();
            case INT -> ((Number) v).longValue();
            case BOOL -> ((Number) v).longValue() != 0;
            case CENTS -> BigDecimal.valueOf(((Number) v).longValue(), 2);
            case DATE -> Date.valueOf(LocalDate.parse(v.toString()));
            case TS -> Timestamp.valueOf(fromMillis(((Number) v).longValue()));
            case DATE_AS_TS -> Date.valueOf(fromMillis(((Number) v).longValue()).toLocalDate());
            case FK -> throw new IllegalStateException("chave estrangeira é tratada pelo motor");
        };
    }

    static LocalDate asLocalDate(Object v) {
        if (v instanceof LocalDate d) return d;
        if (v instanceof Date d) return d.toLocalDate();
        if (v instanceof Timestamp t) return t.toLocalDateTime().toLocalDate();
        return LocalDate.parse(v.toString());
    }

    static LocalDateTime asLocalDateTime(Object v) {
        if (v instanceof LocalDateTime t) return t;
        if (v instanceof Timestamp t) return t.toLocalDateTime();
        throw new IllegalArgumentException("Não é um instante: " + v);
    }

    static long toMillis(LocalDateTime t) {
        return t.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
    }

    static LocalDateTime fromMillis(long ms) {
        return LocalDateTime.ofInstant(Instant.ofEpochMilli(ms), ZoneId.systemDefault());
    }
}
