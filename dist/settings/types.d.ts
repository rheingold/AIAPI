/**
 * settings/types.ts
 *
 * Types for the pluggable settings-source subsystem (CONVENTIONS.md §5.2).
 *
 * The server can load/persist its runtime configuration from:
 *  - "json"  — signed local file (config/dashboard-settings.json)
 *  - "db"    — remote RDBMS (MSSQL, Oracle, MySQL, PostgreSQL)
 *
 * Both implement ISettingsAdapter; SettingsManager is the factory.
 */
export type DbType = 'mssql' | 'oracle' | 'mysql' | 'postgresql';
/**
 * How the server authenticates *to* the remote database.
 *
 * | method          | description                                                  |
 * |-----------------|--------------------------------------------------------------|
 * | impersonation   | Windows impersonation (MSSQL + Kerberos, Windows only)      |
 * | integrated      | Windows integrated / SSPI                                    |
 * | certificate     | Client TLS certificate (reuses settings-signing cert if not |
 * |                 | overridden by db.auth.certificatePath)                      |
 * | password        | Username + password stored in config (may be encrypted)     |
 * | constant        | Full raw connection string in config — unencrypted, abusable |
 */
export type DbAuthMethod = 'impersonation' | 'integrated' | 'certificate' | 'password' | 'constant';
export interface DbAuthConfig {
    method: DbAuthMethod;
    /** Used for method = "password" */
    username?: string;
    /** Used for method = "password" (may be encrypted with settings key) */
    password?: string;
    /** Used for method = "constant"; full connection string */
    connectionString?: string;
    /** Used for method = "certificate" */
    certificatePath?: string;
    /** Used for method = "impersonation" */
    domain?: string;
}
export interface DbConfig {
    type: DbType;
    host: string;
    port?: number;
    database: string;
    /** Table name for key-value settings store */
    table: string;
    auth: DbAuthConfig;
    tls: boolean;
    /** Path to DB server CA cert bundle for TLS verification */
    tlsCertPath?: string;
}
/**
 * ISettingsAdapter — read/write server configuration from/to a backend.
 * All methods that write must also persist the change durably (re-sign JSON,
 * commit to DB, etc.).
 */
export interface ISettingsAdapter {
    /**
     * Load the full settings object.
     * Returns a plain JS object (same shape as dashboard-settings.json).
     */
    load(): Promise<Record<string, unknown>>;
    /**
     * Persist the full settings object, replacing the existing one.
     */
    save(settings: Record<string, unknown>): Promise<void>;
    /**
     * Read a single key.  Returns undefined if absent.
     * Dot-notation supported: "auth.jwt.expiryMinutes"
     */
    get<T = unknown>(key: string): Promise<T | undefined>;
    /**
     * Write a single key.  Dot-notation supported.
     * Triggers a full persist after the update.
     */
    set(key: string, value: unknown): Promise<void>;
    /**
     * Optional: called on server startup.
     * Can be used to test DB connectivity or verify JSON signature.
     */
    initialize?(): Promise<void>;
    /**
     * Optional: called on server shutdown.
     * Releases DB connection pools etc.
     */
    close?(): Promise<void>;
}
export interface SettingsSourceConfig {
    /** Which backend to use */
    settingsSource: 'json' | 'db';
    /** Path to signed JSON file (when settingsSource = "json") */
    settingsJsonPath?: string;
    /** DB connection info (when settingsSource = "db") */
    db?: DbConfig;
}
/**
 * Search provider mode.
 * - "html"  scrape the provider public search results page
 * - "api"   call the provider REST API
 * - "auto"  try API first; fall back to HTML when no API key available
 */
export type SearchProviderMode = 'html' | 'api' | 'auto';
/** Rate limiting configuration for a single provider. */
export interface SearchProviderRateLimit {
    /** Maximum requests per minute */
    maxPerMinute?: number;
    /** Cooldown between requests in ms */
    cooldownMs?: number;
}
/**
 * Single search provider configuration entry.
 * Loaded from config/search-providers.json at server startup.
 */
export interface SearchProviderConfig {
    /** Unique provider identifier, e.g. "google", "duckduckgo_api" */
    id: string;
    /** Human-readable display name */
    name: string;
    /** Operating mode */
    mode: SearchProviderMode;
    /** Whether this provider requires an API key for API mode */
    requiresApiKey: boolean;
    /** Provider enabled flag */
    enabled: boolean;
    /** URL template for HTML scraping. Placeholders: {encoded_query}, {maxResults}, {lang}, {region} */
    searchUrlPattern?: string;
    /** Parser class name for HTML results (e.g. "GoogleParser") */
    resultParser?: string;
    /** Base URL for API calls */
    apiEndpoint?: string;
    /** HTTP method (default: GET) */
    apiMethod?: 'GET' | 'POST';
    /** Headers template. {apiKey} substituted at runtime from env. */
    apiHeaders?: Record<string, string>;
    /** Query-string params template (for GET requests) */
    apiParams?: Record<string, string>;
    /** JSON body template for POST requests */
    apiBodyTemplate?: string;
    /** Environment variable name holding the API key */
    apiKeyEnvVar?: string;
    /** Per-provider rate limit settings */
    rateLimit?: SearchProviderRateLimit;
}
/**
 * Full search provider configuration file shape.
 * Matches config/search-providers.json structure.
 */
export interface SearchProvidersConfig {
    /** Default engine ID when caller does not specify one */
    defaultEngine: string;
    /** Map of provider ID to provider config */
    providers: Record<string, SearchProviderConfig>;
}
/**
 * Search query parameters passed to SearchEngineClient.search().
 */
export interface SearchQuery {
    /** The search query string */
    query: string;
    /** Provider ID; omit to use default */
    engineId?: string;
    /** Maximum results to return (default: 10) */
    maxResults?: number;
    /** Override provider mode */
    mode?: 'html' | 'api';
    /** Language preference (e.g. "en", "de") */
    lang?: string;
    /** Region/locale preference (e.g. "US", "DE") */
    region?: string;
    /** Enable safe search filtering */
    safeSearch?: boolean;
    /** Time range filter: 'day', 'week', 'month', 'year' */
    freshness?: string;
}
/**
 * Individual search result item.
 */
export interface SearchResultItem {
    title: string;
    url: string;
    snippet?: string;
    /** Position in ranking (1-based) */
    position?: number;
    /** Publication date if available */
    date?: string;
    /** Provider-specific metadata */
    metadata?: Record<string, unknown>;
}
/**
 * Normalized search result envelope returned by SearchEngineClient.
 */
export interface SearchResult {
    success: boolean;
    /** Provider ID used */
    engine: string;
    /** Original query string */
    query: string;
    /** Parsed result items */
    results: SearchResultItem[];
    /** Total results count from the engine */
    totalResults?: number;
    /** Error message on failure */
    error?: string;
    /** Additional metadata */
    metadata?: Record<string, unknown>;
}
//# sourceMappingURL=types.d.ts.map