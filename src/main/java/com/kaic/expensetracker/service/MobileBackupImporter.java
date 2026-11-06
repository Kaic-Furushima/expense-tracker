package com.kaic.expensetracker.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Reads the backup file the phone app makes ({@code {"app":"expense-tracker","tables":{...}}}) and writes it into this
 * database, replacing everything. The phone keeps money in cents, flags as 0/1 and moments as text; the computer has
 * decimals, booleans and timestamps, hence the conversions below. Row ids are kept, so the links between rows still hold.
 * Must run inside a transaction: any problem rolls everything back.
 */
final class MobileBackupImporter {

    static final String APP = "expense-tracker";

    private enum Kind { TEXT, INT, CENTS, BOOL, TS, DATE }

    /** {@code phone column -> computer column}, with the kind of value. */
    private record Col(String from, String to, Kind kind) {
    }

    private record Table(String name, List<Col> cols, boolean hasId) {
    }

    private static Col text(String n) { return new Col(n, n, Kind.TEXT); }
    private static Col num(String n) { return new Col(n, n, Kind.INT); }
    private static Col flag(String n) { return new Col(n, n, Kind.BOOL); }
    private static Col cents(String from, String to) { return new Col(from, to, Kind.CENTS); }
    private static Col ts(String n) { return new Col(n, n, Kind.TS); }
    private static Col date(String n) { return new Col(n, n, Kind.DATE); }

    private static Table table(String name, Col... cols) {
        List<Col> all = new ArrayList<>(List.of(cols));
        return new Table(name, all, !name.equals("expense_tags") && !name.equals("app_settings"));
    }

    private static final Col ID = num("id");
    private static final Col UUID_COL = text("uuid");
    private static final Col UPDATED = ts("updated_at");

    /** In the order rows can be written (whoever is pointed to comes first). */
    private static final List<Table> TABLES = List.of(
            table("categories", ID, UUID_COL, UPDATED, text("name"), text("icon"), text("color"), num("parent_id"), text("kind")),
            table("payment_methods", ID, UUID_COL, UPDATED, text("name")),
            table("accounts", ID, UUID_COL, UPDATED, text("name"), text("type"), text("color"), text("icon"),
                    cents("initial_cents", "initial_balance"), flag("archived"), num("parent_id"), num("closing_day"), num("due_day")),
            table("expenses", ID, UUID_COL, text("name"), text("description"), cents("amount_cents", "amount"), date("date"), text("type"),
                    text("status"), num("category_id"), num("account_id"), num("payment_method_id"), text("installment_group"),
                    num("installment_number"), num("installment_total"), ts("created_at"), UPDATED, ts("deleted_at"), flag("adjustment")),
            table("tags", ID, UUID_COL, UPDATED, text("name")),
            table("expense_tags", num("expense_id"), num("tag_id")),
            table("budgets", ID, UUID_COL, UPDATED, num("category_id"), text("from_month"), cents("amount_cents", "amount")),
            table("transfers", ID, UUID_COL, num("from_account_id"), num("to_account_id"), cents("amount_cents", "amount"), date("date"),
                    text("description"), text("invoice_month"), ts("created_at"), UPDATED, ts("deleted_at")),
            table("recurring_payments", ID, UUID_COL, UPDATED, text("name"), text("type"), cents("amount_cents", "amount"),
                    flag("variable_amount"), num("day_of_month"), num("account_id"), num("payment_method_id"), num("category_id"),
                    flag("active"), text("start_month"), text("end_month")),
            table("recurring_occurrences", ID, UUID_COL, UPDATED, num("recurring_id"), text("occurrence_month"), date("due_date"),
                    text("status"), date("paid_date"), cents("amount_cents", "amount"), num("expense_id")),
            table("pots", ID, UUID_COL, UPDATED, text("name"), text("color"), text("icon"), cents("goal_cents", "goal"), text("mode"),
                    cents("monthly_cents", "monthly_amount"), text("start_month"), flag("active"), num("account_id")),
            table("wish_items", ID, UUID_COL, UPDATED, text("name"), cents("estimated_cents", "estimated_price"), text("notes"), text("url"),
                    text("status"), num("pot_id"), cents("real_cents", "real_price"), date("purchase_date"), num("expense_id"),
                    date("created_at")),
            table("pot_entries", ID, UUID_COL, UPDATED, num("pot_id"), date("entry_date"), cents("amount_cents", "amount"), text("kind"),
                    text("note"), text("auto_month"), num("wish_item_id")),
            table("expense_templates", ID, UUID_COL, UPDATED, text("name"), text("type"), cents("amount_cents", "amount"),
                    num("category_id"), num("account_id"), num("payment_method_id"), text("description"), text("tags"), ts("created_at")),
            table("attachments", ID, UUID_COL, UPDATED, num("expense_id"), text("file_name"), text("content_type"), num("size_bytes"),
                    text("data"), ts("created_at")),
            table("app_settings", text("setting_key"), text("setting_value")));

    /** Columns that point to another row of the same table: filled after all rows exist. */
    private static final Map<String, String> SELF_REFERENCE = Map.of("categories", "parent_id", "accounts", "parent_id");

    private final JdbcTemplate jdbc;
    private final ObjectMapper json = new ObjectMapper();

    MobileBackupImporter(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    static boolean looksLikeJson(String content) {
        return content != null && content.replace("﻿", "").stripLeading().startsWith("{");
    }

    /** Replaces all the data with the file's content (inside the caller's transaction). */
    void restore(String content) {
        JsonNode root;
        try {
            root = json.readTree(content.replace("﻿", ""));
        } catch (Exception e) {
            throw invalid();
        }
        JsonNode tables = root == null ? null : root.get("tables");
        if (root == null || !APP.equals(root.path("app").asText()) || tables == null || !tables.isObject()) throw invalid();
        if (!tables.path("accounts").isArray() || tables.path("accounts").isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "O backup não tem nenhuma conta.");
        }

        for (int i = TABLES.size() - 1; i >= 0; i--) jdbc.update("delete from " + TABLES.get(i).name());
        Map<String, Long> nextId = new LinkedHashMap<>();
        for (Table t : TABLES) {
            JsonNode rows = tables.get(t.name());
            if (rows == null || !rows.isArray()) continue;
            long max = 0;
            for (JsonNode row : rows) max = Math.max(max, insert(t, row));
            if (t.hasId()) nextId.put(t.name(), max + 1);
        }
        linkParents();
        nextId.forEach((table, next) -> jdbc.execute("alter table " + table + " alter column id restart with " + next));
    }

    /** Writes one row and returns its id (0 when the table has none). */
    private long insert(Table t, JsonNode row) {
        List<String> columns = new ArrayList<>();
        List<Object> values = new ArrayList<>();
        String selfRef = SELF_REFERENCE.get(t.name());
        Object parent = null;
        LocalDateTime now = LocalDateTime.now();
        for (Col c : t.cols()) {
            JsonNode v = row.get(c.from());
            Object value = v == null || v.isNull() ? null : convert(c.kind(), v);
            if (c.to().equals("uuid") && value == null) value = UUID.randomUUID().toString();
            if (c.to().equals("updated_at") && value == null) value = row.hasNonNull("created_at") ? convert(Kind.TS, row.get("created_at")) : Timestamp.valueOf(now);
            if (c.to().equals("created_at") && value == null) value = rowMoment(row, now, c.kind());
            if (c.to().equals("kind") && value == null && t.name().equals("categories")) value = "EXPENSE";
            if (c.to().equals("type") && value == null && t.name().equals("expenses")) value = "EXPENSE";
            if (c.to().equals("status") && value == null && t.name().equals("expenses")) value = "PAID";
            if (c.to().equals(selfRef)) {
                parent = value;
                continue; // written below, once the parent exists
            }
            if (value == null) continue; // optional and empty: the column default applies
            columns.add(c.to());
            values.add(value);
        }
        jdbc.update("insert into " + t.name() + " (" + String.join(", ", columns) + ") values ("
                + String.join(", ", columns.stream().map(c -> "?").toList()) + ")", values.toArray());
        long id = row.path("id").asLong(0);
        if (parent != null) pendingParents.add(new Object[]{t.name(), selfRef, parent, id});
        return t.hasId() ? id : 0;
    }

    private final List<Object[]> pendingParents = new ArrayList<>();

    /** Second pass for rows that point to a row of the same table (sub-categories, sub-accounts). */
    private void linkParents() {
        for (Object[] p : pendingParents) jdbc.update("update " + p[0] + " set " + p[1] + " = ? where id = ?", p[2], p[3]);
        pendingParents.clear();
    }

    private Object rowMoment(JsonNode row, LocalDateTime now, Kind kind) {
        JsonNode updated = row.get("updated_at");
        Object base = updated == null || updated.isNull() ? Timestamp.valueOf(now) : convert(Kind.TS, updated);
        return kind == Kind.DATE ? Date.valueOf(((Timestamp) base).toLocalDateTime().toLocalDate()) : base;
    }

    private static Object convert(Kind kind, JsonNode v) {
        try {
            return switch (kind) {
                case TEXT -> v.asText();
                case INT -> v.asLong();
                case CENTS -> BigDecimal.valueOf(v.asLong(), 2);
                case BOOL -> v.isBoolean() ? v.asBoolean() : v.asLong() != 0;
                case TS -> {
                    String text = v.asText().replace(' ', 'T');
                    if (!text.contains("T")) text += "T00:00:00";
                    yield Timestamp.valueOf(LocalDateTime.parse(text.replaceAll("Z$", "")));
                }
                case DATE -> Date.valueOf(LocalDate.parse(v.asText().substring(0, 10)));
            };
        } catch (RuntimeException e) {
            throw invalid();
        }
    }

    private static ResponseStatusException invalid() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "Este arquivo não parece um backup deste aplicativo.");
    }
}
