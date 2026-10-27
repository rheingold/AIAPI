/**
 * searchEngineClient.ts
 *
 * Central search engine abstraction with dual-mode support (HTML scrape + API).
 * Loads provider configurations from config/search-providers.json.
 *
 * ADR-019: MCP-Compatible Search & Retrieve Services
 */

import * as https from 'https';
import * as http from 'http';
import * as url from 'url';
import * as path from 'path';
import * as fs from 'fs';
import { JSDOM } from 'jsdom';
import { globalLogger } from '../utils/Logger';
import {
  SearchProvidersConfig,
  SearchProviderConfig,
  SearchQuery,
  SearchResult,
  SearchResultItem,
} from '../settings/types';

const TAG = 'SearchEngineClient';

/**
 * Resolve config file path - pkg-safe.
 */
function resolveConfigPath(): string {
  const isPkg = typeof (process as any).pkg !== 'undefined';
  const base = isPkg ? path.dirname(process.execPath) : path.resolve(__dirname, '..', '..');
  return path.resolve(base, 'config', 'search-providers.json');
}

/**
 * Rate limiter tracker per provider.
 */
interface RateLimitState {
  timestamps: number[];
}

/**
 * Template placeholder replacer.
 * Replaces {placeholder} tokens in strings with actual values.
 */
function replaceTemplates(
  template: string,
  vars: Record<string, string>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}

/**
 * Perform an HTTP/HTTPS GET request and return the response body as text.
 */
function httpGet(targetUrl: string, headers: Record<string, string> = {}, timeoutMs = 15000): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const lib = parsed.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AIAPI-Search/1.0)',
        'Accept': 'text/html,application/json,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        ...headers,
      },
      timeout: timeoutMs,
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} for ${targetUrl}`));
        } else {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout after ${timeoutMs}ms for ${targetUrl}`));
    });

    req.end();
  });
}

/**
 * Perform an HTTP/HTTPS POST request with JSON body.
 */
function httpPostJson(
  targetUrl: string,
  body: unknown,
  headers: Record<string, string> = {},
  timeoutMs = 15000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const lib = parsed.protocol === 'https:' ? https : http;
    const jsonBody = JSON.stringify(body);

    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AIAPI-Search/1.0)',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(jsonBody),
        ...headers,
      },
      timeout: timeoutMs,
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} for ${targetUrl}`));
        } else {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout after ${timeoutMs}ms for ${targetUrl}`));
    });

    req.write(jsonBody);
    req.end();
  });
}


// ─── HTML Result Parsers ─────────────────────────────────────────────────────

/**
 * Base parser interface for HTML search result extraction.
 */
abstract class SearchHtmlParser {
  /**
   * Parse HTML content and extract structured search results.
   */
  abstract parse(html: string): SearchResultItem[];

  /**
   * Extract text content from a DOM element, trimming whitespace.
   */
  protected getText(element: Element): string {
    return (element.textContent || '').trim();
  }

  /**
   * Extract href from an anchor element.
   */
  protected getHref(element: Element): string {
    const a = element.tagName === 'A'
      ? element as HTMLAnchorElement
      : element.querySelector('a');
    return a?.getAttribute('href') || '';
  }
}

/**
 * Google search results parser.
 * Google uses <div class="g"> for each result, with <h3> for title and <a> for link.
 */
class GoogleParser extends SearchHtmlParser {
  parse(html: string): SearchResultItem[] {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const results: SearchResultItem[] = [];

    // Google results are in <div class="g"> elements
    const items = document.querySelectorAll('div.g');
    items.forEach((item, index) => {
      const titleEl = item.querySelector('h3');
      const linkEl = item.querySelector('a');
      const snippetEl = item.querySelector('[data-sncf], span.iszfp, .VwiC3b');

      const title = titleEl ? this.getText(titleEl) : '';
      let linkHref = linkEl ? this.getHref(linkEl) : '';

      // Google URLs are redirect wrappers; extract the actual destination
      if (linkHref.startsWith('/url?')) {
        try {
          const urlParams = new URLSearchParams(linkHref.split('?')[1]);
          const dest = urlParams.get('q') || urlParams.get('u');
          if (dest) linkHref = dest;
        } catch {
          // Keep original URL if parsing fails
        }
      }

      if (title || linkHref) {
        results.push({
          title,
          url: linkHref,
          snippet: snippetEl ? this.getText(snippetEl) : undefined,
          position: index + 1,
        });
      }
    });

    return results;
  }
}

/**
 * Bing search results parser.
 * Bing uses <li class="b_algo"> for each result.
 */
class BingParser extends SearchHtmlParser {
  parse(html: string): SearchResultItem[] {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const results: SearchResultItem[] = [];

    const items = document.querySelectorAll('li.b_algo');
    items.forEach((item, index) => {
      const titleEl = item.querySelector('h2 a');
      const linkEl = item.querySelector('h2 a');
      const snippetEl = item.querySelector('.b_caption p');

      const title = titleEl ? this.getText(titleEl) : '';
      const linkHref = linkEl?.getAttribute('href') || '';
      const snippet = snippetEl ? this.getText(snippetEl) : '';

      if (title || linkHref) {
        results.push({
          title,
          url: linkHref,
          snippet: snippet || undefined,
          position: index + 1,
        });
      }
    });

    return results;
  }
}

/**
 * DuckDuckGo HTML parser.
 * Uses <a class="result__a"> for links and <a class="result__title"> for titles.
 */
class DuckDuckGoHtmlParser extends SearchHtmlParser {
  parse(html: string): SearchResultItem[] {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const results: SearchResultItem[] = [];

    const items = document.querySelectorAll('.result');
    items.forEach((item, index) => {
      const titleEl = item.querySelector('.result__title');
      const linkEl = item.querySelector('.result__a');
      const snippetEl = item.querySelector('.result__snippet');

      const title = titleEl ? this.getText(titleEl) : '';
      const linkHref = linkEl?.getAttribute('href') || '';
      const snippet = snippetEl ? this.getText(snippetEl) : '';

      if (title || linkHref) {
        results.push({
          title,
          url: linkHref,
          snippet: snippet || undefined,
          position: index + 1,
        });
      }
    });

    return results;
  }
}

/**
 * Yahoo search results parser.
 */
class YahooParser extends SearchHtmlParser {
  parse(html: string): SearchResultItem[] {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const results: SearchResultItem[] = [];

    // Yahoo uses <li data-testid="organic"> or similar structures
    const items = document.querySelectorAll('[data-testid="organic"], ol#content li');
    items.forEach((item, index) => {
      const titleEl = item.querySelector('h3');
      const linkEl = item.querySelector('a');
      const snippetEl = item.querySelector('p');

      const title = titleEl ? this.getText(titleEl) : '';
      const linkHref = linkEl?.getAttribute('href') || '';
      const snippet = snippetEl ? this.getText(snippetEl) : '';

      if (title || linkHref) {
        results.push({
          title,
          url: linkHref,
          snippet: snippet || undefined,
          position: index + 1,
        });
      }
    });

    return results;
  }
}

/**
 * Yandex search results parser.
 */
class YandexParser extends SearchHtmlParser {
  parse(html: string): SearchResultItem[] {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const results: SearchResultItem[] = [];

    const items = document.querySelectorAll('.organic__visited, .SearchResultLink');
    items.forEach((item, index) => {
      const titleEl = item.querySelector('.link-theme');
      const linkEl = item.querySelector('a');
      const snippetEl = item.querySelector('.snippet__text');

      const title = titleEl ? this.getText(titleEl) : '';
      const linkHref = linkEl?.getAttribute('href') || '';
      const snippet = snippetEl ? this.getText(snippetEl) : '';

      if (title || linkHref) {
        results.push({
          title,
          url: linkHref,
          snippet: snippet || undefined,
          position: index + 1,
        });
      }
    });

    return results;
  }
}

/**
 * Baidu search results parser.
 */
class BaiduParser extends SearchHtmlParser {
  parse(html: string): SearchResultItem[] {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const results: SearchResultItem[] = [];

    const items = document.querySelectorAll('#content_left .result, .c-container');
    items.forEach((item, index) => {
      const titleEl = item.querySelector('h3');
      const linkEl = item.querySelector('h3 a');
      const snippetEl = item.querySelector('.c-abstract, .content_1');

      const title = titleEl ? this.getText(titleEl) : '';
      const linkHref = linkEl?.getAttribute('href') || '';
      const snippet = snippetEl ? this.getText(snippetEl) : '';

      if (title || linkHref) {
        results.push({
          title,
          url: linkHref,
          snippet: snippet || undefined,
          position: index + 1,
        });
      }
    });

    return results;
  }
}

/**
 * Parser registry — maps parser name to constructor.
 */
const htmlParsers: Record<string, new () => SearchHtmlParser> = {
  GoogleParser,
  BingParser,
  DuckDuckGoHtmlParser,
  YahooParser,
  YandexParser,
  BaiduParser,
};


// ─── API Result Parsers ──────────────────────────────────────────────────────

/**
 * Parse DuckDuckGo API JSON response.
 */
function parseDuckDuckGoApi(json: unknown): SearchResultItem[] {
  if (typeof json !== 'object' || json === null) return [];
  const data = json as Record<string, unknown>;

  const results: SearchResultItem[] = [];
  const relatedTopics = data.RelatedTopics as Record<string, unknown>[] | undefined;

  if (Array.isArray(relatedTopics)) {
    for (const topic of relatedTopics) {
      if (typeof topic !== 'object' || topic === null) continue;
      const t = topic as Record<string, unknown>;
      results.push({
        title: (t.Text as string) || '',
        url: (t.FirstURL as string) || '',
        snippet: (t.Text as string) || undefined,
      });
    }
  }

  // Also check Abstract for a direct answer
  if (data.AbstractText && data.AbstractURL) {
    results.unshift({
      title: (data.AbstractSource as string) || 'DuckDuckGo Summary',
      url: (data.AbstractURL as string) || '',
      snippet: (data.AbstractText as string) || undefined,
      position: 1,
    });
  }

  return results;
}

/**
 * Parse Google Custom Search API JSON response.
 */
function parseGoogleApi(json: unknown): SearchResultItem[] {
  if (typeof json !== 'object' || json === null) return [];
  const data = json as Record<string, unknown>;
  const items = (data.items as Record<string, unknown>[]) || [];
  const results: SearchResultItem[] = [];

  items.forEach((item, index) => {
    results.push({
      title: (item.title as string) || '',
      url: (item.link as string) || '',
      snippet: (item.snippet as string) || undefined,
      position: index + 1,
    });
  });

  return results;
}

/**
 * Parse Bing API JSON response.
 */
function parseBingApi(json: unknown): SearchResultItem[] {
  if (typeof json !== 'object' || json === null) return [];
  const data = json as Record<string, unknown>;
  const webPages = (data.webPages as Record<string, unknown>) || {};
  const value = (webPages.value as Record<string, unknown>[]) || [];
  const results: SearchResultItem[] = [];

  value.forEach((item, index) => {
    results.push({
      title: (item.name as string) || '',
      url: (item.url as string) || '',
      snippet: (item.snippet as string) || undefined,
      position: index + 1,
    });
  });

  return results;
}

/**
 * Parse Jina Reader API JSON response.
 */
function parseJinaApi(json: unknown): SearchResultItem[] {
  if (typeof json !== 'object' || json === null) return [];
  const data = json as Record<string, unknown>;
  const results: SearchResultItem[] = [];

  // Jina returns data array with content
  const dataArr = (data.data as Record<string, unknown>[]) || [];
  dataArr.forEach((item, index) => {
    results.push({
      title: (item.title as string) || '',
      url: (item.url as string) || (item.url as string) || '',
      snippet: (item.text as string) || (item.content as string) || undefined,
      position: index + 1,
    });
  });

  // If no data array, try direct content
  if (results.length === 0 && data.content) {
    results.push({
      title: (data.title as string) || 'Jina Result',
      url: (data.url as string) || '',
      snippet: (data.content as string) || undefined,
      position: 1,
    });
  }

  return results;
}

/**
 * Parse FireCrawl API JSON response.
 */
function parseFireCrawlApi(json: unknown): SearchResultItem[] {
  if (typeof json !== 'object' || json === null) return [];
  const data = json as Record<string, unknown>;
  const results: SearchResultItem[] = [];

  const dataArr = (data.data as Record<string, unknown>[]) || [];
  dataArr.forEach((item, index) => {
    results.push({
      title: (item.title as string) || '',
      url: (item.url as string) || '',
      snippet: (item.markdown as string) || (item.text as string) || undefined,
      position: index + 1,
    });
  });

  return results;
}

/**
 * Parse Brave Search API JSON response.
 */
function parseBraveApi(json: unknown): SearchResultItem[] {
  if (typeof json !== 'object' || json === null) return [];
  const data = json as Record<string, unknown>;
  const results: SearchResultItem[] = [];

  const web = (data.web as Record<string, unknown>) || {};
  const items = (web.results as Record<string, unknown>[]) || [];

  items.forEach((item, index) => {
    results.push({
      title: (item.title as string) || '',
      url: (item.url as string) || '',
      snippet: (item.description as string) || undefined,
      position: index + 1,
      date: (item.page_age as string) || undefined,
    });
  });

  return results;
}


// ─── SearchEngineClient ──────────────────────────────────────────────────────

export class SearchEngineClient {
  private config: SearchProvidersConfig;
  private rateLimiters: Map<string, RateLimitState> = new Map();

  constructor(configPath?: string) {
    this.config = this.loadConfig(configPath);
    // Watch for config file changes
    this.watchConfig(configPath);
  }

  /**
   * Load provider configuration from JSON file.
   */
  private loadConfig(configPath?: string): SearchProvidersConfig {
    try {
      const cfgPath = configPath || resolveConfigPath();
      if (!fs.existsSync(cfgPath)) {
        globalLogger.warn(TAG, `Search providers config not found at ${cfgPath}, using defaults`);
        return { defaultEngine: 'google', providers: {} };
      }
      const content = fs.readFileSync(cfgPath, 'utf-8');
      const parsed = JSON.parse(content);
      // Enrich provider configs with id field
      for (const [id, cfg] of Object.entries(parsed.providers || {})) {
        (cfg as SearchProviderConfig & { id?: string }).id = id;
      }
      return parsed as SearchProvidersConfig;
    } catch (error) {
      globalLogger.error(TAG, `Failed to load search providers config: ${(error as Error).message}`);
      return { defaultEngine: 'google', providers: {} };
    }
  }

  /**
   * Watch config file for changes and reload.
   */
  private watchConfig(configPath?: string): void {
    try {
      const cfgPath = configPath || resolveConfigPath();
      if (fs.existsSync(cfgPath)) {
        fs.watchFile(cfgPath, { interval: 5000 }, () => {
          globalLogger.debug(TAG, 'Reloading search providers config...');
          this.config = this.loadConfig();
        });
      }
    } catch (error) {
      globalLogger.warn(TAG, `Could not watch config file: ${(error as Error).message}`);
    }
  }

  /**
   * Get the API key for a provider from environment variables.
   * Never logs or returns the actual key value in error messages.
   */
  private getApiKey(provider: SearchProviderConfig): string | null {
    if (!provider.apiKeyEnvVar) return null;
    const key = process.env[provider.apiKeyEnvVar];
    if (!key) {
      globalLogger.debug(TAG, `API key for ${provider.id} not set (env: ${provider.apiKeyEnvVar})`);
      return null;
    }
    return key;
  }

  /**
   * Check rate limit for a provider.
   */
  private checkRateLimit(providerId: string, config?: SearchProviderConfig): boolean {
    const rl = config?.rateLimit;
    if (!rl) return true;

    const state = this.rateLimiters.get(providerId) || { timestamps: [] };
    const now = Date.now();
    const windowMs = 60000; // 1 minute window

    // Remove old timestamps
    state.timestamps = state.timestamps.filter(t => now - t < windowMs);

    if (state.timestamps.length >= (rl.maxPerMinute || 20)) {
      const oldest = state.timestamps[0];
      const waitMs = windowMs - (now - oldest);
      globalLogger.warn(TAG, `Rate limit for ${providerId}: wait ${waitMs}ms`);
      return false;
    }

    // Check cooldown
    if (state.timestamps.length > 0) {
      const lastRequest = state.timestamps[state.timestamps.length - 1];
      if (now - lastRequest < (rl.cooldownMs || 1000)) {
        return false;
      }
    }

    state.timestamps.push(now);
    this.rateLimiters.set(providerId, state);
    return true;
  }

  /**
   * Resolve the effective mode for a search query.
   */
  private resolveMode(
    provider: SearchProviderConfig,
    queryMode?: 'html' | 'api',
  ): 'html' | 'api' {
    // Explicit override
    if (queryMode) return queryMode;

    // Provider default
    if (provider.mode === 'html' || provider.mode === 'api') {
      return provider.mode;
    }

    // Auto mode: try API if key available, else HTML
    if (provider.apiKeyEnvVar && this.getApiKey(provider)) {
      return 'api';
    }
    if (provider.searchUrlPattern) {
      return 'html';
    }

    // Fallback
    globalLogger.warn(TAG, `Provider ${provider.id} has no usable mode, defaulting to api`);
    return 'api';
  }

  /**
   * Execute an HTML-mode search.
   */
  private async searchHtml(
    provider: SearchProviderConfig,
    query: SearchQuery,
  ): Promise<SearchResult> {
    if (!provider.searchUrlPattern) {
      return {
        success: false,
        engine: provider.id,
        query: query.query,
        results: [],
        error: `Provider ${provider.id} not configured for HTML mode`,
      };
    }

    const encodedQuery = encodeURIComponent(query.query);
    const vars: Record<string, string> = {
      encoded_query: encodedQuery,
      maxResults: String(query.maxResults || 10),
      query: query.query,
      lang: query.lang || 'en',
      region: query.region || 'US',
    };

    const searchUrl = replaceTemplates(provider.searchUrlPattern, vars);

    try {
      const html = await httpGet(searchUrl);
      const parserName = provider.resultParser || 'GoogleParser';
      const ParserClass = htmlParsers[parserName];

      if (!ParserClass) {
        globalLogger.warn(TAG, `Unknown HTML parser: ${parserName}, using generic`);
        return {
          success: false,
          engine: provider.id,
          query: query.query,
          results: [],
          error: `No parser available for ${provider.id}`,
        };
      }

      const parser = new ParserClass();
      let results = parser.parse(html);

      // Apply safe search filter if requested
      if (query.safeSearch) {
        results = this.applySafeSearchFilter(results);
      }

      // Limit results
      const limit = query.maxResults || 10;
      results = results.slice(0, limit);

      globalLogger.info(TAG, `HTML search via ${provider.id}: ${results.length} results`);

      return {
        success: true,
        engine: provider.id,
        query: query.query,
        results,
      };
    } catch (error) {
      globalLogger.error(TAG, `HTML search failed for ${provider.id}: ${(error as Error).message}`);
      return {
        success: false,
        engine: provider.id,
        query: query.query,
        results: [],
        error: (error as Error).message,
      };
    }
  }

  /**
   * Execute an API-mode search.
   */
  private async searchApi(
    provider: SearchProviderConfig,
    query: SearchQuery,
  ): Promise<SearchResult> {
    if (!provider.apiEndpoint) {
      return {
        success: false,
        engine: provider.id,
        query: query.query,
        results: [],
        error: `Provider ${provider.id} not configured for API mode`,
      };
    }

    // Check if API key is required
    if (provider.requiresApiKey) {
      const apiKey = this.getApiKey(provider);
      if (!apiKey) {
        return {
          success: false,
          engine: provider.id,
          query: query.query,
          results: [],
          error: `API key required for ${provider.id}. Set ${provider.apiKeyEnvVar} environment variable.`,
        };
      }
    }

    const apiKey = this.getApiKey(provider) || '';
    const method = provider.apiMethod || 'GET';
    const vars: Record<string, string> = {
      apiKey,
      query: query.query,
      maxResults: String(query.maxResults || 10),
      lang: query.lang || 'en',
      region: query.region || 'US',
    };

    try {
      let results: SearchResultItem[] = [];
      let totalResults: number | undefined;

      // Build headers
      const headers: Record<string, string> = {};
      if (provider.apiHeaders) {
        for (const [key, template] of Object.entries(provider.apiHeaders)) {
          headers[key] = replaceTemplates(template, vars);
        }
      }

      if (method === 'POST' && provider.apiBodyTemplate) {
        // POST with body template
        const bodyStr = replaceTemplates(provider.apiBodyTemplate, vars);
        let body: unknown;
        try {
          body = JSON.parse(bodyStr);
        } catch {
          body = { q: query.query };
        }

        // Append API params to body if provided
        if (provider.apiParams) {
          const params = {} as Record<string, string>;
          for (const [k, v] of Object.entries(provider.apiParams)) {
            params[k] = replaceTemplates(v, vars);
          }
          Object.assign(body as Record<string, unknown>, params);
        }

        const response = await httpPostJson(provider.apiEndpoint, body, headers);
        results = this.parseApiJsonResponse(provider.id, response);
      } else {
        // GET request
        let apiUrl = provider.apiEndpoint;

        // Build query params
        const searchParams = new URLSearchParams();
        if (provider.apiParams) {
          for (const [key, template] of Object.entries(provider.apiParams)) {
            searchParams.append(key, replaceTemplates(template, vars));
          }
        }

        const queryString = searchParams.toString();
        if (queryString) {
          apiUrl += (apiUrl.includes('?') ? '&' : '?') + queryString;
        }

        const response = await httpGet(apiUrl, headers);
        results = this.parseApiJsonResponse(provider.id, response);
      }

      // Apply safe search filter
      if (query.safeSearch) {
        results = this.applySafeSearchFilter(results);
      }

      // Limit results
      const limit = query.maxResults || 10;
      results = results.slice(0, limit);

      globalLogger.info(TAG, `API search via ${provider.id}: ${results.length} results`);

      return {
        success: true,
        engine: provider.id,
        query: query.query,
        results,
        totalResults,
      };
    } catch (error) {
      globalLogger.error(TAG, `API search failed for ${provider.id}: ${(error as Error).message}`);
      return {
        success: false,
        engine: provider.id,
        query: query.query,
        results: [],
        error: (error as Error).message,
      };
    }
  }

  /**
   * Parse API JSON response using the provider's configured parser.
   */
  private parseApiJsonResponse(providerId: string, jsonStr: string): SearchResultItem[] {
    try {
      const json = JSON.parse(jsonStr);
      const parserMap: Record<string, (j: unknown) => SearchResultItem[]> = {
        duckduckgo: parseDuckDuckGoApi,
        duckduckgo_api: parseDuckDuckGoApi,
        google_api: parseGoogleApi,
        bing_api: parseBingApi,
        jina: parseJinaApi,
        firecrawl: parseFireCrawlApi,
        brave: parseBraveApi,
      };

      const parser = parserMap[providerId];
      if (parser) {
        return parser(json);
      }

      // Generic fallback: try to extract common result patterns
      globalLogger.warn(TAG, `No specific API parser for ${providerId}, using generic extraction`);
      return this.genericApiExtract(json);
    } catch (error) {
      globalLogger.error(TAG, `Failed to parse API response: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Generic API response extractor for unknown providers.
   * Tries common patterns: { results[] }, { data[] }, { items[] }, { web.results[] }
   */
  private genericApiExtract(json: unknown): SearchResultItem[] {
    if (typeof json !== 'object' || json === null) return [];
    const data = json as Record<string, unknown>;
    const results: SearchResultItem[] = [];

    // Try common array fields
    const arrayFields = ['results', 'data', 'items', 'hits'];
    for (const field of arrayFields) {
      const arr = data[field] as Record<string, unknown>[];
      if (Array.isArray(arr) && arr.length > 0) {
        arr.forEach((item, index) => {
          results.push({
            title: (item.title as string) || (item.name as string) || '',
            url: (item.url as string) || (item.link as string) || '',
            snippet: (item.snippet as string) || (item.description as string) || (item.text as string) || undefined,
            position: index + 1,
          });
        });
        return results;
      }
    }

    return results;
  }

  /**
   * Apply safe search filtering to results.
   */
  private applySafeSearchFilter(results: SearchResultItem[]): SearchResultItem[] {
    // Basic domain-based filtering for known unsafe categories
    // This is a lightweight filter; comprehensive filtering requires external services
    const blockedPatterns: string[] = [
      // Placeholder — can be extended based on requirements
    ];

    return results.filter((item) => {
      if (!item.url) return true;
      return !blockedPatterns.some((pattern) => item.url.includes(pattern));
    });
  }

  /**
   * Main search entry point.
   *
   * @param query - Search parameters
   * @returns Normalized search result
   */
  public async search(query: SearchQuery): Promise<SearchResult> {
    if (!query.query || !query.query.trim()) {
      return {
        success: false,
        engine: '',
        query: query.query || '',
        results: [],
        error: 'Search query cannot be empty',
      };
    }

    // Resolve provider
    const providerId = query.engineId || this.config.defaultEngine;
    const provider = this.config.providers[providerId];

    if (!provider) {
      const available = Object.keys(this.config.providers).join(', ');
      return {
        success: false,
        engine: providerId,
        query: query.query,
        results: [],
        error: `Unknown search engine: ${providerId}. Available: ${available}`,
      };
    }

    if (!provider.enabled) {
      return {
        success: false,
        engine: providerId,
        query: query.query,
        results: [],
        error: `Provider ${providerId} is disabled. Enable it in config/search-providers.json.`,
      };
    }

    // Check rate limit
    if (!this.checkRateLimit(providerId, provider)) {
      return {
        success: false,
        engine: providerId,
        query: query.query,
        results: [],
        error: `Rate limit exceeded for ${providerId}. Please wait and retry.`,
      };
    }

    // Resolve mode
    const mode = this.resolveMode(provider, query.mode);

    globalLogger.info(TAG, `Searching "${query.query}" via ${providerId} (${mode} mode)`);

    if (mode === 'html') {
      return this.searchHtml(provider, query);
    }

    return this.searchApi(provider, query);
  }

  /**
   * Get list of available and enabled providers.
   * Does NOT expose API keys.
   */
  public getAvailableProviders(): Array<{
    id: string;
    name: string;
    mode: string;
    enabled: boolean;
    requiresApiKey: boolean;
    hasApiKey: boolean;
  }> {
    return Object.values(this.config.providers).map((p) => ({
      id: p.id,
      name: p.name,
      mode: p.mode,
      enabled: p.enabled,
      requiresApiKey: p.requiresApiKey,
      hasApiKey: p.apiKeyEnvVar ? !!process.env[p.apiKeyEnvVar] : true,
    }));
  }
}
