package com.kaic.expensetracker.controller;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class CsvCellTest {

    @Test
    void formulaStartsGetAnApostropheInside_theQuotes() {
        assertEquals("\"'=HYPERLINK(\"\"http://x\"\")\"", ApiController.cell("=HYPERLINK(\"http://x\")"));
        assertEquals("\"'+1+1\"", ApiController.cell("+1+1"));
        assertEquals("\"'-2\"", ApiController.cell("-2"));
        assertEquals("\"'@SUM\"", ApiController.cell("@SUM"));
        assertEquals("\"'\tcmd\"", ApiController.cell("\tcmd"), "tab also starts a formula for some spreadsheets");
    }

    @Test
    void ordinaryTextIsOnlyQuoted() {
        assertEquals("\"Mercado\"", ApiController.cell("Mercado"));
        assertEquals("\"\"", ApiController.cell(""));
        assertEquals("", ApiController.cell(null));
        assertEquals("\"linha um linha dois\"", ApiController.cell("linha um\nlinha dois"));
    }
}
