package com.kaic.expensetracker.controller;

import com.kaic.expensetracker.service.TagService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** Tags already used, to suggest while typing. They are created automatically when a transaction uses them. */
@RestController
@RequestMapping("/tags")
public class TagController {

    private final TagService service;

    public TagController(TagService service) {
        this.service = service;
    }

    @GetMapping
    public List<String> getAll() {
        return service.names();
    }
}
