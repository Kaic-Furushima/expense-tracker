package com.kaic.expensetracker;

import com.kaic.expensetracker.controller.ExpenseController;
import com.kaic.expensetracker.model.Account;
import com.kaic.expensetracker.model.AccountType;
import com.kaic.expensetracker.model.Category;
import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.model.ExpenseStatus;
import com.kaic.expensetracker.model.ExpenseTemplate;
import com.kaic.expensetracker.model.TransactionType;
import com.kaic.expensetracker.service.AccountService;
import com.kaic.expensetracker.service.AttachmentService;
import com.kaic.expensetracker.service.BackupService;
import com.kaic.expensetracker.service.CategoryService;
import com.kaic.expensetracker.service.ExpenseService;
import com.kaic.expensetracker.service.TemplateService;
import com.kaic.expensetracker.service.TrashService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class BatchTemplatesAttachmentsTest {

    /** A real 1×1 PNG. */
    private static final String PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    @Autowired private ExpenseController controller;
    @Autowired private ExpenseService expenseService;
    @Autowired private AccountService accountService;
    @Autowired private CategoryService categoryService;
    @Autowired private TemplateService templateService;
    @Autowired private AttachmentService attachmentService;
    @Autowired private TrashService trashService;
    @Autowired private BackupService backupService;

    @BeforeEach
    void setUp() {
        expenseService.deleteAll();
        trashService.empty();
    }

    private Account account(String name) {
        return accountService.create(new AccountService.Draft(name, AccountType.CHECKING, null, null, BigDecimal.ZERO, null, false));
    }

    private Expense spend(String name, Account account, ExpenseStatus status, LocalDate date) {
        Expense e = new Expense();
        e.setName(name);
        e.setAmount(new BigDecimal("10.00"));
        e.setDate(date);
        e.setType(TransactionType.EXPENSE);
        e.setStatus(status);
        e.setAccount(account);
        return expenseService.save(e);
    }

    private ExpenseController.BatchRequest batch(List<Long> ids, String action, Long category, Long account, Long method, String tag) {
        return new ExpenseController.BatchRequest(ids, action, category, account, method, tag);
    }

    @Test
    void severalTransactionsCanBeChangedAtOnce() {
        Account a = account("Lote A"), b = account("Lote B");
        Category c = categoryService.create("Lote categoria", "🏷️", "#123456");
        Expense one = spend("Um", a, ExpenseStatus.PAID, LocalDate.of(2026, 5, 1));
        Expense two = spend("Dois", a, ExpenseStatus.PENDING, LocalDate.of(2026, 5, 2));
        List<Long> ids = List.of(one.getId(), two.getId());

        assertEquals(2, controller.batch(batch(ids, "SET_CATEGORY", c.getId(), null, null, null)).get("count"));
        assertEquals(2, controller.batch(batch(ids, "SET_ACCOUNT", null, b.getId(), null, null)).get("count"));
        assertEquals(2, controller.batch(batch(ids, "ADD_TAG", null, null, null, "#reembolso")).get("count"));
        assertEquals(1, controller.batch(batch(ids, "MARK_PAID", null, null, null, null)).get("count")); // only the pending one

        for (Long id : ids) {
            Expense e = expenseService.findById(id).orElseThrow();
            assertEquals(c.getId(), e.getCategory().getId());
            assertEquals(b.getId(), e.getAccount().getId());
            assertTrue(e.getTags().stream().anyMatch(t -> t.getName().equals("reembolso")));
            assertTrue(e.isPaid());
        }
        controller.batch(batch(ids, "SET_CATEGORY", null, null, null, null)); // clears it
        assertNull(expenseService.findById(one.getId()).orElseThrow().getCategory());
    }

    @Test
    void deletingInBatchSendsToTheTrashAndReturnsTheIds() {
        Account a = account("Lote lixeira");
        Expense one = spend("Um", a, ExpenseStatus.PAID, LocalDate.of(2026, 5, 1));
        Expense two = spend("Dois", a, ExpenseStatus.PAID, LocalDate.of(2026, 5, 2));

        Map<String, Object> result = controller.batch(batch(List.of(one.getId(), two.getId()), "DELETE", null, null, null, null));

        assertEquals(2, result.get("count"));
        assertTrue(expenseService.findById(one.getId()).isEmpty());
        assertEquals(2, trashService.list().size());
    }

    @Test
    void badBatchesAreRefused() {
        assertThrows(ResponseStatusException.class, () -> controller.batch(batch(List.of(), "DELETE", null, null, null, null)));
        assertThrows(ResponseStatusException.class, () -> controller.batch(batch(List.of(1L), "EXPLODE", null, null, null, null)));
        assertThrows(ResponseStatusException.class, () -> controller.batch(batch(List.of(1L), "ADD_TAG", null, null, null, " ")));
    }

    @Test
    void earlierDescriptionsAreSuggestedWithTheirLastUse() {
        Account a = account("Sugestao conta");
        Category c = categoryService.create("Sugestao categoria", "🏷️", "#654321");
        Expense old = spend("Mercado Extra", a, ExpenseStatus.PAID, LocalDate.of(2026, 1, 1));
        Expense recent = spend("Mercado Extra", a, ExpenseStatus.PAID, LocalDate.of(2026, 3, 1));
        recent.setCategory(c);
        expenseService.save(recent);
        spend("Padaria", a, ExpenseStatus.PAID, LocalDate.of(2026, 3, 2));

        var suggestions = controller.suggestions("mercad");

        assertEquals(1, suggestions.size()); // the same name appears once
        assertEquals(recent.getId(), suggestions.get(0).id());
        assertEquals(c.getId(), suggestions.get(0).categoryId());
        assertTrue(controller.suggestions("m").isEmpty()); // too short to be useful
        assertNotEquals(old.getId(), suggestions.get(0).id());
    }

    @Test
    void favoriteTemplatesAreSavedAndRemoved() {
        Account a = account("Modelo conta");
        ExpenseTemplate t = templateService.create(new TemplateService.Draft("Almoço de sempre", TransactionType.EXPENSE,
                new BigDecimal("32.5"), null, a.getId(), null, "no centro", List.of("trabalho", "almoco")));

        assertEquals(new BigDecimal("32.50"), t.getAmount());
        assertTrue(templateService.findAll().stream().anyMatch(x -> x.getId().equals(t.getId())));
        assertThrows(ResponseStatusException.class, () -> templateService.create(new TemplateService.Draft(" ", null, null, null, null, null, null, null)));
        templateService.delete(t.getId());
        assertTrue(templateService.findAll().stream().noneMatch(x -> x.getId().equals(t.getId())));
        assertThrows(ResponseStatusException.class, () -> templateService.delete(t.getId()));
    }

    @Test
    void aReceiptCanBeAttachedListedDownloadedAndRemoved() {
        Expense e = spend("Com nota", account("Anexo conta"), ExpenseStatus.PAID, LocalDate.of(2026, 4, 1));

        AttachmentService.Meta meta = attachmentService.add(e.getId(), "nota?.png", PNG);

        assertEquals("image/png", meta.contentType());
        assertEquals("nota_.png", meta.fileName()); // characters that are not safe in a name are replaced
        assertEquals(1, attachmentService.list(e.getId()).size());
        assertEquals(1L, attachmentService.counts().get(e.getId()));
        assertArrayEquals(Base64.getDecoder().decode(PNG), AttachmentService.decode(attachmentService.get(meta.id())));

        attachmentService.delete(meta.id());
        assertTrue(attachmentService.list(e.getId()).isEmpty());
    }

    @Test
    void filesThatAreNotImagesOrPdfsAreRefusedWhateverTheirName() {
        Expense e = spend("Anexo ruim", account("Anexo ruim conta"), ExpenseStatus.PAID, LocalDate.of(2026, 4, 1));
        String html = Base64.getEncoder().encodeToString("<html><script>alert(1)</script></html>".getBytes());
        String svg = Base64.getEncoder().encodeToString("<svg xmlns='http://www.w3.org/2000/svg'/>".getBytes());
        assertThrows(ResponseStatusException.class, () -> attachmentService.add(e.getId(), "foto.png", html));
        assertThrows(ResponseStatusException.class, () -> attachmentService.add(e.getId(), "foto.png", svg));
        assertThrows(ResponseStatusException.class, () -> attachmentService.add(e.getId(), "x.png", "isto nao e base64!!"));
        assertThrows(ResponseStatusException.class, () -> attachmentService.add(e.getId(), "x.png", ""));
        assertThrows(ResponseStatusException.class, () -> attachmentService.add(999_999L, "x.png", PNG));
        String pdf = Base64.getEncoder().encodeToString("%PDF-1.4 fake".getBytes());
        assertEquals("application/pdf", attachmentService.add(e.getId(), "nota.pdf", pdf).contentType());
    }

    @Test
    void sizeAndCountLimitsApply() {
        Expense e = spend("Muitos anexos", account("Anexo limites"), ExpenseStatus.PAID, LocalDate.of(2026, 4, 1));
        byte[] big = new byte[(int) AttachmentService.MAX_BYTES + 1];
        big[0] = (byte) 0xFF; big[1] = (byte) 0xD8; big[2] = (byte) 0xFF;
        assertThrows(ResponseStatusException.class,
                () -> attachmentService.add(e.getId(), "grande.jpg", Base64.getEncoder().encodeToString(big)));
        for (int i = 0; i < AttachmentService.MAX_PER_EXPENSE; i++) {
            attachmentService.add(e.getId(), "n" + i + ".png", PNG);
        }
        assertThrows(ResponseStatusException.class, () -> attachmentService.add(e.getId(), "mais.png", PNG));
    }

    @Test
    void attachmentsDisappearWithTheTransactionWhenItIsPurgedAndSurviveABackup() {
        Expense e = spend("Nota no backup", account("Anexo backup"), ExpenseStatus.PAID, LocalDate.of(2026, 4, 1));
        AttachmentService.Meta meta = attachmentService.add(e.getId(), "nota.png", PNG);
        var backup = backupService.create();

        expenseService.deleteById(e.getId());
        trashService.purge(TrashService.Kind.EXPENSE, e.getId());
        assertThrows(ResponseStatusException.class, () -> attachmentService.get(meta.id()));

        backupService.restoreSaved(backup.name());
        assertArrayEquals(Base64.getDecoder().decode(PNG), AttachmentService.decode(attachmentService.get(meta.id())));
    }
}
