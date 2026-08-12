# Document Q&A Assistant (RAG)

A multi-tenant RAG backend built with **Spring Boot 4.1 + Spring AI 2.0 + PostgreSQL/pgvector** that ingests documents (PDF, DOCX, TXT, MD) and answers natural language questions using grounded context, returning source citations.

Supports **four AI providers** — switch between them without changing any Java code.

---

## Quick Start

### Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Java | 25 | Required by the backend |
| Maven | 3.9+ | Or use included `./mvnw` |
| Node.js | 22+ | Required by the frontend |
| Docker + Docker Compose | Latest | Recommended path for running everything |
| Ollama | Latest | **Only if using the Ollama provider** |

> **Easiest path:** Docker + Docker Compose. It starts PostgreSQL/pgvector, the backend, and the frontend in one command.

---

### 1. Clone the Repository

```bash
git clone https://github.com/your-org/document-qna-assistant.git
cd document-qna-assistant
```

---

### 2. Configure Environment Variables

Create a `.env` file at the **project root** (next to `docker-compose.yml`):

```env
# ── PostgreSQL ────────────────────────────────────────────
POSTGRES_DB=document_qa
POSTGRES_USER=document_qa
POSTGRES_PASSWORD=password123
POSTGRES_PORT=5432

# ── AI Provider Keys (set only the one you are using) ─────
# OpenAI
OPENAI_API_KEY=sk-...

# Google Gemini
GOOGLE_GENAI_API_KEY=AIza...

# Anthropic Claude
ANTHROPIC_API_KEY=sk-ant-...

# Ollama → no API key required
```

> ⚠️ Never commit `.env` to version control. Only set the key for the provider you selected.

---

### 3. Choose an AI Provider

| Provider | Chat Model | Embedding Model | API Key Required |
|---|---|---|---|
| **Ollama** | `qwen3:4b` | `nomic-embed-text` (768-dim) | ❌ No |
| **Google Gemini** | `gemini-3.6-flash` | `gemini-embedding-001` (768-dim via MRL) | ✅ Yes |
| **OpenAI** | `gpt-4o-mini` | `text-embedding-3-small` (768-dim) | ✅ Yes |
| **Anthropic** | `claude-3-7-sonnet-20250219` | `nomic-embed-text` via Ollama (768-dim) | ✅ Yes + Ollama |

> ⚠️ **Embedding dimension:** The PostgreSQL schema uses `vector(768)`. All providers above are configured to produce 768-dimensional embeddings. If you switch embedding providers, existing document embeddings must be re-ingested — vectors from different models are incompatible.

---

### 4. Run with Docker Compose

```bash
docker compose up --build
```

This starts:
```
Docker Compose
 ├── db        → PostgreSQL 16 + pgvector  (port 5432)
 ├── app       → Spring Boot backend       (port 8080)
 └── frontend  → React/Vite via Nginx      (port 3000)
```

| Service | URL |
|---|---|
| **Frontend** | http://localhost:3000 |
| **Backend API** | http://localhost:8080 |
| **Health check** | http://localhost:8080/actuator/health |

**Stop the application:**
```bash
docker compose down
```

**Stop and remove all data (including the database volume):**
```bash
docker compose down -v
```

---

### 5. Run Without Docker (Local Development)

**Backend:**
```bash
# Start PostgreSQL/pgvector manually first, then:
cd backend
mvn spring-boot:run
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173 (with /api proxied to localhost:8080)
```

---

## Switching AI Providers

> You can switch between OpenAI, Google Gemini, Anthropic Claude, and Ollama **without changing any Java source code**.

Switching takes three steps:

1. Select the provider dependency in `pom.xml`
2. Uncomment the provider block in `application.properties`
3. Set the provider API key in `.env`
4. Restart the application

---

### Option A — Ollama (Local, Free)

**No API key required.** Ollama must be running locally before the backend starts.

#### 1. Pull models
```bash
ollama pull qwen3:4b
ollama pull nomic-embed-text
```

#### 2. `pom.xml` — keep (or add):
```xml
<dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-starter-model-ollama</artifactId>
</dependency>
```

#### 3. `application.properties` — uncomment this block:
```properties
spring.ai.model.chat=ollama
spring.ai.model.embedding=ollama
spring.ai.ollama.base-url=${OLLAMA_BASE_URL:http://localhost:11434}
spring.ai.ollama.chat.model=qwen3:4b
spring.ai.ollama.embedding.model=nomic-embed-text
```

#### 4. `.env` — no key needed.

---

### Option B — Google Gemini

#### 1. `pom.xml` — swap to:
```xml
<dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-starter-model-google-genai</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-starter-model-google-genai-embedding</artifactId>
</dependency>
```

#### 2. `application.properties` — uncomment the Google block, comment the Ollama block:
```properties
spring.ai.model.chat=google-genai
spring.ai.model.embedding=google-genai
spring.ai.google.genai.api-key=${GOOGLE_GENAI_API_KEY}
spring.ai.google.genai.chat.model=gemini-3.6-flash
spring.ai.google.genai.embedding.text.model=gemini-embedding-001
spring.ai.google.genai.embedding.text.dimensions=768
spring.ai.google.genai.embedding.api-key=${GOOGLE_GENAI_API_KEY}
spring.ai.google.genai.project-id=dummy-project
spring.ai.google.genai.location=us-central1
spring.ai.google.genai.embedding.project-id=dummy-project
spring.ai.google.genai.embedding.location=us-central1
```

#### 3. `.env`:
```env
GOOGLE_GENAI_API_KEY=AIza...
```

---

### Option C — OpenAI

#### 1. `pom.xml` — swap to:
```xml
<dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-starter-model-openai</artifactId>
</dependency>
```

#### 2. `application.properties` — uncomment the OpenAI block:
```properties
spring.ai.model.chat=openai
spring.ai.model.embedding=openai
spring.ai.openai.api-key=${OPENAI_API_KEY}
spring.ai.openai.chat.model=gpt-4o-mini
spring.ai.openai.embedding.model=text-embedding-3-small
spring.ai.openai.embedding.dimensions=768
```

#### 3. `.env`:
```env
OPENAI_API_KEY=sk-...
```

---

### Option D — Anthropic Claude

> ⚠️ **Anthropic does not provide an embedding API.** Embeddings are handled by Ollama's `nomic-embed-text`. You need Ollama running locally alongside the Anthropic API key.

#### 1. Pull the Ollama embedding model:
```bash
ollama pull nomic-embed-text
```

#### 2. `pom.xml` — swap to:
```xml
<dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-starter-model-anthropic</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-starter-model-ollama</artifactId>
</dependency>
```

#### 3. `application.properties` — uncomment the Anthropic block:
```properties
spring.ai.model.chat=anthropic
spring.ai.model.embedding=ollama
spring.ai.anthropic.api-key=${ANTHROPIC_API_KEY}
spring.ai.anthropic.chat.options.model=claude-3-7-sonnet-20250219
spring.ai.ollama.base-url=${OLLAMA_BASE_URL:http://localhost:11434}
spring.ai.ollama.embedding.model=nomic-embed-text
```

#### 4. `.env`:
```env
ANTHROPIC_API_KEY=sk-ant-...
```

---

## Architecture

### Ingestion Pipeline
```
POST /api/v1/documents
  → Validate (size ≤ 20MB, supported extension)
  → SHA-256 deduplication
  → 202 Accepted (async processing)
  → TextExtractor (PDFBox / POI / plain text)
  → Per-page chunking (~1000 chars, 200 overlap)
  → EmbeddingModel.embed() [provider-agnostic]
  → PgVectorStore.add()
  → Status → READY
```

### RAG Chat Pipeline
```
POST /api/v1/chat  /  POST /api/v1/chat/stream (SSE)
  → X-Tenant-Id header extraction
  → EmbeddingModel.embed(query) [provider-agnostic]
  → PgVectorStore.similaritySearch (filter: tenant + category, threshold: 0.62)
  → If no chunks → refusal ("not found in the available documents")
  → Build grounded system prompt + bounded conversation history
  → ChatModel.call() or ChatModel.stream() [provider-agnostic]
  → Persist message + citations
  → Return answer + source citations
```

### Provider Abstraction
Java services depend only on Spring AI interfaces:
- `org.springframework.ai.chat.model.ChatModel`
- `org.springframework.ai.embedding.EmbeddingModel`
- `org.springframework.ai.vectorstore.VectorStore`

No provider-specific class names (`OpenAiChatModel`, `GoogleGenAiChatModel`, etc.) appear in any business logic. Provider selection is handled entirely by Spring AI auto-configuration.

---

## SSE Streaming Event Format

`POST /api/v1/chat/stream` emits Server-Sent Events:

| Event | Payload | Description |
|---|---|---|
| `token` | `"Hello"` | Progressive LLM output token |
| `sources` | `[{title, pageNumber, similarityScore, snippet}]` | Citation array (terminal) |
| `done` | _(empty)_ | Stream complete signal |
| `error` | `"message"` | Failure notification |

---

## Troubleshooting

### Docker not running
Integration tests use Testcontainers, which requires Docker to be running. Start Docker Desktop before running `mvn test`.

### PostgreSQL connection failure
```bash
# Check Docker Compose database health:
docker compose ps
docker compose logs db

# Test direct connection:
psql -h localhost -p 5432 -U document_qa -d document_qa
```

### Ollama connection failure
```bash
# Verify Ollama is running:
curl http://localhost:11434/api/tags

# Check installed models:
ollama list

# Pull missing models:
ollama pull qwen3:4b
ollama pull nomic-embed-text
```

### Embedding dimension mismatch
The PostgreSQL schema defines `vector(768)`. All embedding models must produce **exactly 768 dimensions**:

| Model | Default Dims | 768-dim Method |
|---|---|---|
| `nomic-embed-text` | 768 | Native |
| `text-embedding-3-small` | 1536 | `spring.ai.openai.embedding.dimensions=768` |
| `gemini-embedding-001` | 3072 | `spring.ai.google.genai.embedding.text.dimensions=768` |

After switching embedding providers, **re-ingest all documents** — embeddings from different models are incompatible.

### API key missing
| Provider | `.env` variable |
|---|---|
| OpenAI | `OPENAI_API_KEY` |
| Google Gemini | `GOOGLE_GENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| Ollama | _(none required)_ |

If the application starts but chat fails with a 401/403, the API key is missing or invalid. If it fails with a 404 model error, the model name may be outdated — check the provider's model availability page.

---

## Chunking Strategy

- **PDFs**: Per-page extraction → ~1000 char chunks, 200 char overlap → 100% citation page-number accuracy.
- **DOCX / TXT / MD**: Sequential chunking → ~1000 char chunks, 200 char overlap, `page_number=1`.
- **Similarity threshold**: `0.62` cosine similarity. Queries without any chunk above this threshold return a deterministic refusal without calling the LLM.
