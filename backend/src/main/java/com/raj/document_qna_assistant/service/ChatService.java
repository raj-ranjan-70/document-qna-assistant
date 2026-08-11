package com.raj.document_qna_assistant.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.raj.document_qna_assistant.config.TenantContext;
import com.raj.document_qna_assistant.dto.ChatRequest;
import com.raj.document_qna_assistant.dto.ChatResponse;
import com.raj.document_qna_assistant.dto.SourceDto;
import com.raj.document_qna_assistant.entity.Conversation;
import com.raj.document_qna_assistant.entity.Message;
import com.raj.document_qna_assistant.repository.ConversationRepository;
import com.raj.document_qna_assistant.repository.MessageRepository;
import com.raj.document_qna_assistant.util.TokenEstimator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.SystemMessage;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse as AiChatResponse;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class ChatService {

    private static final Logger log = LoggerFactory.getLogger(ChatService.class);

    private final RetrievalService retrievalService;
    private final ChatModel chatModel;
    private final ConversationRepository conversationRepository;
    private final MessageRepository messageRepository;
    private final ObjectMapper objectMapper;
    private final TransactionTemplate transactionTemplate;

    @Value("${app.chat.top-k:5}")
    private int defaultTopK;

    @Value("${app.chat.similarity-threshold:0.62}")
    private double defaultThreshold;

    @Value("${app.chat.max-turns:6}")
    private int defaultMaxTurns;

    @Value("${app.chat.token-budget:3000}")
    private int tokenBudget;

    public ChatService(RetrievalService retrievalService, 
                       ChatModel chatModel,
                       ConversationRepository conversationRepository,
                       MessageRepository messageRepository,
                       ObjectMapper objectMapper,
                       TransactionTemplate transactionTemplate) {
        this.retrievalService = retrievalService;
        this.chatModel = chatModel;
        this.conversationRepository = conversationRepository;
        this.messageRepository = messageRepository;
        this.objectMapper = objectMapper;
        this.transactionTemplate = transactionTemplate;
    }

    @Transactional
    public ChatResponse chat(ChatRequest request) {
        String tenantId = TenantContext.getCurrentTenant();
        if (tenantId == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Tenant ID context missing");
        }

        // 1. Resolve or create conversation
        UUID convId = request.conversationId();
        Conversation conv;
        if (convId == null) {
            convId = UUID.randomUUID();
            conv = new Conversation(convId, tenantId, truncateTitle(request.question()), Instant.now(), Instant.now());
            conversationRepository.save(conv);
        } else {
            conv = conversationRepository.findByIdAndTenantId(convId, tenantId)
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Conversation not found"));
        }

        // 2. Persist User Message
        UUID userMsgId = UUID.randomUUID();
        int userTokens = TokenEstimator.estimateTokens(request.question());
        Message userMsg = new Message(userMsgId, convId, "USER", request.question(), userTokens, null, null, Instant.now());
        messageRepository.save(userMsg);

        // 3. Retrieve chunks at database level with filtering
        List<org.springframework.ai.document.Document> chunks = retrievalService.retrieveChunks(
                request.question(),
                tenantId,
                request.category(),
                defaultTopK,
                defaultThreshold
        );

        // 4. Refusal path: if insufficient evidence, refuse without calling LLM
        if (chunks.isEmpty()) {
            String refusalText = "not found in the available documents";
            UUID assistantMsgId = UUID.randomUUID();
            int assistantTokens = TokenEstimator.estimateTokens(refusalText);
            Message assistantMsg = new Message(assistantMsgId, convId, "ASSISTANT", refusalText, assistantTokens, null, 0L, Instant.now());
            messageRepository.save(assistantMsg);

            return new ChatResponse(refusalText, convId, List.of());
        }

        // 5. Construct citations and sources context
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

        // 6. Build the prompt including recent bounded history
        List<org.springframework.ai.chat.messages.Message> promptMessages = new ArrayList<>();

        // Add System prompt with context
        String systemPrompt = """
            You are a helpful assistant that answers questions based ONLY on the provided context below.
            If the context does not contain enough information to answer the question, or if you are unsure, respond with "not found in the available documents" and nothing else.
            Do not make up facts, use external knowledge, or cite references not present in the context.
            
            Context:
            ---
            %s
            """.formatted(contextBuilder.toString());
        promptMessages.add(new SystemMessage(systemPrompt));

        // Add Bounded History
        List<Message> history = messageRepository.findAllByConversationId(convId);
        List<org.springframework.ai.chat.messages.Message> historyMessagesToInclude = new ArrayList<>();
        int accumulatedTokens = 0;
        int maxMessages = defaultMaxTurns * 2;

        // Iterate backwards through history, skipping the user message we just saved
        for (int i = history.size() - 2; i >= 0; i--) {
            Message msg = history.get(i);
            int estTokens = msg.getTokenCount();

            if (historyMessagesToInclude.size() >= maxMessages) {
                break;
            }
            if (accumulatedTokens + estTokens > tokenBudget) {
                break;
            }

            accumulatedTokens += estTokens;
            if ("USER".equalsIgnoreCase(msg.getRole())) {
                historyMessagesToInclude.add(0, new UserMessage(msg.getContent()));
            } else if ("ASSISTANT".equalsIgnoreCase(msg.getRole())) {
                historyMessagesToInclude.add(0, new AssistantMessage(msg.getContent()));
            }
        }
        promptMessages.addAll(historyMessagesToInclude);

        // Add the current user message
        promptMessages.add(new UserMessage(request.question()));

        Prompt prompt = new Prompt(promptMessages);

        // 7. Call OpenAI Model and record metrics
        long startTime = System.currentTimeMillis();
        var response = chatModel.call(prompt);
        long latency = System.currentTimeMillis() - startTime;

        String answer = response.getResult().getOutput().getContent();

        // 8. Persist Assistant response & citations
        UUID assistantMsgId = UUID.randomUUID();
        int assistantTokens = TokenEstimator.estimateTokens(answer);
        Message assistantMsg = new Message(assistantMsgId, convId, "ASSISTANT", answer, assistantTokens, "openai", latency, Instant.now());
        messageRepository.save(assistantMsg);

        // Save Citations
        for (int i = 0; i < chunks.size(); i++) {
            org.springframework.ai.document.Document chunk = chunks.get(i);
            SourceDto src = sources.get(i);
            try {
                UUID chunkId = UUID.fromString(chunk.getId());
                messageRepository.saveSource(assistantMsgId, chunkId, src.similarityScore());
            } catch (Exception e) {
                // Ignore invalid UUIDs
            }
        }

        // Update conversation timestamp
        conv.setUpdatedAt(Instant.now());
        conversationRepository.save(conv);

        return new ChatResponse(answer, convId, sources);
    }

    public Flux<ServerSentEvent<String>> chatStream(ChatRequest request) {
        String tenantId = TenantContext.getCurrentTenant();
        if (tenantId == null) {
            return Flux.just(ServerSentEvent.<String>builder("Tenant ID context missing")
                    .event("error")
                    .build());
        }

        try {
            // 1. Resolve or create conversation
            final UUID convId;
            if (request.conversationId() == null) {
                convId = UUID.randomUUID();
                Conversation conv = new Conversation(convId, tenantId, truncateTitle(request.question()), Instant.now(), Instant.now());
                conversationRepository.save(conv);
            } else {
                convId = request.conversationId();
                // Verify conversation ownership
                conversationRepository.findByIdAndTenantId(convId, tenantId)
                        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Conversation not found"));
            }

            // 2. Persist User Message
            UUID userMsgId = UUID.randomUUID();
            int userTokens = TokenEstimator.estimateTokens(request.question());
            Message userMsg = new Message(userMsgId, convId, "USER", request.question(), userTokens, null, null, Instant.now());
            messageRepository.save(userMsg);

            // 3. Retrieve chunks at database level with filtering
            List<org.springframework.ai.document.Document> chunks = retrievalService.retrieveChunks(
                    request.question(),
                    tenantId,
                    request.category(),
                    defaultTopK,
                    defaultThreshold
            );

            // 4. Refusal path: if insufficient evidence, refuse without calling LLM
            if (chunks.isEmpty()) {
                String refusalText = "not found in the available documents";
                
                // Persist refusal answer
                UUID assistantMsgId = UUID.randomUUID();
                int assistantTokens = TokenEstimator.estimateTokens(refusalText);
                Message assistantMsg = new Message(assistantMsgId, convId, "ASSISTANT", refusalText, assistantTokens, null, 0L, Instant.now());
                messageRepository.save(assistantMsg);

                return Flux.just(
                        ServerSentEvent.<String>builder(refusalText).event("token").build(),
                        ServerSentEvent.<String>builder("[]").event("sources").build(),
                        ServerSentEvent.<String>builder("").event("done").build()
                );
            }

            // 5. Construct citations and sources context
            List<SourceDto> sources = new ArrayList<>();
            StringBuilder contextBuilder = new StringBuilder();
            for (org.springframework.ai.document.Document chunk : chunks) {
                Map<String, Object> metadata = chunk.getMetadata();
                String title = (String) metadata.getOrDefault("title", "Unknown");
                Integer page = (Integer) metadata.get("page_number");
                Double score = chunk.getScore();
                String content = chunk.getContent();

                sources.add(new SourceDto(title, page, score, content));

                contextBuilder.append("Source: ").append(title);
                if (page != null) {
                    contextBuilder.append(", Page: ").append(page);
                }
                contextBuilder.append("\nContent:\n").append(content).append("\n---\n");
            }

            // 6. Build prompt with history
            List<org.springframework.ai.chat.messages.Message> promptMessages = new ArrayList<>();
            String systemPrompt = """
                You are a helpful assistant that answers questions based ONLY on the provided context below.
                If the context does not contain enough information to answer the question, or if you are unsure, respond with "not found in the available documents" and nothing else.
                Do not make up facts, use external knowledge, or cite references not present in the context.
                
                Context:
                ---
                %s
                """.formatted(contextBuilder.toString());
            promptMessages.add(new SystemMessage(systemPrompt));

            List<Message> history = messageRepository.findAllByConversationId(convId);
            List<org.springframework.ai.chat.messages.Message> historyMessagesToInclude = new ArrayList<>();
            int accumulatedTokens = 0;
            int maxMessages = defaultMaxTurns * 2;

            // Iterate backwards, skipping the user message we just saved
            for (int i = history.size() - 2; i >= 0; i--) {
                Message msg = history.get(i);
                int estTokens = msg.getTokenCount();

                if (historyMessagesToInclude.size() >= maxMessages) {
                    break;
                }
                if (accumulatedTokens + estTokens > tokenBudget) {
                    break;
                }

                accumulatedTokens += estTokens;
                if ("USER".equalsIgnoreCase(msg.getRole())) {
                    historyMessagesToInclude.add(0, new UserMessage(msg.getContent()));
                } else if ("ASSISTANT".equalsIgnoreCase(msg.getRole())) {
                    historyMessagesToInclude.add(0, new AssistantMessage(msg.getContent()));
                }
            }
            promptMessages.addAll(historyMessagesToInclude);
            promptMessages.add(new UserMessage(request.question()));

            Prompt prompt = new Prompt(promptMessages);

            // 7. Stream LLM tokens, accumulate response, and save on complete
            StringBuilder answerAccumulator = new StringBuilder();
            long startTime = System.currentTimeMillis();

            Flux<ServerSentEvent<String>> tokenStream = chatModel.stream(prompt)
                    .map(aiResponse -> {
                        String text = aiResponse.getResult() != null && aiResponse.getResult().getOutput() != null
                                ? aiResponse.getResult().getOutput().getContent() : "";
                        if (text != null) {
                            answerAccumulator.append(text);
                        }
                        return ServerSentEvent.<String>builder(text != null ? text : "")
                                .event("token")
                                .build();
                    })
                    .doOnCancel(() -> log.info("SSE Client cancelled subscription for conversation: {}", convId))
                    .doOnComplete(() -> {
                        long latency = System.currentTimeMillis() - startTime;
                        String finalAnswer = answerAccumulator.toString();
                        
                        // Save assistant response and citations in a separate transaction on complete
                        transactionTemplate.executeWithoutResult(status -> {
                            UUID assistantMsgId = UUID.randomUUID();
                            int assistantTokens = TokenEstimator.estimateTokens(finalAnswer);
                            Message assistantMsg = new Message(assistantMsgId, convId, "ASSISTANT", finalAnswer, assistantTokens, "openai", latency, Instant.now());
                            messageRepository.save(assistantMsg);

                            for (int i = 0; i < chunks.size(); i++) {
                                org.springframework.ai.document.Document chunk = chunks.get(i);
                                SourceDto src = sources.get(i);
                                try {
                                    UUID chunkId = UUID.fromString(chunk.getId());
                                    messageRepository.saveSource(assistantMsgId, chunkId, src.similarityScore());
                                } catch (Exception e) {
                                    // Ignore invalid UUIDs
                                }
                            }
                        });
                    });

            // Citations terminal event
            Mono<ServerSentEvent<String>> citationsEvent = Mono.fromCallable(() -> {
                String sourcesJson = objectMapper.writeValueAsString(sources);
                return ServerSentEvent.<String>builder(sourcesJson)
                        .event("sources")
                        .build();
            });

            // Done terminal event
            Mono<ServerSentEvent<String>> doneEvent = Mono.just(
                    ServerSentEvent.<String>builder("").event("done").build()
            );

            return Flux.concat(tokenStream, citationsEvent, doneEvent)
                    .onErrorResume(err -> {
                        log.error("Error occurred during SSE stream generation", err);
                        return Flux.just(ServerSentEvent.<String>builder(err.getMessage()).event("error").build());
                    });

        } catch (Exception e) {
            log.error("Failed to initiate SSE stream", e);
            return Flux.just(ServerSentEvent.<String>builder(e.getMessage()).event("error").build());
        }
    }

    private String truncateTitle(String question) {
        if (question == null) {
            return "New Conversation";
        }
        return question.length() > 50 ? question.substring(0, 47) + "..." : question;
    }
}
