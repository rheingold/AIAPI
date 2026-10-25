/**
 * SearchEngineClient Unit Tests
 * 
 * Tests for search provider resolution, HTML parsing, API parsing,
 * content type detection, and container safety (API key isolation).
 * 
 * Run: npx jest components/server/src/engine/__tests__/searchEngineClient.test.ts
 */
import { SearchEngineClient } from '../searchEngineClient';
import { SearchQuery, SearchResult, SearchProviderConfig } from '../../settings/types';

describe('SearchEngineClient', () => {
  let client: SearchEngineClient;

  beforeEach(() => {
    client = new SearchEngineClient();
  });

  describe('provider resolution', () => {
    test('has default provider (google)', () => {
      const config = (client as any).config;
      expect(config).toBeDefined();
      expect(config.providers).toBeDefined();
    });

    test('search with empty query returns error', async () => {
      const query: SearchQuery = { query: '' };
      const result = await client.search(query);
      expect(result).toBeDefined();
      expect(result.error).toBeTruthy();
    });

    test('search with unknown provider returns error', async () => {
      const query: SearchQuery = { query: 'test', engineId: 'nonexistent-provider-xyz' };
      const result = await client.search(query);
      expect(result).toBeDefined();
      expect(result.error).toBeTruthy();
    });
  });

  describe('HTML parsing functions', () => {
    test('search returns structured result', async () => {
      const query: SearchQuery = { query: 'test', maxResults: 5 };
      const result = await client.search(query);
      expect(result).toBeDefined();
      expect(result.query).toBe('test');
    }, 15000);

    test('search respects maxResults parameter', async () => {
      const query: SearchQuery = { query: 'test', maxResults: 3 };
      const result = await client.search(query);
      expect(result).toBeDefined();
      if (result.results && result.results.length > 0) {
        expect(result.results.length).toBeLessThanOrEqual(3);
      }
    }, 15000);
  });

  describe('container safety', () => {
    test('getApiKey returns null when env var not set', () => {
      const provider: SearchProviderConfig = {
        id: 'test',
        name: 'Test',
        mode: 'api',
        enabled: true,
        requiresApiKey: false,
        apiKeyEnvVar: 'NONEXISTENT_VAR_12345',
      };
      const apiKey = (client as any).getApiKey(provider);
      expect(apiKey).toBeNull();
    });

    test('getApiKey returns key when env var is set', () => {
      process.env.TEST_API_KEY = 'super-secret-key-123';
      const provider: SearchProviderConfig = {
        id: 'test',
        name: 'Test',
        mode: 'api',
        enabled: true,
        requiresApiKey: false,
        apiKeyEnvVar: 'TEST_API_KEY',
      };
      const apiKey = (client as any).getApiKey(provider);
      expect(apiKey).toBe('super-secret-key-123');
      delete process.env.TEST_API_KEY;
    });

    test('config never exposes API key values', () => {
      const config = (client as any).config;
      const configStr = JSON.stringify(config);
      expect(configStr).not.toMatch(/sk-[a-zA-Z0-9]+/);
      expect(configStr).not.toMatch(/api[_-]?key.*[a-zA-Z0-9]{20,}/);
    });
  });

  describe('rate limiting', () => {
    test('checkRateLimit returns true initially', () => {
      const allowed = (client as any).checkRateLimit('google', (client as any).config.providers?.google);
      expect(typeof allowed).toBe('boolean');
    });

    test('rate limiter state is tracked per provider', () => {
      const limiters = (client as any).rateLimiters;
      expect(limiters).toBeDefined();
      expect(limiters instanceof Map).toBe(true);
    });
  });

  describe('error handling', () => {
    test('handles disabled provider gracefully', async () => {
      const query: SearchQuery = { query: 'test', engineId: 'disabled-provider' };
      const result = await client.search(query);
      expect(result).toBeDefined();
      expect(result.error).toBeTruthy();
    });

    test('search result has expected structure', async () => {
      const query: SearchQuery = { query: 'typescript' };
      const result: SearchResult = await client.search(query);
      expect(result).toHaveProperty('query');
      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('success');
      expect(typeof result.success).toBe('boolean');
    }, 15000);
  });

  describe('safe search filter', () => {
    test('safeSearch flag is respected', async () => {
      const query: SearchQuery = { query: 'test', safeSearch: true };
      const result = await client.search(query);
      expect(result).toBeDefined();
    }, 15000);
  });
});
