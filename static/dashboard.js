// Dashboard State
const state = {
  ws: null,
  logs: [],
  autoScroll: true,
  logLevel: 'all',
  searchTerm: '',
  selectedScenario: null,
  serverStartTime: Date.now(),
  rawMode: false,
};

// Initialize Dashboard
document.addEventListener('DOMContentLoaded', () => {
  initializeNavigation();
  initializeWebSocket();
  initializeLogControls();
  initializeActions();
  loadTools();
  loadScenarios();
  loadSettings();
  startUptimeCounter();
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

function shouldDisplayLog(log) {
  // Level filter
  if (state.logLevel !== 'all' && log.level !== state.logLevel) {
    return false;
  }
  
  // Search filter
  if (state.searchTerm && !log.message.toLowerCase().includes(state.searchTerm)) {
    return false;
  }
  
  return true;
}

function appendLogToDOM(log) {
  const logContainer = document.getElementById('log-output');
  const logEntry = document.createElement('div');
  logEntry.className = `log-entry ${log.level}`;
  
  if (state.rawMode) {
    // Raw mode: display exactly like terminal [timestamp] LEVEL [source] message
    const rawText = `[${log.timestamp}] ${log.level.toUpperCase()} [${log.source}] ${log.message}`;
    logEntry.innerHTML = `<span class="message">${escapeHtml(rawText)}</span>`;
  } else {
    // Fancy mode: colored components
    logEntry.innerHTML = `
      <span class="timestamp">${log.timestamp}</span>
      <span class="level">${log.level.toUpperCase()}</span>
      <span class="source">${log.source}</span>
      <span class="message">${escapeHtml(log.message)}</span>
    `;
  }
  
  logContainer.appendChild(logEntry);
  
  // Auto-scroll
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

// Settings
async function loadSettings() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    
    // Populate settings UI
    document.getElementById('setting-require-signature').checked = config.requireBinarySignature || false;
    document.getElementById('setting-require-os-enforcement').checked = config.requireOSEnforcement || false;
    document.getElementById('setting-allow-unsigned-scenarios').checked = config.allowUnsignedScenarios || false;
    document.getElementById('setting-enable-session-auth').checked = config.enableSessionAuth !== false;
    document.getElementById('setting-token-expiry').value = config.sessionTokenExpiry || 60;
    
    addLog('debug', 'settings', 'Settings loaded from server');
  } catch (error) {
    addLog('error', 'settings', `Failed to load settings: ${error.message}`);
  }
}

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

// Utilities
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
