/**
 * settings/SettingsManager.ts
 *
 * Factory and runtime wrapper for ISettingsAdapter.
 *
 * Usage:
 *   const mgr = await SettingsManager.create('./config/dashboard-settings.json');
 *   const port = await mgr.get<number>('mcpPort') ?? 3457;
 *   await mgr.set('auth.mode', 'password');
 *
 * On startup the manager reads the bootstrap JSON file to discover `settingsSource`.
 * If settingsSource = "db" it then opens the DB adapter and uses that adapter
 * for all subsequent reads/writes.  The local JSON file remains the source of the
 * DB connection config so it is always needed at startup.
 */
export declare class SettingsManager {
    private adapter;
    /** The bootstrap JSON adapter is always available for reading DB config */
    private readonly bootstrapAdapter;
    private constructor();
    /**
     * Create and initialise a SettingsManager.
     *
     * @param jsonFilePath  Path to the local dashboard-settings.json (bootstrap config).
     */
    static create(jsonFilePath?: string): Promise<SettingsManager>;
    load(): Promise<Record<string, unknown>>;
    save(settings: Record<string, unknown>): Promise<void>;
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    close(): Promise<void>;
}
//# sourceMappingURL=SettingsManager.d.ts.map