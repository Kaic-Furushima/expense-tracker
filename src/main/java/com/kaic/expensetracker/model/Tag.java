package com.kaic.expensetracker.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.Objects;

/** A free label on a transaction (for example "viagem"). Stored lowercase and without the leading #. */
@Entity
@Table(name = "tags")
@Getter
@Setter
public class Tag extends SyncEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 40)
    private String name;

    @Override
    public boolean equals(Object o) {
        return o instanceof Tag other && Objects.equals(name, other.name);
    }

    @Override
    public int hashCode() {
        return Objects.hashCode(name);
    }
}
