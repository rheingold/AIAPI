/**
 * Shared logger that can broadcast logs to dashboard
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogCallback = (level: LogLevel, source: string, message: string) => void;
export declare class Logger {
    private callbacks;
    private verboseMode;
    constructor(verboseMode?: boolean);
    /**
     * Register a callback to receive log messages
     */
    onLog(callback: LogCallback): void;
    /**
     * Log a message
     */
    log(level: LogLevel, source: string, message: string): void;
    /**
     * Log JSON with formatting
     */
    logJSON(level: LogLevel, source: string, label: string, data: any): void;
    debug(source: string, message: string): void;
    info(source: string, message: string): void;
    warn(source: string, message: string): void;
    error(source: string, message: string): void;
}
export declare const globalLogger: Logger;
//# sourceMappingURL=Logger.d.ts.map