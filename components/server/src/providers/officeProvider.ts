import { IAutomationProvider, UIObject, ActionResult, QueryOptions } from '../types';
import type { HelperRegistry } from '../helpers/HelperRegistry';

/**
 * Office automation provider for Word, Excel, PowerPoint.
 *
 * Two usage modes:
 * 1. **MCP tool (primary)**: HelperRegistry auto-discovers MSOfficeWin.exe from dist/helpers/
 *    and registers it as an MCP tool. No code changes needed here for that path.
 *
 * 2. **IAutomationProvider interface (secondary)**: the `OfficeProvider` class implements
 *    IAutomationProvider so it can be used programmatically. When constructed with a
 *    HelperRegistry, calls delegate to the real MSOfficeWin.exe. Otherwise, returns mock data
 *    (useful for unit tests and offline development).
 *
 * For direct helper calls use the static `callHelper()` method.
 */
export class OfficeProvider implements IAutomationProvider {
  private officeType: 'Word' | 'Excel' | 'PowerPoint';
  private mockDocumentTree: Map<string, UIObject> = new Map();
  private registry: HelperRegistry | null;

  constructor(
    officeType: 'Word' | 'Excel' | 'PowerPoint' = 'Excel',
    registry: HelperRegistry | null = null,
  ) {
    this.officeType = officeType;
    this.registry = registry;
    if (!registry) this.initializeMockData();
  }

  getName(): string {
    return `Office Provider (${this.officeType})`;
  }

  async isAvailable(): Promise<boolean> {
    if (this.registry) {
      const schema = this.registry.get('MSOfficeWin.exe');
      return schema !== undefined;
    }
    return true;
  }

  /**
   * Call MSOfficeWin.exe directly via an existing HelperRegistry.
   * Useful when you have a registry instance and don't want an OfficeProvider object.
   *
   * @example
   *   const result = await OfficeProvider.callHelper(registry, 'excel', 'QUERYTREE', '2');
   */
  static async callHelper(
    registry: HelperRegistry,
    target: string,
    command: string,
    parameter = '',
    timeoutMs = 30000,
  ): Promise<any> {
    return registry.callCommand('MSOfficeWin.exe', target, command, parameter, '', timeoutMs);
  }

  // ---------------------------------------------------------------------------
  // IAutomationProvider — live path (HelperRegistry) + mock fallback
  // ---------------------------------------------------------------------------

  async getWindowTree(documentId: string, options?: QueryOptions): Promise<UIObject> {
    const depth = options?.depth ?? 2;

    if (this.registry) {
      const appType   = this.officeType.toLowerCase();
      const target    = documentId.includes('!') || documentId.includes(':')
        ? `DOCNAME:${documentId}` : appType;
      const result = await this.registry.callCommand(
        'MSOfficeWin.exe', target, 'QUERYTREE', String(depth), '', 30000,
      );
      if (result?.success && result.result) {
        if (typeof result.result === 'string') return JSON.parse(result.result) as UIObject;
        return result.result as UIObject;
      }
      throw new Error(result?.error ?? 'QUERYTREE failed');
    }

    // Mock path
    const cachedTree = this.mockDocumentTree.get(documentId);
    if (!cachedTree) throw new Error(`Document with ID ${documentId} not found`);
    return this.truncateTreeByDepth(cachedTree, depth);
  }

  async clickElement(elementId: string): Promise<ActionResult> {
    if (this.registry) {
      const result = await this.registry.callCommand(
        'MSOfficeWin.exe', this.officeType.toLowerCase(), 'WRITE', `${elementId}|`,
      );
      return { success: result?.success ?? false, message: result?.error ?? 'clicked' };
    }
    console.log(`[Office-${this.officeType}] Clicking element: ${elementId}`);
    return { success: true, message: `Selected element ${elementId}` };
  }

  async setProperty(elementId: string, property: string, value: any): Promise<ActionResult> {
    if (this.registry) {
      const result = await this.registry.callCommand(
        'MSOfficeWin.exe', this.officeType.toLowerCase(), 'WRITE', `${elementId}|${value}`,
      );
      return { success: result?.success ?? false, message: result?.error ?? 'written' };
    }
    console.log(`[Office-${this.officeType}] Setting ${property}=${value} on ${elementId}`);
    return { success: true, message: `Set property ${property} on element ${elementId}` };
  }

  async readProperty(elementId: string, _property: string): Promise<any> {
    if (this.registry) {
      const result = await this.registry.callCommand(
        'MSOfficeWin.exe', this.officeType.toLowerCase(), 'READ', elementId,
      );
      return result?.result ?? null;
    }
    console.log(`[Office-${this.officeType}] Reading property ${_property} from ${elementId}`);
    return `MockValue_${_property}`;
  }

  private initializeMockData(): void {
    if (this.officeType === 'Excel') {
      const workbookTree: UIObject = {
        id: 'workbook_main',
        type: 'Workbook',
        name: 'SampleWorkbook.xlsx',
        properties: {
          sheetCount: 3,
          activeSheet: 'Sheet1',
        },
        actions: ['save', 'close'],
        children: [
          {
            id: 'sheet_1',
            type: 'Worksheet',
            name: 'Sheet1',
            properties: {
              index: 1,
              usedRange: 'A1:C10',
            },
            actions: ['select', 'addRow', 'deleteRow'],
            children: [
              {
                id: 'cell_A1',
                type: 'Cell',
                name: 'A1',
                properties: {
                  value: 'Header 1',
                  formula: '',
                  format: 'General',
                },
                actions: ['setValue', 'readValue', 'setFormat'],
              },
              {
                id: 'cell_B1',
                type: 'Cell',
                name: 'B1',
                properties: {
                  value: 'Header 2',
                  formula: '',
                  format: 'General',
                },
                actions: ['setValue', 'readValue', 'setFormat'],
              },
            ],
          },
        ],
      };
      this.mockDocumentTree.set('workbook_main', workbookTree);
    } else if (this.officeType === 'Word') {
      const docTree: UIObject = {
        id: 'doc_main',
        type: 'Document',
        name: 'SampleDocument.docx',
        properties: {
          pageCount: 5,
          wordCount: 2500,
        },
        actions: ['save', 'close', 'print'],
        children: [
          {
            id: 'para_1',
            type: 'Paragraph',
            name: 'Paragraph 1',
            properties: {
              text: 'This is the first paragraph.',
              style: 'Normal',
              alignment: 'left',
            },
            actions: ['setText', 'getText', 'setStyle'],
          },
        ],
      };
      this.mockDocumentTree.set('doc_main', docTree);
    } else if (this.officeType === 'PowerPoint') {
      const presentationTree: UIObject = {
        id: 'presentation_main',
        type: 'Presentation',
        name: 'SamplePresentation.pptx',
        properties: {
          slideCount: 10,
          activeSlide: 1,
        },
        actions: ['save', 'close', 'play'],
        children: [
          {
            id: 'slide_1',
            type: 'Slide',
            name: 'Slide 1',
            properties: {
              layout: 'Title Slide',
              index: 1,
            },
            actions: ['select', 'addShape', 'deleteShape'],
            children: [
              {
                id: 'shape_title',
                type: 'TextBox',
                name: 'Title',
                properties: {
                  text: 'Welcome',
                  fontSize: 44,
                },
                actions: ['setText', 'getText', 'setFormat'],
              },
            ],
          },
        ],
      };
      this.mockDocumentTree.set('presentation_main', presentationTree);
    }
  }

  private truncateTreeByDepth(obj: UIObject, depth: number): UIObject {
    if (depth <= 0) {
      const { children, ...rest } = obj;
      return rest;
    }

    return {
      ...obj,
      children: obj.children?.map(child => this.truncateTreeByDepth(child, depth - 1)),
    };
  }
}
