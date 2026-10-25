# Search Engine Integration Review for _System Tool

## Executive Summary

This document reviews the necessary modifications to the existing `_System` tool (specifically the web fetching infrastructure) to support multiple search engines: Google, Bing, DuckDuckGo, and the engines shown in the screenshot (Zhipu, Tavily, Searchng, Exa, Bocha, Querit, Jina, Firecrawl, Parallel, Serply).

---

## 1. Current Architecture Overview

### 1.1 Existing Web Fetch Stack

The current web fetching is implemented in three layers:

| Layer | File | Responsibility |
|-------|------|----------------|
| **MCP Server Router** | [`mcpServer.ts`](components/server/src/server/mcpServer.ts:873) | Routes `_System/FETCH_WEBPAGE` and `_System/FETCH_WEBPAGE_RENDER` actions to the automation engine |
| **Automation Engine** | [`automationEngine.ts`](components/server/src/engine/automationEngine.ts:340) | Lazy-initializes `WebScrapingClient` and delegates fetch calls |
| **Web Scraping Client** | [`webScrapingClient.ts`](components/server/src/engine/webScrapingClient.ts:407) | Performs raw HTTP/HTTPS requests with security filtering, rate limiting, redirect handling, and login form detection |

### 1.2 Current Data Flow

```
MCP Client  ->  mcpServer.ts (route FETCH_WEBPAGE)
              ->  automationEngine.fetchWebpage(url, options)
              ->  webScrapingClient.fetchWebpage(url, options)
              ->  HTTP/HTTPS request via Node.js http/https module
              ->  Returns WebFetchResult { success, url, content, text, elements, ... }
```

### 1.3 Current Options Interface

```typescript
interface WebFetchOptions {
  timeout?: number;
  userAgent?: string;
  headers?: Record<string, string>;
  method?: string;
  body?: unknown;
  maxContentLength?: number;
  extractText?: boolean;
  selector?: string;
  followRedirects?: boolean;
  maxRedirects?: number;
  auth?: WebFetchAuth;
  rejectUnauthorized?: boolean;
}
```

### 1.4 Current Result Interface

```typescript
interface WebFetchResult {
  success: boolean;
  url: string;
  finalUrl?: string;
  statusCode?: number;
  headers?: Record<string, string>;
  content?: string;
  text?: string;
  elements?: Array<...>;
  error?: string;
  redirectChain?: string[];
  authChallenge?: string;
  sslCertificate?: SslCertInfo;
  loginForm?: LoginFormInfo;
}
```

---

## 2. Search Engine Categories

The requested search engines fall into **three distinct categories**, each requiring different integration approaches:

### 2.1 Traditional Web Search Engines (Direct HTTP Scraping)

| Engine | Approach | API Available? |
|--------|----------|----------------|
| **Google** | Scrape search results page OR use Custom Search JSON API | Yes (Custom Search API) |
| **Bing** | Scrape search results page OR use Bing Web Search API | Yes (Azure Cognitive Services) |
| **DuckDuckGo** | Scrape search results page OR use Instant Answer API | Partial (Instant Answer only, limited) |

**Integration Method:** Either direct URL construction + HTTP fetch (existing `FETCH_WEBPAGE` can handle this), or dedicated API client with API key authentication.

### 2.2 AI-Powered Search / Knowledge Engines

| Engine | Type | API Available? |
|--------|------|----------------|
| **Tavily** | AI search with content extraction | Yes (REST API with API key) |
| **Exa** | Semantic search / neural discovery | Yes (REST API with API key) |
| **Jina** | Reader API / search | Yes (REST API, some free) |
| **Firecrawl** | Web scraping + LLM-ready content extraction | Yes (REST API with API key) |
| **Serply** | Search API aggregator | Yes (REST API with API key) |
| **Parallel** | Parallel search execution | Yes (REST API) |

**Integration Method:** Dedicated REST API clients with structured JSON request/response.

### 2.3 Specialized / Regional Engines

| Engine | Type | Notes |
|--------|------|-------|
| **Zhipu** | Chinese AI search | May require locale-specific handling |
| **Tavily** | AI-focused search | Already in category 2.2 |
| **Searchng** | Unknown - requires research | Needs investigation |
| **Bocha** | Unknown - requires research | Needs investigation |
| **Querit** | Unknown - requires research | Needs investigation |

---

## 3. Required Changes by Component

### 3.1 New Component: `SearchEngineClient.ts`

**Location:** `components/server/src/engine/searchEngineClient.ts`

**Purpose:** Central abstraction layer for all search engine interactions.

```typescript
// Proposed interface
export interface SearchEngine {
  id: string;                          // 'google', 'bing', 'duckduckgo', 'tavily', 'exa', ...
  name: string;                        // Display name
  type: 'scrape' | 'api';             // Direct scrape vs API-based
  requiresApiKey: boolean;
  baseUrl: string;
  searchUrlPattern: string;           // For scrape mode: template with {query} placeholder
  apiEndpoint?: string;               // For api mode
  apiVersion?: string;
  supportedParams: SearchParam[];
  rateLimit?: RateLimitConfig;
}

export interface SearchQuery {
  q: string;                           // Search query string
  engine: string;                      // Engine ID
  maxResults?: number;                 // Number of results to return
  lang?: string;                       // Language code
  region?: string;                     // Region/locale code
  safeSearch?: boolean;                // Enable safe search filtering
  freshness?: string;                  // Time range filter
  apiOptions?: Record<string, any>;    // Engine-specific API options
}

export interface SearchResult {
  success: boolean;
  engine: string;
  query: string;
  results: SearchResultItem[];
  totalResults?: number;
  error?: string;
  metadata?: Record<string, any>;
}

export interface SearchResultItem {
  title: string;
  url: string;
  snippet?: string;
  position?: number;
  source?: string;
  date?: string;
  metadata?: Record<string, any>;
}
```

### 3.2 Modifications to `WebFetchOptions` and `WebFetchResult`

**File:** [`webScrapingClient.ts`](components/server/src/engine/webScrapingClient.ts:103)

Add search-specific fields to `WebFetchOptions`:

```typescript
export interface WebFetchOptions {
  // ... existing fields ...
  
  // NEW: Search mode fields
  searchMode?: boolean;                // true = interpret URL as search query
  searchEngine?: string;               // 'google', 'bing', 'tavily', etc.
  searchMaxResults?: number;           // Max results to parse (default: 10)
  searchLanguage?: string;             // Language preference
  searchRegion?: string;               // Region/locale preference
  searchSafe?: boolean;                // Enable safe search
  searchFreshness?: string;            // Time filter: 'day', 'week', 'month', 'year'
}
```

Add search-specific fields to `WebFetchResult`:

```typescript
export interface WebFetchResult {
  // ... existing fields ...
  
  // NEW: Search result fields
  searchResults?: SearchResultItem[];  // Parsed search results
  searchTotalResults?: number;         // Total results count from engine
  searchEngine?: string;              // Which engine was used
}
```

### 3.3 Modifications to `AutomationEngine`

**File:** [`automationEngine.ts`](components/server/src/engine/automationEngine.ts:340)

Add a new method for search operations:

```typescript
export class AutomationEngine {
  // ... existing code ...
  
  private searchEngineClient: any;     // Lazy initialized
  
  /**
   * Search the web using the specified engine
   */
  async searchWeb(
    query: string,
    options: any = {}
  ): Promise<any> {
    if (!this.searchEngineClient) {
      const { SearchEngineClient } = await import('./searchEngineClient');
      this.searchEngineClient = new SearchEngineClient();
    }
    
    this.log(`Searching: "${query}" via ${options.engine || 'default'}`, true);
    const result = await this.searchEngineClient.search(query, options);
    this.log(`Search completed: ${result.success}`, result.success);
    return result;
  }
}
```

### 3.4 Modifications to `mcpServer.ts`

**File:** [`mcpServer.ts`](components/server/src/server/mcpServer.ts:873)

#### 3.4.1 Add New `_System` Action: `SEARCH_WEB`

Add to the `_System` switch block (around line 873-900):

```typescript
case 'SEARCH_WEB': {
  const query = args.query ?? args.proc ?? '';
  const searchOpts: Record<string, any> = {
    engine: args.engine ?? 'google',
    maxResults: args.maxResults ?? 10,
    lang: args.lang,
    region: args.region,
    safeSearch: args.safeSearch,
    freshness: args.freshness,
  };
  result = await this.automationEngine.searchWeb(query, searchOpts);
  break;
}
```

#### 3.4.2 Update `_System` Tool Descriptions

Update all references to `_System` tool descriptions (lines 751, 904, 998, 1046, 1103):

**Before:**
```
'EXEC_CMD, FS_READ, FS_WRITE, FS_LIST, FETCH_WEBPAGE, FETCH_WEBPAGE_RENDER'
```

**After:**
```
'EXEC_CMD, FS_READ, FS_WRITE, FS_LIST, FETCH_WEBPAGE, FETCH_WEBPAGE_RENDER, SEARCH_WEB'
```

#### 3.4.3 Add `SEARCH_WEB` to Action Schema

Add to the getHelperSchema response for `_System` (around line 1105):

```typescript
{
  name: 'search_web',
  description: 'Search the web using configured search engine (Google, Bing, DuckDuckGo, Tavily, Exa, etc.). Returns structured search results.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query string (required).' },
      engine: { type: 'string', description: 'Search engine ID: google, bing, duckduckgo, tavily, exa, jina, firecrawl, serply, etc. Default: google.' },
      maxResults: { type: 'number', description: 'Max results to return. Default: 10.' },
      lang: { type: 'string', description: 'Language code (e.g. en, de, zh). Default: auto.' },
      region: { type: 'string', description: 'Region code (e.g. US, DE, CN). Default: auto.' },
      safeSearch: { type: 'boolean', description: 'Enable safe search filtering. Default: false.' },
      freshness: { type: 'string', description: 'Time filter: day, week, month, year.' },
    },
    required: ['query'],
  },
}
```

#### 3.4.4 Add `SEARCH_WEB` to AutomateUI Help/Reference

Add to the getActionDetail response (around line 1387):

```typescript
SEARCH_WEB: {
  description: 'Search the web using specified search engine.',
  parameters: {
    proc: 'Search query string (required).',
    value: 'JSON options: {engine, maxResults, lang, region, safeSearch, freshness}.',
  },
  example: {
    params: { 
      name: 'AutomateUI', 
      arguments: { 
        helper: '_System', 
        action: 'SEARCH_WEB', 
        proc: 'TypeScript tutorial',
        value: '{"engine":"google","maxResults":5}'
      } 
    },
  },
},
```

### 3.5 New Configuration File: `search-engines.json`

**Location:** `config/search-engines.json`

```json
{
  "defaultEngine": "google",
  "engines": {
    "google": {
      "name": "Google",
      "type": "scrape",
      "requiresApiKey": false,
      "baseUrl": "https://www.google.com",
      "searchUrlPattern": "https://www.google.com/search?q={encoded_query}&num={max_results}&hl={lang}&gl={region}",
      "apiKeyEnvVar": null,
      "rateLimit": {
        "maxRequestsPerMinute": 10,
        "cooldownPeriodMs": 3000
      }
    },
    "bing": {
      "name": "Bing",
      "type": "scrape",
      "requiresApiKey": false,
      "baseUrl": "https://www.bing.com",
      "searchUrlPattern": "https://www.bing.com/search?q={encoded_query}&count={max_results}&setlang={lang}&cc={region}",
      "apiKeyEnvVar": null,
      "rateLimit": {
        "maxRequestsPerMinute": 10,
        "cooldownPeriodMs": 3000
      }
    },
    "duckduckgo": {
      "name": "DuckDuckGo",
      "type": "scrape",
      "requiresApiKey": false,
      "baseUrl": "https://duckduckgo.com",
      "searchUrlPattern": "https://duckduckgo.com/html/?q={encoded_query}",
      "apiKeyEnvVar": null,
      "rateLimit": {
        "maxRequestsPerMinute": 15,
        "cooldownPeriodMs": 2000
      }
    },
    "google_api": {
      "name": "Google Custom Search API",
      "type": "api",
      "requiresApiKey": true,
      "apiEndpoint": "https://www.googleapis.com/customsearch/v1",
      "apiParams": {
        "key": "apiKey",
        "cx": "searchEngineId",
        "q": "query",
        "num": "maxResults"
      },
      "apiKeyEnvVar": "GOOGLE_SEARCH_API_KEY",
      "apiSecretEnvVar": "GOOGLE_SEARCH_CX_ID"
    },
    "bing_api": {
      "name": "Bing Web Search API",
      "type": "api",
      "requiresApiKey": true,
      "apiEndpoint": "https://api.bing.microsoft.com/v7.0/search",
      "apiHeaders": {
        "Ocp-Apim-Subscription-Key": "apiKey"
      },
      "apiKeyEnvVar": "BING_SEARCH_API_KEY"
    },
    "tavily": {
      "name": "Tavily AI Search",
      "type": "api",
      "requiresApiKey": true,
      "apiEndpoint": "https://api.tavily.com/search",
      "apiMethod": "POST",
      "apiBody": {
        "query": "query",
        "max_results": "maxResults",
        "include_answer": true
      },
      "apiHeaders": {
        "Authorization": "Bearer {apiKey}"
      },
      "apiKeyEnvVar": "TAVILY_API_KEY"
    },
    "exa": {
      "name": "Exa Neural Search",
      "type": "api",
      "requiresApiKey": true,
      "apiEndpoint": "https://api.exa.ai/search",
      "apiMethod": "POST",
      "apiHeaders": {
        "x-api-key": "{apiKey}"
      },
      "apiKeyEnvVar": "EXA_API_KEY"
    },
    "jina": {
      "name": "Jina Reader/Search",
      "type": "api",
      "requiresApiKey": false,
      "apiEndpoint": "https://s.jina.ai/{query}",
      "apiHeaders": {
        "X-Return-Representative-Images": "true"
      },
      "apiKeyEnvVar": "JINA_API_KEY"
    },
    "firecrawl": {
      "name": "Firecrawl",
      "type": "api",
      "requiresApiKey": true,
      "apiEndpoint": "https://api.firecrawl.dev/v1/search",
      "apiMethod": "POST",
      "apiHeaders": {
        "Authorization": "Bearer {apiKey}"
      },
      "apiKeyEnvVar": "FIRECRAWL_API_KEY"
    },
    "serply": {
      "name": "Serply Search API",
      "type": "api",
      "requiresApiKey": true,
      "apiEndpoint": "https://api.serply.io/v1/search",
      "apiMethod": "POST",
      "apiKeyEnvVar": "SERPLY_API_KEY"
    }
  }
}
```

### 3.6 Environment Variables for API Keys

Add to documentation and `.env.example`:

```bash
# Search Engine API Keys (optional - enable API-based search)
GOOGLE_SEARCH_API_KEY=
GOOGLE_SEARCH_CX_ID=
BING_SEARCH_API_KEY=
TAVILY_API_KEY=
EXA_API_KEY=
JINA_API_KEY=
FIRECRAWL_API_KEY=
SERPLY_API_KEY=
```

---

## 4. Security Considerations

### 4.1 Existing Security Filters Apply

The existing [`WebSecurityFilter`](components/server/src/engine/webScrapingClient.ts:162) infrastructure already provides:

- **Domain allowlisting/blocklisting** — restrict which search engines can be queried
- **Protocol enforcement** — HTTPS-only for search queries
- **Rate limiting** — prevent abuse of search endpoints
- **Header filtering** — block injection of dangerous headers
- **Content validation** — sanitize search results before returning

### 4.2 New Security Requirements

| Concern | Mitigation |
|---------|------------|
| **API Key Exposure** | Store in environment variables only; never log or return in responses |
| **Query Injection** | URL-encode all query parameters; validate against XSS patterns |
| **Result Content Filtering** | Apply existing `blockedKeywords` filter to search snippets |
| **Rate Limit Abuse** | Per-engine rate limits in configuration file |
| **SSRF via Search Results** | Validate all URLs in search results against `allowedDomains`/`blockedDomains` |

### 4.3 API Key Management Design

```typescript
interface ApiKeyConfig {
  engineId: string;
  envVarName: string;
  key: string | null;           // Loaded from environment at startup
  lastRotated?: string;         // ISO timestamp for key rotation tracking
}
```

API keys should be loaded at server startup from environment variables, stored in memory only, and never persisted to disk or logged.

---

## 5. Implementation Phases

### Phase 1: Core Search Abstraction (Week 1)
- [ ] Create `SearchEngineClient.ts` with base interface
- [ ] Create `config/search-engines.json` configuration
- [ ] Implement scrape-based search for Google, Bing, DuckDuckGo
- [ ] Add `SEARCH_WEB` action to `mcpServer.ts`
- [ ] Parse HTML search results into structured `SearchResultItem[]`

### Phase 2: API-Based Search Engines (Week 2)
- [ ] Implement Google Custom Search API client
- [ ] Implement Bing Web Search API client
- [ ] Implement Tavily, Exa, Jina, Firecrawl, Serply API clients
- [ ] API key loading from environment variables
- [ ] Engine selection and routing logic

### Phase 3: Result Enhancement (Week 3)
- [ ] Snippet extraction and cleaning for scraped results
- [ ] Result deduplication across engines
- [ ] Caching layer for repeated queries
- [ ] Search result metadata enrichment

### Phase 4: Testing & Hardening (Week 4)
- [ ] Unit tests for each search engine client
- [ ] Integration tests with mock HTTP responses
- [ ] Security audit of query handling and result parsing
- [ ] Rate limiting enforcement validation
- [ ] Error handling for all failure modes

---

## 6. File Change Summary

| File | Type of Change | Lines Affected |
|------|----------------|----------------|
| `components/server/src/engine/searchEngineClient.ts` | **NEW FILE** | ~500 lines |
| `components/server/src/engine/webScrapingClient.ts` | Extend interfaces | ~30 lines added |
| `components/server/src/engine/automationEngine.ts` | Add `searchWeb()` method | ~20 lines added |
| `components/server/src/server/mcpServer.ts` | Add `SEARCH_WEB` action, update schemas | ~80 lines added |
| `config/search-engines.json` | **NEW FILE** | ~150 lines |
| `docs/api/SERVER_API.md` | Document new action | ~50 lines added |
| `CONVENTIONS.md` | Add search engine vocabulary | ~20 lines added |

---

## 7. Backward Compatibility

The proposed changes are **fully backward compatible**:

1. Existing `FETCH_WEBPAGE` and `FETCH_WEBPAGE_RENDER` actions remain unchanged
2. New `SEARCH_WEB` action is additive
3. New fields in `WebFetchOptions` are optional
4. Existing security filters continue to apply
5. Default behavior (scrape-based Google search) requires no API keys

---

## 8. Dependencies

### New npm Packages (if needed)

| Package | Purpose | Required? |
|---------|---------|-----------|
| `cheerio` | HTML parsing for search result extraction | Yes (for scrape mode) |
| `@googleapis/customsearch` | Google Custom Search API client | Optional (native https module suffices) |
| `@azure/cognitiveservices-bingsearch` | Bing API client | Optional (native https module suffices) |

**Recommendation:** Use existing `https` module for all API calls to minimize dependencies. The existing `webScrapingClient.ts` already demonstrates robust HTTP handling.

---

## 9. API Key Provisioning Flow

```
1. User sets environment variable (e.g. TAVILY_API_KEY=xxx)
2. Server startup: SearchEngineClient loads keys from process.env
3. User calls SEARCH_WEB with engine: 'tavily'
4. If api key missing: return structured error "Engine 'tavily' requires API key. Set TAVILY_API_KEY environment variable."
5. If api key present: forward search request to engine API
6. Parse and return structured results
```

---

## 10. Error Handling Matrix

| Error Condition | Response |
|----------------|----------|
| Unknown engine ID | `{ success: false, error: "Unknown search engine: {id}. Available: {list}" }` |
| Missing API key | `{ success: false, error: "Engine '{id}' requires API key. Set {ENV_VAR}." }` |
| API rate limit exceeded | `{ success: false, error: "Rate limit exceeded for {engine}. Retry after {ms}ms." }` |
| Network timeout | `{ success: false, error: "Search request timed out after {timeoutMs}ms." }` |
| Invalid query (empty) | `{ success: false, error: "Search query cannot be empty." }` |
| SSL cert error (scrape mode) | Return with `sslCertificate` field (existing behavior) |
| API returns error | `{ success: false, error: "Search engine returned error: {message}" }` |

---

## 11. Query Parameter Mapping by Engine

| Parameter | Google | Bing | DuckDuckGo | Tavily | Exa | Notes |
|-----------|--------|------|------------|--------|-----|-------|
| `q` | `q` | `q` | `q` | `query` | `query` | Universal |
| `maxResults` | `num` | `count` | - | `max_results` | `numResults` | Varies |
| `lang` | `hl` | `setlang` | - | - | - | Not all support |
| `region` | `gl` | `cc` | - | - | - | Not all support |
| `safeSearch` | `safe` | `safeSearch` | `kp` | - | - | Varies |
| `freshness` | `tbs=qdr:` | `freshness` | - | `search_time` | `startPublished` | Varies |

---

## 12. Conclusion

The proposed architecture extends the existing `_System` tool with a clean, configurable search engine abstraction layer that:

1. **Leverages existing infrastructure** — reuses `WebScrapingClient` security, rate limiting, and HTTP handling
2. **Supports multiple integration modes** — scrape-based for traditional engines, API-based for AI-powered engines
3. **Maintains backward compatibility** — all existing actions continue to work unchanged
4. **Is extensible** — new engines can be added via configuration file alone (no code changes)
5. **Follows established patterns** — matches the lazy-initialization and error handling style of the existing codebase
6. **Is secure by default** — API keys in environment only, query sanitization, result filtering

The implementation requires approximately **800-1000 new lines of code** distributed across 3-4 files, with the majority being the new `SearchEngineClient.ts` abstraction layer.
