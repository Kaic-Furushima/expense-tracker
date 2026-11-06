package com.kaic.expensetracker;

import com.kaic.expensetracker.model.Account;
import com.kaic.expensetracker.model.AccountType;
import com.kaic.expensetracker.service.AccountService;
import com.kaic.expensetracker.service.DemoDataService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.junit.jupiter.api.Assertions.*;

/** The sample data: six months on several accounts and a card, installments, tags, recurring payments, pots, wishes. */
@SpringBootTest
class DemoDataRichTest {

    @Autowired private DemoDataService demo;
    @Autowired private AccountService accountService;
    @Autowired private JdbcTemplate jdbc;

    private long count(String from) {
        Long n = jdbc.queryForObject("select count(*) from " + from, Long.class);
        return n == null ? 0 : n;
    }

    @Test
    void loadsAFullScenarioAndRunningItAgainAddsNothing() {
        demo.load();

        Account card = accountService.findAll().stream().filter(a -> a.getName().equals("Cartão Nubank")).findFirst().orElseThrow();
        assertEquals(AccountType.CREDIT_CARD, card.getType());
        assertEquals(25, card.getClosingDay());
        assertEquals(5, card.getDueDay());
        assertTrue(accountService.findAll().stream().anyMatch(a -> a.getName().equals("Carteira") && a.getType() == AccountType.WALLET));
        assertEquals(10, count("expenses where name = 'Notebook'"));
        assertEquals(12, count("expenses where name = 'Geladeira'"));
        assertTrue(count("expenses where deleted_at is null") >= 100);
        assertEquals(3, count("tags where name in ('viagem', 'trabalho', 'presente')"));
        assertEquals(2, count("expense_tags et join tags t on t.id = et.tag_id where t.name = 'viagem'"));
        assertEquals(4, count("recurring_payments where name in ('Plano de saúde', 'Seguro do carro', 'Conta de água', 'Aluguel recebido')"));
        assertEquals(1, count("recurring_payments where name = 'Conta de água' and variable_amount = true"));
        assertEquals(3, count("pots where name in ('Viagem', 'Reserva de emergência', 'Equipamentos')"));
        assertEquals(3, count("wish_items where name in ('Fone de ouvido', 'Cadeira ergonômica', 'Bicicleta')"));
        assertEquals(3, count("expense_templates where name in ('Almoço', 'Uber', 'Café')"));
        assertEquals(7, count("budgets"));

        long expenses = count("expenses");
        long transfers = count("transfers");
        long pots = count("pot_entries where kind = 'MANUAL'");
        demo.load();
        assertEquals(expenses, count("expenses"));
        assertEquals(transfers, count("transfers"));
        assertEquals(pots, count("pot_entries where kind = 'MANUAL'"));
        assertEquals(7, count("budgets"));
        assertEquals(3, count("wish_items where name in ('Fone de ouvido', 'Cadeira ergonômica', 'Bicicleta')"));
    }
}
