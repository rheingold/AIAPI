"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.globalLogger = exports.Logger = void 0;
class Logger {
    constructor(verboseMode = true) {
        this.callbacks = [];
        this.verboseMode = true;
        this.verboseMode = verboseMode;
    }
    /**
     * Register a callback to receive log messages
     */
    onLog(callback) {
        this.callbacks.push(callback);
    }
    /**
     * Log a message
     */
    log(level, source, message) {
        // Always log to console
        console.log(`[${new Date().toLocaleTimeString()}] ${level.toUpperCase()} [${source}] ${message}`);
        // Notify all callbacks (e.g., dashboard)
        this.callbacks.forEach(cb => cb(level, source, message));
    }
    /**
     * Log JSON with formatting
     */
    logJSON(level, source, label, data) {
        if (!this.verboseMode)
            return;
        try {
            const formatted = JSON.stringify(data, null, 2);
            this.log(level, source, `${label}:\n${formatted}`);
        }
        catch (error) {
            this.log('error', source, `Failed to format JSON for ${label}: ${error}`);
        }
    }
    debug(source, message) {
        this.log('debug', source, message);
    }
    info(source, message) {
        this.log('info', source, message);
    }
    warn(source, message) {
        this.log('warn', source, message);
    }
    error(source, message) {
        this.log('error', source, message);
    }
}
exports.Logger = Logger;
// Global singleton logger instance
exports.globalLogger = new Logger();
//# sourceMappingURL=Logger.js.map