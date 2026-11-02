package com.kaic.expensetracker.service;

import com.kaic.expensetracker.model.Pot;
import com.kaic.expensetracker.model.PotEntry;
import com.kaic.expensetracker.model.PotEntryKind;
import com.kaic.expensetracker.model.PotMode;
import com.kaic.expensetracker.repository.PotEntryRepository;
import com.kaic.expensetracker.repository.PotRepository;
import com.kaic.expensetracker.repository.WishItemRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.List;

/**
 * Pots ("caixinhas"): money set aside that grows every month. A fixed pot receives the same amount automatically
 * each month; a variable pot receives whatever the user deposits. The money is a logical reservation: it stays in
 * its account and the app just keeps track of it.
 */
@Service
@Transactional(readOnly = true)
public class PotService {

    private final PotRepository pots;
    private final PotEntryRepository entries;
    private final WishItemRepository wishItems;
    private final Clock clock;

    public PotService(PotRepository pots, PotEntryRepository entries, WishItemRepository wishItems, Clock clock) {
        this.clock = clock;
        this.pots = pots;
        this.entries = entries;
        this.wishItems = wishItems;
    }

    /** Fields of a pot, as typed by the user. */
    public record Draft(String name, String color, String icon, BigDecimal goal, PotMode mode,
                        BigDecimal monthlyAmount, String startMonth, boolean active) {
    }

    /** Lists the pots after adding any automatic contribution that is due. */
    @Transactional
    public List<Pot> findAll() {
        sync();
        return pots.findAllByOrderByNameAsc();
    }

    public Pot getOrThrow(Long id) {
        return pots.findById(id).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "Caixinha não encontrada: " + id));
    }

    public BigDecimal balanceOf(Pot pot) {
        return entries.balanceOf(pot);
    }

    public List<PotEntry> entriesOf(Long potId) {
        return entries.findByPotOrderByEntryDateDescIdDesc(getOrThrow(potId));
    }

    @Transactional
    public Pot create(Draft draft) {
        Pot pot = new Pot();
        apply(pot, draft, true);
        Pot saved = pots.save(pot);
        sync();
        return saved;
    }

    @Transactional
    public Pot update(Long id, Draft draft) {
        Pot pot = getOrThrow(id);
        apply(pot, draft, false);
        Pot saved = pots.save(pot);
        sync();
        return saved;
    }

    /** Deleting a pot discards its history; wish-list items that pointed to it just lose the link. */
    @Transactional
    public void delete(Long id) {
        Pot pot = getOrThrow(id);
        wishItems.detachPot(pot);
        entries.deleteByPot(pot);
        pots.delete(pot);
    }

    @Transactional
    public PotEntry deposit(Long potId, BigDecimal amount, LocalDate date, String note) {
        requirePositive(amount);
        return addEntry(getOrThrow(potId), amount.setScale(2, RoundingMode.HALF_UP), date, PotEntryKind.MANUAL, note, null, null);
    }

    @Transactional
    public PotEntry withdraw(Long potId, BigDecimal amount, LocalDate date, String note) {
        requirePositive(amount);
        Pot pot = getOrThrow(potId);
        BigDecimal value = amount.setScale(2, RoundingMode.HALF_UP);
        if (balanceOf(pot).compareTo(value) < 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Saldo da caixinha insuficiente.");
        }
        return addEntry(pot, value.negate(), date, PotEntryKind.WITHDRAWAL, note, null, null);
    }

    /** Only manual movements can be removed; automatic contributions and purchases follow their source. */
    @Transactional
    public void deleteEntry(Long entryId) {
        PotEntry entry = entries.findById(entryId).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "Movimento não encontrado: " + entryId));
        if (entry.getKind() != PotEntryKind.MANUAL && entry.getKind() != PotEntryKind.WITHDRAWAL) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Só movimentos manuais podem ser removidos.");
        }
        entries.delete(entry);
    }

    /** Used by the wish list when an item is paid with the pot. */
    @Transactional
    public PotEntry recordPurchase(Pot pot, BigDecimal price, LocalDate date, String note, Long wishItemId) {
        if (balanceOf(pot).compareTo(price) < 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Saldo da caixinha insuficiente.");
        }
        return addEntry(pot, price.negate(), date, PotEntryKind.PURCHASE, note, null, wishItemId);
    }

    /** Adds the automatic monthly contribution of every fixed pot for each month that does not have one yet. */
    @Transactional
    public synchronized void sync() {
        YearMonth now = YearMonth.now();
        for (Pot pot : pots.findByActiveTrue()) {
            if (pot.getMode() != PotMode.FIXED || pot.getMonthlyAmount() == null || pot.getMonthlyAmount().signum() <= 0) {
                continue;
            }
            for (YearMonth m = pot.start(); !m.isAfter(now); m = m.plusMonths(1)) {
                if (!entries.existsByPotAndAutoMonth(pot, m.toString())) {
                    addEntry(pot, pot.getMonthlyAmount(), m.atDay(1), PotEntryKind.AUTO, "Aporte mensal", m.toString(), null);
                }
            }
        }
    }

    private PotEntry addEntry(Pot pot, BigDecimal amount, LocalDate date, PotEntryKind kind, String note,
                              String autoMonth, Long wishItemId) {
        PotEntry entry = new PotEntry();
        entry.setPot(pot);
        entry.setAmount(amount);
        entry.setEntryDate(date == null ? LocalDate.now(clock) : date);
        entry.setKind(kind);
        entry.setNote(note == null || note.isBlank() ? null : note.trim());
        entry.setAutoMonth(autoMonth);
        entry.setWishItemId(wishItemId);
        return entries.save(entry);
    }

    private void apply(Pot pot, Draft d, boolean creating) {
        if (d.name() == null || d.name().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Informe o nome da caixinha.");
        }
        String name = d.name().trim();
        boolean renamed = creating || !pot.getName().equalsIgnoreCase(name);
        if (renamed && pots.existsByNameIgnoreCase(name)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Já existe uma caixinha com esse nome.");
        }
        PotMode mode = d.mode() == null ? PotMode.VARIABLE : d.mode();
        if (mode == PotMode.FIXED && (d.monthlyAmount() == null || d.monthlyAmount().signum() <= 0)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Informe o valor do aporte mensal.");
        }
        if (d.goal() != null && d.goal().signum() <= 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A meta deve ser maior que zero.");
        }
        YearMonth start = d.startMonth() == null || d.startMonth().isBlank() ? YearMonth.now() : parseMonth(d.startMonth());
        pot.setName(name);
        pot.setColor(d.color() == null || !d.color().matches("#[0-9a-fA-F]{6}") ? "#81C784" : d.color());
        pot.setIcon(d.icon() == null || d.icon().isBlank() ? null : d.icon().trim());
        pot.setGoal(d.goal() == null ? null : d.goal().setScale(2, RoundingMode.HALF_UP));
        pot.setMode(mode);
        pot.setMonthlyAmount(mode == PotMode.FIXED ? d.monthlyAmount().setScale(2, RoundingMode.HALF_UP) : null);
        // The start month of an existing pot is kept so already-created contributions stay consistent.
        if (creating) {
            pot.setStartMonth(start.toString());
        }
        pot.setActive(d.active());
    }

    private static void requirePositive(BigDecimal amount) {
        if (amount == null || amount.signum() <= 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Informe um valor maior que zero.");
        }
    }

    private static YearMonth parseMonth(String text) {
        try {
            return YearMonth.parse(text);
        } catch (RuntimeException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Mês inválido: " + text + " (use aaaa-mm).");
        }
    }
}
