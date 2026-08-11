package com.raj.document_qna_assistant.dto;

import jakarta.validation.constraints.NotBlank;
import java.util.UUID;

public record ChatRequest(
    UUID conversationId,
    @NotBlank(message = "Question cannot be blank") String question,
    String category
) {}
