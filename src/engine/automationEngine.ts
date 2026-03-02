import { IAutomationProvider, UIObject, ActionResult, QueryOptions, LogEntry } from '../types';
import { WindowsFormsProvider } from '../providers/windowsFormsProvider';
import { OfficeProvider } from '../providers/officeProvider';

/**
 * Security filter validation function type
 */
export type SecurityFilterValidator = (
  processName: string, 
  command: string, 
  parameter: string,
  context?: { adminToken?: string }
) => Promise<'ALLOW' | 'DENY'>;

/**
 * Central automation engine that manages all providers
 */
export class AutomationEngine {
  private providers: Map<string, IAutomationProvider> = new Map();
  private logs: LogEntry[] = [];
  private objectCache: Map<string, UIObject> = new Map();
  private readonly maxCacheSize = 100;
  private sessionToken: string | null = null;
  private sessionSecret: string | null = null;
  private securityValidator: SecurityFilterValidator | null = null;
  private webScrapingClient: any; // Lazy initialized
  private adminToken: string | null = null; // For privileged operations

  constructor(sessionToken?: string, sessionSecret?: string) {
    this.sessionToken = sessionToken || null;
    this.sessionSecret = sessionSecret || null;
    this.initializeProviders();
  }

  /**
   * Set security filter validator
   */
  setSecurityValidator(validator: SecurityFilterValidator | null): void {
    this.securityValidator = validator;
  }

  /**
   * Set admin token for privileged operations
   */
  setAdminToken(token: string | null): void {
    this.adminToken = token;
  }

  /**
   * Determine command type from element ID for security filtering
   */
  private determineCommandType(elementId: string): string {
    if (elementId.includes('{QUERYTREE'))  return 'QUERYTREE';
    if (elementId.includes('{CLICKID:'))   return 'CLICKID';
    if (elementId.includes('{CLICKNAME:')) return 'CLICKNAME';
    if (elementId.includes('{CLICK:'))     return 'CLICK';
    if (elementId.includes('{read}'))      return 'READ';
    if (elementId.includes('{SET:'))       return 'SET';
    if (elementId.includes('{LISTWINDOWS}')) return 'LISTWINDOWS';
    if (elementId.includes('{KILL}'))      return 'KILL';
    return 'SENDKEYS'; // Default for regular keystrokes
  }

  /**
   * Extract parameter from element ID
   */
  private extractParameter(elementId: string, commandType: string): string {
    const regex = new RegExp(`\\{${commandType}:?([^}]*)\\}`, 'i');
    const match = elementId.match(regex);
    return match ? match[1] : elementId;
  }

  /**
   * Extract process name from element ID (HANDLE:xxx or process name)
   */
  private extractProcessName(elementId: string): string {
    if (elementId.startsWith('HANDLE:')) {
      return '*'; // Handle-based targeting - use wildcard for now
    }
    if (elementId.startsWith('PID:')) {
      return '*'; // PID-based targeting - use wildcard for now  
    }
    const parts = elementId.split(':');
    return parts.length > 1 ? parts[0] : '*';
  }

  /**
   * Validate security filter before executing command
   */
  private async validateSecurityFilter(
    elementId: string
  ): Promise<void> {
    // Check for emergency admin mode
    if (process.env.EMERGENCY_ADMIN_MODE === 'true') {
      this.log(`🚨 EMERGENCY MODE: Bypassing security filter for ${elementId}`, true);
      return; // Emergency mode bypasses all security
    }
    
    if (!this.securityValidator) {
      return; // No validator configured - allow all
    }

    const commandType = this.determineCommandType(elementId);
    const parameter = this.extractParameter(elementId, commandType);
    const processName = this.extractProcessName(elementId);

    const result = await this.securityValidator(
      processName, 
      commandType, 
      parameter,
      { adminToken: this.adminToken || undefined }
    );
    
    if (result === 'DENY') {
      throw new Error(`Operation blocked by security filter: ${commandType} on ${processName} with parameter ${parameter}`);
    }
  }

  private initializeProviders(): void {
    this.providers.set('windows-forms', new WindowsFormsProvider(this.sessionToken || undefined, this.sessionSecret || undefined));
    this.providers.set('office-excel', new OfficeProvider('Excel'));
    this.providers.set('office-word', new OfficeProvider('Word'));
    this.providers.set('office-powerpoint', new OfficeProvider('PowerPoint'));
  }

  /**
   * Configure asset paths (e.g., PowerShell automation script)
   */
  configureAssets(_paths: { windowsAutomationScript?: string }) {
    // No-op: PowerShell script removed; using WinKeys.exe bundled tool
  }

  /**
   * Get list of available providers
   */
  async getAvailableProviders(): Promise<string[]> {
    const available: string[] = [];

    for (const [name, provider] of this.providers.entries()) {
      if (await provider.isAvailable()) {
        available.push(name);
      }
    }

    return available;
  }

  /**
   * Get provider by name
   */
  getProvider(name: string): IAutomationProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Query a window/document tree from a specific provider
   */
  async queryTree(
    providerName: string,
    targetId: string,
    options?: QueryOptions
  ): Promise<UIObject> {
    const provider = this.getProvider(providerName);
    if (!provider) {
      this.log(`Query failed: Provider '${providerName}' not found`, false);
      throw new Error(`Provider '${providerName}' not found`);
    }

    const cacheKey = `${providerName}:${targetId}`;
    if (this.objectCache.has(cacheKey)) {
      const cached = this.objectCache.get(cacheKey)!;
      this.log(`Retrieved cached tree for ${cacheKey}`, true);
      return cached;
    }

    const tree = await provider.getWindowTree(targetId, options);
    this.cacheObject(cacheKey, tree);
    this.log(`Queried tree from ${providerName} for ${targetId}`, true);
    return tree;
  }

  /**
   * Execute a click action on an element
   */
  async clickElement(providerName: string, elementId: string): Promise<ActionResult> {
    // Validate security filter before execution
    await this.validateSecurityFilter(elementId);
    
    const provider = this.getProvider(providerName);
    if (!provider) {
      this.log(`Click failed: Provider '${providerName}' not found`, false);
      throw new Error(`Provider '${providerName}' not found`);
    }

    const result = await provider.clickElement(elementId);
    this.log(`Click on ${elementId} via ${providerName}: ${result.success}`, result.success);
    return result;
  }

  /**
   * Set a property on an element
   */
  async setProperty(
    providerName: string,
    elementId: string,
    property: string,
    value: any
  ): Promise<ActionResult> {
    // Validate security filter before execution
    await this.validateSecurityFilter(elementId);
    
    const provider = this.getProvider(providerName);
    if (!provider) {
      this.log(`SetProperty failed: Provider '${providerName}' not found`, false);
      throw new Error(`Provider '${providerName}' not found`);
    }

    const result = await provider.setProperty(elementId, property, value);
    this.log(
      `Set ${property}=${value} on ${elementId} via ${providerName}: ${result.success}`,
      result.success
    );
    return result;
  }

  /**
   * Read a property from an element
   */
  async readProperty(
    providerName: string,
    elementId: string,
    property: string
  ): Promise<any> {
    // Validate security filter before execution
    await this.validateSecurityFilter(elementId);
    
    const provider = this.getProvider(providerName);
    if (!provider) {
      this.log(`ReadProperty failed: Provider '${providerName}' not found`, false);
      throw new Error(`Provider '${providerName}' not found`);
    }

    const value = await provider.readProperty(elementId, property);
    this.log(`Read ${property} from ${elementId} via ${providerName}`, true);
    return value;
  }

  /**
   * Get all logs
   */
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  /**
   * Clear logs
   */
  clearLogs(): void {
    this.logs = [];
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; maxSize: number } {
    return {
      size: this.objectCache.size,
      maxSize: this.maxCacheSize,
    };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.objectCache.clear();
  }

  /**
   * List all visible windows
   */
  async listWindows(): Promise<any> {
    const provider = this.getProvider('windows-forms');
    if (!provider) {
      throw new Error('Windows provider not available');
    }
    // Call windows-forms provider's listWindows method
    return await (provider as any).listWindows();
  }

  /**
   * Launch a process
   */
  async launchProcess(executable: string, args?: string[]): Promise<any> {
    const provider = this.getProvider('windows-forms');
    if (!provider) {
      throw new Error('Windows provider not available');
    }
    // Call windows-forms provider's launchProcess method
    return await (provider as any).launchProcess(executable, args);
  }

  /**
   * Internal logging
   */
  private log(action: string, success: boolean, details?: string): void {
    const entry: LogEntry = {
      timestamp: new Date(),
      action,
      success,
      details,
    };
    this.logs.push(entry);

    // Keep logs manageable
    if (this.logs.length > 1000) {
      this.logs = this.logs.slice(-500);
    }
  }

  /**
   * Internal caching with size limit
   */
  private cacheObject(key: string, obj: UIObject): void {
    if (this.objectCache.size >= this.maxCacheSize) {
      const firstKey = this.objectCache.keys().next().value;
      if (firstKey) {
        this.objectCache.delete(firstKey);
      }
    }
    this.objectCache.set(key, obj);
  }

  /**
   * Fetch webpage content with security filtering
   */
  async fetchWebpage(
    url: string, 
    options: any = {}
  ): Promise<any> {
    // Lazy initialize web scraping client
    if (!this.webScrapingClient) {
      // Import dynamically to avoid module resolution issues
      const { WebScrapingClient } = await import('./webScrapingClient');
      this.webScrapingClient = new WebScrapingClient();
    }
    
    this.log(`Fetching webpage: ${url}`, true);
    const result = await this.webScrapingClient.fetchWebpage(url, options);
    this.log(`Webpage fetch completed: ${result.success}`, result.success);
    return result;
  }

  /**
   * Configure web scraping security settings
   */
  configureWebSecurity(filter: any): void {
    // Lazy initialize web scraping client
    if (!this.webScrapingClient) {
      // Import dynamically to avoid module resolution issues
      const { WebScrapingClient } = require('./webScrapingClient');
      this.webScrapingClient = new WebScrapingClient();
    }
    
    this.webScrapingClient.setSecurityFilter(filter);
    this.log('Web security filter updated', true);
  }
}
