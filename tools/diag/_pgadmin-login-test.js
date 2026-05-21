'use strict';
const { mcpCall } = require('../../test/e2e/_shared');
const db = require('../../ai_priv/db.json');
const B = 'brave.exe';

(async () => {
  const { email, password, url } = db.pgadmin;

  // Navigate fresh
  await mcpCall('BrowserWin', { proc: B, action: 'NAVIGATE', path: url + 'login', value: '' });
  await new Promise(r => setTimeout(r, 1500));

  // Fill via JS with React nativeInputValueSetter to properly trigger change events
  const fillJS = (sel, val) => `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(document.querySelector('${sel}'),${JSON.stringify(val)})||document.querySelector('${sel}').dispatchEvent(new Event('input',{bubbles:true}))||document.querySelector('${sel}').value`;
  const r1 = await mcpCall('BrowserWin', { proc: B, action: 'EXEC', path: '', value: fillJS('[name=email]', email) });
  console.log('email set:', r1?.result);
  const r2 = await mcpCall('BrowserWin', { proc: B, action: 'EXEC', path: '', value: fillJS('[name=password]', password) });
  console.log('pass set:', r2?.result);
  await new Promise(r => setTimeout(r, 500));
  await mcpCall('BrowserWin', { proc: B, action: 'CLICKNAME', path: 'Login', value: '' });
  await new Promise(r => setTimeout(r, 3000));

  // Read result
  const loc = await mcpCall('BrowserWin', { proc: B, action: 'EXEC', path: '', value: 'location.href' });
  console.log('URL after login:', loc?.result);

  // Read any error message
  const err = await mcpCall('BrowserWin', { proc: B, action: 'EXEC', path: '', value:
    'Array.from(document.querySelectorAll("[class*=alert],[class*=Alert],[class*=error],[class*=Error]")).map(e=>e.innerText?.trim()).filter(Boolean).join(" | ")' });
  console.log('Error text:', err?.result);

  // Read full body text to see what's on screen
  const body = await mcpCall('BrowserWin', { proc: B, action: 'EXEC', path: '', value:
    'document.body.innerText.slice(0,800)' });
  console.log('Body text:', body?.result);
})().catch(e => console.error(e.message ?? e));
