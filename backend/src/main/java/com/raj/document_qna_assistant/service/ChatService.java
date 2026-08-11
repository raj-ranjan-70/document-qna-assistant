package com.raj.document_qna_assistant.service;

import com.raj.document_qna_assistant.config.TenantContext;
import com.raj.document_qna_assistant.dto.ChatRequest;
import com.raj.document_qna_assistant.dto.ChatResponse;
import com.raj.document_qna_assistant.dto.SourceDto;
import org.springframework.ai.chat.messages.SystemMessage;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class ChatService {

    private final RetrievalService retrievalService;
    private final ChatModel chatModel;

    @Value("${app.chat.top-k:5}")
    private int defaultTopK;

    @Value("${app.chat.similarity-threshold:0.62}")
    private double defaultThreshold;

    public ChatService(RetrievalService retrievalService, ChatModel chatModel) {
        this.retrievalService = retrievalService;
        this.chatModel = chatModel;
    }

    public ChatResponse chat(ChatRequest request) {
        String tenantId = TenantContext.getCurrentTenant();
        if (tenantId == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Tenant ID context missing");
        }

        // 1. Retrieve chunks at database level with filtering
        List<org.springframework.ai.document.Document> chunks = retrievalService.retrieveChunks(
                request.question(),
                tenantId,
                request.category(),
                defaultTopK,
                defaultThreshold
        );

        // 2. Refusal path: if insufficient evidence, refuse without calling LLM
        if (chunks.isEmpty()) {
            return new ChatResponse(
                    "not found in the available documents",
                    request.conversationId() != null ? request.conversationId() : UUID.randomUUID(),
                    List.of()
            );
        }

        // 3. Construct citations
        List<SourceDto> sources = new ArrayList<>();
        StringBuilder contextBuilder = new StringBuilder();
        for (org.springframework.ai.document.Document chunk : chunks) {
            Map<String, Object> metadata = chunk.getMetadata();
            String title = (String) metadata.getOrDefault("title", "Unknown");
            Integer page = (Integer) metadata.get("page_number");
            Double score = chunk.getScore(); // Cosine similarity score
            String content = chunk.getContent();

            sources.add(new SourceDto(title, page, score, content));

            contextBuilder.append("Source: ").append(title);
            if (page != null) {
                contextBuilder.append(", Page: ").append(page);
            }
            contextBuilder.append("\nContent:\n").append(content).append("\n---\n");
        }

        // 4. Construct grounded prompt
        String systemPrompt = """
            You are a helpful assistant that answers questions based ONLY on the provided context below.
            If the context does not contain enough information to answer the question, or if you are unsure, respond with "not found in the available documents" and nothing else.
            Do not make up facts, use external knowledge, or cite references not present in the context.
            
            Context:
            ---
            %s
            """.formatted(contextBuilder.toString());

        SystemMessage systemMessage = new SystemMessage(systemPrompt);
        UserMessage userMessage = new UserMessage(request.question());

        Prompt prompt = new Prompt(List.of(systemMessage, userMessage));

        // 5. Call OpenAI Model
        var response = chatModel.call(prompt);
        String answer = response.getResult().getOutput().getContent();

        UUID conversationId = request.conversationId() != null ? request.conversationId() : UUID.randomUUID();

        return new ChatResponse(answer, conversationId, sources);
    }
}
