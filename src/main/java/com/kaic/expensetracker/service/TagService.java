package com.kaic.expensetracker.service;

import com.kaic.expensetracker.model.Tag;
import com.kaic.expensetracker.repository.TagRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Free labels for transactions. They are created on first use and normalized to lowercase without "#". */
@Service
@Transactional(readOnly = true)
public class TagService {

    public static final int MAX_TAGS_PER_TRANSACTION = 10;
    private static final int MAX_LENGTH = 40;

    private final TagRepository tags;

    public TagService(TagRepository tags) {
        this.tags = tags;
    }

    public List<String> names() {
        return tags.findAllByOrderByNameAsc().stream().map(Tag::getName).toList();
    }

    /** Turns what the user typed into persisted tags, creating the ones that do not exist yet. */
    @Transactional
    public Set<Tag> resolve(Collection<String> raw) {
        Set<Tag> result = new LinkedHashSet<>();
        if (raw == null) {
            return result;
        }
        for (String text : raw) {
            String name = normalize(text);
            if (name.isEmpty()) {
                continue;
            }
            if (name.length() > MAX_LENGTH) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Cada tag pode ter até " + MAX_LENGTH + " caracteres.");
            }
            result.add(tags.findByNameIgnoreCase(name).orElseGet(() -> {
                Tag tag = new Tag();
                tag.setName(name);
                return tags.save(tag);
            }));
        }
        if (result.size() > MAX_TAGS_PER_TRANSACTION) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Use no máximo " + MAX_TAGS_PER_TRANSACTION + " tags por lançamento.");
        }
        return result;
    }

    static String normalize(String text) {
        if (text == null) {
            return "";
        }
        String name = text.trim();
        while (name.startsWith("#")) {
            name = name.substring(1);
        }
        return name.trim().toLowerCase(Locale.ROOT).replaceAll("\\s+", "-");
    }
}
