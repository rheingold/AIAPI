# Dashboard Security Features

## ✅ Security Layers Implemented

### 1. **Session-Based Authentication**
- `/api/login` endpoint with password authentication
- Session tokens (64-character hex) stored in memory
- Tokens expire after 1 hour of inactivity
- Bearer token or cookie-based authentication

### 2. **Endpoint Protection**
Protected endpoints (require valid session):
- `/api/status` - Server statistics
- `/api/config` (GET/PUT) - Configuration management
- `/api/restart` - Server restart
- `/api/tools` - MCP tool listing
- `/api/scenarios` - Scenario management
- `/api/scenarios/run` - Execute scenarios
- All automation endpoints

Public endpoints (no auth):
- `/dashboard` - Dashboard HTML
- `/dashboard.css` - Stylesheet
- `/dashboard.js` - Client code
- `/health` - Health check
- `/api/login` - Authentication

### 3. **Configuration Security**
- **Validation**: All config changes validated against schema
- **Production Protection**: Cannot weaken security in production
  - `requireTargetSignature` cannot be disabled if currently enabled
  - `requireOSEnforcement` cannot be disabled if currently enabled
- **Audit Logging**: All config changes logged with requester IP

### 4. **Session Management**
- **Automatic Cleanup**: Sessions older than 1 hour auto-removed
- **IP Tracking**: Each session tied to originating IP address
- **Access Logging**: All unauthorized attempts logged

### 5. **Development Bypass**
Environment variables for development:
- `SKIP_DASHBOARD_AUTH=true` - Bypass session authentication
- `DASHBOARD_PASSWORD` - Custom dashboard password (default: admin123)

## 🔐 Security Flow

```
1. Client → POST /api/login {"password": "admin123"}
2. Server validates password
3. Server creates session token
4. Client stores token in cookie/localStorage
5. Client → GET /api/config (Authorization: Bearer <token>)
6. Server validates session token
7. Server checks if endpoint requires auth
8. Server processes request if authorized
```

## 🚀 Usage

### Login to Dashboard
```bash
curl -X POST http://localhost:3458/api/login \
  -H "Content-Type: application/json" \
  -d '{"password":"admin123"}'
```

Response:
```json
{
  "success": true,
  "token": "a1b2c3...",
  "message": "Authentication successful"
}
```

### Access Protected Endpoint
```bash
curl http://localhost:3458/api/config \
  -H "Authorization: Bearer a1b2c3..."
```

### Update Configuration
```bash
curl -X PUT http://localhost:3458/api/config \
  -H "Authorization: Bearer a1b2c3..." \
  -H "Content-Type: application/json" \
  -d '{"requireTargetSignature":true,"requireOSEnforcement":false}'
```

## ⚠️ Production Deployment

1. **Change Default Password**:
   ```
   export DASHBOARD_PASSWORD="your-strong-password-here"
   ```

2. **Enable HTTPS**: Use a reverse proxy (nginx/Apache) with TLS

3. **Firewall**: Restrict dashboard port to localhost or trusted IPs

4. **Disable Bypasses**: Never set `SKIP_DASHBOARD_AUTH=true` in production

5. **Rotate Secrets**: Change passwords and session secrets regularly

## 📊 Security Logs

All security events are logged with level and source:
- `[auth]` - Authentication attempts, session creation
- `[config]` - Configuration changes
- `[security]` - Policy violations, bypass attempts

Example log output:
```
[21:45:00] WARN [auth] Failed login attempt from 127.0.0.1
[21:45:15] INFO [auth] New dashboard session created for 127.0.0.1
[21:46:00] INFO [config] Configuration updated successfully
[21:46:30] ERROR [config] Attempt to disable requireTargetSignature in production
```

## 🔗 Integration with MCP Server

The dashboard uses the same `SessionTokenManager` as the MCP server, ensuring consistent security across both:
- MCP Server (port 3457) - JSON-RPC automation API
- Dashboard (port 3458) - Web UI with authentication

Both share the same security policies from `security/config.json`.
