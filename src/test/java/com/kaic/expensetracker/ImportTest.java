package com.kaic.expensetracker;

import com.kaic.expensetracker.controller.ApiController;
import com.kaic.expensetracker.model.Account;
import com.kaic.expensetracker.model.AccountType;
import com.kaic.expensetracker.model.Category;
import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.model.ExpenseStatus;
import com.kaic.expensetracker.model.TransactionType;
import com.kaic.expensetracker.service.AccountService;
import com.kaic.expensetracker.service.CategoryService;
import com.kaic.expensetracker.service.ExpenseService;
import com.kaic.expensetracker.service.ImportService;
import com.kaic.expensetracker.service.ImportService.Row;
import com.kaic.expensetracker.service.TransferService;
import com.kaic.expensetracker.service.TrashService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class ImportTest {

    @Autowired private ImportService importService;
    @Autowired private ExpenseService expenseService;
    @Autowired private AccountService accountService;
    @Autowired private CategoryService categoryService;
    @Autowired private TransferService transferService;
    @Autowired private TrashService trashService;
    @Autowired private ApiController apiController;

    @BeforeEach
    void setUp() {
        expenseService.deleteAll();
        trashService.empty();
    }

    private Account bank(String name) {
        return accountService.create(new AccountService.Draft(name, AccountType.CHECKING, null, null, BigDecimal.ZERO, null, false));
    }

    private static final String OFX = """
            OFXHEADER:100
            DATA:OFXSGML
            <OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
            <STMTTRN>
            <TRNTYPE>DEBIT
            <DTPOSTED>20260310120000[-3:BRT]
            <TRNAMT>-45.90
            <FITID>1
            <MEMO>UBER *TRIP 8842
            </STMTTRN>
            <STMTTRN>
            <TRNTYPE>CREDIT
            <DTPOSTED>20260315
            <TRNAMT>3500.00
            <FITID>2
            <NAME>SALARIO EMPRESA
            </STMTTRN>
            </BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>
            """;

    @Test
    void anOfxStatementBecomesTransactionsWithTheRightTypeAndDate() {
        Account account = bank("Import OFX");

        ImportService.Preview preview = importService.preview(OFX, account.getId(), false);

        assertEquals(ImportService.Format.OFX, preview.format());
        assertEquals(2, preview.rows().size());
        Row uber = preview.rows().get(0);
        assertEquals(TransactionType.EXPENSE, uber.type());
        assertEquals(new BigDecimal("45.90"), uber.amount());
        assertEquals(LocalDate.of(2026, 3, 10), uber.date());
        assertEquals("UBER *TRIP 8842", uber.name());
        assertEquals(TransactionType.INCOME, preview.rows().get(1).type());
        assertEquals("SALARIO EMPRESA", preview.rows().get(1).name());
    }

    @Test
    void invertingSignsSwapsExpensesAndIncome() {
        Account account = bank("Import inverter");
        ImportService.Preview preview = importService.preview(OFX, account.getId(), true);
        assertEquals(TransactionType.INCOME, preview.rows().get(0).type());
        assertEquals(TransactionType.EXPENSE, preview.rows().get(1).type());
    }

    @Test
    void aBankCsvWithBrazilianDatesAndNumbersIsRead() {
        Account account = bank("Import CSV banco");
        String csv = "Extrato conta\n\nData;Histórico;Valor\n"
                + "05/04/2026;PADARIA CENTRAL;-12,50\n"
                + "06/04/2026;PIX RECEBIDO;1.250,00\n"
                + "Total;;1.237,50\n";

        ImportService.Preview preview = importService.preview(csv, account.getId(), false);

        assertEquals(ImportService.Format.BANK_CSV, preview.format());
        assertEquals(2, preview.rows().size());
        assertEquals(new BigDecimal("12.50"), preview.rows().get(0).amount());
        assertEquals(TransactionType.EXPENSE, preview.rows().get(0).type());
        assertEquals(new BigDecimal("1250.00"), preview.rows().get(1).amount());
        assertEquals(TransactionType.INCOME, preview.rows().get(1).type());
        assertEquals(LocalDate.of(2026, 4, 6), preview.rows().get(1).date());
    }

    @Test
    void aCardCsvWhereEveryAmountIsPositiveMeansExpenses() {
        Account account = bank("Import CSV cartao");
        String csv = "date,category,title,amount\n2026-05-01,restaurante,Ifood,32.90\n2026-05-02,transporte,Uber,18.10\n";

        ImportService.Preview preview = importService.preview(csv, account.getId(), false);

        assertTrue(preview.rows().stream().allMatch(r -> r.type() == TransactionType.EXPENSE));
        assertEquals(new BigDecimal("32.90"), preview.rows().get(0).amount());
    }

    @Test
    void unknownFilesAndMissingAccountsAreExplained() {
        Account account = bank("Import erros");
        assertThrows(ResponseStatusException.class, () -> importService.preview("", account.getId(), false));
        assertThrows(ResponseStatusException.class, () -> importService.preview("a;b;c\n1;2;3\n", account.getId(), false));
        assertThrows(ResponseStatusException.class, () -> importService.preview(OFX, null, false));
    }

    @Test
    void categoriesAreSuggestedFromWhatThePersonDidBeforeAndFromKnownWords() {
        Account account = bank("Import sugestao");
        Category transport = categoryService.findOrCreate("Transporte", null, null);
        Category groceries = categoryService.findOrCreate("Mercado", null, null);
        Category custom = categoryService.create("Pets sugestao", "🐶", "#112233");
        Expense past = new Expense();
        past.setName("Petshop do Zé");
        past.setAmount(new BigDecimal("80.00"));
        past.setDate(LocalDate.of(2026, 1, 5));
        past.setAccount(account);
        past.setCategory(custom);
        expenseService.save(past);

        String csv = "Data;Descrição;Valor\n"
                + "10/03/2026;PETSHOP DO ZE 123;-90,00\n"      // same words as a past entry
                + "11/03/2026;Petshop Amigo;-40,00\n"          // same first word
                + "12/03/2026;UBER *TRIP;-20,00\n"             // known merchant -> Transporte
                + "13/03/2026;SUPERMERCADO ABC;-100,00\n"      // known word -> Mercado
                + "14/03/2026;COISA ESTRANHA;-5,00\n";         // nothing to go on

        List<Row> rows = importService.preview(csv, account.getId(), false).rows();

        assertEquals(custom.getId(), rows.get(0).categoryId());
        assertEquals(custom.getId(), rows.get(1).categoryId());
        assertEquals(transport.getId(), rows.get(2).categoryId());
        assertEquals(groceries.getId(), rows.get(3).categoryId());
        assertNull(rows.get(4).categoryId());
    }

    @Test
    void linesThatAlreadyExistAreMarkedAsDuplicatesOncePerExistingTransaction() {
        Account account = bank("Import duplicados");
        Expense existing = new Expense();
        existing.setName("Cafe digitado");
        existing.setAmount(new BigDecimal("7.00"));
        existing.setDate(LocalDate.of(2026, 6, 1));
        existing.setAccount(account);
        expenseService.save(existing);

        String csv = "Data;Descrição;Valor\n"
                + "01/06/2026;CAFE DO BANCO;-7,00\n"
                + "01/06/2026;CAFE DO BANCO;-7,00\n"   // a second coffee the same day is a different transaction
                + "02/06/2026;OUTRO;-7,00\n";

        ImportService.Preview preview = importService.preview(csv, account.getId(), false);

        assertEquals(List.of(true, false, false), preview.rows().stream().map(Row::duplicate).toList());
        assertEquals(1, preview.duplicates());
    }

    @Test
    void committingSavesTheKeptLinesInTheChosenAccount() {
        Account account = bank("Import salvar");
        Category category = categoryService.create("Salvar categoria", "🏷️", "#445566");
        List<Row> rows = importService.preview(OFX, account.getId(), false).rows().stream()
                .map(r -> new Row(r.line(), r.kind(), r.date(), r.type(), r.name(), r.amount(), category.getId(), null,
                        null, null, null, ExpenseStatus.PAID, List.of("importado"), null, false))
                .toList();

        ImportService.Result result = importService.commit(rows, account.getId());

        assertEquals(2, result.transactions());
        List<Expense> saved = expenseService.findAll().stream().filter(e -> e.getAccount().getId().equals(account.getId())).toList();
        assertEquals(2, saved.size());
        assertTrue(saved.stream().allMatch(e -> e.getCategory().getId().equals(category.getId())));
        assertTrue(saved.stream().allMatch(e -> e.getTags().stream().anyMatch(t -> t.getName().equals("importado"))));
        assertEquals(new BigDecimal("3454.10"), accountService.balances().get(account.getId()));
    }

    @Test
    void aBadLineCancelsTheWholeImport() {
        Account account = bank("Import tudo ou nada");
        Row good = new Row(2, "TRANSACTION", LocalDate.of(2026, 1, 1), TransactionType.EXPENSE, "Bom", new BigDecimal("1.00"),
                null, null, null, null, null, ExpenseStatus.PAID, List.of(), null, false);
        Row bad = new Row(3, "TRANSACTION", LocalDate.of(1990, 1, 1), TransactionType.EXPENSE, "Ruim", new BigDecimal("1.00"),
                null, null, null, null, null, ExpenseStatus.PAID, List.of(), null, false);
        assertThrows(ResponseStatusException.class, () -> importService.commit(List.of(good, bad), account.getId()));
        assertTrue(expenseService.findAll().stream().noneMatch(e -> e.getName().equals("Bom")));
    }

    @Test
    void theCsvThisAppExportsCanBeImportedBackOnAnotherDatabase() {
        Account santander = bank("Roundtrip Santander");
        Account nubank = bank("Roundtrip Nubank");
        Category food = categoryService.findOrCreate("Roundtrip comida", null, null);
        Expense lunch = new Expense();
        lunch.setName("Almoço; com \"aspas\"");
        lunch.setDescription("nota 1");
        lunch.setAmount(new BigDecimal("42.50"));
        lunch.setDate(LocalDate.of(2026, 2, 3));
        lunch.setAccount(santander);
        lunch.setCategory(food);
        lunch.setStatus(ExpenseStatus.PENDING);
        expenseService.save(lunch);
        transferService.create(new TransferService.Draft(santander.getId(), nubank.getId(), new BigDecimal("100.00"),
                LocalDate.of(2026, 2, 4), "Mover"));
        String csv = new String(apiController.exportCsv().getBody(), StandardCharsets.UTF_8);

        // importing the same file over the same data: everything is already there
        ImportService.Preview same = importService.preview(csv, null, false);
        assertEquals(ImportService.Format.APP_CSV, same.format());
        List<Row> mine = same.rows().stream().filter(r -> "Roundtrip Santander".equals(r.accountName())).toList();
        assertEquals(2, mine.size());
        assertTrue(mine.stream().allMatch(Row::duplicate)); // the transfer too

        // now wipe and bring it back
        expenseService.deleteAll();
        trashService.empty();
        ImportService.Preview again = importService.preview(csv, null, false);
        List<Row> back = again.rows().stream().filter(r -> r.accountName() != null && r.accountName().startsWith("Roundtrip")).toList();
        assertTrue(back.stream().noneMatch(Row::duplicate));
        importService.commit(back, null);

        Expense restored = expenseService.findAll().stream().filter(e -> e.getName().startsWith("Almoço")).findFirst().orElseThrow();
        assertEquals("Almoço; com \"aspas\"", restored.getName());
        assertEquals(new BigDecimal("42.50"), restored.getAmount());
        assertEquals(ExpenseStatus.PENDING, restored.getStatus());
        assertEquals(food.getId(), restored.getCategory().getId());
        assertEquals(santander.getId(), restored.getAccount().getId());
        assertEquals(1, transferService.findAll().stream().filter(t -> "Mover".equals(t.getDescription())).count());
    }

    @Test
    void theAppCsvCreatesTheAccountsAndCategoriesItDoesNotFindYet() {
        String csv = "data;tipo;nome;categoria;valor;conta;conta_destino;forma_pagamento;situacao;tags;descricao\n"
                + "2026-03-01;EXPENSE;\"Remédio\";\"Farmácia importada\";19.90;\"Conta importada nova\";;\"Boleto importado\";PAGO;\"saude viagem\";\n";

        ImportService.Preview preview = importService.preview(csv, null, false);
        assertNull(preview.rows().get(0).categoryId()); // does not exist yet
        ImportService.Result result = importService.commit(preview.rows(), null);

        assertEquals(1, result.categoriesCreated());
        Expense saved = expenseService.findAll().stream().filter(e -> e.getName().equals("Remédio")).findFirst().orElseThrow();
        assertEquals("Farmácia importada", saved.getCategory().getName());
        assertEquals("Conta importada nova", saved.getAccount().getName());
        assertEquals("Boleto importado", saved.getPaymentMethod().getName());
        assertEquals(2, saved.getTags().size());
    }

    @Test
    void numbersAndDatesInManyShapesAreUnderstood() {
        assertEquals(new BigDecimal("1234.56"), ImportService.parseAmount("1.234,56"));
        assertEquals(new BigDecimal("-45.90"), ImportService.parseAmount("-45.90"));
        assertEquals(new BigDecimal("12.00"), ImportService.parseAmount("R$ 12,00"));
        assertEquals(new BigDecimal("-12.00"), ImportService.parseAmount("(12,00)"));
        assertEquals(new BigDecimal("1234567.00"), ImportService.parseAmount("1.234.567"));
        assertNull(ImportService.parseAmount("abc"));
        assertEquals(LocalDate.of(2026, 1, 5), ImportService.parseDate("05/01/2026"));
        assertEquals(LocalDate.of(2026, 1, 5), ImportService.parseDate("2026-01-05"));
        assertEquals(LocalDate.of(2026, 1, 5), ImportService.parseDate("2026-01-05 10:30:00"));
        assertNull(ImportService.parseDate("Total"));
    }
}
