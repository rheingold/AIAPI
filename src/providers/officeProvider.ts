import { IAutomationProvider, UIObject, ActionResult, QueryOptions } from '../types';

/**
 * Office automation provider for Word, Excel, PowerPoint
 * In production, this would use COM interop via C# DLL
 */
export class OfficeProvider implements IAutomationProvider {
  private officeType: 'Word' | 'Excel' | 'PowerPoint';
  private mockDocumentTree: Map<string, UIObject> = new Map();

  constructor(officeType: 'Word' | 'Excel' | 'PowerPoint' = 'Excel') {
    this.officeType = officeType;
    this.initializeMockData();
  }

  getName(): string {
    return `Office Provider (${this.officeType})`;
  }

  async isAvailable(): Promise<boolean> {
    // In production, check if Office is installed and COM is accessible
    return true;
  }

  async getWindowTree(documentId: string, options?: QueryOptions): Promise<UIObject> {
    const depth = options?.depth ?? 2;
    const cachedTree = this.mockDocumentTree.get(documentId);

    if (!cachedTree) {
      throw new Error(`Document with ID ${documentId} not found`);
    }

    return this.truncateTreeByDepth(cachedTree, depth);
  }

  async clickElement(elementId: string): Promise<ActionResult> {
    console.log(`[Office-${this.officeType}] Clicking element: ${elementId}`);
    return {
      success: true,
      message: `Selected element ${elementId}`,
    };
  }

  async setProperty(elementId: string, property: string, value: any): Promise<ActionResult> {
    console.log(`[Office-${this.officeType}] Setting ${property}=${value} on ${elementId}`);
    return {
      success: true,
      message: `Set property ${property} on element ${elementId}`,
    };
  }

  async readProperty(elementId: string, property: string): Promise<any> {
    console.log(`[Office-${this.officeType}] Reading property ${property} from ${elementId}`);
    return `MockValue_${property}`;
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
