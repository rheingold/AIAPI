import { IAutomationProvider, UIObject, ActionResult, QueryOptions } from '../types';

/**
 * Web UI automation provider using Playwright
 */
export class WebUIProvider implements IAutomationProvider {
  private playwright: any;
  private browser: any;
  private page: any;

  getName(): string {
    return 'Web UI Provider (Playwright)';
  }

  async isAvailable(): Promise<boolean> {
    try {
      // @ts-ignore - optional dependency
      this.playwright = await import('playwright').catch(() => null);
      return this.playwright !== null;
    } catch {
      return false;
    }
  }

  async initializeBrowser(url?: string): Promise<void> {
    if (!this.playwright) {
      throw new Error('Playwright is not available');
    }

    if (!this.browser) {
      this.browser = await this.playwright.chromium.launch();
      this.page = await this.browser.newPage();

      if (url) {
        await this.page.goto(url);
      }
    }
  }

  async closeBrowser(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  async getWindowTree(selector: string, options?: QueryOptions): Promise<UIObject> {
    if (!this.page) {
      throw new Error('Browser not initialized. Call initializeBrowser first.');
    }

    const depth = options?.depth ?? 2;
    const domTree = await this.page.evaluate((sel: string, maxDepth: number) => {
      const element = document.querySelector(sel) || document.body;
      
      const buildTree = (el: Element, currentDepth: number): any => {
        if (currentDepth <= 0) return null;

        const rect = el.getBoundingClientRect();
        const node: any = {
          id: el.id || `elem_${Math.random().toString(36).substr(2, 9)}`,
          type: el.tagName.toLowerCase(),
          name: el.className || el.id,
          properties: {
            tagName: el.tagName,
            className: el.className,
            innerHTML: el.innerHTML.substring(0, 100),
            textContent: el.textContent?.substring(0, 100),
          },
          position: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          actions: ['click', 'inspect'],
        };

        // Include interactive element actions
        if (el instanceof HTMLInputElement) {
          node.actions.push('setValue', 'readValue', 'focus');
        } else if (el instanceof HTMLButtonElement) {
          node.actions.push('click');
        } else if (el instanceof HTMLSelectElement) {
          node.actions.push('setValue', 'readValue');
        }

        if (el.children.length > 0 && currentDepth > 1) {
          node.children = Array.from(el.children)
            .map(child => buildTree(child, currentDepth - 1))
            .filter((child: any) => child !== null);
        }

        return node;
      };

      return buildTree(element, maxDepth);
    }, selector, depth);

    return domTree as UIObject;
  }

  async clickElement(elementId: string): Promise<ActionResult> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    try {
      const selector = `#${elementId}`;
      await this.page.click(selector);
      return {
        success: true,
        message: `Clicked element ${elementId}`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to click element: ${error}`,
      };
    }
  }

  async setProperty(elementId: string, property: string, value: any): Promise<ActionResult> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    try {
      const selector = `#${elementId}`;
      
      if (property === 'value') {
        await this.page.fill(selector, value);
      } else if (property === 'textContent') {
        await this.page.evaluate((sel: string, val: any) => {
          document.querySelector(sel)!.textContent = val;
        }, selector, value);
      } else {
        await this.page.evaluate((sel: string, prop: string, val: any) => {
          (document.querySelector(sel) as any)[prop] = val;
        }, selector, property, value);
      }

      return {
        success: true,
        message: `Set ${property} on element ${elementId}`,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to set property: ${error}`,
      };
    }
  }

  async readProperty(elementId: string, property: string): Promise<any> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    const selector = `#${elementId}`;
    return await this.page.evaluate((sel: string, prop: string) => {
      return (document.querySelector(sel) as any)?.[prop];
    }, selector, property);
  }
}
