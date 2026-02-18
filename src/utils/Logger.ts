/**
 * Shared logger that can broadcast logs to dashboard
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogCallback = (level: LogLevel, source: string, message: string) => void;

export class Logger {
  private callbacks: LogCallback[] = [];
  private verboseMode: boolean = true;

  constructor(verboseMode: boolean = true) {
    this.verboseMode = verboseMode;
  }

  /**
   * Register a callback to receive log messages
   */
  onLog(callback: LogCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Log a message
   */
  log(level: LogLevel, source: string, message: string): void {
    // Always log to console
    console.log(`[${new Date().toLocaleTimeString()}] ${level.toUpperCase()} [${source}] ${message}`);

    // Notify all callbacks (e.g., dashboard)
    this.callbacks.forEach(cb => cb(level, source, message));
  }

  /**
   * Log JSON with formatting
   */
  logJSON(level: LogLevel, source: string, label: string, data: any): void {
    if (!this.verboseMode) return;

    try {
      const formatted = JSON.stringify(data, null, 2);
      const lines = formatted.split('\n');

      // Log the entire JSON as a single message with label
      if (lines.length > 50) {
        const truncated = lines.slice(0, 47).join('\n') + `\n... (${lines.length - 47} more lines)`;
        this.log(level, source, `${label}:\n${truncated}`);
      } else {
        this.log(level, source, `${label}:\n${formatted}`);
      }
    } catch (error) {
      this.log('error', source, `Failed to format JSON for ${label}: ${error}`);
    }
  }

  debug(source: string, message: string): void {
    this.log('debug', source, message);
  }

  info(source: string, message: string): void {
    this.log('info', source, message);
  }

  warn(source: string, message: string): void {
    this.log('warn', source, message);
  }

  error(source: string, message: string): void {
    this.log('error', source, message);
  }
}

// Global singleton logger instance
export const globalLogger = new Logger();
