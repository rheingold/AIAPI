import { AutomationEngine } from '../engine/automationEngine';

describe('AutomationEngine', () => {
  let engine: AutomationEngine;

  beforeEach(() => {
    engine = new AutomationEngine();
  });

  describe('Provider Management', () => {
    it('should initialize with providers', () => {
      const provider = engine.getProvider('windows-forms');
      expect(provider).toBeDefined();
    });

    it('should list available providers', async () => {
      const providers = await engine.getAvailableProviders();
      expect(providers.length).toBeGreaterThan(0);
      expect(providers).toContain('windows-forms');
      expect(providers).toContain('office-excel');
    });

    it('should return undefined for unknown provider', () => {
      const provider = engine.getProvider('unknown-provider');
      expect(provider).toBeUndefined();
    });
  });

  describe('Tree Queries', () => {
    it('should query window tree from Windows Forms provider', async () => {
      const tree = await engine.queryTree('windows-forms', 'form_main');
      expect(tree).toBeDefined();
      expect(tree.id).toBe('form_main');
    });

    it('should query tree from Office provider', async () => {
      const tree = await engine.queryTree('office-excel', 'workbook_main');
      expect(tree).toBeDefined();
      expect(tree.type).toBe('Workbook');
    });

    it('should throw error for unknown provider', async () => {
      await expect(engine.queryTree('unknown', 'any-id')).rejects.toThrow();
    });

    it('should cache query results', async () => {
      await engine.queryTree('windows-forms', 'form_main');
      const stats1 = engine.getCacheStats();
      expect(stats1.size).toBeGreaterThan(0);

      const stats2 = engine.getCacheStats();
      expect(stats2.size).toBe(stats1.size);
    });
  });

  describe('Actions', () => {
    it('should click element', async () => {
      const result = await engine.clickElement('windows-forms', 'btn_submit');
      expect(result.success).toBe(true);
    });

    it('should set property', async () => {
      const result = await engine.setProperty('windows-forms', 'txt_input', 'text', 'Hello');
      expect(result.success).toBe(true);
    });

    it('should read property', async () => {
      const value = await engine.readProperty('office-excel', 'cell_A1', 'value');
      expect(value).toBeDefined();
    });

    it('should throw error for unknown provider in actions', async () => {
      await expect(engine.clickElement('unknown', 'elem')).rejects.toThrow();
    });
  });

  describe('Logging', () => {
    it('should log actions', async () => {
      await engine.queryTree('windows-forms', 'form_main');
      const logs = engine.getLogs();
      expect(logs.length).toBeGreaterThan(0);
    });

    it('should record success in logs', async () => {
      await engine.clickElement('windows-forms', 'btn_submit');
      const logs = engine.getLogs();
      const lastLog = logs[logs.length - 1];
      expect(lastLog.success).toBe(true);
    });

    it('should clear logs', async () => {
      await engine.queryTree('windows-forms', 'form_main');
      engine.clearLogs();
      const logs = engine.getLogs();
      expect(logs.length).toBe(0);
    });

    it('should maintain log limit', async () => {
      // Add many log entries
      for (let i = 0; i < 1001; i++) {
        await engine.clickElement('windows-forms', 'btn_submit');
      }
      const logs = engine.getLogs();
      expect(logs.length).toBeLessThanOrEqual(500);
    });
  });

  describe('Caching', () => {
    it('should get cache statistics', () => {
      const stats = engine.getCacheStats();
      expect(stats.size).toBeGreaterThanOrEqual(0);
      expect(stats.maxSize).toBe(100);
    });

    it('should clear cache', async () => {
      await engine.queryTree('windows-forms', 'form_main');
      let stats = engine.getCacheStats();
      expect(stats.size).toBeGreaterThan(0);

      engine.clearCache();
      stats = engine.getCacheStats();
      expect(stats.size).toBe(0);
    });

    it('should enforce cache size limit', async () => {
      // Query multiple items to exceed cache
      for (let i = 0; i < 150; i++) {
        await engine.queryTree('windows-forms', 'form_main');
      }
      const stats = engine.getCacheStats();
      expect(stats.size).toBeLessThanOrEqual(stats.maxSize);
    });
  });
});
