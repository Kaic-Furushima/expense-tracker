package com.kaic.expensetracker;

import com.kaic.expensetracker.controller.ApiController;
import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.model.TransactionType;
import com.kaic.expensetracker.service.AccountService;
import com.kaic.expensetracker.service.ExpenseService;
import com.kaic.expensetracker.service.TrashService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.*;

/** The CSV export: the layout a spreadsheet expects, and the protection against formulas (T3). */
@SpringBootTest
class CsvExportTest {

    private static final String HEADER = "data;tipo;nome;categoria;valor;conta;conta_destino;forma_pagamento;situacao;tags;descricao";

    @Autowired private ApiController api;
    @Autowired private ExpenseService expenses;
    @Autowired private AccountService accounts;
    @Autowired private TrashService trash;

    @BeforeEach
    void setUp() {
        expenses.deleteAll();
        trash.empty();
    }

    @AfterEach
    void tearDown() {
        expenses.deleteAll();
        trash.empty();
    }

    private Expense spend(String name, String description, String amount) {
        Expense e = new Expense();
        e.setName(name);
        e.setDescription(description);
        e.setAmount(new BigDecimal(amount));
        e.setDate(LocalDate.of(2030, 6, 1));
        e.setType(TransactionType.EXPENSE);
        e.setAccount(accounts.defaultAccount());
        return expenses.save(e);
    }

    private String export() {
        byte[] body = api.exportCsv().getBody();
        assertNotNull(body);
        return new String(body, StandardCharsets.UTF_8);
    }

    @Test
    void theFileStartsWithABomAndTheHeaderThenOneLinePerTransaction() {
        spend("Mercado", "compra do mês", "20.5");
        spend("Farmácia", null, "7");

        String text = export();

        assertEquals('﻿', text.charAt(0), "o BOM faz o Excel ler os acentos");
        String[] lines = text.substring(1).split("\n");
        assertEquals(HEADER, lines[0]);
        String[] rows = java.util.Arrays.stream(lines).filter(l -> l.startsWith("2030-06-01;")).toArray(String[]::new);
        assertEquals(2, rows.length);
        String mercado = rows[0].contains("Mercado") ? rows[0] : rows[1];
        assertTrue(mercado.startsWith("2030-06-01;EXPENSE;\"Mercado\";"), mercado);
        assertTrue(mercado.contains(";20.50;"), "valor com ponto e sem formatação");
        assertTrue(mercado.endsWith(";PAGO;\"\";\"compra do mês\""), mercado);
    }

    @Test
    void textThatStartsAFormulaIsNeutralisedInTheFile() {
        spend("=HYPERLINK(\"http://x\")", null, "1");

        assertTrue(export().contains("\"'=HYPERLINK(\"\"http://x\"\")\""));
    }

    @Test
    void aTransactionWithoutAnExplicitTypeIsStillExported() {
        Expense e = spend("Sem tipo", null, "3");
        e.setType(null);
        expenses.save(e);

        assertTrue(export().contains("\"Sem tipo\""), "um lançamento sem tipo não pode derrubar a exportação");
    }
}
