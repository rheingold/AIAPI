// Dashboard State
const state = {
  ws: null,
  logs: [],
  autoScroll: true,
  logLevel: 'all',
  logSource: 'all',
  searchTerm: '',
  selectedScenario: null,
  serverStartTime: Date.now(),
  rawMode: false,
  expandAll: false,
  adminMode: {
    active: false,
    token: null,
    expiry: null,
    timer: null
  }
};

// Initialize Dashboard
document.addEventListener('DOMContentLoaded', () => {
  initializeNavigation();
  initializeWebSocket();
  initializeLogControls();
  initializeActions();
  initializeSettings();
  initializeHelpers();
  loadTools();
  loadScenarios();
  loadAppTemplates();
  loadSettings();
  startUptimeCounter();
  startStatusPoller();
});

// Navigation
function initializeNavigation() {
  const navButtons = document.querySelectorAll('.nav-btn');
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.dataset.section;
      
      // Update active nav button
      navButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Show corresponding section
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      document.getElementById(`section-${section}`).classList.add('active');

      // Auto-validate config whenever Settings section is opened
      if (section === 'settings') {
        validateConfiguration();
      }
      // Refresh app templates list when that section is opened
      if (section === 'templates') {
        loadAppTemplates();
      }
    });
  });
}

// WebSocket Connection
function initializeWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.hostname}:${window.location.port || 3457}/ws`;
  
  state.ws = new WebSocket(wsUrl);
  
  state.ws.onopen = () => {
    addLog('info', 'system', 'WebSocket connected to server');
    updateServerStatus('running');
  };
  
  state.ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleWebSocketMessage(data);
  };
  
  state.ws.onerror = (error) => {
    addLog('error', 'system', `WebSocket error: ${error.message || 'Connection failed'}`);
    updateServerStatus('error');
  };
  
  state.ws.onclose = () => {
    addLog('warn', 'system', 'WebSocket disconnected. Attempting to reconnect...');
    updateServerStatus('stopped');
    setTimeout(initializeWebSocket, 5000);
  };
}

function handleWebSocketMessage(data) {
  switch (data.type) {
    case 'log':
      addLog(data.level, data.source, data.message, data.timestamp);
      break;
    case 'status':
      updateStats(data.stats);
      break;
    case 'scenario-result':
      handleScenarioResult(data.result);
      break;
  }
}

// Log Management
function initializeLogControls() {
  const autoScrollCheckbox = document.getElementById('auto-scroll');
  const jsonLoggingCheckbox = document.getElementById('json-logging');
  const rawModeCheckbox = document.getElementById('raw-mode');
  const logLevelSelect = document.getElementById('log-level');
  const searchInput = document.getElementById('log-search');
  
  autoScrollCheckbox.addEventListener('change', (e) => {
    state.autoScroll = e.target.checked;
  });
  
  rawModeCheckbox.addEventListener('change', (e) => {
    state.rawMode = e.target.checked;
    filterLogs();
  });

  const expandAllCheckbox = document.getElementById('expand-all');
  if (expandAllCheckbox) {
    expandAllCheckbox.addEventListener('change', (e) => {
      state.expandAll = e.target.checked;
      filterLogs();
    });
  }

  const logSourceSelect = document.getElementById('log-source');
  if (logSourceSelect) {
    logSourceSelect.addEventListener('change', (e) => {
      state.logSource = e.target.value;
      filterLogs();
    });
  }

  jsonLoggingCheckbox.addEventListener('change', (e) => {
    const enabled = e.target.checked;
    // Send to server via WebSocket
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({
        type: 'config',
        setting: 'jsonLogging',
        value: enabled
      }));
      addLog('info', 'system', `JSON logging ${enabled ? 'enabled' : 'disabled'}`);
    }
  });
  
  logLevelSelect.addEventListener('change', (e) => {
    state.logLevel = e.target.value;
    filterLogs();
  });
  
  searchInput.addEventListener('input', (e) => {
    state.searchTerm = e.target.value.toLowerCase();
    filterLogs();
  });
}

function addLog(level, source, message, timestamp) {
  const logEntry = {
    level,
    source,
    message,
    timestamp: timestamp || new Date().toLocaleTimeString(),
  };
  
  state.logs.push(logEntry);
  
  // Keep only last 1000 logs
  if (state.logs.length > 1000) {
    state.logs.shift();
  }
  
  // Check if log should be displayed
  if (shouldDisplayLog(logEntry)) {
    appendLogToDOM(logEntry);
  }
}

// Alias for compatibility
function addLogEntry(level, source, message, timestamp) {
  addLog(level, source, message, timestamp);
}

function shouldDisplayLog(log) {
  // Level filter
  if (state.logLevel !== 'all' && log.level !== state.logLevel) {
    return false;
  }

  // Source filter
  if (state.logSource !== 'all') {
    const src = (log.source || '').toLowerCase();
    const sel = state.logSource.toLowerCase();
    if (sel === 'keywin') {
      if (src !== 'keywin' && src !== 'scenarioreplayer') return false;
    } else if (sel === 'system') {
      if (!['system', 'websocket', 'settings', 'dashboard', 'tools', 'scenarios'].includes(src)) return false;
    } else {
      if (src !== sel) return false;
    }
  }
  
  // Search filter
  if (state.searchTerm && !log.message.toLowerCase().includes(state.searchTerm) &&
      !log.source.toLowerCase().includes(state.searchTerm)) {
    return false;
  }
  
  return true;
}

const LOG_COLLAPSE_LINES = 30;

function buildMessageHtml(message) {
  const lines = message.split('\n');
  if (lines.length <= LOG_COLLAPSE_LINES || state.expandAll || state.rawMode) {
    return `<span class="message">${escapeHtml(message)}</span>`;
  }
  const preview = escapeHtml(lines.slice(0, LOG_COLLAPSE_LINES).join('\n'));
  const full    = escapeHtml(message);
  const extra   = lines.length - LOG_COLLAPSE_LINES;
  return `<span class="message-wrap">
    <span class="msg-short">${preview}</span>
    <button class="log-expand-btn" onclick="(function(btn){
      btn.previousElementSibling.style.display='none';
      btn.nextElementSibling.style.display='';
      btn.style.display='none';
    })(this)">▶ ${extra} more lines — click to expand</button>
    <span class="msg-full" style="display:none">${full}</span>
  </span>`;
}

function appendLogToDOM(log) {
  const logContainer = document.getElementById('log-output');
  const logEntry = document.createElement('div');
  const srcClass = (log.source || '').toLowerCase().replace(/[^a-z0-9]/g, '-');
  logEntry.className = `log-entry ${log.level} src-${srcClass}`;
  
  if (state.rawMode) {
    // Raw mode: full text, never truncated
    const rawText = `[${log.timestamp}] ${log.level.toUpperCase()} [${log.source}] ${log.message}`;
    logEntry.innerHTML = `<span class="message">${escapeHtml(rawText)}</span>`;
  } else {
    logEntry.innerHTML = `
      <span class="timestamp">${log.timestamp}</span>
      <span class="level">${log.level.toUpperCase()}</span>
      <span class="source src-${srcClass}">${log.source}</span>
      ${buildMessageHtml(log.message)}
    `;
  }
  
  logContainer.appendChild(logEntry);
  
  if (state.autoScroll) {
    logContainer.scrollTop = logContainer.scrollHeight;
  }
}

function filterLogs() {
  const logContainer = document.getElementById('log-output');
  logContainer.innerHTML = '';
  
  state.logs.filter(shouldDisplayLog).forEach(log => {
    appendLogToDOM(log);
  });
}

// Actions
function initializeActions() {
  document.getElementById('btn-admin-mode').addEventListener('click', toggleAdminMode);
  document.getElementById('btn-exit-admin').addEventListener('click', exitAdminMode);
  document.getElementById('btn-restart').addEventListener('click', restartServer);
  document.getElementById('btn-clear-logs').addEventListener('click', clearLogs);
  document.getElementById('btn-export-logs').addEventListener('click', exportLogs);
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
  document.getElementById('btn-run-scenario').addEventListener('click', runSelectedScenario);
}

async function restartServer() {
  if (!confirm('Restart the server? Active connections will be closed.')) return;
  
  try {
    const response = await fetch('/api/restart', { method: 'POST' });
    if (response.ok) {
      addLog('info', 'system', 'Server restart initiated');
    }
  } catch (error) {
    addLog('error', 'system', `Failed to restart server: ${error.message}`);
  }
}

function clearLogs() {
  state.logs = [];
  document.getElementById('log-output').innerHTML = '';
  addLog('info', 'system', 'Logs cleared');
}

function exportLogs() {
  const content = state.logs.map(log => 
    `[${log.timestamp}] ${log.level.toUpperCase()} [${log.source}] ${log.message}`
  ).join('\n');
  
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `aiapi-logs-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  
  addLog('info', 'system', 'Logs exported');
}

// Settings - moved to line ~500 for comprehensive version

async function saveSettings() {
  const config = {
    requireBinarySignature: document.getElementById('setting-require-signature').checked,
    requireOSEnforcement: document.getElementById('setting-require-os-enforcement').checked,
    allowUnsignedScenarios: document.getElementById('setting-allow-unsigned-scenarios').checked,
    enableSessionAuth: document.getElementById('setting-enable-session-auth').checked,
    sessionTokenExpiry: parseInt(document.getElementById('setting-token-expiry').value),
  };
  
  try {
    const response = await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    
    if (response.ok) {
      addLog('info', 'settings', 'Settings saved successfully');
      alert('Settings saved! Server will apply changes on next restart.');
    } else {
      throw new Error('Failed to save settings');
    }
  } catch (error) {
    addLog('error', 'settings', `Failed to save settings: ${error.message}`);
    alert('Failed to save settings. See logs for details.');
  }
}

// Tools
async function loadTools() {
  try {
    const response = await fetch('/api/tools');
    const data = await response.json();
    
    const toolsList = document.getElementById('tools-list');
    toolsList.innerHTML = '';
    
    data.tools.forEach(tool => {
      const toolCard = document.createElement('div');
      toolCard.className = 'tool-card';
      toolCard.innerHTML = `
        <h3>${tool.name}</h3>
        <p class="description">${tool.description}</p>
      `;
      toolsList.appendChild(toolCard);
    });
    
    addLog('debug', 'tools', `Loaded ${data.tools.length} MCP tools`);
  } catch (error) {
    addLog('error', 'tools', `Failed to load tools: ${error.message}`);
  }
}

// Scenarios
// App Templates
async function loadAppTemplates() {
  const container = document.getElementById('templates-list');
  if (!container) return;
  container.innerHTML = '<div class="loading">Loading app templates...</div>';
  try {
    const response = await fetch('/api/appTemplates');
    const data = await response.json();
    container.innerHTML = '';
    if (!data.apps || data.apps.length === 0) {
      container.innerHTML = '<p style="color:var(--text-secondary)">No app templates found in apptemplates/ directory.</p>';
      return;
    }
    data.apps.forEach(app => {
      const card = document.createElement('div');
      card.className = 'tool-card';
      card.innerHTML = `
        <div class="tool-name">${app.name}</div>
        <div class="tool-description">
          ${app.hasTree ? '✅ tree.xml' : '❌ tree.xml'}
          &nbsp;&nbsp;
          ${app.hasScenarios ? '✅ scenarios.xml' : '❌ scenarios.xml'}
          ${app.scenarioCount != null ? ` (${app.scenarioCount} scenarios)` : ''}
        </div>
        <div style="margin-top:0.5rem;">
          <a href="/api/appTemplates/${app.name}/tree" target="_blank" class="btn-secondary" style="font-size:0.75rem;padding:0.2rem 0.5rem;">View tree.xml</a>
          <a href="/api/appTemplates/${app.name}/scenarios" target="_blank" class="btn-secondary" style="font-size:0.75rem;padding:0.2rem 0.5rem;margin-left:0.4rem;">View scenarios.xml</a>
        </div>`;
      container.appendChild(card);
    });
    addLog('debug', 'templates', `Loaded ${data.apps.length} app template(s)`);
  } catch (error) {
    container.innerHTML = `<p style="color:var(--error)">Failed to load app templates: ${error.message}</p>`;
    addLog('error', 'templates', `Failed to load app templates: ${error.message}`);
  }
}

async function loadScenarios() {
  try {
    const response = await fetch('/api/scenarios');
    const data = await response.json();
    
    const scenariosList = document.getElementById('scenarios-list');
    scenariosList.innerHTML = '';
    
    data.scenarios.forEach(scenario => {
      const scenarioItem = document.createElement('div');
      scenarioItem.className = 'scenario-item';
      scenarioItem.innerHTML = `
        <div>
          <div class="name">${scenario.name}</div>
          <div class="path">${scenario.path}</div>
        </div>
      `;
      
      scenarioItem.addEventListener('click', () => {
        document.querySelectorAll('.scenario-item').forEach(s => s.classList.remove('selected'));
        scenarioItem.classList.add('selected');
        state.selectedScenario = scenario.path;
      });
      
      scenariosList.appendChild(scenarioItem);
    });
    
    addLog('debug', 'scenarios', `Loaded ${data.scenarios.length} scenarios`);
  } catch (error) {
    addLog('error', 'scenarios', `Failed to load scenarios: ${error.message}`);
  }
}

async function runSelectedScenario() {
  if (!state.selectedScenario) {
    alert('Please select a scenario first');
    return;
  }
  
  addLog('info', 'scenarios', `Running scenario: ${state.selectedScenario}`);
  
  try {
    const response = await fetch('/api/scenarios/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioPath: state.selectedScenario }),
    });
    
    const result = await response.json();
    handleScenarioResult(result);
  } catch (error) {
    addLog('error', 'scenarios', `Failed to run scenario: ${error.message}`);
  }
}

function handleScenarioResult(result) {
  if (result.success) {
    addLog('info', 'scenarios', `Scenario completed: ${result.steps} steps executed in ${result.duration}ms`);
  } else {
    addLog('error', 'scenarios', `Scenario failed: ${result.error}`);
  }
}

// Status Updates
function updateServerStatus(status) {
  const statusElement = document.getElementById('server-status');
  statusElement.textContent = status.charAt(0).toUpperCase() + status.slice(1);
  statusElement.className = `value status-${status}`;
}

function updateStats(stats) {
  if (stats.requestCount !== undefined) {
    document.getElementById('request-count').textContent = stats.requestCount;
  }
  if (stats.security) {
    const sec = stats.security;
    const secEl = document.getElementById('security-status');
    if (sec.enabled) {
      secEl.textContent = sec.filterCount > 0 ? `✅ Active (${sec.filterCount} filters)` : '⚠️ On (no filters)';
      secEl.className = `value status-indicator ${sec.filterCount > 0 ? 'indicator-ok' : 'indicator-warn'}`;
    } else {
      secEl.textContent = '❌ Disabled';
      secEl.className = 'value status-indicator indicator-error';
    }
    const keysEl = document.getElementById('keys-status');
    if (sec.keysPresent) {
      keysEl.textContent = '✅ OK';
      keysEl.className = 'value status-indicator indicator-ok';
    } else {
      keysEl.textContent = '⚠️ Missing';
      keysEl.className = 'value status-indicator indicator-warn';
      keysEl.title = 'One or more key files are missing. Check Settings.';
    }
  }
  if (stats.helpers) {
    const helpersEl = document.getElementById('helpers-status');
    const count = stats.helpers.count;
    helpersEl.textContent = count > 0 ? `${count} loaded` : '0';
    helpersEl.className = `value status-indicator ${count > 0 ? 'indicator-ok' : 'indicator-warn'}`;
  }
}

function startUptimeCounter() {
  setInterval(() => {
    const uptime = Date.now() - state.serverStartTime;
    const seconds = Math.floor(uptime / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    const display = `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    document.getElementById('uptime').textContent = display;
  }, 1000);
}

async function startStatusPoller() {
  async function poll() {
    try {
      const response = await fetch('/api/status');
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          updateStats(result.data);
          if (result.data.requestCount !== undefined) {
            document.getElementById('request-count').textContent = result.data.requestCount;
          }
        }
      }
    } catch (e) {
      // Server may be restarting — ignore silently
    }
  }
  await poll();                         // immediate first poll
  setInterval(poll, 30000);             // then every 30 s
}

// Utilities
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
// Settings Management
function initializeSettings() {
  // Change directory button
  document.getElementById('btn-change-dir')?.addEventListener('click', async () => {
    const currentDir = document.getElementById('current-working-dir')?.textContent || '.';
    const newDir = prompt('Enter new working directory (absolute or relative):', currentDir);
    
    if (newDir && newDir !== currentDir) {
      try {
        const response = await fetch('/api/workdir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: newDir })
        });
        
        const result = await response.json();
        
        if (result.success) {
          document.getElementById('current-working-dir').textContent = result.path;
          addLogEntry('info', 'settings', `Working directory changed to: ${result.path}`);
          // Reload settings to update relative paths
          loadSettings();
        } else {
          alert(`Failed to change directory: ${result.error}`);
        }
      } catch (error) {
        alert(`Error changing directory: ${error.message}`);
      }
    }
  });
  
  // Browse buttons
  document.querySelectorAll('.btn-browse').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      // In a real implementation, this would open a file dialog
      // For now, just allow manual input
      const path = prompt('Enter path:', input.value);
      if (path) input.value = path;
    });
  });
  
  // Advanced filter buttons
  document.getElementById('btn-add-filter')?.addEventListener('click', () => {
    openFilterEditor();
  });
  
  document.getElementById('btn-import-tree')?.addEventListener('click', () => {
    addLogEntry('info', 'settings', 'Import from Live UI: Feature coming soon');
    alert('Import UI Tree\n\n' +
          'Coming soon:\n' +
          '- Connect to running application\n' +
          '- Query UI element tree structure\n' +
          '- Select elements to allow/deny\n' +
          '- Auto-generate filter rules\n' +
          '- Preview before applying');
  });
  
  document.getElementById('btn-validate-filters')?.addEventListener('click', () => {
    addLogEntry('info', 'settings', 'Validate Filters: Feature coming soon');
    alert('Filter Validation\n\n' +
          'Coming soon:\n' +
          '- Check filter syntax\n' +
          '- Verify helper commands exist\n' +
          '- Test pattern matching\n' +
          '- Detect conflicts\n' +
          '- Show coverage report');
  });

  // Save settings button
  document.getElementById('btn-save-settings')?.addEventListener('click', saveSettings);
  
  // Reload settings button
  document.getElementById('btn-reload-settings')?.addEventListener('click', loadSettings);
  
  // Validate config button
  document.getElementById('btn-validate-config')?.addEventListener('click', validateConfiguration);
  
  // Generate token button
  document.getElementById('btn-generate-token')?.addEventListener('click', generateNewToken);
}

async function loadSettings() {
  try {
    const response = await fetch('/api/settings');
    const settings = await response.json();
    
    // Show current working directory
    if (settings.currentWorkingDir) {
      document.getElementById('current-working-dir').textContent = settings.currentWorkingDir;
    }
    
    // Apply settings to form
    if (settings.paths) {
      document.getElementById('setting-scenarios-path').value = settings.paths.scenarios || './config/scenarios';
      document.getElementById('setting-security-path').value = settings.paths.security || './config/security';
      document.getElementById('setting-public-key').value = settings.paths.publicKey || './config/security/public.key.enc';
      document.getElementById('setting-private-key').value = settings.paths.privateKey || './config/security/private.key.enc';
      const helperPaths = Array.isArray(settings.paths.helperPaths)
        ? settings.paths.helperPaths.join(', ')
        : (settings.paths.helperPaths || './dist/win/*.exe');
      document.getElementById('setting-helper-paths').value = helperPaths;
    }

    if (settings.testSessionDir !== undefined) {
      document.getElementById('setting-session-dir').value = settings.testSessionDir || './test-sessions';
    }

    if (settings.security) {
      document.getElementById('setting-require-signature').checked = settings.security.requireSignature || false;
      document.getElementById('setting-require-os-enforcement').checked = settings.security.requireOsEnforcement || false;
      document.getElementById('setting-allow-unsigned-scenarios').checked = settings.security.allowUnsignedScenarios || false;
      document.getElementById('setting-enable-session-auth').checked = settings.security.enableSessionAuth !== false;
      
      // Security filters
      document.getElementById('setting-allowed-exes').value = (settings.security.allowedExecutables || []).join('\n');
      document.getElementById('setting-blocked-exes').value = (settings.security.blockedExecutables || []).join('\n');
      document.getElementById('setting-allowed-paths').value = (settings.security.allowedPaths || []).join('\n');
      document.getElementById('setting-blocked-paths').value = (settings.security.blockedPaths || []).join('\n');
    }
    
    if (settings.server) {
      document.getElementById('setting-port').value = settings.server.port || 3457;
      document.getElementById('setting-dashboard-port').value = settings.server.dashboardPort || 3458;
      document.getElementById('setting-log-level').value = settings.server.logLevel || 'info';
      document.getElementById('setting-token-expiry').value = settings.server.tokenExpiry || 60;
    }
    
    if (settings.currentToken) {
      document.getElementById('current-token').textContent = settings.currentToken.substring(0, 16) + '...';
    }
    
    addLog('info', 'settings', 'Settings loaded successfully');
  } catch (error) {
    addLog('error', 'settings', `Failed to load settings: ${error.message}`);
  }
}

async function saveSettings() {
  try {
    const settings = {
      paths: {
        scenarios: document.getElementById('setting-scenarios-path').value,
        security: document.getElementById('setting-security-path').value,
        publicKey: document.getElementById('setting-public-key').value,
        privateKey: document.getElementById('setting-private-key').value,
        helperPaths: document.getElementById('setting-helper-paths').value
          .split(',')
          .map(x => x.trim())
          .filter(x => x.length > 0),
      },
      security: {
        requireSignature: document.getElementById('setting-require-signature').checked,
        requireOsEnforcement: document.getElementById('setting-require-os-enforcement').checked,
        allowUnsignedScenarios: document.getElementById('setting-allow-unsigned-scenarios').checked,
        enableSessionAuth: document.getElementById('setting-enable-session-auth').checked,
        allowedExecutables: document.getElementById('setting-allowed-exes').value.split('\n').filter(x => x.trim()),
        blockedExecutables: document.getElementById('setting-blocked-exes').value.split('\n').filter(x => x.trim()),
        allowedPaths: document.getElementById('setting-allowed-paths').value.split('\n').filter(x => x.trim()),
        blockedPaths: document.getElementById('setting-blocked-paths').value.split('\n').filter(x => x.trim()),
      },
      server: {
        port: parseInt(document.getElementById('setting-port').value),
        dashboardPort: parseInt(document.getElementById('setting-dashboard-port').value),
        logLevel: document.getElementById('setting-log-level').value,
        tokenExpiry: parseInt(document.getElementById('setting-token-expiry').value),
      },
      testSessionDir: document.getElementById('setting-session-dir').value || './test-sessions',
    };
    
    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    
    const result = await response.json();
    
    if (result.success) {
      addLog('info', 'settings', 'Settings saved successfully');
      if (result.requiresRestart) {
        addLog('warn', 'settings', 'Server restart required for changes to take effect');
      }
    } else {
      addLog('error', 'settings', `Failed to save settings: ${result.error}`);
    }
  } catch (error) {
    addLog('error', 'settings', `Failed to save settings: ${error.message}`);
  }
}

async function validateConfiguration() {
  const statusDiv = document.getElementById('config-status');
  statusDiv.innerHTML = '<div class="status-item"><span class="status-icon">⏳</span><span>Validating...</span></div>';
  
  try {
    const response = await fetch('/api/settings/validate');
    const validation = await response.json();
    
    let html = '';
    validation.checks.forEach(check => {
      const icon = check.status === 'ok' ? '✅' : check.status === 'warning' ? '⚠️' : '❌';
      const iconClass = check.status === 'ok' ? 'success' : check.status === 'warning' ? 'warning' : 'error';
      html += `<div class="status-item">
        <span class="status-icon ${iconClass}">${icon}</span>
        <span>${check.message}</span>
      </div>`;
    });
    
    statusDiv.innerHTML = html;
    addLog('info', 'settings', `Validation complete: ${validation.checks.length} checks performed`);
  } catch (error) {
    statusDiv.innerHTML = '<div class="status-item"><span class="status-icon error">❌</span><span>Validation failed</span></div>';
    addLog('error', 'settings', `Validation error: ${error.message}`);
  }
}

async function generateNewToken() {
  try {
    const response = await fetch('/api/token/generate', { method: 'POST' });
    const result = await response.json();
    
    if (result.success && result.token) {
      document.getElementById('current-token').textContent = result.token.substring(0, 16) + '...';
      addLog('info', 'settings', 'New session token generated');
    } else {
      addLog('error', 'settings', 'Failed to generate token');
    }
  } catch (error) {
    addLog('error', 'settings', `Token generation error: ${error.message}`);
  }
}
// Advanced Filter Management
let advancedFilters = [];
let nextFilterId = 1;
let editingFilterId = null;

async function loadFilters() {
  try {
    const response = await fetch('/api/filters');
    if (response.ok) {
      const data = await response.json();
      if (data.success && Array.isArray(data.filters)) {
        advancedFilters = data.filters;
        // Recalculate nextFilterId to avoid collisions
        if (advancedFilters.length > 0) {
          nextFilterId = Math.max(...advancedFilters.map(f => f.id || 0)) + 1;
        }
        renderFilters();
      }
    }
  } catch (e) {
    addLog('warn', 'filters', `Could not load filters from server: ${e}`);
  }
}

async function saveFilters() {
  try {
    const response = await fetch('/api/filters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters: advancedFilters }),
    });
    const data = await response.json();
    if (data.success) {
      addLog('info', 'filters', `Saved ${data.count} filter rule(s) to server`);
    } else {
      addLog('error', 'filters', `Failed to save filters: ${data.error}`);
    }
  } catch (e) {
    addLog('error', 'filters', `Save filters error: ${e}`);
  }
}

function openFilterEditor(filterId = null) {
  const modal = document.getElementById('filter-editor-modal');
  const title = document.getElementById('filter-editor-title');
  
  editingFilterId = filterId;
  
  if (filterId) {
    const filter = advancedFilters.find(f => f.id === filterId);
    if (!filter) return;
    
    title.textContent = 'Edit Security Filter';
    document.getElementById('filter-action').value = filter.action;
    document.getElementById('filter-process').value = filter.process || '*';
    document.getElementById('filter-helper').value = filter.helper;
    document.getElementById('filter-command').value = filter.command;
    document.getElementById('filter-pattern').value = filter.pattern;
    document.getElementById('filter-description').value = filter.description;
  } else {
    title.textContent = 'Add Security Filter';
    document.getElementById('filter-action').value = 'allow';
    document.getElementById('filter-process').value = '*';
    document.getElementById('filter-helper').value = 'KeyWin.exe';
    document.getElementById('filter-command').value = '';
    document.getElementById('filter-pattern').value = '';
    document.getElementById('filter-description').value = '';
  }
  
  updateFilterPreview();
  modal.classList.add('active');
}

function closeFilterEditor() {
  const modal = document.getElementById('filter-editor-modal');
  modal.classList.remove('active');
  editingFilterId = null;
}

function updateFilterPreview() {
  const action = document.getElementById('filter-action').value;
  const process = document.getElementById('filter-process').value || '*';
  const helper = document.getElementById('filter-helper').value;
  const command = document.getElementById('filter-command').value || 'command';
  const pattern = document.getElementById('filter-pattern').value || 'pattern';
  
  const actionText = action === 'allow' ? '✅ ALLOW' : '🚫 DENY';
  const preview = `${actionText} ${process} → ${helper}::${command}/${pattern}`;
  
  const previewEl = document.getElementById('filter-preview-text');
  previewEl.innerHTML = `
    <span class="preview-action" style="color: ${action === 'allow' ? 'var(--success)' : 'var(--error)'}">${actionText}</span>
    <span class="preview-process">${process}</span> → 
    <span class="preview-helper">${helper}</span>::<span class="preview-command">${command}</span>/<span class="preview-pattern">${pattern}</span>
  `;
}

function saveFilter() {
  const action = document.getElementById('filter-action').value;
  const process = document.getElementById('filter-process').value.trim() || '*';
  const helper = document.getElementById('filter-helper').value;
  const command = document.getElementById('filter-command').value.trim();
  const pattern = document.getElementById('filter-pattern').value.trim();
  const description = document.getElementById('filter-description').value.trim();
  
  if (!process) {
    alert('Target process is required (use * for all)');
    return;
  }
  
  if (!command) {
    alert('Command is required');
    return;
  }
  
  if (!pattern) {
    alert('Parameter pattern is required');
    return;
  }
  
  if (editingFilterId) {
    const filter = advancedFilters.find(f => f.id === editingFilterId);
    if (filter) {
      filter.action = action;
      filter.process = process;
      filter.helper = helper;
      filter.command = command;
      filter.pattern = pattern;
      filter.description = description;
      addLogEntry('info', 'settings', `Filter updated: ${action.toUpperCase()} ${process} → ${helper}::${command}/${pattern}`);
    }
  } else {
    advancedFilters.push({
      id: nextFilterId++,
      action,
      process,
      helper,
      command,
      pattern,
      description
    });
    addLogEntry('info', 'settings', `Filter added: ${action.toUpperCase()} ${process} → ${helper}::${command}/${pattern}`);
  }
  
  renderFilters();
  closeFilterEditor();
  saveFilters();
}

function deleteFilter(filterId) {
  if (!confirm('Are you sure you want to delete this filter?')) {
    return;
  }
  
  const index = advancedFilters.findIndex(f => f.id === filterId);
  if (index !== -1) {
    const filter = advancedFilters[index];
    advancedFilters.splice(index, 1);
    addLogEntry('info', 'settings', `Filter deleted: ${filter.helper}://${filter.command}/${filter.pattern}`);
    renderFilters();
    saveFilters();
  }
}

function renderFilters(filterTerm = '') {
  const container = document.getElementById('filter-rules-list');
  
  if (!container) return;

  const filtered = filterTerm
    ? advancedFilters.filter(f =>
        `${f.process} ${f.helper} ${f.command} ${f.pattern} ${f.description}`.toLowerCase().includes(filterTerm.toLowerCase()))
    : advancedFilters;
  
  if (filtered.length === 0) {
    container.innerHTML = advancedFilters.length === 0
      ? '<div class="filter-rule-example" style="text-align: center; padding: 2rem; color: var(--text-secondary);"><h3>No filters configured</h3><p>Click "➕ Add Filter Rule" to create your first security filter</p></div>'
      : '<div class="filter-rule-example" style="text-align: center; padding: 2rem; color: var(--text-secondary);">No filters match your search</div>';
    return;
  }
  
  container.innerHTML = filtered.map(filter => {
    const process = filter.process || '*';
    const filterPath = `${process} → ${filter.helper}::${filter.command}/${filter.pattern}`;
    const actionIcon = filter.action === 'allow' ? '✅' : '🚫';
    
    return `
      <div class="filter-rule-example">
        <div class="filter-rule-header">
          <span class="filter-type ${filter.action}">${actionIcon} ${filter.action.toUpperCase()}</span>
          <span class="filter-pattern">${escapeHtml(filterPath)}</span>
          <div class="filter-actions">
            <button class="btn-icon" title="Edit" onclick="openFilterEditor(${filter.id})">✏️</button>
            <button class="btn-icon" title="Delete" onclick="deleteFilter(${filter.id})">🗑️</button>
          </div>
        </div>
        <div class="filter-description">${escapeHtml(filter.description || 'No description')}</div>
      </div>
    `;
  }).join('');
}

let _filterSearchTerm = '';

function filterSearch(term) {
  _filterSearchTerm = term;
  renderFilters(term);
}

function validateAllFilters() {
  const issues = [];
  for (const f of advancedFilters) {
    if (!f.action)  issues.push(`Filter ${f.id}: missing action`);
    if (!f.helper)  issues.push(`Filter ${f.id}: missing helper`);
    if (!f.command) issues.push(`Filter ${f.id}: missing command`);
    if (!f.pattern) issues.push(`Filter ${f.id}: missing pattern`);

    // Schema-based command name validation using cached helper schemas
    if (f.command && f.command !== '*' && f.helper) {
      const schema = cachedHelperSchemas[f.helper];
      if (schema?.commands) {
        const cmdName = f.command.replace(/^\{|\}$/g, '').toUpperCase();
        const known = schema.commands.some(c => c.name.replace(/^\{|\}$/g, '').toUpperCase() === cmdName);
        if (!known) {
          issues.push(`Filter ${f.id}: command "${f.command}" not found in ${f.helper} schema (known: ${
            schema.commands.map(c => `{${c.name.replace(/^\{|\}$/g,'').toUpperCase()}}`).join(', ')
          })`);
        }
      }
    }
  }
  if (issues.length === 0) {
    alert(`✅ All ${advancedFilters.length} filter(s) are valid`);
  } else {
    alert(`⚠️ ${issues.length} issue(s) found:\n\n${issues.join('\n')}`);
  }
}

function exportFilters() {
  const json = JSON.stringify(advancedFilters, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'security-filters.json';
  a.click();
  URL.revokeObjectURL(url);
  addLog('info', 'filters', `Exported ${advancedFilters.length} filter rule(s)`);
}

function importFilters() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const incoming = Array.isArray(parsed) ? parsed : (parsed.filters || []);
      if (!Array.isArray(incoming) || incoming.length === 0) {
        alert('No valid filter rules found in the selected file.');
        return;
      }
      const replace = confirm(
        `Import ${incoming.length} filter rule(s) from "${file.name}"?\n\n` +
        `OK = Replace all current filters\nCancel = Merge (append) to existing`
      );
      if (replace) {
        advancedFilters = incoming.map((f, i) => ({ ...f, id: i + 1 }));
        nextFilterId = advancedFilters.length + 1;
      } else {
        const maxId = advancedFilters.length > 0 ? Math.max(...advancedFilters.map(f => f.id || 0)) : 0;
        advancedFilters.push(...incoming.map((f, i) => ({ ...f, id: maxId + i + 1 })));
        nextFilterId = Math.max(...advancedFilters.map(f => f.id)) + 1;
      }
      renderFilters();
      await saveFilters();
      addLog('info', 'filters',
        `Imported ${incoming.length} filter(s) from "${file.name}" (${replace ? 'replace' : 'merge'} mode)`);
    } catch (err) {
      alert(`Failed to import filters: ${err.message}`);
    }
  };
  input.click();
}

// ---- Quick-pick filter templates ----
const FILTER_TEMPLATES = [
  { action:'allow', process:'calc.exe',   helper:'KeyWin.exe', command:'{CLICKNAME}', pattern:'num*Button',    description:'Allow Calculator number buttons' },
  { action:'deny',  process:'*',          helper:'KeyWin.exe', command:'{KILL}',       pattern:'*',            description:'Block KILL on all processes' },
  { action:'allow', process:'*',          helper:'KeyWin.exe', command:'{READ}',       pattern:'*',            description:'Allow read-only ops everywhere' },
  { action:'deny',  process:'*',          helper:'KeyWin.exe', command:'{SENDKEYS}',   pattern:'*',            description:'Block all keyboard input globally' },
  { action:'allow', process:'notepad.exe',helper:'KeyWin.exe', command:'{SET}',        pattern:'*',            description:'Allow Notepad text editing' },
  { action:'deny',  process:'*',          helper:'KeyWin.exe', command:'{LAUNCH}',     pattern:'*',            description:'Block process launch everywhere' },
  { action:'allow', process:'*',          helper:'KeyWin.exe', command:'{QUERYTREE}',  pattern:'*',            description:'Allow UI tree queries everywhere' },
];

function applyFilterTemplate() {
  const sel = document.getElementById('filter-template');
  const idx = parseInt(sel.value, 10);
  if (isNaN(idx) || idx < 0 || idx >= FILTER_TEMPLATES.length) return;
  const t = FILTER_TEMPLATES[idx];
  document.getElementById('filter-action').value      = t.action;
  document.getElementById('filter-process').value     = t.process;
  document.getElementById('filter-helper').value      = t.helper;
  document.getElementById('filter-command').value     = t.command;
  document.getElementById('filter-pattern').value     = t.pattern;
  document.getElementById('filter-description').value = t.description;
  sel.value = '';   // reset so it can be picked again
  updateFilterPreview();
}

// ---- Test / dry-run panel ----
async function testFilter() {
  const proc  = document.getElementById('test-process').value.trim();
  const cmd   = document.getElementById('test-command').value.trim();
  const param = document.getElementById('test-parameter').value.trim();
  const resultEl = document.getElementById('filter-test-result');
  resultEl.style.display = 'none';
  if (!proc || !cmd) { alert('Enter at least a process name and command.'); return; }
  try {
    const r = await fetch('/api/filters/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ process: proc, helper: 'KeyWin.exe', command: cmd, parameter: param }),
    });
    const data = await r.json();
    const cls = data.verdict === 'ALLOW' ? 'filter-test-allow' : 'filter-test-deny';
    const icon = data.verdict === 'ALLOW' ? '\u2705' : '\ud83d\udeab';
    resultEl.className = `filter-test-result ${cls}`;
    resultEl.innerHTML = `<strong>${icon} ${data.verdict}</strong> &mdash; ${escapeHtml(data.reason)}`;
    resultEl.style.display = 'block';
    addLog('info', 'filters',
      `Filter test: ${proc}/${cmd}/${param || '*'} → ${data.verdict} — ${data.reason}`);
  } catch (err) {
    resultEl.className = 'filter-test-result filter-test-deny';
    resultEl.innerHTML = `<strong>Error:</strong> ${escapeHtml(err.message)}`;
    resultEl.style.display = 'block';
  }
}

// ---- Schema-driven command autocomplete ----
// Schema cache per helper name: { 'KeyWin.exe': schema }
const cachedHelperSchemas = {};

const FALLBACK_COMMANDS_HTML = `
  <optgroup label="\ud83d\udfe2 Read Operations (Low Risk)">
    <option value="{QUERYTREE}">{QUERYTREE} - Query UI element tree</option>
    <option value="{READ}">{READ} - Read text/properties</option>
    <option value="{LISTWINDOWS}">{LISTWINDOWS} - List all windows</option>
    <option value="{GETPROVIDERS}">{GETPROVIDERS} - List available providers</option>
  </optgroup>
  <optgroup label="\ud83d\udfe1 Modification (Medium Risk)">
    <option value="{SET}">{SET} - Set property/text value</option>
  </optgroup>
  <optgroup label="\ud83d\udd34 UI Interaction (High Risk)">
    <option value="{CLICKID}">{CLICKID} - Click element by AutomationId</option>
    <option value="{CLICKNAME}">{CLICKNAME} - Click element by Name</option>
    <option value="{CLICK}">{CLICK} - Click at coordinates</option>
    <option value="{SENDKEYS}">{SENDKEYS} - Send keyboard input</option>
  </optgroup>
  <optgroup label="\u26d4 Process Control (Critical Risk)">
    <option value="{LAUNCH}">{LAUNCH} - Launch new process</option>
    <option value="{KILL}">{KILL} - Terminate process</option>
  </optgroup>
  <optgroup label="Special">
    <option value="*">* - All commands (use with caution)</option>
  </optgroup>`;

async function loadHelperCommandsForFilter(helperName) {
  const sel = document.getElementById('filter-command');
  if (!sel) return;
  try {
    const res = await fetch(`/api/getHelperSchema?name=${encodeURIComponent(helperName)}`);
    if (!res.ok) throw new Error('schema fetch failed');
    const data = await res.json();
    if (!data.success || !data.schema?.commands?.length) throw new Error('no commands in schema');

    const RISK = {
      read:    { label: '\ud83d\udfe2 Read Operations (Low Risk)',       names: ['QUERYTREE','READ','LISTWINDOWS','GETPROVIDERS','LISTHELPERS','GETHELPERCHEMA'] },
      modify:  { label: '\ud83d\udfe1 Modification (Medium Risk)',        names: ['SET','SETPROPERTY'] },
      interact:{ label: '\ud83d\udd34 UI Interaction (High Risk)',         names: ['CLICKID','CLICKNAME','CLICK','SENDKEYS'] },
      process: { label: '\u26d4 Process Control (Critical Risk)',         names: ['LAUNCH','KILL'] },
    };
    const groups = { read:[], modify:[], interact:[], process:[], other:[] };
    data.schema.commands.forEach(cmd => {
      const name = cmd.name.replace(/^\{|\}$/g,'').toUpperCase();
      const key = Object.keys(RISK).find(k => RISK[k].names.includes(name)) || 'other';
      groups[key].push(cmd);
    });

    sel.innerHTML = '';
    const groupOrder = ['read','modify','interact','process','other'];
    const groupLabels = { ...RISK, other: { label:'\ud83d\udd37 Other' } };
    groupOrder.forEach(key => {
      if (!groups[key].length) return;
      const og = document.createElement('optgroup');
      og.label = groupLabels[key].label;
      groups[key].forEach(cmd => {
        const raw = cmd.name.replace(/^\{|\}$/g,'');
        const opt = new Option(`{${raw}} \u2014 ${cmd.description}`, `{${raw}}`);
        og.appendChild(opt);
      });
      sel.appendChild(og);
    });
    // Always add *
    const og = document.createElement('optgroup'); og.label = 'Special';
    og.appendChild(new Option('* \u2014 All commands (use with caution)','*'));
    sel.appendChild(og);
    // Cache the schema for parameter autocomplete
    cachedHelperSchemas[helperName] = data.schema;
    // Update parameter suggestions for current command
    updateParameterSuggestions(sel.value);
    addLog('debug','filters',`Loaded ${data.schema.commands.length} commands from ${helperName} schema`);
  } catch {
    sel.innerHTML = FALLBACK_COMMANDS_HTML;
  }
}

/**
 * Populate the parameter datalist from the cached schema for the currently
 * selected helper + command. Extracts parameter values from command examples.
 */
function updateParameterSuggestions(commandValue) {
  const datalist = document.getElementById('parameter-suggestions');
  if (!datalist) return;
  datalist.innerHTML = '';

  const helperName = document.getElementById('filter-helper')?.value;
  if (!helperName) return;
  const schema = cachedHelperSchemas[helperName];
  if (!schema?.commands) return;

  // Strip braces e.g. '{CLICKNAME}' → 'CLICKNAME'
  const cmdName = (commandValue || '').replace(/^\{|\}$/g, '').toUpperCase();
  const cmd = schema.commands.find(c => c.name.replace(/^\{|\}$/g, '').toUpperCase() === cmdName);
  if (!cmd?.examples?.length) return;

  const seen = new Set();
  cmd.examples.forEach(ex => {
    // Extract parameter from full example: "calc.exe {CLICKNAME:num5Button}" → "num5Button"
    const match = ex.match(/\{[^:}]+:([^}]+)\}/);
    const val = match ? match[1] : ex;
    if (val && !seen.has(val)) {
      seen.add(val);
      const opt = document.createElement('option');
      opt.value = val;
      datalist.appendChild(opt);
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const inputs = ['filter-helper', 'filter-command', 'filter-pattern', 'filter-process', 'filter-action'];
  inputs.forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateFilterPreview);
  });

  // When helper selection changes, reload command list from its schema
  document.getElementById('filter-helper')?.addEventListener('change', (e) => {
    loadHelperCommandsForFilter(e.target.value);
    updateFilterPreview();
  });

  // When command changes, update parameter suggestions from cached schema
  document.getElementById('filter-command')?.addEventListener('change', (e) => {
    updateParameterSuggestions(e.target.value);
    updateFilterPreview();
  });

  // Connect toolbar buttons
  document.getElementById('btn-add-filter')?.addEventListener('click', () => openFilterEditor());
  document.getElementById('btn-import-filters')?.addEventListener('click', importFilters);
  document.getElementById('btn-validate-filters')?.addEventListener('click', validateAllFilters);
  document.getElementById('btn-export-filters')?.addEventListener('click', exportFilters);
  document.getElementById('btn-save-filters')?.addEventListener('click', saveFilters);
  document.getElementById('filter-search')?.addEventListener('input', (e) => filterSearch(e.target.value));

  // Filter test panel
  document.getElementById('btn-test-filter')?.addEventListener('click', testFilter);

  loadFilters();
  // Pre-load KeyWin commands in the editor (default helper)
  loadHelperCommandsForFilter('KeyWin.exe');
});;

// Interactive Window and UI Tree Selection
let selectedWindow = null;
let selectedElement = null;
let currentUITree = null;

async function openWindowSelector() {
  const modal = document.getElementById('window-selector-modal');
  modal.classList.add('active');
  await loadWindowsList();
}

function closeWindowSelector() {
  const modal = document.getElementById('window-selector-modal');
  modal.classList.remove('active');
}

async function loadWindowsList() {
  const container = document.getElementById('windows-list');
  container.innerHTML = '<div class="loading">Loading windows...</div>';
  
  try {
    const response = await fetch('/api/listWindows', { method: 'POST', body: '{}' });
    const result = await response.json();
    
    if (!result.success || !result.data) {
      container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--error);">Failed to load windows</div>';
      return;
    }
    
    const windows = result.data;
    if (windows.length === 0) {
      container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-secondary);">No windows found</div>';
      return;
    }
    
    container.innerHTML = windows.map(win => {
      const icon = getWindowIcon(win.processName);
      return `
        <div class="window-item" onclick="selectWindow(${JSON.stringify(win).replace(/"/g, '&quot;')})">
          <div class="window-icon">${icon}</div>
          <div class="window-info">
            <div class="window-title">${escapeHtml(win.title || 'Untitled')}</div>
            <div class="window-details">
              Process: ${escapeHtml(win.processName || 'Unknown')} | 
              PID: ${win.pid || 'N/A'} | 
              Handle: ${win.handle || 'N/A'}
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (error) {
    container.innerHTML = `<div style="text-align: center; padding: 2rem; color: var(--error);">Error: ${error.message}</div>`;
    addLogEntry('error', 'ui', `Failed to load windows: ${error.message}`);
  }
}

function selectWindow(windowInfo) {
  console.log('selectWindow called with:', windowInfo);
  addLogEntry('info', 'ui', `selectWindow called - Title: ${windowInfo.title}, PID: ${windowInfo.pid}, Handle: ${windowInfo.handle}`);
  
  selectedWindow = windowInfo;
  
  // Ensure handle is stored as string for API calls
  if (selectedWindow.handle) {
    selectedWindow.handle = String(selectedWindow.handle);
  }
  
  addLogEntry('info', 'ui', `Selected window: ${windowInfo.title} (PID: ${windowInfo.pid}, Handle: ${windowInfo.handle})`);
  
  // Update process input with selected window info
  document.getElementById('filter-process').value = windowInfo.processName || 'Unknown';
  
  // Show process details
  const details = document.getElementById('process-details');
  details.className = 'process-details active';
  details.innerHTML = `
    <div class="process-details-item"> <strong>Title:</strong> ${escapeHtml(windowInfo.title || 'Untitled')}</div>
    <div class="process-details-item"> <strong>PID:</strong> ${windowInfo.pid || 'N/A'}</div>
    <div class="process-details-item"> <strong>Handle:</strong> ${windowInfo.handle || 'N/A'}</div>
    <div class="process-details-item"> <strong>Process:</strong> ${escapeHtml(windowInfo.processName || 'Unknown')}</div>
  `;
  
  // Visual feedback - highlight selected item
  document.querySelectorAll('.window-item').forEach(item => item.classList.remove('selected'));
  event.currentTarget.classList.add('selected');
  
  // Show selection confirmation in modal
  const windowsList = document.getElementById('windows-list');
  const confirmMsg = document.createElement('div');
  confirmMsg.className = 'selection-confirmation';
  confirmMsg.innerHTML = `✓ Selected: <strong>${escapeHtml(windowInfo.title || 'Untitled')}</strong> - Closing...`;
  windowsList.insertBefore(confirmMsg, windowsList.firstChild);
  
  // Enable tree browser button
  document.getElementById('btn-browse-tree').disabled = false;
  
  // Check if tree browser is already open before closing window selector
  const treeBrowserModal = document.getElementById('tree-browser-modal');
  const shouldRefreshTree = treeBrowserModal && treeBrowserModal.classList.contains('active');
  
  addLogEntry('info', 'ui', `Tree browser is ${shouldRefreshTree ? 'OPEN' : 'CLOSED'}, will ${shouldRefreshTree ? 'REFRESH' : 'NOT refresh'}`);
  
  // Close modal after short delay to show confirmation
  setTimeout(() => {
    closeWindowSelector();
    
    // If tree browser was open, refresh the tree with the new window
    if (shouldRefreshTree) {
      addLogEntry('info', 'ui', `Refreshing tree for newly selected window: ${selectedWindow.title} (Handle: ${selectedWindow.handle})`);
      setTimeout(() => queryUITree(), 100);  // Small delay to ensure modal is fully closed
    }
  }, 800);
}

function refreshWindowsList() {
  loadWindowsList();
}

async function launchAndSelect() {
  const processName = prompt('Enter process to launch (e.g., calc.exe, notepad.exe):');
  if (!processName) return;
  
  try {
    addLogEntry('info', 'ui', `Launching process: ${processName}`);
    
    const response = await fetch('/api/launchProcess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        executable: processName,
        args: []
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      addLogEntry('info', 'ui', `Process launched successfully: ${processName}`);
      // Wait a bit for window to appear
      setTimeout(() => {
        openWindowSelector();
      }, 1000);
    } else {
      alert(`Failed to launch process: ${result.error || 'Unknown error'}`);
    }
  } catch (error) {
    alert(`Error launching process: ${error.message}`);
    addLogEntry('error', 'ui', `Failed to launch process: ${error.message}`);
  }
}

function openUITreeBrowser() {
  if (!selectedWindow) {
    alert('Please select a window first using "Select Window" button');
    return;
  }
  
  const modal = document.getElementById('tree-browser-modal');
  modal.classList.add('active');
  
  document.getElementById('tree-target').textContent = 
    `${selectedWindow.title} (${selectedWindow.processName})`;
}

function closeUITreeBrowser() {
  const modal = document.getElementById('tree-browser-modal');
  modal.classList.remove('active');
}

async function queryUITree() {
  if (!selectedWindow) {
    alert('No window selected');
    return;
  }
  
  // Update the tree target display to show current selected window
  const treeTargetEl = document.getElementById('tree-target');
  if (treeTargetEl) {
    treeTargetEl.textContent = `${selectedWindow.title} (${selectedWindow.processName})`;
  }
  
  const container = document.getElementById('ui-tree-display');
  container.innerHTML = '<div class="loading">Querying UI tree...</div>';
  
  try {
    addLogEntry('info', 'ui', `Querying UI tree for: ${selectedWindow.title} (Handle: ${selectedWindow.handle}, PID: ${selectedWindow.pid})`);
    
    const response = await fetch('/api/queryTree', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerName: 'windows-forms',
        targetId: `HANDLE:${selectedWindow.handle || selectedWindow.processName}`,
        options: { depth: 5 }
      })
    });
    
    const result = await response.json();
    
    if (result.success && result.data) {
      currentUITree = result.data;
      container.innerHTML = '';  // Clear before rendering
      renderUITree(result.data, container);
      addLogEntry('info', 'ui', 'UI tree loaded successfully');
    } else {
      container.innerHTML = `<div style="text-align: center; padding: 2rem; color: var(--error);">Failed to query tree: ${result.error || 'Unknown error'}</div>`;
      addLogEntry('error', 'ui', `Failed to query tree: ${result.error || 'Unknown error'}`);
    }
  } catch (error) {
    container.innerHTML = `<div style="text-align: center; padding: 2rem; color: var(--error);">Error: ${error.message}</div>`;
    addLogEntry('error', 'ui', `Failed to query tree: ${error.message}`);
  }
}

function renderUITree(node, container, level = 0) {
  if (!node) return;
  
  const nodeDiv = document.createElement('div');
  nodeDiv.className = 'tree-node';
  
  const hasChildren = node.children && node.children.length > 0;
  const toggleIcon = hasChildren ? '▼' : '';
  
  const header = document.createElement('div');
  header.className = 'tree-node-header';
  
  // Build identifier display - prioritize ID, show name as supplementary
  const idDisplay = node.id ? `<span class="tree-element-id" title="AutomationId - Primary Identifier">[ID: ${escapeHtml(node.id)}]</span>` : '';
  const nameDisplay = node.name ? `<span class="tree-element-name" title="Name - May be localized">${escapeHtml(node.name)}</span>` : '<span class="tree-element-name" style="font-style:italic;color:var(--text-secondary)">(no name)</span>';
  
  header.innerHTML = `
    <span class="tree-toggle" onclick="toggleTreeNode(this)">${toggleIcon}</span>
    <span class="tree-element-type" title="Control Type">${escapeHtml(node.type || 'Element')}</span>
    ${idDisplay}
    ${nameDisplay}
  `;
  
  header.addEventListener('click', (e) => {
    if (e.target.classList.contains('tree-toggle')) return;
    selectTreeElement(node, header);
  });
  
  nodeDiv.appendChild(header);
  
  if (hasChildren) {
    const childrenDiv = document.createElement('div');
    childrenDiv.className = 'tree-node-children expanded';  // Expanded by default
    node.children.forEach(child => renderUITree(child, childrenDiv, level + 1));
    nodeDiv.appendChild(childrenDiv);
  }
  
  container.appendChild(nodeDiv);
}

function toggleTreeNode(toggle) {
  const header = toggle.closest('.tree-node-header');
  const node = header.parentElement;
  const children = node.querySelector('.tree-node-children');
  
  if (children) {
    children.classList.toggle('expanded');
    toggle.textContent = children.classList.contains('expanded') ? '▼' : '▶';
  }
}

function selectTreeElement(element, headerElement) {
  // Deselect previous
  document.querySelectorAll('.tree-node-header.selected').forEach(el => {
    el.classList.remove('selected');
  });
  
  // Select new
  headerElement.classList.add('selected');
  selectedElement = element;
  
  addLogEntry('info', 'ui', `Selected element: ${element.name || element.type} (ID: ${element.id || 'none'})`);
  
  // Display properties in the properties panel
  displayElementProperties(element);
}

function displayElementProperties(element) {
  const container = document.getElementById('element-properties');
  if (!container) return;
  
  container.innerHTML = '';
  
  // Basic Information Section
  const basicSection = document.createElement('div');
  basicSection.className = 'property-section';
  basicSection.innerHTML = '<div class="property-section-title">Basic Information</div>';
  
  addProperty(basicSection, '⭐ Automation ID (Preferred)', element.id || '⚠️ NOT SET - element may be hard to target', 'string');
  addProperty(basicSection, 'Name', element.name || '(no name)', 'string');
  addProperty(basicSection, 'Type', element.type || 'Unknown', 'string');
  
  container.appendChild(basicSection);
  
  // Position Section
  if (element.position) {
    const posSection = document.createElement('div');
    posSection.className = 'property-section';
    posSection.innerHTML = '<div class="property-section-title">Position & Size</div>';
    
    addProperty(posSection, 'X', element.position.x, 'number');
    addProperty(posSection, 'Y', element.position.y, 'number');
    addProperty(posSection, 'Width', element.position.width, 'number');
    addProperty(posSection, 'Height', element.position.height, 'number');
    
    container.appendChild(posSection);
  }
  
  // Properties Section
  if (element.properties && Object.keys(element.properties).length > 0) {
    const propsSection = document.createElement('div');
    propsSection.className = 'property-section';
    propsSection.innerHTML = '<div class="property-section-title">Properties</div>';
    
    for (const [key, value] of Object.entries(element.properties)) {
      const valueType = typeof value;
      addProperty(propsSection, key, value, valueType);
    }
    
    container.appendChild(propsSection);
  }
  
  // Actions Section
  if (element.actions && element.actions.length > 0) {
    const actionsSection = document.createElement('div');
    actionsSection.className = 'property-section';
    actionsSection.innerHTML = '<div class="property-section-title">Available Actions</div>';
    
    addProperty(actionsSection, 'Actions', element.actions.join(', '), 'string');
    
    container.appendChild(actionsSection);
  }
  
  // Children Count
  if (element.children) {
    const childSection = document.createElement('div');
    childSection.className = 'property-section';
    childSection.innerHTML = '<div class="property-section-title">Structure</div>';
    
    addProperty(childSection, 'Children Count', element.children.length, 'number');
    
    container.appendChild(childSection);
  }
}

function addProperty(container, label, value, valueType) {
  const propItem = document.createElement('div');
  propItem.className = 'property-item';
  
  const propLabel = document.createElement('div');
  propLabel.className = 'property-label';
  propLabel.textContent = label + ':';
  
  const propValue = document.createElement('div');
  propValue.className = `property-value ${valueType}`;
  
  if (value === null || value === undefined) {
    propValue.textContent = 'null';
    propValue.className = 'property-value null';
  } else if (valueType === 'boolean') {
    propValue.textContent = value ? 'true' : 'false';
  } else if (valueType === 'object') {
    propValue.textContent = JSON.stringify(value, null, 2);
  } else {
    propValue.textContent = String(value);
  }
  
  propItem.appendChild(propLabel);
  propItem.appendChild(propValue);
  container.appendChild(propItem);
}

function useSelectedElement() {
  if (!selectedElement) {
    alert('Please select an element from the tree');
    return;
  }
  
  // Prioritize ID (stable identifier), fallback to name, then type
  const pattern = selectedElement.id || selectedElement.name || selectedElement.type;
  const identifierType = selectedElement.id ? 'ID' : (selectedElement.name ? 'Name' : 'Type');
  
  document.getElementById('filter-pattern').value = pattern;
  
  addLogEntry('info', 'ui', `Using ${identifierType}: ${pattern}`);
  
  // Warn if using name (may be localized) or type (not unique)
  if (!selectedElement.id) {
    addLogEntry('warn', 'ui', `Element has no ID. Using ${identifierType} which may not be stable across sessions or localizations.`);
  }
  
  closeUITreeBrowser();
  updateFilterPreview();
}

function getWindowIcon(processName) {
  const lower = (processName || '').toLowerCase();
  if (lower.includes('calc')) return '';
  if (lower.includes('notepad')) return '';
  if (lower.includes('explorer')) return '';
  if (lower.includes('chrome') || lower.includes('edge') || lower.includes('firefox')) return '';
  if (lower.includes('word')) return '';
  if (lower.includes('excel')) return '';
  if (lower.includes('powershell') || lower.includes('cmd')) return '';
  return '';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize criteria checkbox handlers
document.addEventListener('DOMContentLoaded', () => {
  const windowTitleCheckbox = document.getElementById('criteria-window-title');
  const processPathCheckbox = document.getElementById('criteria-process-path');
  const binaryHashCheckbox = document.getElementById('criteria-binary-hash');
  
  if (windowTitleCheckbox) {
    windowTitleCheckbox.addEventListener('change', (e) => {
      const field = document.getElementById('field-window-title');
      field.style.display = e.target.checked ? 'block' : 'none';
    });
  }
  
  if (processPathCheckbox) {
    processPathCheckbox.addEventListener('change', (e) => {
      const field = document.getElementById('field-process-path');
      field.style.display = e.target.checked ? 'block' : 'none';
    });
  }
  
  if (binaryHashCheckbox) {
    binaryHashCheckbox.addEventListener('change', (e) => {
      const field = document.getElementById('field-binary-hash');
      field.style.display = e.target.checked ? 'block' : 'none';
    });
  }
  
  // Update preview when any filter input changes
  const filterInputs = ['filter-action', 'filter-process', 'filter-helper', 'filter-command', 'filter-pattern'];
  filterInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', updateFilterPreview);
      el.addEventListener('change', updateFilterPreview);
    }
  });
});

// Hash computation helpers
async function computeHashFromFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.exe,.dll';
  
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const algorithm = document.getElementById('hash-algorithm').value;
    addLogEntry('info', 'security', `Computing ${algorithm} hash for ${file.name}...`);
    
    try {
      const arrayBuffer = await file.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest(algorithm === 'SHA256' ? 'SHA-256' : 'MD5', arrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      
      document.getElementById('filter-binary-hash').value = hashHex;
      addLogEntry('success', 'security', `${algorithm} hash computed: ${hashHex.substring(0, 16)}...`);
    } catch (err) {
      addLogEntry('error', 'security', `Failed to compute hash: ${err.message}`);
    }
  };
  
  input.click();
}

async function computeHashFromRunning() {
  if (!selectedWindow) {
    alert('Please select a running process from the Windows list first');
    return;
  }
  
  const algorithm = document.getElementById('hash-algorithm').value;
  addLogEntry('info', 'security', `Requesting ${algorithm} hash for ${selectedWindow.title}...`);
  
  try {
    const response = await fetch('/api/process-hash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        processId: selectedWindow.pid,
        processName: selectedWindow.processName,
        algorithm: algorithm
      })
    });
    
    const result = await response.json();
    if (result.success) {
      document.getElementById('filter-binary-hash').value = result.hash;
      addLogEntry('success', 'security', `${algorithm} hash retrieved: ${result.hash.substring(0, 16)}...`);
    } else {
      addLogEntry('error', 'security', `Failed to get hash: ${result.error}`);
    }
  } catch (err) {
    addLogEntry('error', 'security', `Failed to request hash: ${err.message}`);
  }
}

// Admin Mode Functions
async function toggleAdminMode() {
  if (state.adminMode.active) {
    exitAdminMode();
    return;
  }
  
  const password = prompt('🔐 Enter admin password to enable privileged mode:\n\nWarning: This will bypass ALL security filters!');
  if (!password) {
    return;
  }
  
  try {
    const response = await fetch('/api/auth/admin-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    
    if (response.status === 401) {
      addLog('error', 'security', '❌ Invalid admin password');
      alert('Invalid password. Admin mode access denied.');
      return;
    }
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const result = await response.json();
    
    // Store admin token
    state.adminMode = {
      active: true,
      token: result.token,
      expiry: new Date(result.expiry),
      timer: null
    };
    
    // Show admin banner
    showAdminMode();
    
    addLog('warn', 'security', '⚠️ ADMIN MODE ACTIVATED - Security filters bypassed!');
    addLog('info', 'security', `Admin session expires at ${state.adminMode.expiry.toLocaleTimeString()}`);
    
  } catch (error) {
    addLog('error', 'security', `Admin mode activation failed: ${error.message}`);
    alert('Failed to activate admin mode. Please try again.');
  }
}

function showAdminMode() {
  // Show warning banner
  const banner = document.getElementById('admin-mode-banner');
  banner.style.display = 'block';
  
  // Update button
  const btn = document.getElementById('btn-admin-mode');
  btn.textContent = '🔒 Exit Admin Mode';
  btn.classList.add('admin-active');
  
  // Update expiry time
  updateAdminExpiry();
  
  // Start countdown timer
  state.adminMode.timer = setInterval(() => {
    updateAdminExpiry();
    
    // Check if expired
    if (Date.now() >= state.adminMode.expiry.getTime()) {
      exitAdminMode();
    }
  }, 1000);
}

function updateAdminExpiry() {
  const expiryElement = document.getElementById('admin-expiry');
  const remaining = state.adminMode.expiry.getTime() - Date.now();
  
  if (remaining <= 0) {
    expiryElement.textContent = ' (EXPIRED)';
    expiryElement.style.color = '#ff4444';
    return;
  }
  
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  expiryElement.textContent = ` (expires in ${minutes}:${seconds.toString().padStart(2, '0')})`;
  
  // Warning colors for last 2 minutes
  if (remaining < 120000) {
    expiryElement.style.color = '#ffaa00';
  } else {
    expiryElement.style.color = 'white';
  }
}

function exitAdminMode() {
  // Clear admin state
  if (state.adminMode.timer) {
    clearInterval(state.adminMode.timer);
  }
  
  state.adminMode = {
    active: false,
    token: null,
    expiry: null,
    timer: null
  };
  
  // Hide warning banner
  const banner = document.getElementById('admin-mode-banner');
  banner.style.display = 'none';
  
  // Update button
  const btn = document.getElementById('btn-admin-mode');
  btn.textContent = '🔓 Enter Admin Mode';
  btn.classList.remove('admin-active');
  
  addLog('info', 'security', '✅ Admin mode deactivated - Security filters restored');
}

// ===== Discovered Helpers =====

// Module-level cache for disabled helpers
let disabledHelpers = [];

function initializeHelpers() {
  const scanBtn = document.getElementById('btn-scan-helpers');
  if (scanBtn) {
    scanBtn.addEventListener('click', () => scanHelpers());
    // Auto-scan on load so helpers appear without manual interaction
    scanHelpers();
  }
  const reloadBtn = document.getElementById('btn-reload-helpers');
  if (reloadBtn) {
    reloadBtn.addEventListener('click', () => reloadHelpers());
  }
}

async function scanHelpers() {
  const statusEl = document.getElementById('helpers-scan-status');
  const listEl   = document.getElementById('helpers-list');
  if (!statusEl || !listEl) return;

  statusEl.textContent = 'Scanning…';
  listEl.innerHTML = '<div class="helpers-empty">Scanning for helpers…</div>';

  try {
    // Fetch helpers list and disabled list in parallel
    const [helpersResp, disabledResp] = await Promise.all([
      fetch('/api/listHelpers'),
      fetch('/api/helpers/disabled'),
    ]);
    const data      = await helpersResp.json();
    const disData   = await disabledResp.json();
    disabledHelpers = Array.isArray(disData.disabledHelpers) ? disData.disabledHelpers : [];

    if (!data.success) {
      statusEl.textContent = 'Scan failed';
      listEl.innerHTML = `<div class="helpers-empty error">Error: ${escapeHtml(data.error || 'unknown')}</div>`;
      return;
    }

    const helpers = data.helpers || [];
    statusEl.textContent = helpers.length
      ? `Found ${helpers.length} helper${helpers.length > 1 ? 's' : ''}`
      : 'No helpers found';

    if (helpers.length === 0) {
      listEl.innerHTML = '<div class="helpers-empty">No helpers discovered. Ensure helper executables are built and paths are configured above.</div>';
      return;
    }

    listEl.innerHTML = helpers.map(h => {
      const safeId    = h.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const isDisabled = disabledHelpers.includes(h.name);
      const cmds = (h.commands || []).map(c =>
        `<div class="helper-cmd"><code>${escapeHtml(c.name)}</code> — ${escapeHtml(c.description)}</div>`
      ).join('');
      const toggleLabel = isDisabled ? '▶ Enable' : '⏸ Disable';
      const toggleClass = isDisabled ? 'btn-helper-enable' : 'btn-helper-disable';
      return `
        <div class="helper-card${isDisabled ? ' helper-disabled' : ''}" id="helper-card-${safeId}">
          <div class="helper-card-header">
            <span class="helper-name">${escapeHtml(h.name)}</span>
            <span class="helper-version">v${escapeHtml(h.version)}</span>
            ${isDisabled ? '<span class="helper-badge-disabled">DISABLED</span>' : ''}
            <span class="helper-cmd-count">${h.commandCount} command${h.commandCount !== 1 ? 's' : ''}</span>
            <button class="btn-sm btn-secondary" onclick="toggleHelperCommands('${safeId}')">📋 Commands</button>
            <button class="btn-sm btn-secondary" onclick="showHelperSchema('${escapeHtml(h.name)}')">📄 Schema</button>
            <button class="btn-sm ${toggleClass}" onclick="toggleHelperEnabled('${escapeHtml(h.name)}', ${isDisabled})">${toggleLabel}</button>
          </div>
          <div class="helper-description">${escapeHtml(h.description)}</div>
          <div class="helper-path"><code>${escapeHtml(h.filePath)}</code></div>
          <div id="helper-cmds-${safeId}" class="helper-commands" style="display:none">${cmds}</div>
        </div>`;
    }).join('');
  } catch (e) {
    statusEl.textContent = 'Scan failed';
    listEl.innerHTML = `<div class="helpers-empty error">Failed to connect: ${escapeHtml(String(e))}</div>`;
  }
}

/**
 * POST /api/helpers/reload — shutdown + re-discover + restart all daemons,
 * then refresh the helpers list in the UI.
 */
async function reloadHelpers() {
  const statusEl = document.getElementById('helpers-scan-status');
  const listEl   = document.getElementById('helpers-list');
  const btn      = document.getElementById('btn-reload-helpers');
  if (statusEl) statusEl.textContent = 'Reloading…';
  if (listEl)   listEl.innerHTML = '<div class="helpers-empty">Reloading helpers — stopping daemons and re-scanning…</div>';
  if (btn)      btn.disabled = true;
  try {
    const resp = await fetch('/api/helpers/reload', { method: 'POST' });
    const data = await resp.json();
    if (data.success) {
      if (statusEl) statusEl.textContent = `Reloaded ${data.reloaded} helper${data.reloaded !== 1 ? 's' : ''}`;
    } else {
      if (statusEl) statusEl.textContent = `Reload failed: ${data.error || 'unknown'}`;
    }
    // Refresh the list regardless (even partial reload is useful)
    await scanHelpers();
  } catch (e) {
    if (statusEl) statusEl.textContent = `Reload error: ${e}`;
    if (listEl)   listEl.innerHTML = `<div class="helpers-empty error">Reload failed: ${escapeHtml(String(e))}</div>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function toggleHelperEnabled(helperName, currentlyDisabled) {
  const newDisabled = !currentlyDisabled;
  try {
    const resp = await fetch('/api/helpers/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: helperName, disabled: newDisabled }),
    });
    const data = await resp.json();
    if (data.success) {
      // Re-render the helpers list to reflect the new state
      await scanHelpers();
    } else {
      alert(`Failed to ${newDisabled ? 'disable' : 'enable'} ${helperName}: ${data.error}`);
    }
  } catch (e) {
    alert(`Error toggling helper: ${e}`);
  }
}

function toggleHelperCommands(safeId) {
  const el = document.getElementById('helper-cmds-' + safeId);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function showHelperSchema(helperName) {
  const modal = document.getElementById('helper-schema-modal');
  const title = document.getElementById('helper-schema-title');
  const content = document.getElementById('helper-schema-content');
  if (!modal || !title || !content) return;

  title.textContent = helperName;
  content.textContent = 'Loading…';
  modal.classList.add('active');

  try {
    const response = await fetch(`/api/getHelperSchema?name=${encodeURIComponent(helperName)}`);
    const data = await response.json();
    if (data.success && data.schema) {
      content.textContent = JSON.stringify(data.schema, null, 2);
    } else {
      content.textContent = `Error: ${data.error || 'Failed to load schema'}`;
    }
  } catch (e) {
    content.textContent = `Error: ${e}`;
  }
}

function closeHelperSchema() {
  const modal = document.getElementById('helper-schema-modal');
  if (modal) modal.classList.remove('active');
}
