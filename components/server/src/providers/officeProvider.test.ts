import { OfficeProvider } from '../providers/officeProvider';

describe('OfficeProvider', () => {
  describe('Excel Provider', () => {
    let provider: OfficeProvider;

    beforeEach(() => {
      provider = new OfficeProvider('Excel');
    });

    it('should return Excel provider name', () => {
      expect(provider.getName()).toContain('Excel');
    });

    it('should retrieve workbook tree', async () => {
      const tree = await provider.getWindowTree('workbook_main');
      expect(tree).toBeDefined();
      expect(tree.type).toBe('Workbook');
      expect(tree.children).toBeDefined();
    });

    it('should have worksheet children', async () => {
      const tree = await provider.getWindowTree('workbook_main', { depth: 2 });
      expect(tree.children).toBeDefined();
      expect(tree.children!.length).toBeGreaterThan(0);
      expect(tree.children![0].type).toBe('Worksheet');
    });
  });

  describe('Word Provider', () => {
    let provider: OfficeProvider;

    beforeEach(() => {
      provider = new OfficeProvider('Word');
    });

    it('should return Word provider name', () => {
      expect(provider.getName()).toContain('Word');
    });

    it('should retrieve document tree', async () => {
      const tree = await provider.getWindowTree('doc_main');
      expect(tree).toBeDefined();
      expect(tree.type).toBe('Document');
    });
  });

  describe('PowerPoint Provider', () => {
    let provider: OfficeProvider;

    beforeEach(() => {
      provider = new OfficeProvider('PowerPoint');
    });

    it('should return PowerPoint provider name', () => {
      expect(provider.getName()).toContain('PowerPoint');
    });

    it('should retrieve presentation tree with slides', async () => {
      const tree = await provider.getWindowTree('presentation_main', { depth: 2 });
      expect(tree).toBeDefined();
      expect(tree.type).toBe('Presentation');
      expect(tree.children).toBeDefined();
      expect(tree.children![0].type).toBe('Slide');
    });
  });

  describe('Common Operations', () => {
    let provider: OfficeProvider;

    beforeEach(() => {
      provider = new OfficeProvider('Excel');
    });

    it('should click elements', async () => {
      const result = await provider.clickElement('sheet_1');
      expect(result.success).toBe(true);
    });

    it('should set properties', async () => {
      const result = await provider.setProperty('cell_A1', 'value', 'New Value');
      expect(result.success).toBe(true);
    });

    it('should read properties', async () => {
      const value = await provider.readProperty('cell_A1', 'value');
      expect(value).toBeDefined();
    });
  });
});
