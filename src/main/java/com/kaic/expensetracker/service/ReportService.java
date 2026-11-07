package com.kaic.expensetracker.service;

import com.kaic.expensetracker.model.Category;
import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.model.Tag;
import com.kaic.expensetracker.model.Transfer;
import com.kaic.expensetracker.profile.Messages;
import com.lowagie.text.Document;
import com.lowagie.text.DocumentException;
import com.lowagie.text.Element;
import com.lowagie.text.Font;
import com.lowagie.text.FontFactory;
import com.lowagie.text.PageSize;
import com.lowagie.text.Paragraph;
import com.lowagie.text.Phrase;
import com.lowagie.text.Rectangle;
import com.lowagie.text.pdf.ColumnText;
import com.lowagie.text.pdf.PdfContentByte;
import com.lowagie.text.pdf.PdfPCell;
import com.lowagie.text.pdf.PdfPTable;
import com.lowagie.text.pdf.PdfPageEventHelper;
import com.lowagie.text.pdf.PdfWriter;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.text.NumberFormat;
import java.time.Clock;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Currency;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/** Statements for a period as a formatted spreadsheet (.xlsx) or a PDF. */
@Service
@Transactional(readOnly = true)
public class ReportService {

    private static final long MAX_DAYS = 366L * 5;

    private final ExpenseService expenseService;
    private final TransferService transferService;
    private final AccountService accountService;
    private final SettingsService settings;
    private final Messages m;
    private final Clock clock;

    public ReportService(ExpenseService expenseService, TransferService transferService, AccountService accountService,
                         SettingsService settings, Messages messages, Clock clock) {
        this.clock = clock;
        this.m = messages;
        this.expenseService = expenseService;
        this.transferService = transferService;
        this.accountService = accountService;
        this.settings = settings;
    }

    /** What goes into a statement. Totals count only what is paid; the pending ones are listed apart. */
    public record Data(LocalDate from, LocalDate to, String accountName, List<Expense> expenses,
                       List<Transfer> transfers, BigDecimal income, BigDecimal expense, BigDecimal pendingIncome,
                       BigDecimal pendingExpense, Map<String, BigDecimal> byCategory, String currency) {
        BigDecimal balance() {
            return income.subtract(expense);
        }
    }

    public Data collect(LocalDate from, LocalDate to, Long accountId) {
        return collect(from, to, accountId, null);
    }

    /** Only what is in one currency counts: the one of the account chosen, the one asked for, or the main one. */
    public Data collect(LocalDate from, LocalDate to, Long accountId, String currency) {
        if (from == null || to == null || to.isBefore(from)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Informe o período (a data final não pode ser antes da inicial).");
        }
        if (ChronoUnit.DAYS.between(from, to) > MAX_DAYS) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "O relatório pode cobrir no máximo 5 anos.");
        }
        String accountName = accountId == null ? null : accountService.getOrThrow(accountId).getName();
        Map<Long, String> currencies = accountService.accountCurrencies();
        String view = accountId != null ? currencies.getOrDefault(accountId, accountService.mainCurrency())
                : currency == null || currency.isBlank() ? accountService.mainCurrency() : currency.trim().toUpperCase();
        List<Expense> expenses = expenseService.findAll().stream()
                .filter(e -> !e.getDate().isBefore(from) && !e.getDate().isAfter(to))
                .filter(e -> accountId == null ? view.equals(currencies.get(e.getAccount().getId())) : accountId.equals(e.getAccount().getId()))
                .sorted(Comparator.comparing(Expense::getDate).thenComparing(Expense::getId))
                .toList();
        List<Transfer> transfers = transferService.findAll().stream()
                .filter(t -> !t.getDate().isBefore(from) && !t.getDate().isAfter(to))
                .filter(t -> accountId == null ? view.equals(currencies.get(t.getFromAccount().getId())) && view.equals(currencies.get(t.getToAccount().getId()))
                        : accountId.equals(t.getFromAccount().getId()) || accountId.equals(t.getToAccount().getId()))
                .sorted(Comparator.comparing(Transfer::getDate).thenComparing(Transfer::getId))
                .toList();
        BigDecimal income = sum(expenses, true, true), expense = sum(expenses, false, true);
        Map<String, BigDecimal> byCategory = new LinkedHashMap<>();
        expenses.stream().filter(e -> !e.isIncome() && e.isPaid())
                .collect(Collectors.groupingBy(e -> categoryLabel(e.getCategory()),
                        Collectors.reducing(BigDecimal.ZERO, Expense::getAmount, BigDecimal::add)))
                .entrySet().stream().sorted(Map.Entry.<String, BigDecimal>comparingByValue().reversed())
                .forEach(en -> byCategory.put(en.getKey(), en.getValue()));
        return new Data(from, to, accountName, expenses, transfers, income, expense,
                sum(expenses, true, false), sum(expenses, false, false), byCategory, view);
    }

    private static BigDecimal sum(List<Expense> list, boolean income, boolean paid) {
        return list.stream().filter(e -> e.isIncome() == income && e.isPaid() == paid)
                .map(Expense::getAmount).reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private String categoryLabel(Category c) {
        if (c == null) {
            return m.t("Sem categoria");
        }
        return c.getParent() == null ? c.getName() : c.getParent().getName() + " › " + c.getName();
    }

    private static String tagsOf(Expense e) {
        return e.getTags().stream().map(Tag::getName).sorted().map(t -> "#" + t).collect(Collectors.joining(" "));
    }

    private String title(Data d) {
        return m.t("Extrato") + (d.accountName() == null ? "" : " — " + d.accountName());
    }

    private String period(Data d) {
        return m.t("{0} a {1}", br(d.from()), br(d.to()));
    }

    private static String br(LocalDate d) {
        return String.format("%02d/%02d/%d", d.getDayOfMonth(), d.getMonthValue(), d.getYear());
    }

    private String money(BigDecimal value, String currency) {
        NumberFormat f = NumberFormat.getCurrencyInstance(m.locale());
        f.setCurrency(Currency.getInstance(currency == null ? settings.currency() : currency));
        return f.format(value).replace(' ', ' ').replace(' ', ' ');
    }

    /* ------------------------------------------------------------------ PDF */

    public byte[] pdf(Data d) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        Document doc = new Document(PageSize.A4, 36, 36, 40, 44);
        try {
            PdfWriter writer = PdfWriter.getInstance(doc, out);
            writer.setPageEvent(new PdfPageEventHelper() {
                @Override
                public void onEndPage(PdfWriter w, Document document) {
                    PdfContentByte cb = w.getDirectContent();
                    Phrase footer = new Phrase(m.t("Pocketful · página {0}", w.getPageNumber()),
                            FontFactory.getFont(FontFactory.HELVETICA, 8, Color.GRAY));
                    ColumnText.showTextAligned(cb, Element.ALIGN_CENTER, footer,
                            (document.right() + document.left()) / 2, document.bottom() - 18, 0);
                }
            });
            doc.addTitle(title(d));
            doc.addCreator("Pocketful");
            doc.open();

            Font h1 = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 18, new Color(0x2F, 0x7D, 0x6D));
            Font h2 = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 12, Color.BLACK);
            Font normal = FontFactory.getFont(FontFactory.HELVETICA, 9, Color.BLACK);
            Font small = FontFactory.getFont(FontFactory.HELVETICA, 8, Color.DARK_GRAY);
            Font bold = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 9, Color.BLACK);

            doc.add(new Paragraph(title(d), h1));
            Paragraph sub = new Paragraph(m.t("Período: {0} · gerado em {1}", period(d), br(LocalDate.now(clock))), small);
            sub.setSpacingAfter(10);
            doc.add(sub);

            PdfPTable summary = new PdfPTable(new float[]{1, 1, 1});
            summary.setWidthPercentage(100);
            summary.addCell(box(m.t("Receitas"), money(d.income(), d.currency()), new Color(0x2E, 0x7D, 0x32)));
            summary.addCell(box(m.t("Despesas"), money(d.expense(), d.currency()), new Color(0xC6, 0x28, 0x28)));
            summary.addCell(box(m.t("Saldo do período"), money(d.balance(), d.currency()), Color.BLACK));
            doc.add(summary);
            if (d.pendingIncome().signum() > 0 || d.pendingExpense().signum() > 0) {
                Paragraph pending = new Paragraph(m.t("Ainda a pagar: {0} · ainda a receber: {1} (não entram nos totais acima)",
                        money(d.pendingExpense(), d.currency()), money(d.pendingIncome(), d.currency())), small);
                pending.setSpacingBefore(4);
                doc.add(pending);
            }

            if (!d.byCategory().isEmpty()) {
                Paragraph cap = new Paragraph(m.t("Despesas por categoria"), h2);
                cap.setSpacingBefore(14);
                cap.setSpacingAfter(4);
                doc.add(cap);
                PdfPTable cats = new PdfPTable(new float[]{5, 2, 1});
                cats.setWidthPercentage(100);
                cats.setHeaderRows(1);
                header(cats, m.t("Categoria"), m.t("Total"), "%");
                for (Map.Entry<String, BigDecimal> en : d.byCategory().entrySet()) {
                    cats.addCell(cell(en.getKey(), normal, Element.ALIGN_LEFT));
                    cats.addCell(cell(money(en.getValue(), d.currency()), normal, Element.ALIGN_RIGHT));
                    cats.addCell(cell(d.expense().signum() == 0 ? "" : en.getValue().multiply(BigDecimal.valueOf(100))
                            .divide(d.expense(), 0, java.math.RoundingMode.HALF_UP) + "%", normal, Element.ALIGN_RIGHT));
                }
                doc.add(cats);
            }

            Paragraph cap = new Paragraph(m.t("Lançamentos ({0})", d.expenses().size()), h2);
            cap.setSpacingBefore(14);
            cap.setSpacingAfter(4);
            doc.add(cap);
            if (d.expenses().isEmpty()) {
                doc.add(new Paragraph(m.t("Nenhum lançamento neste período."), normal));
            } else {
                PdfPTable table = new PdfPTable(new float[]{1.3f, 4f, 2.6f, 2f, 2.2f});
                table.setWidthPercentage(100);
                table.setHeaderRows(1);
                header(table, m.t("Data"), m.t("Descrição"), m.t("Categoria"), m.t("Conta"), m.t("Valor"));
                for (Expense e : d.expenses()) {
                    String name = e.isPaid() ? e.getName() : m.t(e.isIncome() ? "{0} (a receber)" : "{0} (a pagar)", e.getName());
                    table.addCell(cell(br(e.getDate()), normal, Element.ALIGN_LEFT));
                    table.addCell(cell(name + (tagsOf(e).isEmpty() ? "" : "  " + tagsOf(e)), normal, Element.ALIGN_LEFT));
                    table.addCell(cell(categoryLabel(e.getCategory()), normal, Element.ALIGN_LEFT));
                    table.addCell(cell(e.getAccount().getName(), normal, Element.ALIGN_LEFT));
                    PdfPCell value = cell((e.isIncome() ? "+ " : "− ") + money(e.getAmount(), d.currency()),
                            FontFactory.getFont(FontFactory.HELVETICA, 9, e.isIncome() ? new Color(0x2E, 0x7D, 0x32) : new Color(0xC6, 0x28, 0x28)),
                            Element.ALIGN_RIGHT);
                    table.addCell(value);
                }
                doc.add(table);
            }

            if (!d.transfers().isEmpty()) {
                Paragraph tcap = new Paragraph(m.t("Transferências entre contas (não entram nos totais)"), h2);
                tcap.setSpacingBefore(14);
                tcap.setSpacingAfter(4);
                doc.add(tcap);
                PdfPTable table = new PdfPTable(new float[]{1.3f, 4f, 4.6f, 2.2f});
                table.setWidthPercentage(100);
                table.setHeaderRows(1);
                header(table, m.t("Data"), m.t("Descrição"), m.t("De → Para"), m.t("Valor"));
                for (Transfer t : d.transfers()) {
                    table.addCell(cell(br(t.getDate()), normal, Element.ALIGN_LEFT));
                    table.addCell(cell(t.getDescription() == null ? m.t("Transferência") : t.getDescription(), normal, Element.ALIGN_LEFT));
                    table.addCell(cell(t.getFromAccount().getName() + " → " + t.getToAccount().getName(), normal, Element.ALIGN_LEFT));
                    table.addCell(cell(money(t.getAmount(), d.currency()), bold, Element.ALIGN_RIGHT));
                }
                doc.add(table);
            }
        } catch (DocumentException e) {
            throw new IllegalStateException("Não foi possível gerar o PDF", e);
        } finally {
            doc.close();
        }
        return out.toByteArray();
    }

    private static PdfPCell box(String label, String value, Color color) {
        PdfPCell c = new PdfPCell();
        c.setBorderColor(new Color(0xDD, 0xDD, 0xDD));
        c.setPadding(8);
        c.addElement(new Paragraph(label, FontFactory.getFont(FontFactory.HELVETICA, 8, Color.GRAY)));
        c.addElement(new Paragraph(value, FontFactory.getFont(FontFactory.HELVETICA_BOLD, 13, color)));
        return c;
    }

    private void header(PdfPTable table, String... titles) {
        Font f = FontFactory.getFont(FontFactory.HELVETICA_BOLD, 9, Color.WHITE);
        for (String t : titles) {
            PdfPCell c = new PdfPCell(new Phrase(t, f));
            c.setBackgroundColor(new Color(0x2F, 0x7D, 0x6D));
            c.setBorder(Rectangle.NO_BORDER);
            c.setPadding(5);
            c.setHorizontalAlignment(t.equals(m.t("Valor")) || t.equals(m.t("Total")) || t.equals("%") ? Element.ALIGN_RIGHT : Element.ALIGN_LEFT);
            table.addCell(c);
        }
    }

    private static PdfPCell cell(String text, Font font, int align) {
        PdfPCell c = new PdfPCell(new Phrase(text, font));
        c.setBorder(Rectangle.BOTTOM);
        c.setBorderColor(new Color(0xE6, 0xE6, 0xE6));
        c.setPadding(4);
        c.setHorizontalAlignment(align);
        return c;
    }

    /* ------------------------------------------------------------------ XLSX */

    public byte[] xlsx(Data d) {
        Xlsx book = new Xlsx();

        Xlsx.Sheet summary = book.sheet(m.t("Resumo"), new double[]{34, 18, 12}, false);
        summary.row(Xlsx.text(title(d), Xlsx.TITLE));
        summary.row(Xlsx.text(m.t("Período: {0}", period(d))));
        summary.row();
        summary.row(Xlsx.text(m.t("Receitas (pagas)"), Xlsx.BOLD), Xlsx.num(d.income(), Xlsx.MONEY));
        summary.row(Xlsx.text(m.t("Despesas (pagas)"), Xlsx.BOLD), Xlsx.num(d.expense(), Xlsx.MONEY));
        summary.row(Xlsx.text(m.t("Saldo do período"), Xlsx.BOLD), Xlsx.num(d.balance(), Xlsx.MONEY_BOLD));
        summary.row(Xlsx.text(m.t("A receber (pendente)")), Xlsx.num(d.pendingIncome(), Xlsx.MONEY));
        summary.row(Xlsx.text(m.t("A pagar (pendente)")), Xlsx.num(d.pendingExpense(), Xlsx.MONEY));
        summary.row();
        summary.row(Xlsx.text(m.t("Despesas por categoria"), Xlsx.HEADER), Xlsx.text(m.t("Total"), Xlsx.HEADER), Xlsx.text("%", Xlsx.HEADER));
        for (Map.Entry<String, BigDecimal> en : d.byCategory().entrySet()) {
            summary.row(Xlsx.text(en.getKey()), Xlsx.num(en.getValue(), Xlsx.MONEY),
                    d.expense().signum() == 0 ? Xlsx.text("") : Xlsx.num(en.getValue().divide(d.expense(), 4, java.math.RoundingMode.HALF_UP), Xlsx.PERCENT));
        }

        Xlsx.Sheet list = book.sheet(m.t("Lançamentos"), new double[]{12, 38, 22, 20, 16, 12, 14, 24, 28}, true);
        list.row(Xlsx.text(m.t("Data"), Xlsx.HEADER), Xlsx.text(m.t("Descrição"), Xlsx.HEADER), Xlsx.text(m.t("Categoria"), Xlsx.HEADER),
                Xlsx.text(m.t("Conta"), Xlsx.HEADER), Xlsx.text(m.t("Forma de pagamento"), Xlsx.HEADER), Xlsx.text(m.t("Tipo"), Xlsx.HEADER),
                Xlsx.text(m.t("Valor"), Xlsx.HEADER), Xlsx.text(m.t("Situação"), Xlsx.HEADER), Xlsx.text("Tags", Xlsx.HEADER));
        int rowNumber = 1;
        for (Expense e : d.expenses()) {
            rowNumber++;
            list.row(Xlsx.date(e.getDate()), Xlsx.text(e.getName()), Xlsx.text(categoryLabel(e.getCategory())),
                    Xlsx.text(e.getAccount().getName()),
                    Xlsx.text(e.getPaymentMethod() == null ? "" : e.getPaymentMethod().getName()),
                    Xlsx.text(m.t(e.isIncome() ? "Receita" : "Despesa")),
                    Xlsx.num(e.isIncome() ? e.getAmount() : e.getAmount().negate(), Xlsx.MONEY),
                    Xlsx.text(m.t(e.isPaid() ? "Pago" : e.isIncome() ? "A receber" : "A pagar")), Xlsx.text(tagsOf(e)));
        }
        if (rowNumber > 1) {
            BigDecimal paidTotal = d.balance();
            list.row(Xlsx.text(m.t("Saldo pago"), Xlsx.BOLD), Xlsx.text(""), Xlsx.text(""), Xlsx.text(""), Xlsx.text(""),
                    Xlsx.text(""), Xlsx.formula("SUMIF(H2:H" + rowNumber + ",\"" + m.t("Pago") + "\",G2:G" + rowNumber + ")", paidTotal, Xlsx.MONEY_BOLD));
        }

        Xlsx.Sheet moves = book.sheet(m.t("Transferências"), new double[]{12, 34, 22, 22, 16}, true);
        moves.row(Xlsx.text(m.t("Data"), Xlsx.HEADER), Xlsx.text(m.t("Descrição"), Xlsx.HEADER), Xlsx.text(m.t("De"), Xlsx.HEADER),
                Xlsx.text(m.t("Para"), Xlsx.HEADER), Xlsx.text(m.t("Valor"), Xlsx.HEADER));
        for (Transfer t : d.transfers()) {
            moves.row(Xlsx.date(t.getDate()), Xlsx.text(t.getDescription() == null ? m.t("Transferência") : t.getDescription()),
                    Xlsx.text(t.getFromAccount().getName()), Xlsx.text(t.getToAccount().getName()), Xlsx.num(t.getAmount(), Xlsx.MONEY));
        }
        return book.build();
    }

    /** A very small .xlsx writer: sheets of rows of text, numbers, dates and formulas, with a handful of styles. */
    static final class Xlsx {

        static final int DEFAULT = 0, HEADER = 1, DATE = 2, MONEY = 3, BOLD = 4, TITLE = 5, MONEY_BOLD = 6, PERCENT = 7;

        record Cell(String kind, String text, BigDecimal number, String formula, int style) {
        }

        static Cell text(String value) {
            return new Cell("s", value, null, null, DEFAULT);
        }

        static Cell text(String value, int style) {
            return new Cell("s", value, null, null, style);
        }

        static Cell num(BigDecimal value, int style) {
            return new Cell("n", null, value, null, style);
        }

        static Cell date(LocalDate date) {
            return new Cell("n", null, BigDecimal.valueOf(ChronoUnit.DAYS.between(LocalDate.of(1899, 12, 30), date)), null, DATE);
        }

        static Cell formula(String formula, BigDecimal cached, int style) {
            return new Cell("f", null, cached, formula, style);
        }

        static final class Sheet {
            final String name;
            final double[] widths;
            final boolean freezeHeader;
            final List<Cell[]> rows = new ArrayList<>();

            Sheet(String name, double[] widths, boolean freezeHeader) {
                this.name = name;
                this.widths = widths;
                this.freezeHeader = freezeHeader;
            }

            void row(Cell... cells) {
                rows.add(cells);
            }
        }

        private final List<Sheet> sheets = new ArrayList<>();

        Sheet sheet(String name, double[] widths, boolean freezeHeader) {
            Sheet s = new Sheet(name, widths, freezeHeader);
            sheets.add(s);
            return s;
        }

        byte[] build() {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (ZipOutputStream zip = new ZipOutputStream(bytes, StandardCharsets.UTF_8)) {
                StringBuilder types = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
                        + "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
                        + "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
                        + "<Default Extension=\"xml\" ContentType=\"application/xml\"/>"
                        + "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>"
                        + "<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>");
                StringBuilder workbook = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
                        + "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" "
                        + "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets>");
                StringBuilder rels = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
                        + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">");
                List<String> sheetFiles = new ArrayList<>();
                for (int i = 0; i < sheets.size(); i++) {
                    int n = i + 1;
                    types.append("<Override PartName=\"/xl/worksheets/sheet").append(n)
                            .append(".xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>");
                    workbook.append("<sheet name=\"").append(esc(sheets.get(i).name)).append("\" sheetId=\"").append(n)
                            .append("\" r:id=\"rId").append(n).append("\"/>");
                    rels.append("<Relationship Id=\"rId").append(n)
                            .append("\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet")
                            .append(n).append(".xml\"/>");
                    sheetFiles.add(sheetXml(sheets.get(i)));
                }
                rels.append("<Relationship Id=\"rId").append(sheets.size() + 1)
                        .append("\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/></Relationships>");
                put(zip, "[Content_Types].xml", types.append("</Types>").toString());
                put(zip, "_rels/.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
                        + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                        + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>");
                put(zip, "xl/workbook.xml", workbook.append("</sheets></workbook>").toString());
                put(zip, "xl/_rels/workbook.xml.rels", rels.toString());
                put(zip, "xl/styles.xml", STYLES);
                for (int i = 0; i < sheetFiles.size(); i++) {
                    put(zip, "xl/worksheets/sheet" + (i + 1) + ".xml", sheetFiles.get(i));
                }
            } catch (IOException e) {
                throw new IllegalStateException("Não foi possível gerar a planilha", e);
            }
            return bytes.toByteArray();
        }

        private static void put(ZipOutputStream zip, String name, String content) throws IOException {
            zip.putNextEntry(new ZipEntry(name));
            zip.write(content.getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
        }

        private static String sheetXml(Sheet sheet) {
            StringBuilder x = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
                    + "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">");
            if (sheet.freezeHeader) {
                x.append("<sheetViews><sheetView workbookViewId=\"0\"><pane ySplit=\"1\" topLeftCell=\"A2\" activePane=\"bottomLeft\" state=\"frozen\"/></sheetView></sheetViews>");
            }
            x.append("<cols>");
            for (int i = 0; i < sheet.widths.length; i++) {
                x.append("<col min=\"").append(i + 1).append("\" max=\"").append(i + 1).append("\" width=\"")
                        .append(sheet.widths[i]).append("\" customWidth=\"1\"/>");
            }
            x.append("</cols><sheetData>");
            int r = 0;
            for (Cell[] row : sheet.rows) {
                r++;
                x.append("<row r=\"").append(r).append("\">");
                for (int c = 0; c < row.length; c++) {
                    Cell cell = row[c];
                    String ref = column(c) + r;
                    switch (cell.kind()) {
                        case "s" -> x.append("<c r=\"").append(ref).append("\" t=\"inlineStr\" s=\"").append(cell.style())
                                .append("\"><is><t xml:space=\"preserve\">").append(esc(cell.text() == null ? "" : cell.text())).append("</t></is></c>");
                        case "f" -> x.append("<c r=\"").append(ref).append("\" s=\"").append(cell.style()).append("\"><f>")
                                .append(esc(cell.formula())).append("</f><v>").append(cell.number().toPlainString()).append("</v></c>");
                        default -> x.append("<c r=\"").append(ref).append("\" s=\"").append(cell.style()).append("\"><v>")
                                .append(cell.number().toPlainString()).append("</v></c>");
                    }
                }
                x.append("</row>");
            }
            return x.append("</sheetData></worksheet>").toString();
        }

        private static String column(int index) {
            StringBuilder s = new StringBuilder();
            for (int i = index; i >= 0; i = i / 26 - 1) {
                s.insert(0, (char) ('A' + i % 26));
            }
            return s.toString();
        }

        /** Escapes XML and drops characters XML cannot hold. */
        private static String esc(String s) {
            StringBuilder out = new StringBuilder();
            for (char ch : s.toCharArray()) {
                switch (ch) {
                    case '&' -> out.append("&amp;");
                    case '<' -> out.append("&lt;");
                    case '>' -> out.append("&gt;");
                    case '"' -> out.append("&quot;");
                    default -> {
                        if (ch >= 0x20 || ch == '\t' || ch == '\n') {
                            out.append(ch);
                        }
                    }
                }
            }
            return out.toString();
        }

        private static final String STYLES = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
                + "<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">"
                + "<numFmts count=\"3\"><numFmt numFmtId=\"164\" formatCode=\"#,##0.00\"/>"
                + "<numFmt numFmtId=\"165\" formatCode=\"dd/mm/yyyy\"/><numFmt numFmtId=\"166\" formatCode=\"0%\"/></numFmts>"
                + "<fonts count=\"4\"><font><sz val=\"11\"/><name val=\"Calibri\"/></font>"
                + "<font><b/><sz val=\"11\"/><name val=\"Calibri\"/></font>"
                + "<font><b/><sz val=\"11\"/><color rgb=\"FFFFFFFF\"/><name val=\"Calibri\"/></font>"
                + "<font><b/><sz val=\"14\"/><color rgb=\"FF2F7D6D\"/><name val=\"Calibri\"/></font></fonts>"
                + "<fills count=\"3\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill>"
                + "<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FF2F7D6D\"/><bgColor indexed=\"64\"/></patternFill></fill></fills>"
                + "<borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders>"
                + "<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>"
                + "<cellXfs count=\"8\">"
                + "<xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>"
                + "<xf numFmtId=\"0\" fontId=\"2\" fillId=\"2\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\"/>"
                + "<xf numFmtId=\"165\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/>"
                + "<xf numFmtId=\"164\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/>"
                + "<xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/>"
                + "<xf numFmtId=\"0\" fontId=\"3\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/>"
                + "<xf numFmtId=\"164\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\"/>"
                + "<xf numFmtId=\"166\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/>"
                + "</cellXfs><cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles></styleSheet>";
    }
}
