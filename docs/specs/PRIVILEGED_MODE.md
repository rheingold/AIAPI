# Privileged Mode & Security Bootstrap

## The Bootstrap Problem

**Scenario:** Security filters block operations, but you need those operations to configure the filters.

Example:
```
Filter: DENY * → KeyWin.exe::{CLICKID}/*
Problem: Can't click buttons in the dashboard to change this filter!
```

This creates a **lock-out situation** where the system is too secure to be configured.

---

## Solution: Privileged Administrative Mode

### Concept

A **privileged session** that bypasses normal security filters when:
1. Authenticated with private key
2. Operating from trusted context (localhost dashboard)
3. Performing administrative operations
4. Within time-limited window

---

## Implementation Options

### Option 1: Admin Session Token (RECOMMENDED)

**How it works:**
1. User clicks "🔐 Enter Admin Mode" in dashboard
2. Dashboard prompts for private key password
3. Server generates special admin token signed with private key
4. Token grants bypass privileges for X minutes
5. All operations during this session bypass filters
6. Admin mode expires automatically
7. All privileged operations logged to audit trail

**Advantages:**
- ✅ Secure (requires private key authentication)
- ✅ Time-limited (automatic expiry)
- ✅ Auditable (all actions logged)
- ✅ Doesn't weaken permanent security

**Token Structure:**
```json
{
  "type": "admin",
  "expiry": "2026-02-19T18:30:00Z",
  "privileges": ["BYPASS_FILTERS", "MODIFY_CONFIG"],
  "signature": "HMAC-SHA256(...)"
}
```

---

### Option 2: Filter Management Whitelist

**How it works:**
1. Specific API endpoints always bypass filters:
   - `/api/filters/list` - List current filters
   - `/api/filters/add` - Add new filter
   - `/api/filters/remove` - Remove filter
   - `/api/filters/update` - Update filter
2. These endpoints still require authentication
3. Only configuration operations bypass, not general automation

**Advantages:**
- ✅ Simple to implement
- ✅ Doesn't require special mode
- ✅ Least privilege (only config operations bypass)

**Disadvantages:**
- ⚠️ Doesn't help with dashboard UI automation
- ⚠️ Limited to filter management only

---

### Option 3: Localhost Exemption

**How it works:**
1. Operations from `localhost` or `127.0.0.1` always bypass filters
2. Assumes physical access = trusted user
3. Remote operations still subject to filters

**Advantages:**
- ✅ Very simple
- ✅ Doesn't break dashboard

**Disadvantages:**
- ❌ Security weakness (any local malware can bypass)
- ❌ Not suitable for production
- ❌ No audit trail

---

### Option 4: Emergency Override Flag

**How it works:**
1. Server startup flag: `--disable-security` or `--admin-mode`
2. Completely disables all security filters
3. Used for recovery when locked out
4. Must be set via command line (not API)

**Advantages:**
- ✅ Failsafe recovery mechanism
- ✅ Can't be triggered remotely

**Disadvantages:**
- ⚠️ Requires server restart
- ⚠️ All-or-nothing (disables everything)
- ⚠️ Must have console access

---

## Recommended Combined Approach

Use **multiple layers** for different scenarios:

### Layer 1: Admin Session Token (Primary)
For normal administrative work in the dashboard:

```typescript
// In dashboard.js
async function enterAdminMode() {
  const password = prompt('Enter private key password:');
  
  const response = await fetch('/api/auth/admin-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  
  const { token, expiry } = await response.json();
  
  // Store token for subsequent requests
  sessionStorage.setItem('admin_token', token);
  
  // Show admin mode indicator
  showAdminModeBar(expiry);
  
  addLog('warn', 'security', '⚠️ ADMIN MODE ACTIVE - All security filters bypassed!');
}
```

### Layer 2: Whitelisted Endpoints (Backup)
Always allow filter management APIs:

```typescript
// In httpServerWithDashboard.ts
private requiresAuth(pathname: string): boolean {
  // Admin endpoints always accessible (but require auth)
  const adminEndpoints = [
    '/api/filters/list',
    '/api/filters/add',
    '/api/filters/remove',
    '/api/filters/update'
  ];
  
  if (adminEndpoints.includes(pathname)) {
    return true; // Requires auth but bypasses filters
  }
  
  // ... rest of normal auth logic
}
```

### Layer 3: Emergency Override (Failsafe)
Command-line flag for recovery:

```bash
# Start server in emergency admin mode
node dist/start-mcp-server.js --emergency-admin-mode
```

```typescript
// In start-mcp-server.ts
const emergencyMode = process.argv.includes('--emergency-admin-mode');

if (emergencyMode) {
  console.warn('⚠️⚠️⚠️ EMERGENCY ADMIN MODE ACTIVE ⚠️⚠️⚠️');
  console.warn('ALL SECURITY FILTERS DISABLED');
  console.warn('USE ONLY FOR RECOVERY');
  process.env.BYPASS_ALL_FILTERS = 'true';
}
```

---

## Admin Mode UI

### Dashboard Indicator

When admin mode is active:

```html
<div class="admin-mode-banner" id="admin-mode-indicator" style="display: none;">
  ⚠️ ADMIN MODE ACTIVE
  <span id="admin-mode-timer">Expires in: 15:00</span>
  <button onclick="exitAdminMode()">Exit Admin Mode</button>
</div>
```

```css
.admin-mode-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  background: #ff6b35;
  color: white;
  padding: 0.75rem;
  text-align: center;
  font-weight: bold;
  z-index: 10000;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.8; }
}
```

### Settings Section

```html
<section id="section-security-admin">
  <h3>🔐 Administrative Access</h3>
  
  <div class="admin-mode-section">
    <button id="btn-enter-admin-mode" class="btn-danger">
      🔓 Enter Admin Mode
    </button>
    <p class="warning">
      Admin mode bypasses all security filters for 15 minutes.
      Use only when needed for configuration.
      All actions are logged.
    </p>
  </div>
  
  <div class="audit-log">
    <h4>Privileged Operations Audit Log</h4>
    <div id="admin-audit-log"></div>
  </div>
</section>
```

---

## Security Considerations

### Admin Token Generation

```typescript
async generateAdminToken(password: string): Promise<AdminToken> {
  // 1. Verify password unlocks private key
  const privateKey = await this.decryptPrivateKey(password);
  if (!privateKey) {
    throw new Error('Invalid password');
  }
  
  // 2. Generate time-limited token
  const expiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
  
  // 3. Sign with private key
  const payload = {
    type: 'admin',
    expiry: expiry.toISOString(),
    privileges: ['BYPASS_FILTERS', 'MODIFY_CONFIG'],
    issued: new Date().toISOString()
  };
  
  const signature = crypto
    .createHmac('sha256', privateKey)
    .update(JSON.stringify(payload))
    .digest('hex');
  
  return {
    ...payload,
    signature
  };
}
```

### Token Validation

```typescript
validateAdminToken(token: AdminToken): boolean {
  // 1. Check expiry
  if (new Date(token.expiry) < new Date()) {
    return false;
  }
  
  // 2. Verify signature
  const expectedSignature = crypto
    .createHmac('sha256', this.privateKey)
    .update(JSON.stringify({
      type: token.type,
      expiry: token.expiry,
      privileges: token.privileges,
      issued: token.issued
    }))
    .digest('hex');
  
  return token.signature === expectedSignature;
}
```

### Audit Logging

```typescript
logPrivilegedOperation(token: AdminToken, operation: string, details: any) {
  const auditEntry = {
    timestamp: new Date().toISOString(),
    tokenIssued: token.issued,
    tokenExpiry: token.expiry,
    operation,
    details,
    source: 'dashboard' // or 'api', 'mcp', etc.
  };
  
  // Write to secure audit log
  fs.appendFileSync(
    './security/admin-audit.log',
    JSON.stringify(auditEntry) + '\n',
    { mode: 0o600 } // Only owner can read
  );
  
  // Also broadcast to dashboard
  this.broadcastLog('warn', 'security', 
    `ADMIN: ${operation} - ${JSON.stringify(details)}`
  );
}
```

---

## Filter Evaluation with Admin Mode

```typescript
async checkSecurityFilter(
  processName: string,
  command: string,
  parameter: string,
  context: RequestContext
): Promise<'ALLOW' | 'DENY'> {
  
  // 1. Check for admin token
  if (context.adminToken) {
    const isValid = this.validateAdminToken(context.adminToken);
    if (isValid) {
      this.logPrivilegedOperation(
        context.adminToken,
        'BYPASS_FILTER',
        { processName, command, parameter }
      );
      return 'ALLOW'; // Admin mode bypasses all filters
    }
  }
  
  // 2. Check for whitelisted endpoints
  if (this.isWhitelistedOperation(context.endpoint)) {
    return 'ALLOW';
  }
  
  // 3. Check for emergency mode
  if (process.env.BYPASS_ALL_FILTERS === 'true') {
    console.warn('⚠️ Operation allowed due to EMERGENCY MODE');
    return 'ALLOW';
  }
  
  // 4. Normal filter evaluation
  return this.evaluateFilters(processName, command, parameter);
}
```

---

## User Workflow

### Scenario: Locked Out by Restrictive Filter

**Problem:** Filter `DENY * → KeyWin.exe::*/*` blocks everything

**Solution:**

1. **Open Dashboard** at http://localhost:3458
2. **Click "🔓 Enter Admin Mode"**
3. **Enter private key password**
4. **Dashboard shows red banner**: "⚠️ ADMIN MODE ACTIVE"
5. **Navigate to Security Filters**
6. **Click any buttons/controls** - they work despite filters
7. **Modify or remove problematic filter**
8. **Click "Exit Admin Mode"** or wait for auto-expiry
9. **Dashboard returns to normal mode**
10. **Test that new filters work correctly**

---

## Configuration

Add to `config.json`:

```json
{
  "security": {
    "adminMode": {
      "enabled": true,
      "tokenDuration": 900,  // 15 minutes in seconds
      "requirePrivateKey": true,
      "auditLog": "./security/admin-audit.log",
      "maxConcurrentSessions": 1
    },
    "whitelistedEndpoints": [
      "/api/filters/list",
      "/api/filters/add",
      "/api/filters/remove",
      "/api/filters/update"
    ],
    "emergencyMode": {
      "enabled": true,
      "requireCommandLine": true,
      "autoDisableAfter": 3600  // 1 hour
    }
  }
}
```

---

## Summary

| Mode | Use Case | Activation | Security | Scope |
|------|----------|------------|----------|-------|
| **Admin Token** | Configuration via dashboard | Private key password | High | All operations for 15 min |
| **Whitelisted APIs** | Filter management | Standard auth | Medium | Filter CRUD only |
| **Emergency Override** | System locked out | Command-line flag | Low | All operations until restart |

**Recommended for production:**
- ✅ Enable Admin Token mode
- ✅ Enable Whitelisted APIs
- ⚠️ Enable Emergency Override (with care)
- ✅ Always log privileged operations
- ✅ Auto-expire admin sessions
- ✅ Require strong password for private key

This ensures you can **always configure security** without creating permanent weaknesses!
