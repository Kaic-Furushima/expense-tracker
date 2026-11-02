package com.kaic.expensetracker.service;

import com.kaic.expensetracker.model.Account;
import com.kaic.expensetracker.model.AccountType;
import com.kaic.expensetracker.model.Category;
import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.model.ExpenseStatus;
import com.kaic.expensetracker.model.PaymentMethod;
import com.kaic.expensetracker.model.TransactionType;
import com.kaic.expensetracker.model.Transfer;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.Normalizer;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Imports transactions from a file: an OFX bank statement (F5), a bank/card CSV with a date, a description and an
 * amount (F5), or the CSV this app exports (F8). The flow has two steps: {@link #preview} reads the file and suggests
 * a category and duplicates for every line; {@link #commit} saves what the user kept.
 */
@Service
@Transactional(readOnly = true)
public class ImportService {

    public enum Format { OFX, APP_CSV, BANK_CSV }

    public static final int MAX_ROWS = 5000;
    private static final BigDecimal MAX_AMOUNT = new BigDecimal("999999999.99");

    /** One line of the file. {@code kind} is TRANSACTION or TRANSFER (transfers only come from the app's own CSV). */
    public record Row(int line, String kind, LocalDate date, TransactionType type, String name, BigDecimal amount,
                      Long categoryId, String categoryName, String accountName, String toAccountName,
                      String methodName, ExpenseStatus status, List<String> tags, String description,
                      boolean duplicate) {
        Row withSuggestion(Long id) {
            return new Row(line, kind, date, type, name, amount, id, categoryName, accountName, toAccountName,
                    methodName, status, tags, description, duplicate);
        }

        Row withCategory(Long id, String name) {
            return new Row(line, kind, date, type, this.name, amount, id, name, accountName, toAccountName,
                    methodName, status, tags, description, duplicate);
        }

        Row withDuplicate(boolean value) {
            return new Row(line, kind, date, type, name, amount, categoryId, categoryName, accountName, toAccountName,
                    methodName, status, tags, description, value);
        }

        public boolean kindIsTransfer() {
            return "TRANSFER".equals(kind);
        }
    }

    public record Preview(Format format, List<Row> rows, int duplicates) {
    }

    public record Result(int transactions, int transfers, int categoriesCreated) {
    }

    private final ExpenseService expenseService;
    private final TransferService transferService;
    private final AccountService accountService;
    private final CategoryService categoryService;
    private final PaymentMethodService paymentMethodService;
    private final TagService tagService;

    public ImportService(ExpenseService expenseService, TransferService transferService, AccountService accountService,
                         CategoryService categoryService, PaymentMethodService paymentMethodService,
                         TagService tagService) {
        this.expenseService = expenseService;
        this.transferService = transferService;
        this.accountService = accountService;
        this.categoryService = categoryService;
        this.paymentMethodService = paymentMethodService;
        this.tagService = tagService;
    }

    /* ------------------------------------------------------------------ preview */

    /**
     * Reads the file. {@code accountId} is the account that receives the lines of a bank statement (not needed for the
     * app's own CSV, which names the accounts); {@code invertSigns} swaps expense and income for every line, for banks
     * that export purchases as positive numbers.
     */
    public Preview preview(String content, Long accountId, boolean invertSigns) {
        String text = content == null ? "" : content.replace("﻿", "").trim();
        if (text.isEmpty()) {
            throw bad("O arquivo está vazio.");
        }
        Format format;
        List<Row> rows;
        if (text.regionMatches(true, 0, "OFXHEADER", 0, 9) || text.toUpperCase(Locale.ROOT).contains("<OFX>")
                || text.toUpperCase(Locale.ROOT).contains("<STMTTRN>")) {
            format = Format.OFX;
            rows = parseOfx(text, invertSigns);
        } else {
            List<List<String>> table = parseCsv(text);
            if (isAppCsv(table)) {
                format = Format.APP_CSV;
                rows = parseAppCsv(table);
            } else {
                format = Format.BANK_CSV;
                rows = parseBankCsv(table, invertSigns);
            }
        }
        if (rows.isEmpty()) {
            throw bad("Não encontrei nenhum lançamento neste arquivo.");
        }
        if (rows.size() > MAX_ROWS) {
            throw bad("O arquivo tem lançamentos demais (máximo de " + MAX_ROWS + " por vez).");
        }
        if (format != Format.APP_CSV) {
            if (accountId == null) {
                throw bad("Escolha a conta que vai receber os lançamentos.");
            }
            accountService.getOrThrow(accountId);
        }
        List<Row> enriched = markDuplicates(suggest(rows), format == Format.APP_CSV ? null : accountId, format);
        return new Preview(format, enriched, (int) enriched.stream().filter(Row::duplicate).count());
    }

    private List<Row> suggest(List<Row> rows) {
        List<Category> categories = categoryService.findAll();
        CategorySuggester suggester = new CategorySuggester(expenseService.findAll(), categories);
        List<Row> result = new ArrayList<>();
        for (Row row : rows) {
            if (row.kindIsTransfer()) {
                result.add(row);
                continue;
            }
            Category existing = row.categoryName() == null ? null : categories.stream()
                    .filter(c -> c.getName().equalsIgnoreCase(row.categoryName())).findFirst().orElse(null);
            if (existing != null) {
                result.add(row.withCategory(existing.getId(), existing.getName()));
            } else if (row.categoryName() != null && !row.categoryName().isBlank()) {
                result.add(row); // the app's own CSV names a category that does not exist yet: it will be created
            } else {
                result.add(row.withSuggestion(suggester.suggest(row.name(), row.type())));
            }
        }
        return result;
    }

    /** A line is a probable duplicate when an equal transaction already exists (same account, day, amount and kind). */
    private List<Row> markDuplicates(List<Row> rows, Long fixedAccountId, Format format) {
        Map<String, Integer> existing = new HashMap<>();
        for (Expense e : expenseService.findAll()) {
            existing.merge(key(e.getAccount().getId(), e.getDate(), e.getAmount(), e.getType().name(),
                    format == Format.APP_CSV ? normalize(e.getName()) : ""), 1, Integer::sum);
        }
        for (var t : transferService.findAll()) {
            existing.merge(transferKey(t.getFromAccount().getName(), t.getToAccount().getName(), t.getDate(), t.getAmount()), 1, Integer::sum);
        }
        Map<String, Account> accounts = new HashMap<>();
        accountService.findAll().forEach(a -> accounts.put(a.getName().toLowerCase(Locale.ROOT), a));
        List<Row> result = new ArrayList<>();
        for (Row row : rows) {
            if (row.kindIsTransfer()) {
                String transferKey = transferKey(row.accountName(), row.toAccountName(), row.date(), row.amount());
                Integer left = existing.get(transferKey);
                if (left != null && left > 0) {
                    existing.put(transferKey, left - 1);
                    result.add(row.withDuplicate(true));
                } else {
                    result.add(row);
                }
                continue;
            }
            Long account = fixedAccountId != null ? fixedAccountId : idOf(accounts.get(lower(row.accountName())));
            String key = account == null ? null : key(account, row.date(), row.amount(), row.type().name(),
                    format == Format.APP_CSV ? normalize(row.name()) : "");
            Integer left = key == null ? null : existing.get(key);
            if (left != null && left > 0) {
                existing.put(key, left - 1); // each existing transaction explains only one line of the file
                result.add(row.withDuplicate(true));
            } else {
                result.add(row);
            }
        }
        return result;
    }

    private static String key(Long accountId, LocalDate date, BigDecimal amount, String type, String name) {
        return accountId + "|" + date + "|" + amount.setScale(2, RoundingMode.HALF_UP).toPlainString() + "|" + type + "|" + name;
    }

    private static String transferKey(String from, String to, LocalDate date, BigDecimal amount) {
        return "T|" + lower(from) + "|" + lower(to) + "|" + date + "|" + amount.setScale(2, RoundingMode.HALF_UP).toPlainString();
    }

    private static Long idOf(Account account) {
        return account == null ? null : account.getId();
    }

    /* ------------------------------------------------------------------ commit */

    /** Saves the given lines (all or nothing). Bank-statement lines go to {@code accountId}. */
    @Transactional
    public Result commit(List<Row> rows, Long accountId) {
        if (rows == null || rows.isEmpty()) {
            throw bad("Nenhum lançamento foi selecionado.");
        }
        if (rows.size() > MAX_ROWS) {
            throw bad("São lançamentos demais de uma vez (máximo de " + MAX_ROWS + ").");
        }
        int transactions = 0, transfers = 0;
        int categoriesBefore = categoryService.findAll().size();
        Map<String, Category> createdCategories = new HashMap<>();
        for (Row row : rows) {
            try {
                if (row.kindIsTransfer()) {
                    saveTransfer(row);
                    transfers++;
                } else {
                    saveTransaction(row, accountId, createdCategories);
                    transactions++;
                }
            } catch (ResponseStatusException e) {
                throw bad("Linha " + row.line() + ": " + e.getReason());
            }
        }
        return new Result(transactions, transfers, categoryService.findAll().size() - categoriesBefore);
    }

    private void saveTransaction(Row row, Long accountId, Map<String, Category> created) {
        validate(row);
        Account account = row.accountName() != null && !row.accountName().isBlank()
                ? accountService.findOrCreate(row.accountName(), AccountType.CHECKING, null)
                : accountId == null ? accountService.defaultAccount() : accountService.getOrThrow(accountId);
        Category category = null;
        if (row.categoryId() != null) {
            category = categoryService.getOrThrow(row.categoryId());
        } else if (row.categoryName() != null && !row.categoryName().isBlank()) {
            category = created.computeIfAbsent(row.categoryName().toLowerCase(Locale.ROOT),
                    k -> categoryService.findOrCreate(row.categoryName(), null, null));
        }
        PaymentMethod method = null;
        if (row.methodName() != null && !row.methodName().isBlank()) {
            method = paymentMethodService.findAll().stream()
                    .filter(m -> m.getName().equalsIgnoreCase(row.methodName().trim())).findFirst()
                    .orElseGet(() -> paymentMethodService.create(row.methodName()));
        }
        Expense e = new Expense();
        e.setName(truncate(row.name() == null || row.name().isBlank() ? "Sem descrição" : row.name().trim(), 120));
        e.setDescription(row.description() == null || row.description().isBlank() ? null : truncate(row.description().trim(), 255));
        e.setAmount(row.amount().setScale(2, RoundingMode.HALF_UP));
        e.setDate(row.date());
        e.setType(row.type() == null ? TransactionType.EXPENSE : row.type());
        e.setStatus(row.status() == null ? ExpenseStatus.PAID : row.status());
        e.setCategory(category);
        e.setAccount(account);
        e.setPaymentMethod(method);
        e.getTags().addAll(tagService.resolve(row.tags()));
        expenseService.save(e);
    }

    private void saveTransfer(Row row) {
        validate(row);
        if (row.accountName() == null || row.toAccountName() == null || row.accountName().isBlank() || row.toAccountName().isBlank()) {
            throw bad("a transferência precisa da conta de origem e da de destino.");
        }
        Account from = accountService.findOrCreate(row.accountName(), AccountType.CHECKING, null);
        Account to = accountService.findOrCreate(row.toAccountName(), AccountType.CHECKING, null);
        transferService.create(new TransferService.Draft(from.getId(), to.getId(), row.amount(), row.date(), row.description() != null
                ? row.description() : row.name()));
    }

    private static void validate(Row row) {
        if (row.date() == null || row.date().getYear() < 2000 || row.date().getYear() > 2100) {
            throw bad("a data deve estar entre os anos 2000 e 2100.");
        }
        if (row.amount() == null || row.amount().compareTo(new BigDecimal("0.01")) < 0 || row.amount().compareTo(MAX_AMOUNT) > 0) {
            throw bad("o valor deve estar entre 0,01 e 999.999.999,99.");
        }
    }

    /* ------------------------------------------------------------------ OFX */

    private static final Pattern OFX_BLOCK = Pattern.compile("<STMTTRN>(.*?)(?=</STMTTRN>|<STMTTRN>|</BANKTRANLIST>|</CCSTMTTRNRS>|$)",
            Pattern.CASE_INSENSITIVE | Pattern.DOTALL);

    static List<Row> parseOfx(String text, boolean invert) {
        List<Row> rows = new ArrayList<>();
        Matcher blocks = OFX_BLOCK.matcher(text);
        int line = 0;
        while (blocks.find()) {
            line++;
            String block = blocks.group(1);
            String posted = ofxValue(block, "DTPOSTED");
            String amountText = ofxValue(block, "TRNAMT");
            if (posted == null || amountText == null) {
                continue;
            }
            LocalDate date;
            try {
                date = LocalDate.parse(posted.replaceAll("\\D", "").substring(0, 8), DateTimeFormatter.BASIC_ISO_DATE);
            } catch (DateTimeParseException | StringIndexOutOfBoundsException e) {
                continue;
            }
            BigDecimal signed = parseAmount(amountText);
            if (signed == null || signed.signum() == 0) {
                continue;
            }
            String memo = ofxValue(block, "MEMO");
            String name = memo != null && !memo.isBlank() ? memo : ofxValue(block, "NAME");
            rows.add(bankRow(line, date, signed.signum() < 0 != invert ? TransactionType.EXPENSE : TransactionType.INCOME,
                    name, signed.abs(), null));
        }
        return rows;
    }

    private static String ofxValue(String block, String tag) {
        Matcher m = Pattern.compile("<" + tag + ">([^<\\r\\n]*)", Pattern.CASE_INSENSITIVE).matcher(block);
        return m.find() ? m.group(1).trim() : null;
    }

    /* ------------------------------------------------------------------ CSV */

    private static final List<String> DATE_HEADERS = List.of("data", "date", "data lancamento", "data da compra", "data de lancamento", "dt");
    private static final List<String> NAME_HEADERS = List.of("descricao", "title", "titulo", "estabelecimento", "historico",
            "lancamento", "memo", "detalhes", "description", "nome", "name");
    private static final List<String> AMOUNT_HEADERS = List.of("valor", "amount", "valor (r$)", "quantia", "value");
    private static final List<String> CREDIT_HEADERS = List.of("credito", "credit", "entrada", "entradas");
    private static final List<String> DEBIT_HEADERS = List.of("debito", "debit", "saida", "saidas");

    private static boolean isAppCsv(List<List<String>> table) {
        if (table.isEmpty()) {
            return false;
        }
        List<String> head = table.get(0).stream().map(ImportService::headerKey).toList();
        return head.size() >= 5 && head.get(0).equals("data") && head.get(1).equals("tipo") && head.get(2).equals("nome")
                && head.contains("valor");
    }

    private static List<Row> parseAppCsv(List<List<String>> table) {
        Map<String, Integer> col = columns(table.get(0));
        List<Row> rows = new ArrayList<>();
        for (int i = 1; i < table.size(); i++) {
            List<String> r = table.get(i);
            if (r.stream().allMatch(String::isBlank)) {
                continue;
            }
            LocalDate date = parseDate(cell(r, col, "data"));
            BigDecimal amount = parseAmount(cell(r, col, "valor"));
            String kind = cell(r, col, "tipo").toUpperCase(Locale.ROOT);
            if (date == null || amount == null || !List.of("EXPENSE", "INCOME", "TRANSFER").contains(kind)) {
                throw bad("Linha " + (i + 1) + ": data, tipo ou valor inválidos.");
            }
            String situation = cell(r, col, "situacao").toUpperCase(Locale.ROOT);
            ExpenseStatus status = situation.equals("A_PAGAR") ? ExpenseStatus.PENDING : ExpenseStatus.PAID;
            List<String> tags = cell(r, col, "tags").isBlank() ? List.of()
                    : List.of(cell(r, col, "tags").trim().split("\\s+"));
            boolean transfer = kind.equals("TRANSFER");
            rows.add(new Row(i + 1, transfer ? "TRANSFER" : "TRANSACTION", date,
                    kind.equals("INCOME") ? TransactionType.INCOME : TransactionType.EXPENSE,
                    cell(r, col, "nome"), amount.abs(), null, blankToNull(cell(r, col, "categoria")),
                    blankToNull(cell(r, col, "conta")), transfer ? blankToNull(cell(r, col, "conta_destino")) : null,
                    blankToNull(cell(r, col, "forma_pagamento")), status, tags, blankToNull(cell(r, col, "descricao")), false));
        }
        return rows;
    }

    private static List<Row> parseBankCsv(List<List<String>> table, boolean invert) {
        int headerRow = -1;
        for (int i = 0; i < Math.min(table.size(), 30); i++) {
            List<String> keys = table.get(i).stream().map(ImportService::headerKey).toList();
            if (find(keys, DATE_HEADERS) >= 0 && (find(keys, AMOUNT_HEADERS) >= 0
                    || (find(keys, CREDIT_HEADERS) >= 0 || find(keys, DEBIT_HEADERS) >= 0))) {
                headerRow = i;
                break;
            }
        }
        if (headerRow < 0) {
            throw bad("Não reconheci as colunas deste arquivo. Ele precisa ter, no mínimo, colunas de data e de valor "
                    + "(e de preferência a descrição). Se for um extrato OFX, use o arquivo .ofx.");
        }
        List<String> keys = table.get(headerRow).stream().map(ImportService::headerKey).toList();
        int dateCol = find(keys, DATE_HEADERS), nameCol = find(keys, NAME_HEADERS), amountCol = find(keys, AMOUNT_HEADERS);
        int creditCol = find(keys, CREDIT_HEADERS), debitCol = find(keys, DEBIT_HEADERS);

        record Parsed(int line, LocalDate date, BigDecimal signed, String name) {
        }
        List<Parsed> parsed = new ArrayList<>();
        for (int i = headerRow + 1; i < table.size(); i++) {
            List<String> r = table.get(i);
            LocalDate date = parseDate(get(r, dateCol));
            if (date == null) {
                continue; // blank lines, totals, notes
            }
            BigDecimal signed;
            if (amountCol >= 0 && parseAmount(get(r, amountCol)) != null) {
                signed = parseAmount(get(r, amountCol));
            } else {
                BigDecimal credit = creditCol >= 0 ? parseAmount(get(r, creditCol)) : null;
                BigDecimal debit = debitCol >= 0 ? parseAmount(get(r, debitCol)) : null;
                signed = credit != null && credit.signum() != 0 ? credit.abs() : debit != null ? debit.abs().negate() : null;
            }
            if (signed == null || signed.signum() == 0) {
                continue;
            }
            parsed.add(new Parsed(i + 1, date, signed, get(r, nameCol)));
        }
        // Statements use negative numbers for money out; card exports often list purchases as positive numbers.
        boolean anyNegative = parsed.stream().anyMatch(p -> p.signed().signum() < 0);
        boolean separateColumns = amountCol < 0;
        List<Row> rows = new ArrayList<>();
        for (Parsed p : parsed) {
            boolean expense = separateColumns || anyNegative ? p.signed().signum() < 0 : true;
            rows.add(bankRow(p.line(), p.date(), expense != invert ? TransactionType.EXPENSE : TransactionType.INCOME,
                    p.name(), p.signed().abs(), null));
        }
        return rows;
    }

    private static Row bankRow(int line, LocalDate date, TransactionType type, String name, BigDecimal amount, String category) {
        return new Row(line, "TRANSACTION", date, type, name == null || name.isBlank() ? "Sem descrição" : name.trim(),
                amount.setScale(2, RoundingMode.HALF_UP), null, category, null, null, null, ExpenseStatus.PAID, List.of(), null, false);
    }

    private static Map<String, Integer> columns(List<String> header) {
        Map<String, Integer> result = new LinkedHashMap<>();
        for (int i = 0; i < header.size(); i++) {
            result.putIfAbsent(headerKey(header.get(i)), i);
        }
        return result;
    }

    private static String cell(List<String> row, Map<String, Integer> col, String name) {
        Integer i = col.get(name);
        if (i == null || i >= row.size()) {
            return "";
        }
        String value = row.get(i).trim();
        // The export prefixes an apostrophe to cells that start with = + - @ or a tab (spreadsheet formula protection).
        return value.length() > 1 && value.charAt(0) == '\'' && "=+-@\t".indexOf(value.charAt(1)) >= 0 ? value.substring(1) : value;
    }

    private static String get(List<String> row, int index) {
        return index < 0 || index >= row.size() ? "" : row.get(index).trim();
    }

    private static int find(List<String> keys, List<String> wanted) {
        for (String w : wanted) {
            int i = keys.indexOf(w);
            if (i >= 0) {
                return i;
            }
        }
        return -1;
    }

    private static String headerKey(String header) {
        return normalize(header == null ? "" : header).replaceAll("[^a-z0-9_() $]", "").trim();
    }

    /** Splits CSV text into rows of cells (quoted cells may contain the delimiter, quotes and line breaks). */
    static List<List<String>> parseCsv(String text) {
        // The delimiter is the one used most in the first lines (statements often start with a title line)
        String sample = String.join(" ", text.lines().limit(15).toList());
        long semicolons = sample.chars().filter(c -> c == ';').count();
        long commas = sample.chars().filter(c -> c == ',').count();
        long tabs = sample.chars().filter(c -> c == '\t').count();
        char delimiter = semicolons >= commas && semicolons >= tabs && semicolons > 0 ? ';' : tabs > commas ? '\t' : ',';
        List<List<String>> table = new ArrayList<>();
        List<String> row = new ArrayList<>();
        StringBuilder cell = new StringBuilder();
        boolean quoted = false;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (quoted) {
                if (c == '"') {
                    if (i + 1 < text.length() && text.charAt(i + 1) == '"') {
                        cell.append('"');
                        i++;
                    } else {
                        quoted = false;
                    }
                } else {
                    cell.append(c);
                }
            } else if (c == '"') {
                quoted = true;
            } else if (c == delimiter) {
                row.add(cell.toString());
                cell.setLength(0);
            } else if (c == '\n' || c == '\r') {
                if (c == '\r' && i + 1 < text.length() && text.charAt(i + 1) == '\n') {
                    i++;
                }
                row.add(cell.toString());
                cell.setLength(0);
                table.add(row);
                row = new ArrayList<>();
            } else {
                cell.append(c);
            }
        }
        if (cell.length() > 0 || !row.isEmpty()) {
            row.add(cell.toString());
            table.add(row);
        }
        return table;
    }

    /* ------------------------------------------------------------------ values */

    private static final DateTimeFormatter[] DATE_FORMATS = {
            DateTimeFormatter.ofPattern("d/M/uuuu"), DateTimeFormatter.ofPattern("uuuu-M-d"),
            DateTimeFormatter.ofPattern("d-M-uuuu"), DateTimeFormatter.ofPattern("d/M/uu"),
            DateTimeFormatter.ofPattern("uuuu/M/d"), DateTimeFormatter.ofPattern("d.M.uuuu")};

    public static LocalDate parseDate(String text) {
        if (text == null || text.isBlank()) {
            return null;
        }
        String t = text.trim();
        if (t.length() > 10 && Character.isDigit(t.charAt(0))) {
            t = t.split("[ T]")[0];
        }
        for (DateTimeFormatter f : DATE_FORMATS) {
            try {
                return LocalDate.parse(t, f);
            } catch (DateTimeParseException ignored) {
                // try the next format
            }
        }
        return null;
    }

    /** Accepts "1.234,56", "1234,56", "-45.90", "R$ 12,00", "(12,00)". Returns null when it is not a number. */
    public static BigDecimal parseAmount(String text) {
        if (text == null) {
            return null;
        }
        String t = text.trim().replace("R$", "").replace(" ", "").replace(" ", "");
        boolean negative = t.startsWith("(") && t.endsWith(")") || t.endsWith("-") && t.length() > 1;
        t = t.replaceAll("[()]", "");
        if (t.endsWith("-")) {
            t = t.substring(0, t.length() - 1);
        }
        if (t.isEmpty() || !t.matches("[+-]?[\\d.,]+")) {
            return null;
        }
        int comma = t.lastIndexOf(','), dot = t.lastIndexOf('.');
        if (comma >= 0 && dot >= 0) {
            t = comma > dot ? t.replace(".", "").replace(',', '.') : t.replace(",", "");
        } else if (comma >= 0) {
            t = t.replace(".", "").replace(',', '.');
        } else if (t.matches("[+-]?\\d{1,3}(\\.\\d{3}){2,}")) {
            t = t.replace(".", ""); // 1.234.567 can only be thousands
        }
        try {
            BigDecimal value = new BigDecimal(t).setScale(2, RoundingMode.HALF_UP);
            return negative ? value.negate() : value;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    static String normalize(String text) {
        if (text == null) {
            return "";
        }
        return Normalizer.normalize(text, Normalizer.Form.NFD).replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT).trim();
    }

    private static String lower(String text) {
        return text == null ? "" : text.toLowerCase(Locale.ROOT);
    }

    private static String blankToNull(String text) {
        return text == null || text.isBlank() ? null : text.trim();
    }

    private static String truncate(String text, int max) {
        return text.length() <= max ? text : text.substring(0, max);
    }

    private static ResponseStatusException bad(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }

    /* ------------------------------------------------------------------ category suggestions */

    /**
     * Suggests a category from what the user already did (the same description, then the same first word) and, as
     * a last resort, from a few well-known merchants and words matched to categories that exist.
     */
    static final class CategorySuggester {

        private static final Map<String, List<String>> KEYWORDS = new LinkedHashMap<>();

        static {
            KEYWORDS.put("transporte", List.of("uber", "99", "taxi", "posto", "ipiranga", "shell", "combustivel", "estacionamento", "pedagio", "onibus", "metro"));
            KEYWORDS.put("mercado", List.of("mercado", "supermercado", "atacad", "carrefour", "assai", "hortifruti", "sacolao"));
            KEYWORDS.put("alimentacao", List.of("ifood", "restaurante", "lanchonete", "pizza", "burger", "padaria", "cafe", "sorvete", "acai", "rappi"));
            KEYWORDS.put("saude", List.of("farmacia", "drogaria", "drogasil", "raia", "hospital", "clinica", "dentista", "laboratorio"));
            KEYWORDS.put("assinaturas", List.of("netflix", "spotify", "prime", "disney", "hbo", "youtube", "apple", "icloud", "deezer"));
            KEYWORDS.put("lazer", List.of("cinema", "steam", "playstation", "xbox", "ingresso", "show", "teatro"));
            KEYWORDS.put("educacao", List.of("escola", "faculdade", "curso", "udemy", "livraria", "mensalidade"));
            KEYWORDS.put("moradia", List.of("aluguel", "condominio", "energia", "enel", "cemig", "sabesp", "internet", "vivo", "claro", "gas"));
            KEYWORDS.put("salario", List.of("salario", "pagamento de salario", "folha"));
        }

        private final Map<String, Map<Long, Integer>> byName = new HashMap<>();
        private final Map<String, Map<Long, Integer>> byFirstWord = new HashMap<>();
        private final Map<String, Long> categoriesByNormalizedName = new HashMap<>();

        CategorySuggester(List<Expense> history, List<Category> categories) {
            categories.forEach(c -> categoriesByNormalizedName.put(normalize(c.getName()), c.getId()));
            for (Expense e : history) {
                if (e.getCategory() == null) {
                    continue;
                }
                String key = simplify(e.getName());
                if (key.isEmpty()) {
                    continue;
                }
                byName.computeIfAbsent(key, k -> new HashMap<>()).merge(e.getCategory().getId(), 1, Integer::sum);
                String first = firstWord(key);
                if (first.length() >= 4) {
                    byFirstWord.computeIfAbsent(first, k -> new HashMap<>()).merge(e.getCategory().getId(), 1, Integer::sum);
                }
            }
        }

        Long suggest(String name, TransactionType type) {
            String key = simplify(name);
            if (key.isEmpty()) {
                return null;
            }
            Long best = most(byName.get(key));
            if (best == null) {
                best = most(byFirstWord.get(firstWord(key)));
            }
            if (best != null) {
                return best;
            }
            for (Map.Entry<String, List<String>> entry : KEYWORDS.entrySet()) {
                Long category = categoriesByNormalizedName.get(entry.getKey());
                if (category == null || (type == TransactionType.INCOME) != entry.getKey().equals("salario")) {
                    continue;
                }
                for (String word : entry.getValue()) {
                    if (Pattern.compile("\\b" + Pattern.quote(word)).matcher(key).find()) {
                        return category;
                    }
                }
            }
            return null;
        }

        private static Long most(Map<Long, Integer> counts) {
            return counts == null ? null : counts.entrySet().stream()
                    .max(Map.Entry.comparingByValue()).map(Map.Entry::getKey).orElse(null);
        }

        /** Lowercase, no accents, digits or punctuation: "UBER *TRIP 1234" and "Uber trip" look alike. */
        private static String simplify(String text) {
            return normalize(text).replaceAll("[^a-z ]", " ").replaceAll("\\s+", " ").trim();
        }

        private static String firstWord(String key) {
            int space = key.indexOf(' ');
            return space < 0 ? key : key.substring(0, space);
        }
    }
}
