/**
 * Core API types for AI-driven UI automation
 */

export interface UIObject {
  id: string;
  type: string; // e.g., Button, TextBox, Slide, Table, Input, Div
  name?: string;
  children?: UIObject[];
  properties?: Record<string, any>;
  actions?: string[]; // e.g., click, setValue, readValue
  position?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface ActionResult {
  success: boolean;
  message?: string;
  updatedObject?: UIObject;
  data?: any;
  error?: string;
}

export interface QueryOptions {
  depth?: number;
  includeProperties?: boolean;
  includeActions?: boolean;
}

export enum AutomationTargetType {
  WINDOWS_FORMS = 'windows_forms',
  WPF = 'wpf',
  WEB_UI = 'web_ui',
  OFFICE_WORD = 'office_word',
  OFFICE_EXCEL = 'office_excel',
  OFFICE_POWERPOINT = 'office_powerpoint',
}

export interface WindowInfo {
  id: string;
  title: string;
  className?: string;
  targetType: AutomationTargetType;
  isActive: boolean;
}

export interface AutomationContext {
  targetWindow?: WindowInfo;
  lastQueryDepth?: number;
  cachedObjects?: Map<string, UIObject>;
}

export interface LogEntry {
  timestamp: Date;
  action: string;
  success: boolean;
  details?: string;
}

/**
 * Base interface for all automation providers
 */
export interface IAutomationProvider {
  getName(): string;
  isAvailable(): Promise<boolean>;
  getWindowTree(windowId: string, options?: QueryOptions): Promise<UIObject>;
  clickElement(elementId: string): Promise<ActionResult>;
  setProperty(elementId: string, property: string, value: any): Promise<ActionResult>;
  readProperty(elementId: string, property: string): Promise<any>;
}
