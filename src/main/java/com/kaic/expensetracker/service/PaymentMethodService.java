package com.kaic.expensetracker.service;

import com.kaic.expensetracker.model.PaymentMethod;
import com.kaic.expensetracker.repository.ExpenseRepository;
import com.kaic.expensetracker.repository.PaymentMethodRepository;
import com.kaic.expensetracker.repository.RecurringPaymentRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;

@Service
@Transactional(readOnly = true)
public class PaymentMethodService {

    private final PaymentMethodRepository paymentMethodRepository;
    private final ExpenseRepository expenseRepository;
    private final RecurringPaymentRepository recurringPaymentRepository;

    public PaymentMethodService(PaymentMethodRepository paymentMethodRepository, ExpenseRepository expenseRepository,
                                RecurringPaymentRepository recurringPaymentRepository) {
        this.paymentMethodRepository = paymentMethodRepository;
        this.expenseRepository = expenseRepository;
        this.recurringPaymentRepository = recurringPaymentRepository;
    }

    public List<PaymentMethod> findAll() {
        return paymentMethodRepository.findAllByOrderByNameAsc();
    }

    public PaymentMethod getOrThrow(Long id) {
        return paymentMethodRepository.findById(id).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "Forma de pagamento não encontrada: " + id));
    }

    @Transactional
    public PaymentMethod create(String name) {
        if (paymentMethodRepository.existsByNameIgnoreCase(name.trim())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Já existe uma forma de pagamento com esse nome.");
        }
        PaymentMethod method = new PaymentMethod();
        method.setName(name.trim());
        return paymentMethodRepository.save(method);
    }

    @Transactional
    public PaymentMethod update(Long id, String name) {
        PaymentMethod method = getOrThrow(id);
        boolean renamed = !method.getName().equalsIgnoreCase(name.trim());
        if (renamed && paymentMethodRepository.existsByNameIgnoreCase(name.trim())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Já existe uma forma de pagamento com esse nome.");
        }
        method.setName(name.trim());
        return paymentMethodRepository.save(method);
    }

    /** Transactions keep existing; they just lose the payment method. */
    @Transactional
    public void delete(Long id) {
        PaymentMethod method = getOrThrow(id);
        expenseRepository.detachPaymentMethod(id);
        recurringPaymentRepository.detachPaymentMethod(method);
        paymentMethodRepository.delete(method);
    }
}
