package com.kaic.expensetracker.service;

import com.kaic.expensetracker.model.Attachment;
import com.kaic.expensetracker.repository.AttachmentRepository;
import com.kaic.expensetracker.repository.ExpenseRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Receipts attached to transactions: images (JPEG, PNG, GIF, WebP) or PDF, up to 5 MB each and 5 per transaction.
 * The content is checked by its first bytes (not by the name the client gives), so a disguised file is refused.
 */
@Service
@Transactional(readOnly = true)
public class AttachmentService {

    public static final long MAX_BYTES = 5L * 1024 * 1024;
    public static final int MAX_PER_EXPENSE = 5;

    private final AttachmentRepository repository;
    private final ExpenseRepository expenseRepository;

    public AttachmentService(AttachmentRepository repository, ExpenseRepository expenseRepository) {
        this.repository = repository;
        this.expenseRepository = expenseRepository;
    }

    public record Meta(Long id, String fileName, String contentType, long sizeBytes, LocalDateTime createdAt) {
    }

    public List<Meta> list(Long expenseId) {
        return repository.listOf(expenseId).stream()
                .map(r -> new Meta((Long) r[0], (String) r[1], (String) r[2], (Long) r[3], (LocalDateTime) r[4]))
                .toList();
    }

    /** How many attachments each transaction has (only those that have any). */
    public Map<Long, Long> counts() {
        Map<Long, Long> result = new HashMap<>();
        repository.countsByExpense().forEach(r -> result.put((Long) r[0], (Long) r[1]));
        return result;
    }

    public Attachment get(Long id) {
        return repository.findById(id).orElseThrow(() ->
                new ResponseStatusException(HttpStatus.NOT_FOUND, "Anexo não encontrado: " + id));
    }

    @Transactional
    public Meta add(Long expenseId, String fileName, String base64) {
        if (expenseRepository.findById(expenseId).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Lançamento não encontrado: " + expenseId);
        }
        if (repository.countByExpenseId(expenseId) >= MAX_PER_EXPENSE) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Cada lançamento aceita até " + MAX_PER_EXPENSE + " anexos.");
        }
        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(base64 == null ? "" : base64.trim());
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "O arquivo não pôde ser lido.");
        }
        if (bytes.length == 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "O arquivo está vazio.");
        }
        if (bytes.length > MAX_BYTES) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "O arquivo passa de 5 MB.");
        }
        String type = detectType(bytes);
        if (type == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Só são aceitas imagens (JPEG, PNG, GIF, WebP) e arquivos PDF.");
        }
        Attachment a = new Attachment();
        a.setExpenseId(expenseId);
        a.setFileName(cleanName(fileName));
        a.setContentType(type);
        a.setSizeBytes(bytes.length);
        a.setData(Base64.getEncoder().encodeToString(bytes));
        a = repository.save(a);
        return new Meta(a.getId(), a.getFileName(), a.getContentType(), a.getSizeBytes(), a.getCreatedAt());
    }

    @Transactional
    public void delete(Long id) {
        get(id);
        repository.deleteById(id);
    }

    public static byte[] decode(Attachment a) {
        return Base64.getDecoder().decode(a.getData());
    }

    static String detectType(byte[] b) {
        if (b.length >= 3 && (b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8 && (b[2] & 0xFF) == 0xFF) {
            return "image/jpeg";
        }
        if (b.length >= 8 && (b[0] & 0xFF) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G') {
            return "image/png";
        }
        if (b.length >= 6 && b[0] == 'G' && b[1] == 'I' && b[2] == 'F' && b[3] == '8') {
            return "image/gif";
        }
        if (b.length >= 12 && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F'
                && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') {
            return "image/webp";
        }
        if (b.length >= 5 && b[0] == '%' && b[1] == 'P' && b[2] == 'D' && b[3] == 'F' && b[4] == '-') {
            return "application/pdf";
        }
        return null;
    }

    private static String cleanName(String name) {
        String base = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (base.isEmpty()) {
            base = "comprovante";
        }
        return base.length() > 150 ? base.substring(0, 150) : base;
    }
}
