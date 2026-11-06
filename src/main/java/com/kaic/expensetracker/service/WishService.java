package com.kaic.expensetracker.service;

import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.model.TransactionType;
import com.kaic.expensetracker.model.WishItem;
import com.kaic.expensetracker.model.WishStatus;
import com.kaic.expensetracker.repository.PotEntryRepository;
import com.kaic.expensetracker.repository.WishItemRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.LocalDate;
import java.util.List;

/**
 * Wish list. An item has an estimated price and belongs to no account. Buying it records the real price and the
 * account, and creates the expense.
 */
@Service
@Transactional(readOnly = true)
public class WishService {

    private final WishItemRepository wishItems;
    private final PotEntryRepository potEntries;
    private final PotService potService;
    private final ExpenseService expenseService;
    private final AccountService accountService;
    private final PaymentMethodService paymentMethodService;
    private final CategoryService categoryService;
    private final Clock clock;

    public WishService(WishItemRepository wishItems, PotEntryRepository potEntries, PotService potService,
                       ExpenseService expenseService, AccountService accountService,
                       PaymentMethodService paymentMethodService, CategoryService categoryService, Clock clock) {
        this.clock = clock;
        this.wishItems = wishItems;
        this.potEntries = potEntries;
        this.potService = potService;
        this.expenseService = expenseService;
        this.accountService = accountService;
        this.paymentMethodService = paymentMethodService;
        this.categoryService = categoryService;
    }

    public record Draft(String name, BigDecimal estimatedPrice, String notes, String url, Long potId) {
    }

    /** What is needed to turn a wish into a purchase. */
    public record Purchase(BigDecimal price, LocalDate date, Long accountId, Long paymentMethodId, Long categoryId,
                           boolean usePot, int installments) {

        /** A vista (uma parcela só). */
        public Purchase(BigDecimal price, LocalDate date, Long accountId, Long paymentMethodId, Long categoryId, boolean usePot) {
            this(price, date, accountId, paymentMethodId, categoryId, usePot, 1);
        }
    }

    public List<WishItem> findAll() {
        return wishItems.findAllByOrderByIdDesc();
    }

    public WishItem getOrThrow(Long id) {
        return wishItems.findById(id).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "Item da lista de desejos não encontrado: " + id));
    }

    @Transactional
    public WishItem create(Draft draft) {
        WishItem item = new WishItem();
        apply(item, draft);
        return wishItems.save(item);
    }

    @Transactional
    public WishItem update(Long id, Draft draft) {
        WishItem item = getOrThrow(id);
        apply(item, draft);
        return wishItems.save(item);
    }

    /** Deleting a bought item keeps the expense that was created for it. */
    @Transactional
    public void delete(Long id) {
        WishItem item = getOrThrow(id);
        potEntries.deleteByWishItemIdAndKind(item.getId(), com.kaic.expensetracker.model.PotEntryKind.PURCHASE);
        wishItems.delete(item);
    }

    @Transactional
    public WishItem discard(Long id) {
        WishItem item = getOrThrow(id);
        if (item.getStatus() == WishStatus.BOUGHT) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Este item já foi comprado.");
        }
        item.setStatus(WishStatus.DISCARDED);
        return wishItems.save(item);
    }

    @Transactional
    public WishItem restore(Long id) {
        WishItem item = getOrThrow(id);
        if (item.getStatus() != WishStatus.DISCARDED) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Só itens descartados podem voltar para a lista.");
        }
        item.setStatus(WishStatus.WISHED);
        return wishItems.save(item);
    }

    @Transactional
    public WishItem buy(Long id, Purchase purchase) {
        WishItem item = getOrThrow(id);
        if (item.getStatus() == WishStatus.BOUGHT) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Este item já foi comprado.");
        }
        if (purchase.price() == null || purchase.price().compareTo(new BigDecimal("0.01")) < 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Informe o preço pago.");
        }
        if (purchase.accountId() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Informe em qual conta foi a compra.");
        }
        BigDecimal price = purchase.price().setScale(2, RoundingMode.HALF_UP);
        LocalDate date = purchase.date() == null ? LocalDate.now(clock) : purchase.date();

        Expense expense = new Expense();
        expense.setName(item.getName());
        expense.setDescription(item.getNotes());
        expense.setAmount(price);
        expense.setDate(date);
        expense.setType(TransactionType.EXPENSE);
        expense.setAccount(accountService.getOrThrow(purchase.accountId()));
        expense.setPaymentMethod(purchase.paymentMethodId() == null ? null : paymentMethodService.getOrThrow(purchase.paymentMethodId()));
        expense.setCategory(purchase.categoryId() == null ? null : categoryService.getOrThrow(purchase.categoryId()));
        // Parcelado: o preço é o total; a primeira parcela fica paga e as outras "a pagar" (no cartão, todas já contam)
        Expense saved = purchase.installments() > 1
                ? expenseService.saveInstallments(expense, purchase.installments()).get(0)
                : expenseService.save(expense);

        if (purchase.usePot() && item.getPot() != null) {
            potService.recordPurchase(item.getPot(), price, date, "Compra: " + item.getName(), item.getId());
        }
        item.setStatus(WishStatus.BOUGHT);
        item.setRealPrice(price);
        item.setPurchaseDate(date);
        item.setExpense(saved);
        return wishItems.save(item);
    }

    private void apply(WishItem item, Draft d) {
        if (d.name() == null || d.name().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Informe o nome do produto.");
        }
        if (d.estimatedPrice() != null && d.estimatedPrice().signum() <= 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "O preço estimado deve ser maior que zero.");
        }
        item.setName(d.name().trim());
        item.setEstimatedPrice(d.estimatedPrice() == null ? null : d.estimatedPrice().setScale(2, RoundingMode.HALF_UP));
        item.setNotes(d.notes() == null || d.notes().isBlank() ? null : d.notes().trim());
        item.setUrl(d.url() == null || d.url().isBlank() ? null : d.url().trim());
        item.setPot(d.potId() == null ? null : potService.getOrThrow(d.potId()));
    }
}
