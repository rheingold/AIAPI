import * as https from 'https';
import * as http from 'http';
import * as tls from 'tls';
import { JSDOM } from 'jsdom';
import { globalLogger } from '../utils/Logger';

/**
 * TLS/SSL certificate information returned for HTTPS connections.
 * Present in the result even when the certificate is invalid so the AI
 * can inspect it and decide whether to retry with rejectUnauthorized: false.
 */
export interface SslCertInfo {
  /** Common Name from the certificate subject */
  subject: string;
  /** Common Name from the certificate issuer */
  issuer: string;
  validFrom: string;
  validTo: string;
  /** SHA-1 fingerprint as colon-separated hex pairs */
  fingerprint: string;
  /** true = Node.js TLS verification passed; false = self-signed / expired / hostname mismatch etc. */
  trusted: boolean;
  /** Raw TLS authorization error string when trusted is false, e.g. 'DEPTH_ZERO_SELF_SIGNED_CERT' */
  authError?: string;
}

/**
 * A single field extracted from a detected login form.
 */
export interface LoginFormField {
  name: string;
  type: string;
  /** Pre-filled value (never for password fields) */
  value?: string;
  required: boolean;
  /** Associated <label> text if found */
  label?: string;
}

/**
 * Describes a login/authentication form detected in the page.
 * The AI can use this to decide whether to submit credentials.
 */
export interface LoginFormInfo {
  /** Absolute URL where the form submits to */
  action: string;
  method: 'GET' | 'POST';
  fields: LoginFormField[];
  /**
   * Confidence that this is a real login form:
   *   'high'   – contains a <input type="password">
   *   'medium' – contains username/email + submit but no password
   *   'low'    – other heuristic match (form keywords in id/class/action)
   */
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Authentication options for web requests
 */
export type WebFetchAuth =
  | { type: 'basic'; username: string; password: string }
  | { type: 'bearer'; token: string };

/**
 * Web scraping options
 */
export interface WebFetchOptions {
  timeout?: number;
  userAgent?: string;
  headers?: Record<string, string>;
  maxContentLength?: number;
  extractText?: boolean;
  selector?: string;
  followRedirects?: boolean;
  maxRedirects?: number;
  /** Credentials to use when the server requires authentication */
  auth?: WebFetchAuth;
  /**
   * Whether to reject TLS certificates that cannot be verified (expired,
   * self-signed, hostname mismatch, etc.).  Defaults to true (strict).
   * Set to false to behave like `curl --insecure` — the AI should inspect
   * `sslCertificate.trusted` in the result before trusting the content.
   */
  rejectUnauthorized?: boolean;
}

/**
 * Web scraping result
 */
export interface WebFetchResult {
  success: boolean;
  /** The original URL that was requested */
  url: string;
  /** The final URL after following redirects */
  finalUrl?: string;
  statusCode?: number;
  headers?: Record<string, string>;
  content?: string;
  text?: string;
  elements?: Array<{
    tag: string;
    text: string;
    attributes: Record<string, string>;
  }>;
  error?: string;
  redirectChain?: string[];
  /** WWW-Authenticate challenge value when the server returned 401 */
  authChallenge?: string;
  /** TLS certificate info for HTTPS connections (present on success and on cert errors) */
  sslCertificate?: SslCertInfo;
  /**
   * Login/auth form detected in the page body.
   * The AI should inspect this and decide whether to submit credentials
   * or request the user to provide them.
   */
  loginForm?: LoginFormInfo;
}

/**
 * Security filter for web requests
 */
export interface WebSecurityFilter {
  allowedDomains?: string[];
  blockedDomains?: string[];
  allowedProtocols?: string[];
  maxContentLength?: number;
  allowedContentTypes?: string[];
  blockedKeywords?: string[];
  requireHttps?: boolean;
  rateLimiting?: {
    maxRequestsPerMinute: number;
    maxRequestsPerDomain: number;
    cooldownPeriodMs: number;
  };
  redirectValidation?: {
    maxRedirects: number;
    allowedRedirectDomains?: string[];
    blockCrossDomainRedirects?: boolean;
  };
  headerSecurity?: {
    blockedHeaders?: string[];
    requiredHeaders?: Record<string, string>;
    maxHeaderSize?: number;
  };
}

/**
 * Web scraping client with security filtering
 */
export class WebScrapingClient {
  private securityFilter: WebSecurityFilter;
  private requestTracker: Map<string, number[]> = new Map(); // domain -> timestamps
  private globalRequestTimes: number[] = []; // global request timestamps
  private defaultOptions: WebFetchOptions = {
    timeout: 30000,
    userAgent: 'AI-UI-Automation/1.0',
    maxContentLength: 1048576, // 1MB
    followRedirects: true,
    maxRedirects: 5
  };

  constructor(securityFilter: WebSecurityFilter = {}) {
    this.securityFilter = {
      allowedProtocols: ['http:', 'https:'],
      maxContentLength: 5242880, // 5MB
      allowedContentTypes: ['text/html', 'text/plain', 'application/json', 'text/xml'],
      requireHttps: false,
      rateLimiting: {
        maxRequestsPerMinute: 30,
        maxRequestsPerDomain: 10,
        cooldownPeriodMs: 1000, // 1 second between requests to same domain
      },
      redirectValidation: {
        maxRedirects: 5,
        blockCrossDomainRedirects: true,
      },
      headerSecurity: {
        blockedHeaders: ['authorization', 'cookie', 'x-auth-token'],
        maxHeaderSize: 8192, // 8KB
      },
      ...securityFilter
    };
  }

  /**
   * Validate headers for security
   */
  private validateHeaders(headers?: Record<string, string>): { valid: boolean; error?: string } {
    if (!headers || !this.securityFilter.headerSecurity) {
      return { valid: true };
    }

    const headerSecurity = this.securityFilter.headerSecurity;

    // Check for blocked headers
    if (headerSecurity.blockedHeaders) {
      for (const headerName of Object.keys(headers)) {
        if (headerSecurity.blockedHeaders.some(blocked => 
            headerName.toLowerCase() === blocked.toLowerCase())) {
          return { valid: false, error: `Header '${headerName}' is not allowed` };
        }
      }
    }

    // Check header size limits
    if (headerSecurity.maxHeaderSize) {
      const totalHeaderSize = Object.entries(headers)
        .reduce((size, [key, value]) => size + key.length + value.length, 0);
      
      if (totalHeaderSize > headerSecurity.maxHeaderSize) {
        return { valid: false, error: `Total header size exceeds maximum (${headerSecurity.maxHeaderSize} bytes)` };
      }
    }

    return { valid: true };
  }

  /**
   * Validate rate limiting rules
   */
  private validateRateLimit(domain: string): { valid: boolean; error?: string; waitTimeMs?: number } {
    if (!this.securityFilter.rateLimiting) {
      return { valid: true };
    }

    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const rateLimits = this.securityFilter.rateLimiting;

    // Clean up old request times
    this.globalRequestTimes = this.globalRequestTimes.filter(time => time > oneMinuteAgo);
    
    // Check global rate limit
    if (this.globalRequestTimes.length >= rateLimits.maxRequestsPerMinute) {
      const oldestRequest = Math.min(...this.globalRequestTimes);
      const waitTime = oldestRequest + 60000 - now;
      return { 
        valid: false, 
        error: `Global rate limit exceeded (${rateLimits.maxRequestsPerMinute}/min)`,
        waitTimeMs: waitTime 
      };
    }

    // Check domain-specific rate limit
    const domainRequests = this.requestTracker.get(domain) || [];
    const recentDomainRequests = domainRequests.filter(time => time > oneMinuteAgo);
    
    if (recentDomainRequests.length >= rateLimits.maxRequestsPerDomain) {
      const oldestDomainRequest = Math.min(...recentDomainRequests);
      const waitTime = oldestDomainRequest + 60000 - now;
      return { 
        valid: false, 
        error: `Domain rate limit exceeded (${rateLimits.maxRequestsPerDomain}/min for ${domain})`,
        waitTimeMs: waitTime 
      };
    }

    // Check cooldown period
    if (recentDomainRequests.length > 0) {
      const lastRequest = Math.max(...recentDomainRequests);
      const timeSinceLastRequest = now - lastRequest;
      if (timeSinceLastRequest < rateLimits.cooldownPeriodMs) {
        const waitTime = rateLimits.cooldownPeriodMs - timeSinceLastRequest;
        return { 
          valid: false, 
          error: `Cooldown period active for ${domain} (${waitTime}ms remaining)`,
          waitTimeMs: waitTime 
        };
      }
    }

    return { valid: true };
  }

  /**
   * Record a successful request for rate limiting
   */
  private recordRequest(domain: string): void {
    const now = Date.now();
    
    // Record global request
    this.globalRequestTimes.push(now);
    
    // Record domain-specific request
    const domainRequests = this.requestTracker.get(domain) || [];
    domainRequests.push(now);
    this.requestTracker.set(domain, domainRequests);
  }

  /**
   * Validate URL against security filters
   */
  private validateUrl(targetUrl: string): { valid: boolean; error?: string } {
    try {
      const parsedUrl = new URL(targetUrl);
      
      // Check protocol
      if (this.securityFilter.allowedProtocols && 
          !this.securityFilter.allowedProtocols.includes(parsedUrl.protocol)) {
        return { valid: false, error: `Protocol ${parsedUrl.protocol} not allowed` };
      }
      
      // Check HTTPS requirement
      if (this.securityFilter.requireHttps && parsedUrl.protocol !== 'https:') {
        return { valid: false, error: 'HTTPS required but URL uses HTTP' };
      }
      
      // Check domain whitelist
      if (this.securityFilter.allowedDomains && 
          !this.securityFilter.allowedDomains.some(domain => 
            parsedUrl.hostname.endsWith(domain))) {
        return { valid: false, error: `Domain ${parsedUrl.hostname} not in whitelist` };
      }
      
      // Check domain blacklist
      if (this.securityFilter.blockedDomains && 
          this.securityFilter.blockedDomains.some(domain => 
            parsedUrl.hostname.endsWith(domain))) {
        return { valid: false, error: `Domain ${parsedUrl.hostname} is blocked` };
      }
      
      return { valid: true };
    } catch (error) {
      return { valid: false, error: `Invalid URL: ${error}` };
    }
  }

  /**
   * Validate content against security filters
   */
  private validateContent(
    content: string, 
    contentType: string
  ): { valid: boolean; error?: string } {
    // Check content length
    if (content.length > (this.securityFilter.maxContentLength || 5242880)) {
      return { valid: false, error: 'Content length exceeds maximum allowed size' };
    }
    
    // Check content type
    if (this.securityFilter.allowedContentTypes && 
        !this.securityFilter.allowedContentTypes.some(type => 
          contentType.includes(type))) {
      return { valid: false, error: `Content type ${contentType} not allowed` };
    }
    
    // Check blocked keywords
    if (this.securityFilter.blockedKeywords) {
      const blockedKeyword = this.securityFilter.blockedKeywords.find(keyword => 
        content.toLowerCase().includes(keyword.toLowerCase()));
      if (blockedKeyword) {
        return { valid: false, error: `Content contains blocked keyword: ${blockedKeyword}` };
      }
    }
    
    return { valid: true };
  }

  /**
   * Fetch webpage content with security filtering
   */
  async fetchWebpage(
    targetUrl: string, 
    options: WebFetchOptions = {}
  ): Promise<WebFetchResult> {
    const opts = { ...this.defaultOptions, ...options };
    
    // Validate URL
    const urlValidation = this.validateUrl(targetUrl);
    if (!urlValidation.valid) {
      globalLogger.warn('WebSecurity', `Web fetch blocked: ${urlValidation.error}`);
      return {
        success: false,
        url: targetUrl,
        error: urlValidation.error
      };
    }
    
    // Check rate limiting
    const domain = new URL(targetUrl).hostname;
    const rateLimitValidation = this.validateRateLimit(domain);
    if (!rateLimitValidation.valid) {
      globalLogger.warn('WebSecurity', `Rate limit exceeded: ${rateLimitValidation.error}`);
      return {
        success: false,
        url: targetUrl,
        error: rateLimitValidation.error
      };
    }
    
    // Validate headers
    const headerValidation = this.validateHeaders(opts.headers);
    if (!headerValidation.valid) {
      globalLogger.warn('WebSecurity', `Header validation failed: ${headerValidation.error}`);
      return {
        success: false,
        url: targetUrl,
        error: headerValidation.error
      };
    }
    
    try {
      const result = await this.performRequest(targetUrl, opts);
      
      // Validate content
      if (result.content) {
        const contentType = result.headers?.['content-type'] || 'text/html';
        const contentValidation = this.validateContent(result.content, contentType);
        if (!contentValidation.valid) {
          globalLogger.warn('WebSecurity', `Web content blocked: ${contentValidation.error}`);
          return {
            success: false,
            url: targetUrl,
            error: contentValidation.error
          };
        }
      }
      
      // Process content based on options
      if (result.content) {
        result.text = this.extractTextContent(result.content, opts);
        if (opts.selector) {
          result.elements = this.extractElements(result.content, opts.selector);
        }

        // Detect login forms so the AI can decide how to proceed
        const finalUrl = result.finalUrl ?? result.url;
        const detected = this.detectLoginForm(result.content, finalUrl);
        if (detected) {
          result.loginForm = detected;
          globalLogger.info(
            'WebScraper',
            `Login form detected (confidence: ${detected.confidence}) on ${finalUrl}` +
            ` — action: ${detected.action}`
          );
        }
      }

      // Log SSL certificate status for HTTPS fetches
      if (result.sslCertificate) {
        const cert = result.sslCertificate;
        if (!cert.trusted) {
          globalLogger.warn(
            'WebScraper',
            `Untrusted certificate for ${targetUrl}: ${cert.authError ?? 'unknown'} ` +
            `(subject: ${cert.subject}, expires: ${cert.validTo})`
          );
        } else {
          globalLogger.debug(
            'WebScraper',
            `Certificate OK — subject: ${cert.subject}, ` +
            `issuer: ${cert.issuer}, expires: ${cert.validTo}`
          );
        }
      }

      globalLogger.info('WebScraper', `Web fetch successful: ${targetUrl}`);
      
      // Record successful request for rate limiting
      this.recordRequest(domain);
      
      return result;
    } catch (error) {
      globalLogger.error('WebScraper', `Web fetch error: ${error}`);
      return {
        success: false,
        url: targetUrl,
        error: String(error)
      };
    }
  }

  /**
   * Perform HTTP/HTTPS request, following redirects and handling 401 auth challenges.
   */
  private performRequest(
    targetUrl: string,
    options: WebFetchOptions
  ): Promise<WebFetchResult> {
    const maxRedirects = options.maxRedirects ?? this.defaultOptions.maxRedirects ?? 5;
    return this.execRequest(targetUrl, options, maxRedirects, false, []);
  }

  /**
   * Internal recursive helper that handles one hop (redirect or auth retry).
   *
   * @param targetUrl        URL to fetch on this hop
   * @param options          Caller options (immutable across hops)
   * @param remainingRedirects  How many more 3xx hops are allowed
   * @param authRetried      Whether we have already retried after a 401
   * @param redirectChain    URLs visited so far (not including targetUrl)
   */
  private execRequest(
    targetUrl: string,
    options: WebFetchOptions,
    remainingRedirects: number,
    authRetried: boolean,
    redirectChain: string[]
  ): Promise<WebFetchResult> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(targetUrl);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      // Build Authorization header from the structured auth option.
      // This is intentionally separate from options.headers so it bypasses
      // the user-header security check (which blocks 'authorization' keys).
      const authHeader: Record<string, string> = {};
      if (options.auth) {
        if (options.auth.type === 'basic') {
          const creds = Buffer.from(
            `${options.auth.username}:${options.auth.password}`
          ).toString('base64');
          authHeader['Authorization'] = `Basic ${creds}`;
        } else if (options.auth.type === 'bearer') {
          authHeader['Authorization'] = `Bearer ${options.auth.token}`;
        }
      }

      const rejectUnauthorized = options.rejectUnauthorized ?? true;

      const requestOptions: https.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': options.userAgent || this.defaultOptions.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          ...authHeader,
          ...options.headers   // explicit caller headers take final precedence
        },
        timeout: options.timeout || this.defaultOptions.timeout,
        // TLS options (only meaningful for HTTPS; ignored by http.request)
        rejectUnauthorized,
      };

      const req = client.request(requestOptions, (res) => {
        const statusCode = res.statusCode ?? 0;

        // ── Capture TLS certificate (HTTPS only) ────────────────────────
        let sslCert: SslCertInfo | undefined;
        if (isHttps) {
          try {
            const sock = res.socket as tls.TLSSocket;
            if (typeof sock.getPeerCertificate === 'function') {
              const cert = sock.getPeerCertificate(false);
              if (cert && (cert.subject || cert.fingerprint)) {
                const authErr = sock.authorizationError;
                sslCert = {
                  subject: (cert.subject as unknown as Record<string,string>)?.CN
                    ?? JSON.stringify(cert.subject ?? {}),
                  issuer: (cert.issuer as unknown as Record<string,string>)?.CN
                    ?? JSON.stringify(cert.issuer ?? {}),
                  validFrom: cert.valid_from ?? '',
                  validTo: cert.valid_to ?? '',
                  fingerprint: cert.fingerprint ?? '',
                  trusted: !authErr,
                  authError: authErr ? String(authErr) : undefined,
                };
              }
            }
          } catch {
            // non-fatal — proceed without cert info
          }
        }

        // ── Redirect handling (3xx) ──────────────────────────────────────
        const REDIRECT_CODES = [301, 302, 303, 307, 308];
        if (REDIRECT_CODES.includes(statusCode) && options.followRedirects !== false) {
          const location = res.headers['location'];

          // Must drain body to reuse the socket
          res.resume();

          if (!location) {
            resolve({
              success: false,
              url: targetUrl,
              statusCode,
              headers: res.headers as Record<string, string>,
              error: `Redirect (${statusCode}) with no Location header`,
              redirectChain
            });
            return;
          }

          if (remainingRedirects <= 0) {
            resolve({
              success: false,
              url: targetUrl,
              statusCode,
              error: 'Max redirects exceeded',
              redirectChain
            });
            return;
          }

          // Resolve relative Location URLs against the current URL
          let redirectUrl: string;
          try {
            redirectUrl = new URL(location, targetUrl).href;
          } catch {
            resolve({
              success: false,
              url: targetUrl,
              statusCode,
              error: `Invalid Location header: ${location}`,
              redirectChain
            });
            return;
          }

          // Cross-domain redirect security check
          const origHost = parsedUrl.hostname;
          const redirHost = new URL(redirectUrl).hostname;
          const redirValidation = this.securityFilter.redirectValidation;
          if (
            redirValidation?.blockCrossDomainRedirects &&
            origHost !== redirHost &&
            !redirValidation.allowedRedirectDomains?.some(d => redirHost.endsWith(d))
          ) {
            resolve({
              success: false,
              url: targetUrl,
              statusCode,
              error: `Cross-domain redirect blocked: ${origHost} → ${redirHost}`,
              redirectChain: [...redirectChain, redirectUrl]
            });
            return;
          }

          // Validate the redirect URL against security rules
          const urlValidation = this.validateUrl(redirectUrl);
          if (!urlValidation.valid) {
            resolve({
              success: false,
              url: targetUrl,
              statusCode,
              error: `Redirect URL blocked: ${urlValidation.error}`,
              redirectChain: [...redirectChain, redirectUrl]
            });
            return;
          }

          globalLogger.debug(
            'WebScraper',
            `Redirect ${statusCode}: ${targetUrl} → ${redirectUrl}` +
            ` (${remainingRedirects - 1} hops remaining)`
          );

          this.execRequest(
            redirectUrl,
            options,
            remainingRedirects - 1,
            authRetried,
            [...redirectChain, targetUrl]
          ).then(result => {
            // Ensure the original requested URL is preserved in the result
            resolve({
              ...result,
              url: result.url,
              finalUrl: result.finalUrl ?? result.url,
              // surface the cert of the redirect hop that we just completed
              sslCertificate: result.sslCertificate ?? sslCert,
            });
          }).catch(reject);
          return;
        }

        // ── 401 Unauthorized ────────────────────────────────────────────
        if (statusCode === 401) {
          const wwwAuth = (res.headers['www-authenticate'] as string) ?? '';

          // If we have basic credentials and have not retried yet, retry once.
          // (The first request is sent without auth so we discover the realm;
          //  if you prefer pre-emptive auth just add the header upfront.)
          if (!authRetried && options.auth?.type === 'basic' &&
              /^basic/i.test(wwwAuth)) {
            res.resume();
            globalLogger.debug('WebScraper', `401 Basic challenge received – retrying with credentials (${targetUrl})`);
            this.execRequest(targetUrl, options, remainingRedirects, true, redirectChain)
              .then(resolve).catch(reject);
            return;
          }

          // Otherwise fall through to read the response body and surface the challenge.
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk; });
          res.on('end', () => {
            resolve({
              success: false,
              url: targetUrl,
              finalUrl: targetUrl,
              statusCode,
              headers: res.headers as Record<string, string>,
              content: data || undefined,
              error: `HTTP 401 Unauthorized${wwwAuth ? ` (${wwwAuth})` : ''}`,
              authChallenge: wwwAuth || undefined,
              sslCertificate: sslCert,
              redirectChain: redirectChain.length ? redirectChain : undefined
            });
          });
          return;
        }

        // ── Normal response ──────────────────────────────────────────────
        let data = '';
        let contentLength = 0;
        const maxLength = options.maxContentLength || this.defaultOptions.maxContentLength;

        res.on('data', (chunk: Buffer) => {
          contentLength += chunk.length;
          if (maxLength && contentLength > maxLength) {
            req.destroy();
            reject(new Error(`Content length ${contentLength} exceeds maximum ${maxLength}`));
            return;
          }
          data += chunk;
        });

        res.on('end', () => {
          const finalUrl = redirectChain.length ? targetUrl : undefined;
          resolve({
            success: statusCode >= 200 && statusCode < 300,
            url: redirectChain.length ? redirectChain[0] : targetUrl,
            finalUrl,
            statusCode,
            headers: res.headers as Record<string, string>,
            content: data,
            redirectChain: redirectChain.length ? redirectChain : undefined,
            sslCertificate: sslCert,
          });
        });
      });

      req.on('error', (error: NodeJS.ErrnoException) => {
        // Surface TLS errors with a helpful hint so the AI can decide
        // whether to retry with rejectUnauthorized: false
        const isTlsError = [
          'DEPTH_ZERO_SELF_SIGNED_CERT',
          'SELF_SIGNED_CERT_IN_CHAIN',
          'CERT_HAS_EXPIRED',
          'ERR_TLS_CERT_ALTNAME_INVALID',
          'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
          'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
        ].includes(error.code ?? '');

        if (isTlsError) {
          reject(Object.assign(
            new Error(`TLS certificate error [${error.code}]: ${error.message}` +
              ' — retry with rejectUnauthorized: false to inspect the certificate'),
            { code: error.code, tlsError: true }
          ));
        } else {
          reject(error);
        }
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.end();
    });
  }

  /**
   * Detect a login / authentication form in an HTML page.
   *
   * Strategy (in decreasing confidence):
   *   high   – any <form> that contains <input type="password">
   *   medium – any <form> with a field whose name/id/autocomplete suggests
   *            a username or email AND a submit button
   *   low    – any <form> where the form's id, class, or action URL contain
   *            keywords like "login", "signin", "auth", "logon"
   *
   * Returns the highest-confidence form found, or undefined if none.
   */
  private detectLoginForm(html: string, baseUrl: string): LoginFormInfo | undefined {
    let dom: JSDOM;
    try {
      dom = new JSDOM(html);
    } catch {
      return undefined;
    }

    const doc = dom.window.document;
    const forms = Array.from(doc.querySelectorAll('form'));
    if (forms.length === 0) { return undefined; }

    // Build a label map: input id → label text
    const labelMap = new Map<string, string>();
    for (const lbl of Array.from(doc.querySelectorAll('label'))) {
      const forAttr = lbl.getAttribute('for');
      if (forAttr) { labelMap.set(forAttr, lbl.textContent?.trim() ?? ''); }
    }

    const extractFields = (form: Element): LoginFormField[] => {
      const fieldEls = Array.from(
        form.querySelectorAll('input, select, textarea')
      );
      return fieldEls
        .filter(el => (el as HTMLInputElement).type !== 'hidden' ||
                       (el as HTMLInputElement).name !== '')
        .map(el => {
          const inp = el as HTMLInputElement;
          const type  = inp.type?.toLowerCase() || el.tagName.toLowerCase();
          const name  = inp.name || inp.id || '';
          return {
            name,
            type,
            // never expose pre-filled password values
            value: type === 'password' ? undefined : (inp.value || undefined),
            required: inp.required,
            label: labelMap.get(inp.id) ||
                   inp.getAttribute('aria-label') ||
                   inp.getAttribute('placeholder') ||
                   undefined,
          } as LoginFormField;
        });
    };

    const resolveAction = (form: Element): string => {
      const raw = form.getAttribute('action') || '';
      try { return new URL(raw, baseUrl).href; } catch { return baseUrl; }
    };

    const formMethod = (form: Element): 'GET' | 'POST' =>
      (form.getAttribute('method') || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET';

    const USER_NAMES = /^(user(name)?|login|email|mail|account|id|name)$/i;
    const FORM_KEYWORDS = /login|signin|sign-in|logon|log-in|auth/i;

    // Pass 1 – high confidence: password field present
    for (const form of forms) {
      if (form.querySelector('input[type="password"]')) {
        return {
          action: resolveAction(form),
          method: formMethod(form),
          fields: extractFields(form),
          confidence: 'high',
        };
      }
    }

    // Pass 2 – medium confidence: username/email field + submit
    for (const form of forms) {
      const hasUser = Array.from(form.querySelectorAll('input')).some(inp => {
        const n = (inp as HTMLInputElement);
        return USER_NAMES.test(n.name || n.id || '') ||
               n.getAttribute('autocomplete')?.startsWith('username') ||
               n.getAttribute('autocomplete') === 'email';
      });
      const hasSubmit = !!form.querySelector(
        'input[type="submit"], button[type="submit"], button:not([type])');
      if (hasUser && hasSubmit) {
        return {
          action: resolveAction(form),
          method: formMethod(form),
          fields: extractFields(form),
          confidence: 'medium',
        };
      }
    }

    // Pass 3 – low confidence: form attributes/action contain auth keywords
    for (const form of forms) {
      const hint = [
        form.id,
        form.className,
        form.getAttribute('action') || '',
        form.getAttribute('name') || '',
      ].join(' ');
      if (FORM_KEYWORDS.test(hint)) {
        return {
          action: resolveAction(form),
          method: formMethod(form),
          fields: extractFields(form),
          confidence: 'low',
        };
      }
    }

    return undefined;
  }

  /**
   * Extract text content from HTML
   */
  private extractTextContent(html: string, options: WebFetchOptions): string {
    if (!options.extractText) {
      return '';
    }
    
    try {
      const dom = new JSDOM(html);
      return dom.window.document.body?.textContent || '';
    } catch (error) {
      return html; // Fallback to raw content
    }
  }

  /**
   * Extract specific elements using CSS selector
   */
  private extractElements(html: string, selector: string): Array<{
    tag: string;
    text: string;
    attributes: Record<string, string>;
  }> {
    try {
      const dom = new JSDOM(html);
      const elements = dom.window.document.querySelectorAll(selector);
      
      return Array.from(elements).map(element => ({
        tag: element.tagName.toLowerCase(),
        text: element.textContent || '',
        attributes: Object.fromEntries(
          Array.from(element.attributes).map(attr => [attr.name, attr.value])
        )
      }));
    } catch (error) {
      return [];
    }
  }

  /**
   * Update security filter configuration
   */
  setSecurityFilter(filter: WebSecurityFilter): void {
    this.securityFilter = { ...this.securityFilter, ...filter };
  }

  /**
   * Get current security filter configuration
   */
  getSecurityFilter(): WebSecurityFilter {
    return { ...this.securityFilter };
  }
}