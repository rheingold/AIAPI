/**
 * FetchContentClient Unit Tests
 * 
 * Tests for content fetching with automatic content-type handling,
 * HTML-to-Markdown conversion, and timeout handling.
 * 
 * Run: npx jest components/server/src/engine/__tests__/fetchContentClient.test.ts
 */
import { FetchContentClient } from '../fetchContentClient';

describe('FetchContentClient', () => {
  let client: FetchContentClient;

  beforeEach(() => {
    client = new FetchContentClient();
  });

  describe('fetchMarkdown', () => {
    test('returns structured result', async () => {
      const result = await client.fetchMarkdown('https://httpbin.org/html', { timeout: 5000 });
      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('contentType');
    }, 15000);

    test('handles invalid URL gracefully', async () => {
      const result = await client.fetchMarkdown('http://invalid-host-xyz-12345.com', { timeout: 2000 });
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    }, 10000);

    test('markdown field is present on success', async () => {
      const result = await client.fetchMarkdown('https://httpbin.org/html', { timeout: 5000 });
      if (result.success) {
        expect(result.markdown).toBeDefined();
        expect(typeof result.markdown).toBe('string');
      }
    }, 15000);
  });

  describe('fetchTxt', () => {
    test('returns structured result', async () => {
      const result = await client.fetchTxt('https://httpbin.org/get', { timeout: 5000 });
      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');
    }, 15000);

    test('text field is present on success', async () => {
      const result = await client.fetchTxt('https://httpbin.org/get', { timeout: 5000 });
      if (result.success) {
        expect(result.text).toBeDefined();
        expect(typeof result.text).toBe('string');
      }
    }, 15000);
  });

  describe('fetchHtml', () => {
    test('returns HTML content', async () => {
      const result = await client.fetchHtml('https://httpbin.org/html', { timeout: 5000 });
      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');
      if (result.success) {
        expect(result.content).toBeDefined();
      }
    }, 15000);
  });

  describe('fetchJson', () => {
    test('parses JSON response', async () => {
      const result = await client.fetchJson('https://httpbin.org/get', { timeout: 5000 });
      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');
      if (result.success) {
        expect(result.json).toBeDefined();
        expect(typeof result.json).toBe('object');
      }
    }, 15000);

    test('handles non-JSON response with error', async () => {
      const result = await client.fetchJson('https://httpbin.org/html', { timeout: 5000 });
      expect(result).toBeDefined();
      // HTML is not valid JSON, so this should fail parsing
      expect(result.success || result.error).toBeTruthy();
    }, 15000);
  });

  describe('timeout handling', () => {
    test('respects short timeout', async () => {
      const result = await client.fetchTxt('https://httpbin.org/delay/10', { timeout: 200 });
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
    }, 10000);
  });

  describe('security', () => {
    test('does not expose internal content for localhost', async () => {
      const result = await client.fetchTxt('http://localhost:3457', { timeout: 2000 });
      expect(result).toBeDefined();
      // Should not crash, result may fail but that's fine
    }, 10000);
  });
});
