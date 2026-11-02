package com.kaic.expensetracker.repository;

import com.kaic.expensetracker.model.Attachment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;

public interface AttachmentRepository extends JpaRepository<Attachment, Long> {

    /** Rows of {id, file name, content type, size, created at} without the (large) file content. */
    @Query("select a.id, a.fileName, a.contentType, a.sizeBytes, a.createdAt from Attachment a "
            + "where a.expenseId = :expenseId order by a.id")
    List<Object[]> listOf(Long expenseId);

    long countByExpenseId(Long expenseId);

    /** Rows of {expense id, how many attachments}, for the whole app. */
    @Query("select a.expenseId, count(a) from Attachment a group by a.expenseId")
    List<Object[]> countsByExpense();
}
