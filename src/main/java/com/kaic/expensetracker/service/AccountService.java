package com.kaic.expensetracker.service;

import com.kaic.expensetracker.model.Account;
import com.kaic.expensetracker.model.AccountType;
import com.kaic.expensetracker.model.Expense;
import com.kaic.expensetracker.model.ExpenseStatus;
import com.kaic.expensetracker.model.TransactionType;
import com.kaic.expensetracker.repository.AccountRepository;
import com.kaic.expensetracker.repository.ExpenseRepository;
import com.kaic.expensetracker.repository.PotRepository;
import com.kaic.expensetracker.repository.RecurringPaymentRepository;
import com.kaic.expensetracker.repository.TransferRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
@Transactional(readOnly = true)
public class AccountService {

    private static final String DEFAULT_COLOR = "#64B5F6";

    private final AccountRepository accountRepository;
    private final ExpenseRepository expenseRepository;
    private final RecurringPaymentRepository recurringPaymentRepository;
    private final TransferRepository transferRepository;
    private final PotRepository potRepository;
    private final Clock clock;

    public AccountService(AccountRepository accountRepository, ExpenseRepository expenseRepository,
                          RecurringPaymentRepository recurringPaymentRepository, TransferRepository transferRepository,
                          PotRepository potRepository, Clock clock) {
        this.clock = clock;
        this.potRepository = potRepository;
        this.accountRepository = accountRepository;
        this.expenseRepository = expenseRepository;
        this.recurringPaymentRepository = recurringPaymentRepository;
        this.transferRepository = transferRepository;
    }

    /** Fields of an account, as typed by the user. */
    public record Draft(String name, AccountType type, String color, String icon, BigDecimal initialBalance,
                        Long parentId, boolean archived, Integer closingDay, Integer dueDay, Boolean saved) {

        public Draft(String name, AccountType type, String color, String icon, BigDecimal initialBalance,
                     Long parentId, boolean archived, Integer closingDay, Integer dueDay) {
            this(name, type, color, icon, initialBalance, parentId, archived, closingDay, dueDay, null);
        }

        public Draft(String name, AccountType type, String color, String icon, BigDecimal initialBalance,
                     Long parentId, boolean archived) {
            this(name, type, color, icon, initialBalance, parentId, archived, null, null, null);
        }
    }

    public List<Account> findAll() {
        return accountRepository.findAllByOrderByNameAsc();
    }

    public Account getOrThrow(Long id) {
        return accountRepository.findById(id).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "Conta não encontrada: " + id));
    }

    /** The account used when a transaction does not say which one: the oldest top-level account that is not archived. */
    public Account defaultAccount() {
        return accountRepository.findFirstByArchivedFalseAndParentIsNullOrderByIdAsc().orElseThrow(() ->
                new ResponseStatusException(HttpStatus.CONFLICT, "Cadastre uma conta antes de lançar."));
    }

    /**
     * Current balance of every account: initial balance + paid income − paid expenses + transfers received −
     * transfers sent. A sub-account has its own balance and does not count in its parent's.
     */
    public Map<Long, BigDecimal> balances() {
        Map<Long, BigDecimal> result = new HashMap<>();
        accountRepository.findAll().forEach(a -> result.put(a.getId(), a.getInitialBalance()));
        for (Object[] row : expenseRepository.sumByAccountAndType()) {
            Long accountId = (Long) row[0];
            boolean income = row[1] == TransactionType.INCOME;
            BigDecimal total = (BigDecimal) row[2];
            result.merge(accountId, income ? total : total.negate(), BigDecimal::add);
        }
        for (Object[] row : transferRepository.sumInByAccount()) {
            result.merge((Long) row[0], (BigDecimal) row[1], BigDecimal::add);
        }
        for (Object[] row : transferRepository.sumOutByAccount()) {
            result.merge((Long) row[0], ((BigDecimal) row[1]).negate(), BigDecimal::add);
        }
        return result;
    }

    @Transactional
    public Account create(Draft draft) {
        String name = requireName(draft.name());
        if (accountRepository.existsByNameIgnoreCase(name)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Já existe uma conta com esse nome.");
        }
        Account account = new Account();
        apply(account, draft);
        return accountRepository.save(account);
    }

    @Transactional
    public Account update(Long id, Draft draft) {
        Account account = getOrThrow(id);
        String name = requireName(draft.name());
        boolean renamed = !account.getName().equalsIgnoreCase(name);
        if (renamed && accountRepository.existsByNameIgnoreCase(name)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Já existe uma conta com esse nome.");
        }
        if (draft.archived() && !account.isArchived()) {
            if (accountRepository.existsByParentAndArchivedFalse(account)) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "Arquive primeiro as partes desta conta.");
            }
            if (account.getParent() == null && activeTopLevelCount() <= 1) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "Mantenha pelo menos uma conta ativa.");
            }
        }
        apply(account, draft);
        return accountRepository.save(account);
    }

    /** An account with history cannot be deleted (that would orphan its transactions): archive it instead. */
    @Transactional
    public void delete(Long id) {
        Account account = getOrThrow(id);
        if (accountRepository.existsByParent(account)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Esta conta tem partes (cofrinhos). Exclua ou mova-as antes.");
        }
        if (expenseRepository.countAllByAccountId(id) > 0 || transferRepository.countAllByAccountId(id) > 0
                || recurringPaymentRepository.countByAccount(account) > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Esta conta tem lançamentos, transferências ou pagamentos recorrentes (a lixeira conta). Arquive-a em vez de excluir.");
        }
        if (!account.isArchived() && account.getParent() == null && activeTopLevelCount() <= 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Mantenha pelo menos uma conta ativa.");
        }
        // as caixinhas atreladas a esta conta só perdem o vínculo
        potRepository.findByAccount(account).forEach(p -> {
            p.setAccount(null);
            potRepository.save(p);
        });
        accountRepository.delete(account);
    }

    public static final String ADJUSTMENT_NAME = "Correção de saldo";

    /**
     * "Correção de saldo": the person types the balance the account really has and the app records the difference as a
     * paid entry flagged as an adjustment (income when the balance goes up, expense when it goes down). It is shown on
     * its own in the month summary and is not counted as income or expense. Returns null when nothing had to change.
     */
    @Transactional
    public Expense adjustBalance(Long id, BigDecimal target) {
        Account account = getOrThrow(id);
        if (target == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Informe o saldo atual.");
        }
        if (account.getType() == AccountType.CREDIT_CARD) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Cartão de crédito não tem correção de saldo.");
        }
        BigDecimal wanted = target.setScale(2, RoundingMode.HALF_UP);
        if (wanted.abs().compareTo(new BigDecimal("999999999.99")) > 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "O saldo é alto demais.");
        }
        BigDecimal current = balances().getOrDefault(id, account.getInitialBalance());
        BigDecimal diff = wanted.subtract(current);
        if (diff.signum() == 0) {
            return null;
        }
        Expense entry = new Expense();
        entry.setName(ADJUSTMENT_NAME);
        entry.setAmount(diff.abs());
        entry.setDate(LocalDate.now(clock));
        entry.setType(diff.signum() > 0 ? TransactionType.INCOME : TransactionType.EXPENSE);
        entry.setStatus(ExpenseStatus.PAID);
        entry.setAccount(account);
        entry.setAdjustment(true);
        return expenseRepository.save(entry);
    }

    @Transactional
    public Account findOrCreate(String name, AccountType type, String color) {
        return accountRepository.findByNameIgnoreCase(name.trim())
                .orElseGet(() -> create(new Draft(name, type, color, null, BigDecimal.ZERO, null, false)));
    }

    private long activeTopLevelCount() {
        return accountRepository.findAll().stream().filter(a -> !a.isArchived() && a.getParent() == null).count();
    }

    private static String requireName(String name) {
        if (name == null || name.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Informe o nome da conta.");
        }
        return name.trim();
    }

    private void apply(Account account, Draft d) {
        Account parent = resolveParent(account, d.parentId());
        account.setName(d.name().trim());
        account.setType(d.type() == null ? AccountType.CHECKING : d.type());
        account.setColor(d.color() == null || !d.color().matches("#[0-9a-fA-F]{6}") ? DEFAULT_COLOR : d.color());
        account.setIcon(d.icon() == null || d.icon().isBlank() ? null : d.icon().trim());
        account.setInitialBalance(d.initialBalance() == null ? BigDecimal.ZERO : d.initialBalance());
        account.setParent(parent);
        account.setArchived(d.archived());
        // not sent (an old client): keep what the account already was
        if (d.saved() != null) account.setSaved(d.saved());
        boolean card = account.getType() == AccountType.CREDIT_CARD;
        account.setClosingDay(card ? requireDay(d.closingDay(), "fechamento") : null);
        account.setDueDay(card ? requireDay(d.dueDay(), "vencimento") : null);
    }

    private static Integer requireDay(Integer day, String what) {
        if (day != null && (day < 1 || day > 31)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "O dia de " + what + " deve ficar entre 1 e 31.");
        }
        return day;
    }

    /** Only one level: the parent must be a top-level account, and an account with parts cannot become a part. */
    private Account resolveParent(Account account, Long parentId) {
        if (parentId == null) {
            return null;
        }
        if (account.getId() != null && account.getId().equals(parentId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Uma conta não pode ficar dentro dela mesma.");
        }
        Account parent = getOrThrow(parentId);
        if (parent.getParent() != null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Só é possível ficar dentro de uma conta principal (um nível).");
        }
        if (account.getId() != null && accountRepository.existsByParent(account)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Esta conta já tem partes; não pode ficar dentro de outra.");
        }
        return parent;
    }
}
