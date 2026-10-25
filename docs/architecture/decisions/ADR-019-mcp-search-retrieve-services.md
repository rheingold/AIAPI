# ADR-019 — MCP-Compatible Search & Retrieve Services

**Date:** 2026-10-25
**Status:** Accepted
**Deciders:** ARCH
**Supersedes:** Partially extends [SEARCH_ENGINE_INTEGRATION_REVIEW.md](../SEARCH_ENGINE_INTEGRATION_REVIEW.md)

---

## Context

### User Requirement

The AIAPI MCP server needs to expose MCP-compatible tools for:
1. **Web Search** - configurable multi-provider search (Google, Bing, DuckDuckGo, Yahoo, Yandex, Baidu) operating in both HTML-scraping mode AND API mode
2. **Content Retrieval** - specialized fetch tools: `fetch_markdown`, `fetch_txt`, `fetch_html`, `fetch_json`
3. **Third-Party Search Providers** - Querit, Jina, FireCrawl with API key management
4. **Container Deployment** - all new tools must be safe for containerized MCP deployment (API keys secured, no local-only dependencies)

### Current State

The existing [`_System`](CONVENTIONS.md) virtual helper provides:
- `FETCH_WEBPAGE` - raw HTTP fetch via Node.js `https` module
- `FETCH_WEBPAGE_RENDER` - browser-based rendering via BrowserWin

There is NO dedicated search abstraction. The [`SEARCH_ENGINE_INTEGRATION_REVIEW.md`](../SEARCH_ENGINE_INTEGRATION_REVIEW.md) document exists as a research artifact but was never implemented.

### Key Constraints

| Constraint | Rationale |
|------------|-----------|
| **Container-safe** | API keys must never appear in responses, logs, or tool schemas |
| **Dual-mode search** | Each provider supports HTML scraping (free) AND API mode (keyed) |
| **Configurable providers** | Dashboard UI manages provider list, keys, and mode selection |
| **Pre-configured defaults** | Google (HTML mode) and DuckDuckGo (API mode) ship ready-to-use |
| **Node.js http stack** | All HTTP operations use native `http`/`https` - no Playwright/Puppeteer for search |
| **Existing security** | Reuse [`WebSecurityFilter`](../../src/engine/webScrapingClient.ts:162) infrastructure |

---

## Decision

### Architecture Overview

```
MCP Client
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│                    MCPServer (mcpServer.ts)                  │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  New MCP Tools (tools/list response):                    ││
│  │  - brave_search          │  search via configured engine ││
│  │  - local_search          │  local filesystem text search ││
│  │  - fetch_markdown        │  fetch → convert to MD       ││
│  │  - fetch_txt             │  fetch → raw text            ││
│  │  - fetch_html            │  fetch → HTML                ││
│  │  - fetch_json            │  fetch → parse JSON          ││
│  └─────────────────────────────────────────────────────────┘│
│                                                             │
│  _System tool extended with new actions:                     │
│  - SEARCH_WEB          │  dispatch to SearchEngineClient    │
│  - FETCH_MARKDOWN      │  fetch + HTML→MD conversion        │
│  - FETCH_TXT           │  fetch + text extraction           │
│  - FETCH_HTML          │  fetch (passthrough)               │
│  - FETCH_JSON          │  fetch + JSON parsing              │
│  - LOCAL_SEARCH        │  filesystem text search            │
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  SearchEngineClient (NEW - searchEngineClient.ts)        ││
│  │                                                          ││
│  │  loadProviders()  ← config/search-providers.json         ││
│  │  search(query, opts)                                     ││
│  │    ├─ resolveProvider(engineId)                          ││
│  │    ├─ if mode="api" → call API endpoint                  ││
│  │    └─ if mode="html" → fetch URL + parse results         ││
│  │                                                          ││
│  │  Per-Provider Parsers:                                   ││
│  │  - GoogleParser, BingParser, DuckDuckGoParser, ...       ││
│  │  - JinaParser, FireCrawlParser, QueritParser             ││
│  └─────────────────────────────────────────────────────────┘│
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  FetchContentClient (NEW - fetchContentClient.ts)        ││
│  │                                                          ││
│  │  fetchMarkdown(url, opts)  → WebFetchResult + .markdown  ││
│  │  fetchTxt(url, opts)      → WebFetchResult + .text       ││
│  │  fetchHtml(url, opts)     → WebFetchResult (passthrough) ││
│  │  fetchJson(url, opts)     → WebFetchResult + .json       ││
│  │                                                          ││
│  │  Reuses WebScrapingClient for HTTP layer                  ││
│  │  Adds content-type specific post-processing               ││
│  └─────────────────────────────────────────────────────────┘│
│                                                             │
│  WebScrapingClient (existing)                                │
│  - HTTP/HTTPS requests, security filtering, rate limiting    │
└─────────────────────────────────────────────────────────────┘
```

### New Components

#### 1. `SearchEngineClient` (`components/server/src/engine/searchEngineClient.ts`)

Central abstraction for all search operations. Dual-mode per provider:

```typescript
interface SearchProviderConfig {
  id: string;                          // 'google', 'bing', 'duckduckgo', 'jina', ...
  name: string;                        // Display name
  mode: 'html' | 'api' | 'auto';      // html=scrape, api=REST, auto=try-API-fallback-HTML
  requiresApiKey: boolean;
  // HTML mode config
  searchUrlPattern?: string;           // template with {query}, {maxResults}, etc.
  resultParser?: string;              // parser class name
  // API mode config
  apiEndpoint?: string;               // base URL for API calls
  apiMethod?: string;                 // GET | POST (default GET)
  apiHeaders?: Record<string, string>; // { "Authorization": "Bearer {apiKey}" }
  apiBodyTemplate?: string;           // JSON template for POST body
  apiKeyEnvVar?: string;              // environment variable name for API key
  // Common
  rateLimit?: { maxPerMinute: number; cooldownMs: number };
  enabled: boolean;
}

interface SearchQuery {
  query: string;
  engineId?: string;                  // provider ID; omit for default
  maxResults?: number;                // default 10
  mode?: 'html' | 'api';             // override provider default
  lang?: string;
  region?: string;
  safeSearch?: boolean;
  freshness?: string;                 // 'day', 'week', 'month', 'year'
}

interface SearchResult {
  success: boolean;
  engine: string;
  query: string;
  results: SearchResultItem[];
  totalResults?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

interface SearchResultItem {
  title: string;
  url: string;
  snippet?: string;
  position?: number;
  date?: string;
  metadata?: Record<string, unknown>;
}
```

**Provider Resolution Flow:**
1. Load provider configs from `config/search-providers.json` at startup
2. Watch file for changes (dashboard edits)
3. On search request:
   - Resolve provider by `engineId` (or use default)
   - Determine mode: explicit `mode` param → provider config `mode` → `'auto'` logic
   - In `'auto'` mode: if API key available → API mode, else → HTML mode
   - Execute search via appropriate path
   - Parse results through provider-specific parser
   - Return normalized `SearchResult`

#### 2. `FetchContentClient` (`components/server/src/engine/fetchContentClient.ts`)

Content-type specific fetch wrapper around `WebScrapingClient`:

```typescript
class FetchContentClient {
  // Reuses WebScrapingClient for the HTTP layer
  private webClient: WebScrapingClient;

  async fetchMarkdown(url: string, opts?: WebFetchOptions): Promise<WebFetchResult & { markdown?: string }>
  async fetchTxt(url: string, opts?: WebFetchOptions): Promise<WebFetchResult & { text?: string }>
  async fetchHtml(url: string, opts?: WebFetchOptions): Promise<WebFetchResult>
  async fetchJson(url: string, opts?: WebFetchOptions): Promise<WebFetchResult & { json?: unknown }>
}
```

**Processing Pipeline:**
1. `WebScrapingClient.fetchWebpage(url, opts)` - raw HTTP fetch with security
2. Content-type detection from `Content-Type` header or URL extension
3. Post-processing:
   - `fetch_markdown`: HTML → Markdown via `turndown` library (or existing JSDOM)
   - `fetch_txt`: HTML → plain text (existing `extractTextContent`)
   - `fetch_html`: passthrough, return raw HTML
   - `fetch_json`: parse response body as JSON, attach `.json` field

#### 3. Configuration File (`config/search-providers.json`)

```json
{
  "defaultEngine": "google",
  "providers": {
    "google": {
      "name": "Google",
      "mode": "html",
      "requiresApiKey": false,
      "enabled": true,
      "searchUrlPattern": "https://www.google.com/search?q={encoded_query}&num={maxResults}&hl={lang}",
      "resultParser": "GoogleParser",
      "rateLimit": { "maxPerMinute": 10, "cooldownMs": 3000 }
    },
    "google_api": {
      "name": "Google Custom Search API",
      "mode": "api",
      "requiresApiKey": true,
      "enabled": false,
      "apiEndpoint": "https://www.googleapis.com/customsearch/v1",
      "apiKeyEnvVar": "GOOGLE_SEARCH_API_KEY",
      "apiHeaders": { "X-SearchEngineId": "{cxId}" }
    },
    "bing": {
      "name": "Bing",
      "mode": "html",
      "requiresApiKey": false,
      "enabled": false,
      "searchUrlPattern": "https://www.bing.com/search?q={encoded_query}&count={maxResults}",
      "resultParser": "BingParser",
      "rateLimit": { "maxPerMinute": 10, "cooldownMs": 3000 }
    },
    "duckduckgo": {
      "name": "DuckDuckGo",
      "mode": "api",
      "requiresApiKey": false,
      "enabled": true,
      "apiEndpoint": "https://api.duckduckgo.com/",
      "apiParams": { "q": "{query}", "format": "json" },
      "resultParser": "DuckDuckGoParser"
    },
    "duckduckgo_html": {
      "name": "DuckDuckGo (HTML)",
      "mode": "html",
      "requiresApiKey": false,
      "enabled": false,
      "searchUrlPattern": "https://duckduckgo.com/html/?q={encoded_query}",
      "resultParser": "DuckDuckGoHtmlParser"
    },
    "jina": {
      "name": "Jina Reader",
      "mode": "api",
      "requiresApiKey": false,
      "enabled": false,
      "apiEndpoint": "https://s.jina.ai",
      "apiMethod": "POST",
      "apiBodyTemplate": "{ \"url\": \"{query}\", \"json\": true }",
      "apiKeyEnvVar": "JINA_API_KEY"
    },
    "firecrawl": {
      "name": "Firecrawl",
      "mode": "api",
      "requiresApiKey": true,
      "enabled": false,
      "apiEndpoint": "https://api.firecrawl.dev/v1/search",
      "apiMethod": "POST",
      "apiHeaders": { "Authorization": "Bearer {apiKey}" },
      "apiKeyEnvVar": "FIRECRAWL_API_KEY"
    },
    "brave": {
      "name": "Brave Search",
      "mode": "api",
      "requiresApiKey": true,
      "enabled": false,
      "apiEndpoint": "https://api.search.brave.com/res/v1/web/search",
      "apiHeaders": { "X-Subscription-Token": "{apiKey}" },
      "apiKeyEnvVar": "BRAVE_SEARCH_API_KEY"
    },
    "yandex": {
      "name": "Yandex",
      "mode": "html",
      "requiresApiKey": false,
      "enabled": false,
      "searchUrlPattern": "https://yandex.com/search/?text={encoded_query}&lr={region}",
      "resultParser": "YandexParser"
    },
    "baidu": {
      "name": "Baidu",
      "mode": "html",
      "requiresApiKey": false,
      "enabled": false,
      "searchUrlPattern": "https://www.baidu.com/s?wd={encoded_query}&rn={maxResults}",
      "resultParser": "BaiduParser"
    },
    "yahoo": {
      "name": "Yahoo",
      "mode": "html",
      "requiresApiKey": false,
      "enabled": false,
      "searchUrlPattern": "https://search.yahoo.com/search?p={encoded_query}&n={maxResults}",
      "resultParser": "YahooParser"
    }
  }
}
```

### MCP Tool Surface

#### New Standalone Tools (added to `tools/list`)

| Tool | Description | Container-Safe |
|------|-------------|----------------|
| `brave_search` | Search the web using configured search engine | ✅ Yes |
| `local_search` | Search local filesystem for text patterns | ✅ Yes |
| `fetch_markdown` | Fetch URL and return as Markdown | ✅ Yes |
| `fetch_txt` | Fetch URL and return plain text | ✅ Yes |
| `fetch_html` | Fetch URL and return HTML | ✅ Yes |
| `fetch_json` | Fetch URL and parse as JSON | ✅ Yes |

#### Extended `_System` Actions

New actions added to the `_System` tool `action` enum:
- `SEARCH_WEB` - search via SearchEngineClient
- `FETCH_MARKDOWN` - fetch with Markdown conversion
- `FETCH_TXT` - fetch with text extraction
- `FETCH_HTML` - fetch HTML (passthrough to FETCH_WEBPAGE)
- `FETCH_JSON` - fetch with JSON parsing
- `LOCAL_SEARCH` - filesystem text search

### Container Deployment Considerations

| Aspect | Strategy |
|--------|----------|
| **API Keys** | Environment variables only. Never logged, never in responses. `getHelperSchema` returns `requiresApiKey: true/false` but never the key itself |
| **Local-only tools** | `local_search` excluded from container MCP tool list when `CONTAINER_MODE=true` |
| **HTML scraping** | Works in containers (headless HTTP). No display server required |
| **API-based search** | Works in containers. Pure HTTP to provider APIs |
| **Config persistence** | `config/search-providers.json` mounted as volume or baked into image |

### Security

1. **API Key Handling:**
   - Keys loaded from `process.env` at startup into `SearchEngineClient` private memory
   - Never serialized, logged, or returned in tool responses
   - Schema responses indicate `requiresApiKey: true` without exposing the key

2. **Query Sanitization:**
   - All search queries URL-encoded before use
   - XSS pattern validation on input
   - Existing `WebSecurityFilter.blockedKeywords` applied to results

3. **SSRF Protection:**
   - Search result URLs validated against `allowedDomains`/`blockedDomains`
   - Redirect chains limited and logged

4. **Rate Limiting:**
   - Per-provider rate limits enforced
   - Global rate limit inherited from `WebScrapingClient`

---

## Consequences

### Positive
- **Zero breaking changes** - all new tools are additive
- **Provider flexibility** - users configure exactly which engines to use
- **Cost control** - HTML mode is free; API mode is opt-in with user's own keys
- **Container-ready** - designed for headless deployment from day one
- **Token-efficient** - 6 new tools vs. 21+ individual engine tools

### Negative
- **HTML parsing fragility** - scraped search results depend on provider HTML structure
- **API key management** - users must provide their own keys for API-mode providers
- **Additional dependency** - `turndown` library for HTML→Markdown conversion

### Mitigations
- HTML parsers versioned and tested against current provider layouts
- Graceful fallback: API mode → HTML mode when key unavailable
- `turndown` is lightweight (~30KB) and widely used

---

## File Change Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `components/server/src/engine/searchEngineClient.ts` | **NEW** | Search engine abstraction with dual-mode support |
| `components/server/src/engine/fetchContentClient.ts` | **NEW** | Content-type specific fetch wrapper |
| `config/search-providers.json` | **NEW** | Provider configuration with defaults |
| `components/server/src/server/mcpServer.ts` | Modify | Add new tools, extend _System actions |
| `components/server/src/settings/types.ts` | Modify | Add search provider types |
| `components/server/dist-resources/dashboard/dashboard.html` | Modify | Add search provider config section |
| `components/server/dist-resources/dashboard/dashboard.js` | Modify | Add search provider UI management |
| `CONVENTIONS.md` | Modify | Add search/fetch vocabulary |
| `docs/api/SERVER_API.md` | Modify | Document new actions |
| `test/unit/test-search-engine.js` | **NEW** | Unit tests for search |
| `test/integration/test-search-tools.js` | **NEW** | Integration tests |

---

## Implementation Phases

### Phase 1: Core Infrastructure
- Create `SearchEngineClient` with base interface and provider loading
- Create `config/search-providers.json` with pre-configured defaults
- Implement HTML-mode parsers for Google, DuckDuckGo
- Add `SEARCH_WEB` action to `_System` tool

### Phase 2: Content Fetch Tools
- Create `FetchContentClient` with content-type processing
- Add `fetch_markdown`, `fetch_txt`, `fetch_html`, `fetch_json` MCP tools
- Implement HTML→Markdown conversion

### Phase 3: API-Mode Providers
- Implement API-mode for DuckDuckGo, Jina, FireCrawl, Brave
- Add API key loading from environment variables
- Provider selection and routing logic

### Phase 4: Dashboard UI
- Add search provider configuration panel
- Provider enable/disable, mode selection, API key status
- Live provider testing

### Phase 5: Local Search & Testing
- Implement `local_search` filesystem search
- Unit tests, integration tests
- Container deployment validation

---

## Related Documents

- [ADR-017](ADR-017-mcp-tool-hierarchy.md) - MCP tool hierarchy (extended by this ADR)
- [CONVENTIONS.md](../../CONVENTIONS.md) - Command taxonomy (extended)
- [SEARCH_ENGINE_INTEGRATION_REVIEW.md](../SEARCH_ENGINE_INTEGRATION_REVIEW.md) - Original research (superseded by implementation)
- [SECURITY_ARCHITECTURE.md](../SECURITY_ARCHITECTURE.md) - Security baseline
