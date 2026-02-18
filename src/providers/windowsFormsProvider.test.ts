import { WindowsFormsProvider } from '../providers/windowsFormsProvider';
import { QueryOptions } from '../types';

describe('WindowsFormsProvider', () => {
  let provider: WindowsFormsProvider;

  beforeEach(() => {
    provider = new WindowsFormsProvider();
  });

  describe('getName', () => {
    it('should return provider name', () => {
      expect(provider.getName()).toBe('Windows Forms Provider');
    });
  });

  describe('isAvailable', () => {
    it('should return true', async () => {
      const available = await provider.isAvailable();
      expect(available).toBe(true);
    });
  });

  describe('getWindowTree', () => {
    it('should return window tree with default depth', async () => {
      const tree = await provider.getWindowTree('form_main');
      expect(tree).toBeDefined();
      expect(tree.id).toBe('form_main');
      expect(tree.type).toBe('Form');
      expect(tree.children).toBeDefined();
    });

    it('should respect depth parameter', async () => {
      const treeDepth1 = await provider.getWindowTree('form_main', { depth: 1 });
      const treeDepth2 = await provider.getWindowTree('form_main', { depth: 2 });

      // Depth 1 should have children but no grandchildren
      expect(treeDepth1.children).toBeDefined();
      if (treeDepth1.children && treeDepth1.children.length > 0) {
        expect(treeDepth1.children[0].children).toBeUndefined();
      }

      // Depth 2 may have deeper structure
      expect(treeDepth2.children).toBeDefined();
    });

    it('should throw error for unknown window', async () => {
      await expect(provider.getWindowTree('unknown_window')).rejects.toThrow();
    });
  });

  describe('clickElement', () => {
    it('should return success result', async () => {
      const result = await provider.clickElement('btn_submit');
      expect(result.success).toBe(true);
      expect(result.message).toContain('btn_submit');
    });
  });

  describe('setProperty', () => {
    it('should return success result', async () => {
      const result = await provider.setProperty('txt_input', 'text', 'test value');
      expect(result.success).toBe(true);
    });
  });

  describe('readProperty', () => {
    it('should return a value', async () => {
      const value = await provider.readProperty('lbl_status', 'text');
      expect(value).toBeDefined();
      expect(typeof value).toBe('string');
    });
  });
});
