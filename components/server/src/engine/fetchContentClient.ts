/**
 * fetchContentClient.ts
 *
 * Content-type specific fetch wrapper around WebScrapingClient.
 * Provides fetch_markdown, fetch_txt, fetch_html, fetch_json operations.
 *
 * ADR-019: MCP-Compatible Search & Retrieve Services
 */

import { JSDOM } from 'jsdom';
import { globalLogger } from '../utils/Logger';
import { WebFetchOptions, WebFetchResult } from './webScrapingClient';

const TAG = 'FetchContentClient';

/**
 * Extended result type that includes content-type specific fields.
 */
export interface FetchContentResult extends WebFetchResult {
  /** Markdown content (for fetch_markdown) */
  markdown?: string;
  /** Parsed JSON object (for fetch_json) */
  json?: unknown;
  /** Detected content type */
  contentType?: string;
}

/**
 * Simple HTML-to-Markdown converter using JSDOM.
 * Handles common elements: headings, paragraphs, lists, links, code, tables.
 */
function htmlToMarkdown(html: string): string {
  try {
    const dom = new JSDOM(html);
    const document = dom.window.document;

    // Remove script and style elements
    const scripts = document.querySelectorAll('script, style, noscript');
    scripts.forEach((s) => s.remove());

    return convertElement(document.body);
  } catch (error) {
    globalLogger.warn(TAG, `HTML-to-Markdown conversion failed: ${(error as Error).message}`);
    // Fallback: strip tags and return plain text
    return html.replace(/<[^>]*>/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
}

/**
 * Recursively convert a DOM element to Markdown.
 */
function convertElement(element: Node, indent: number = 0): string {
  const md: string[] = [];
  const indentStr = '  '.repeat(indent);

  if (element.nodeType === 3) {
    // Text node
    const text = (element as Text).textContent || '';
    if (text.trim()) {
      md.push(text);
    }
    return md.join('');
  }

  if (element.nodeType !== 1) {
    return '';
  }

  const el = element as Element;
  const tag = el.tagName.toLowerCase();

  switch (tag) {
    case 'h1':
      md.push(`\n\n${indentStr}# ${getTextContent(el)}\n\n`);
      break;
    case 'h2':
      md.push(`\n\n${indentStr}## ${getTextContent(el)}\n\n`);
      break;
    case 'h3':
      md.push(`\n\n${indentStr}### ${getTextContent(el)}\n\n`);
      break;
    case 'h4':
      md.push(`\n\n${indentStr}#### ${getTextContent(el)}\n\n`);
      break;
    case 'h5':
      md.push(`\n\n${indentStr}##### ${getTextContent(el)}\n\n`);
      break;
    case 'h6':
      md.push(`\n\n${indentStr}###### ${getTextContent(el)}\n\n`);
      break;
    case 'p':
      md.push(`\n\n${indentStr}${getTextContent(el)}\n\n`);
      break;
    case 'br':
      md.push('\n');
      break;
    case 'a': {
      const href = el.getAttribute('href') || '';
      const text = getTextContent(el);
      if (text) {
        md.push(`[${text}](${href})`);
      } else {
        md.push(href);
      }
      break;
    }
    case 'strong':
    case 'b':
      md.push(`**${getTextContent(el)}**`);
      break;
    case 'em':
    case 'i':
      md.push(`*${getTextContent(el)}*`);
      break;
    case 'code':
      if (el.parentElement?.tagName.toLowerCase() === 'pre') {
        md.push(getTextContent(el));
      } else {
        md.push(`\`${getTextContent(el)}\``);
      }
      break;
    case 'pre':
      md.push(`\n\n\`\`\`\n${getTextContent(el)}\n\`\`\`\n\n`);
      break;
    case 'blockquote':
      const quoteContent = convertChildren(el);
      md.push(`\n\n> ${quoteContent.replace(/\n/g, '\n> ')}\n\n`);
      break;
    case 'ul':
    case 'ol':
      md.push(convertList(el, indent));
      break;
    case 'li':
      md.push(convertChildren(el));
      break;
    case 'img': {
      const src = el.getAttribute('src') || '';
      const alt = el.getAttribute('alt') || '';
      md.push(`![${alt}](${src})`);
      break;
    }
    case 'table':
      md.push(convertTable(el));
      break;
    case 'div':
    case 'section':
    case 'article':
    case 'main':
    case 'header':
    case 'footer':
    case 'nav':
    case 'aside':
    case 'span':
    case 'section':
    case 'figure':
    case 'figcaption':
      md.push(convertChildren(el));
      break;
    case 'head':
    case 'script':
    case 'style':
    case 'noscript':
      // Skip these
      break;
    default:
      md.push(convertChildren(el));
  }

  return md.join('');
}

/**
 * Convert all child nodes of an element.
 */
function convertChildren(element: Element): string {
  const md: string[] = [];
  element.childNodes.forEach((child) => {
    md.push(convertElement(child));
  });
  return md.join('');
}

/**
 * Convert a list element to Markdown.
 */
function convertList(listElement: Element, indent: number): string {
  const md: string[] = [];
  const items = listElement.querySelectorAll(':scope > li');
  const isOrdered = listElement.tagName.toLowerCase() === 'ol';
  const indentStr = '  '.repeat(indent);

  items.forEach((item, index) => {
    const prefix = isOrdered ? `${index + 1}. ` : '- ';
    const content = getTextContent(item).trim();
    md.push(`${indentStr}${prefix}${content}`);
  });

  return `\n\n${md.join('\n')}\n\n`;
}

/**
 * Convert a table element to Markdown.
 */
function convertTable(tableElement: Element): string {
  const md: string[] = [];
  const rows = tableElement.querySelectorAll('tr');

  if (rows.length === 0) return '';

  rows.forEach((row, rowIndex) => {
    const cells = row.querySelectorAll('th, td');
    const cellContents: string[] = [];

    cells.forEach((cell) => {
      cellContents.push(getTextContent(cell).trim().replace(/\|/g, '\\|'));
    });

    if (cellContents.length === 0) return;

    md.push(`| ${cellContents.join(' | ')} |`);

    // Add separator after header row
    if (rowIndex === 0) {
      const separator = cellContents.map(() => '---').join(' | ');
      md.push(`| ${separator} |`);
    }
  });

  return `\n\n${md.join('\n')}\n\n`;
}

/**
 * Get text content of an element, normalizing whitespace.
 */
function getTextContent(element: Element): string {
  return (element.textContent || '').replace(/\s+/g, ' ').trim();
}

/**
 * Detect content type from URL or Content-Type header.
 */
function detectContentType(url: string, contentTypeHeader?: string): string {
  if (contentTypeHeader) {
    return contentTypeHeader.split(';')[0].trim().toLowerCase();
  }

  // Fallback to URL extension detection
  const ext = url.split('.').pop()?.toLowerCase() || '';
  const extMap: Record<string, string> = {
    'html': 'text/html',
    'htm': 'text/html',
    'json': 'application/json',
    'txt': 'text/plain',
    'text': 'text/plain',
    'md': 'text/markdown',
    'markdown': 'text/markdown',
    'xml': 'application/xml',
    'csv': 'text/csv',
    'pdf': 'application/pdf',
  };

  return extMap[ext] || 'text/html';
}


// ─── FetchContentClient ──────────────────────────────────────────────────────

/**
 * Content-type specific fetch client.
 * Reuses the existing WebScrapingClient infrastructure for HTTP operations
 * and adds content-type specific post-processing.
 */
export class FetchContentClient {
  private webClient: any; // Lazy initialized WebScrapingClient

  /**
   * Get or create the WebScrapingClient instance.
   */
  private async getWebClient(): Promise<any> {
    if (!this.webClient) {
      const { WebScrapingClient } = await import('./webScrapingClient');
      this.webClient = new WebScrapingClient();
    }
    return this.webClient;
  }

  /**
   * Fetch URL and return content as Markdown.
   */
  public async fetchMarkdown(
    targetUrl: string,
    options?: WebFetchOptions,
  ): Promise<FetchContentResult> {
    globalLogger.info(TAG, `fetch_markdown: ${targetUrl}`);

    try {
      const client = await this.getWebClient();
      const result = await client.fetchWebpage(targetUrl, {
        ...options,
        extractText: false,
      });

      if (!result.success) {
        return { ...result, contentType: 'unknown' };
      }

      const contentType = detectContentType(
        targetUrl,
        result.headers?.['content-type'],
      );

      // If already text/markdown, return directly
      if (contentType === 'text/markdown') {
        return {
          ...result,
          markdown: result.content || result.text || '',
          contentType,
        };
      }

      // Convert HTML to Markdown
      const markdown = htmlToMarkdown(result.content || '');

      return {
        ...result,
        markdown,
        contentType,
      };
    } catch (error) {
      globalLogger.error(TAG, `fetch_markdown failed: ${(error as Error).message}`);
      return {
        success: false,
        url: targetUrl,
        error: (error as Error).message,
        contentType: 'unknown',
      };
    }
  }

  /**
   * Fetch URL and return plain text content.
   */
  public async fetchTxt(
    targetUrl: string,
    options?: WebFetchOptions,
  ): Promise<FetchContentResult> {
    globalLogger.info(TAG, `fetch_txt: ${targetUrl}`);

    try {
      const client = await this.getWebClient();
      const result = await client.fetchWebpage(targetUrl, {
        ...options,
        extractText: true,
      });

      if (!result.success) {
        return { ...result, contentType: 'unknown' };
      }

      const contentType = detectContentType(
        targetUrl,
        result.headers?.['content-type'],
      );

      return {
        ...result,
        text: result.text || result.content || '',
        contentType,
      };
    } catch (error) {
      globalLogger.error(TAG, `fetch_txt failed: ${(error as Error).message}`);
      return {
        success: false,
        url: targetUrl,
        error: (error as Error).message,
        contentType: 'unknown',
      };
    }
  }

  /**
   * Fetch URL and return HTML content (passthrough).
   */
  public async fetchHtml(
    targetUrl: string,
    options?: WebFetchOptions,
  ): Promise<FetchContentResult> {
    globalLogger.info(TAG, `fetch_html: ${targetUrl}`);

    try {
      const client = await this.getWebClient();
      const result = await client.fetchWebpage(targetUrl, options);

      if (!result.success) {
        return { ...result, contentType: 'unknown' };
      }

      const contentType = detectContentType(
        targetUrl,
        result.headers?.['content-type'],
      );

      return {
        ...result,
        contentType,
      };
    } catch (error) {
      globalLogger.error(TAG, `fetch_html failed: ${(error as Error).message}`);
      return {
        success: false,
        url: targetUrl,
        error: (error as Error).message,
        contentType: 'unknown',
      };
    }
  }

  /**
   * Fetch URL and parse response as JSON.
   */
  public async fetchJson(
    targetUrl: string,
    options?: WebFetchOptions,
  ): Promise<FetchContentResult> {
    globalLogger.info(TAG, `fetch_json: ${targetUrl}`);

    try {
      const client = await this.getWebClient();
      const result = await client.fetchWebpage(targetUrl, {
        ...options,
        headers: {
          'Accept': 'application/json',
          ...(options?.headers || {}),
        },
      });

      if (!result.success) {
        return { ...result, contentType: 'unknown' };
      }

      const contentType = detectContentType(
        targetUrl,
        result.headers?.['content-type'],
      );

      // Try to parse the content as JSON
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(result.content || '');
      } catch (parseError) {
        globalLogger.warn(TAG, `JSON parse failed: ${(parseError as Error).message}`);
        return {
          ...result,
          error: `Response is not valid JSON: ${(parseError as Error).message}`,
          contentType,
          success: false,
        };
      }

      return {
        ...result,
        json: parsedJson,
        contentType,
      };
    } catch (error) {
      globalLogger.error(TAG, `fetch_json failed: ${(error as Error).message}`);
      return {
        success: false,
        url: targetUrl,
        error: (error as Error).message,
        contentType: 'unknown',
      };
    }
  }
}
