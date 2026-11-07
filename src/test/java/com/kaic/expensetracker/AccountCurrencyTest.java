package com.kaic.expensetracker;

import com.kaic.expensetracker.model.Account;
import com.kaic.expensetracker.model.AccountType;
import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.model.TransactionType;
import com.kaic.expensetracker.model.Category;
import com.kaic.expensetracker.model.Pot;
import com.kaic.expensetracker.model.PotMode;
import com.kaic.expensetracker.model.WishItem;
import com.kaic.expensetracker.repository.BudgetRepository;
import com.kaic.expensetracker.service.AccountService;
import com.kaic.expensetracker.service.BudgetService;
import com.kaic.expensetracker.service.CategoryService;
import com.kaic.expensetracker.service.PotService;
import com.kaic.expensetracker.service.WishService;
import com.kaic.expensetracker.service.ExpenseService;
import com.kaic.expensetracker.service.SummaryService;
import com.kaic.expensetracker.service.TransferService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;

import static org.junit.jupiter.api.Assertions.*;

/** Accounts in a currency other than the main one: own balance, own summary, and transfers that need both amounts. */
@SpringBootTest
class AccountCurrencyTest {

    private static final LocalDate DAY = LocalDate.of(2026, 4, 10);

    @Autowired private AccountService accountService;
    @Autowired private ExpenseService expenseService;
    @Autowired private TransferService transferService;
    @Autowired private SummaryService summaryService;
    @Autowired private BudgetService budgetService;
    @Autowired private BudgetRepository budgetRepository;
    @Autowired private CategoryService categoryService;
    @Autowired private PotService potService;
    @Autowired private WishService wishService;
    @Autowired private com.kaic.expensetracker.service.ImportService importService;

    private Account reais;
    private Account dollars;

    @BeforeEach
    void setUp() {
        expenseService.deleteAll();
        budgetRepository.deleteAll();
        reais = accountService.create(new AccountService.Draft("Moeda teste reais " + System.nanoTime(), AccountType.CHECKING,
                null, null, new BigDecimal("1000.00"), null, false));
        dollars = accountService.create(new AccountService.Draft("Moeda teste dolar " + System.nanoTime(), AccountType.CHECKING,
                null, null, new BigDecimal("100.00"), null, false, null, null, null, "USD"));
    }

    private void spend(Account account, String amount) {
        Expense e = new Expense();
        e.setName("compra");
        e.setAmount(new BigDecimal(amount));
        e.setDate(DAY);
        e.setType(TransactionType.EXPENSE);
        e.setAccount(account);
        expenseService.save(e);
    }

    @Test
    void anAccountUsesTheMainCurrencyUnlessItChoosesAnother() {
        assertEquals("BRL", accountService.currencyOf(reais));
        assertEquals("USD", accountService.currencyOf(dollars));
        assertNull(reais.getCurrency());

        // choosing the main currency is the same as choosing none; an edit that does not send it keeps what it had
        Account again = accountService.update(dollars.getId(), new AccountService.Draft(dollars.getName(), AccountType.CHECKING,
                null, null, new BigDecimal("100.00"), null, false));
        assertEquals("USD", again.getCurrency());
        Account main = accountService.update(dollars.getId(), new AccountService.Draft(dollars.getName(), AccountType.CHECKING,
                null, null, new BigDecimal("100.00"), null, false, null, null, null, "BRL"));
        assertNull(main.getCurrency());
    }

    @Test
    void anUnknownCurrencyIsRefused() {
        var ex = assertThrows(ResponseStatusException.class, () -> accountService.create(new AccountService.Draft(
                "Moeda teste invalida " + System.nanoTime(), AccountType.CHECKING, null, null, null, null, false, null, null, null, "XYZ")));
        assertEquals(HttpStatus.BAD_REQUEST, ex.getStatusCode());
    }

    @Test
    void theMonthSummaryOnlyCountsTheMainCurrencyUnlessAnAccountIsViewed() {
        spend(reais, "50.00");
        spend(dollars, "20.00");
        YearMonth month = YearMonth.from(DAY);
        assertEquals(0, new BigDecimal("50.00").compareTo(summaryService.summarize(month).expense()));
        assertEquals(0, new BigDecimal("20.00").compareTo(summaryService.summarize(month, dollars.getId()).expense()));
    }

    @Test
    void aTransferBetweenCurrenciesNeedsTheReceivedAmountAndEachBalanceMovesInItsOwnCurrency() {
        var missing = assertThrows(ResponseStatusException.class, () -> transferService.create(
                new TransferService.Draft(reais.getId(), dollars.getId(), new BigDecimal("500.00"), DAY, null)));
        assertEquals(HttpStatus.BAD_REQUEST, missing.getStatusCode());

        transferService.create(new TransferService.Draft(reais.getId(), dollars.getId(), new BigDecimal("500.00"), DAY, null,
                null, new BigDecimal("90.00")));
        var balances = accountService.balances();
        assertEquals(0, new BigDecimal("500.00").compareTo(balances.get(reais.getId())));
        assertEquals(0, new BigDecimal("190.00").compareTo(balances.get(dollars.getId())));
    }
    @Test
    void aPotHasItsOwnCurrencyAndWithAnAccountItFollowsTheAccount() {
        Pot alone = potService.create(new PotService.Draft("Moeda teste caixinha " + System.nanoTime(), null, null, null,
                PotMode.VARIABLE, null, null, true, null, "USD"));
        assertEquals("USD", potService.currencyOf(alone));
        Pot linked = potService.create(new PotService.Draft("Moeda teste ligada " + System.nanoTime(), null, null, null,
                PotMode.VARIABLE, null, null, true, dollars.getId(), "EUR"));
        assertEquals("USD", potService.currencyOf(linked), "com conta, vale a moeda da conta");
    }

    @Test
    void aWishItemHasACurrencyItsPotAndItsPurchaseAccountMustMatchIt() {
        Pot pot = potService.create(new PotService.Draft("Moeda teste desejo " + System.nanoTime(), null, null, null,
                PotMode.VARIABLE, null, null, true, null, "USD"));
        var mismatch = assertThrows(ResponseStatusException.class, () -> wishService.create(
                new WishService.Draft("Mala", new BigDecimal("100.00"), null, null, pot.getId())));
        assertEquals(HttpStatus.BAD_REQUEST, mismatch.getStatusCode());

        WishItem item = wishService.create(new WishService.Draft("Mala", new BigDecimal("100.00"), null, null, pot.getId(), "USD"));
        assertEquals("USD", wishService.currencyOf(item));
        var wrongAccount = assertThrows(ResponseStatusException.class, () -> wishService.buy(item.getId(),
                new WishService.Purchase(new BigDecimal("90.00"), DAY, reais.getId(), null, null, false)));
        assertEquals(HttpStatus.BAD_REQUEST, wrongAccount.getStatusCode());
        wishService.buy(item.getId(), new WishService.Purchase(new BigDecimal("90.00"), DAY, dollars.getId(), null, null, false));
    }

    @Test
    void aBudgetLimitCountsOnlyInItsCurrency() {
        Category food = categoryService.findOrCreate("Moeda teste comida", null, "#E57373");
        YearMonth month = YearMonth.from(DAY);
        budgetService.set(food.getId(), month, new BigDecimal("300.00"), BudgetService.Scope.FROM_MONTH);
        assertEquals(0, new BigDecimal("300.00").compareTo(summaryService.summarize(month).categories().stream()
                .filter(c -> food.getId().equals(c.categoryId())).findFirst().orElseThrow().budget()));

        // the limit in force becomes one in dollars: it leaves the real view and shows in the dollar one
        budgetService.set(food.getId(), month, new BigDecimal("80.00"), BudgetService.Scope.FROM_MONTH, "USD");
        assertTrue(summaryService.summarize(month).categories().stream()
                .noneMatch(c -> food.getId().equals(c.categoryId()) && c.budget() != null));
        Expense dinner = new Expense();
        dinner.setName("jantar");
        dinner.setAmount(new BigDecimal("25.00"));
        dinner.setDate(DAY);
        dinner.setType(TransactionType.EXPENSE);
        dinner.setCategory(food);
        dinner.setAccount(dollars);
        expenseService.save(dinner);
        var view = summaryService.summarize(month, null, "USD");
        assertEquals("USD", view.currency());
        var row = view.categories().stream().filter(c -> food.getId().equals(c.categoryId())).findFirst().orElseThrow();
        assertEquals(0, new BigDecimal("80.00").compareTo(row.budget()));
        assertEquals(0, new BigDecimal("25.00").compareTo(row.budgetSpent()));
    }

    @Test
    void aPotLinkedToASavedAccountShowsTheAccountBalanceAndRefusesItsOwnDeposits() {
        Account vault = accountService.create(new AccountService.Draft("Moeda teste cofre " + System.nanoTime(), AccountType.SAVINGS,
                null, null, new BigDecimal("300.00"), null, false, null, null, true, null));
        Pot pot = potService.create(new PotService.Draft("Moeda teste espelho " + System.nanoTime(), null, null, null,
                PotMode.VARIABLE, null, null, true, vault.getId(), null));
        assertTrue(potService.isMirrored(pot));
        assertEquals(0, new BigDecimal("300.00").compareTo(potService.balanceOf(pot)));
        var refused = assertThrows(ResponseStatusException.class, () -> potService.deposit(pot.getId(), BigDecimal.TEN, DAY, null));
        assertEquals(HttpStatus.CONFLICT, refused.getStatusCode());

        transferService.create(new TransferService.Draft(reais.getId(), vault.getId(), new BigDecimal("50.00"), DAY, null));
        assertEquals(0, new BigDecimal("350.00").compareTo(potService.balanceOf(pot)));
    }
    @Test
    void theCsvCarriesTheCurrencyAndTheAmountThatArrivedAndImportCreatesTheAccountInThatCurrency() {
        String stamp = String.valueOf(System.nanoTime());
        String header = "data;tipo;nome;categoria;valor;conta;conta_destino;forma_pagamento;situacao;tags;descricao;moeda;valor_destino;moeda_destino\n";
        String csv = header
                + "2026-04-10;TRANSFER;\"Cambio\";;500.00;\"" + reais.getName() + "\";\"Importada " + stamp + "\";;PAGO;\"\";;\"BRL\";90.00;\"USD\"\n"
                + "2026-04-11;EXPENSE;\"Cafe\";;12.50;\"Importada " + stamp + "\";;;PAGO;\"\";;\"USD\";;\n";
        var preview = importService.preview(csv, null, false);
        importService.commit(preview.rows(), null);
        Account created = accountService.findAll().stream().filter(a -> a.getName().equals("Importada " + stamp)).findFirst().orElseThrow();
        assertEquals("USD", created.getCurrency());
        assertEquals(0, new BigDecimal("77.50").compareTo(accountService.balances().get(created.getId())));
    }
}
