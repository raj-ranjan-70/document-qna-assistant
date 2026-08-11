package com.raj.document_qna_assistant.dto;

import java.util.List;
import java.util.UUID;

public record ChatResponse(
    String answer,
    UUID conversationId,
    List<SourceDto> sources
) {}
