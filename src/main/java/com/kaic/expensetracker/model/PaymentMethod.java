package com.kaic.expensetracker.model;

import jakarta.persistence.*;
import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;

/** How a payment was made (Pix, debit, credit...). Independent from the account it came out of. */
@Entity
@Table(name = "payment_methods")
@Getter
@Setter
public class PaymentMethod extends SyncEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @NotBlank(message = "Informe o nome da forma de pagamento.")
    @Column(nullable = false, unique = true, length = 60)
    private String name;
}
