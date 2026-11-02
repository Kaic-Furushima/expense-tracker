package com.kaic.expensetracker.model;

import jakarta.persistence.*;
import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;

@Entity
@Table(name = "categories")
@Getter
@Setter
public class Category {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @NotBlank(message = "Informe o nome da categoria.")
    @Column(nullable = false, unique = true)
    private String name;

    /** Icon key (or, for old data, an emoji) shown next to the category. */
    private String icon;

    /** Hex color such as #6750A4. */
    private String color;

    /** Set when this is a subcategory. Only one level is allowed: a parent cannot itself have a parent. */
    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumn(name = "parent_id")
    private Category parent;
}
