/**
 * settings/adapters/JsonSettingsAdapter.ts
 *
 * ISettingsAdapter backed by the signed local JSON file
 * (config/dashboard-settings.json).
 *
 * On load:  reads the file, optionally verifies the ConfigSigner signature.
 * On save:  writes + re-signs the file atomically (write tmp → rename).
 *
 * Dot-notation helpers (get/set) traverse nested objects using a simple
 * path split without a heavy library dependency.
 */
import { ISettingsAdapter } from '../types';
export declare class JsonSettingsAdapter implements ISettingsAdapter {
    private readonly filePath;
    /** In-memory cache; null until first load() */
    private cache;
    constructor(filePath: string);
    initialize(): Promise<void>;
    load(): Promise<Record<string, unknown>>;
    save(settings: Record<string, unknown>): Promise<void>;
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
}
//# sourceMappingURL=JsonSettingsAdapter.d.ts.map