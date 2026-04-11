import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { XmlScenarioLoader, executeXmlScenario, XmlScenario, XmlStep } from './xmlScenarioLoader';

// ── XmlScenarioLoader.substitute ──────────────────────────────────────────────

describe('XmlScenarioLoader.substitute', () => {
  it('replaces a single variable', () => {
    expect(XmlScenarioLoader.substitute('HANDLE:{{hwnd}}', { hwnd: '123' })).toBe('HANDLE:123');
  });

  it('replaces multiple variables', () => {
    const result = XmlScenarioLoader.substitute('{{greeting}} {{name}}!', { greeting: 'Hello', name: 'World' });
    expect(result).toBe('Hello World!');
  });

  it('leaves unbound {{var}} placeholders as-is', () => {
    expect(XmlScenarioLoader.substitute('{{unset}}', {})).toBe('{{unset}}');
  });

  it('replaces the same variable used twice', () => {
    expect(XmlScenarioLoader.substitute('{{a}} and {{a}}', { a: 'X' })).toBe('X and X');
  });

  it('handles empty string input', () => {
    expect(XmlScenarioLoader.substitute('', { x: 'y' })).toBe('');
  });

  it('handles string with no placeholders', () => {
    expect(XmlScenarioLoader.substitute('SYSTEM', {})).toBe('SYSTEM');
  });

  it('handles partial variable names correctly', () => {
    // {{abc}} should match, {{ab}} in same string should also match independently
    const result = XmlScenarioLoader.substitute('{{ab}}-{{abc}}', { ab: 'short', abc: 'long' });
    expect(result).toBe('short-long');
  });
});

// ── executeXmlScenario ────────────────────────────────────────────────────────

/** Build a minimal XmlScenario without touching the file system. */
function makeScenario(steps: XmlStep[], overrides: Partial<XmlScenario> = {}): XmlScenario {
  return {
    id: 'test',
    label: 'Test Scenario',
    helper: 'KeyWin.exe',
    process: 'testapp.exe',
    app: 'testapp',
    params: [],
    steps,
    ...overrides,
  };
}

describe('executeXmlScenario', () => {
  const noopLog = (_m: string) => { /* silent */ };

  // ── WAIT step ──────────────────────────────────────────────────────────────

  it('WAIT step records success + waitMs without calling the helper', async () => {
    const callFn = jest.fn();
    const result = await executeXmlScenario({
      scenario: makeScenario([{ command: 'WAIT', target: '', parameter: '0' }]),
      callFn,
      log: noopLog,
    });
    expect(callFn).not.toHaveBeenCalled();
    expect(result.steps[0]).toMatchObject({ command: 'WAIT', waitMs: 0, success: true });
  });

  it('WAIT with 0ms does not sleep (fast test)', async () => {
    const start = Date.now();
    await executeXmlScenario({
      scenario: makeScenario([{ command: 'WAIT', target: '', parameter: '0' }]),
      callFn: jest.fn(),
    });
    expect(Date.now() - start).toBeLessThan(500);
  });

  // ── LISTWINDOWS + {{hwnd}} binding ─────────────────────────────────────────

  it('LISTWINDOWS binds {{hwnd}} when a matching window is found', async () => {
    const callFn = jest.fn().mockResolvedValue({
      success: true,
      windows: [
        { title: 'Calculator', hwnd: 99999 },
        { title: 'Notepad', hwnd: 11111 },
      ],
    });

    const result = await executeXmlScenario({
      scenario: makeScenario(
        [
          { command: 'LISTWINDOWS', target: 'SYSTEM', parameter: '' },
          { command: 'READ',        target: '{{hwnd}}', parameter: '' },
        ],
        { process: 'calc.exe', app: 'calculator' },
      ),
      callFn,
      log: noopLog,
    });

    expect(result.vars['hwnd']).toBe('HANDLE:99999');
    // READ step should have been called with the resolved target
    const readCall = callFn.mock.calls.find(c => c[2] === 'READ');
    expect(readCall).toBeDefined();
    expect(readCall![1]).toBe('HANDLE:99999');
  });

  it('LISTWINDOWS leaves {{hwnd}} unbound when no window matches', async () => {
    const callFn = jest.fn().mockResolvedValue({
      success: true,
      windows: [{ title: 'SomeOtherApp', hwnd: 555 }],
    });

    const result = await executeXmlScenario({
      scenario: makeScenario(
        [{ command: 'LISTWINDOWS', target: 'SYSTEM', parameter: '' }],
        { process: 'calc.exe', app: 'calculator' },
      ),
      callFn,
    });

    expect(result.vars['hwnd']).toBeUndefined();
  });

  it('LISTWINDOWS does not re-bind {{hwnd}} if already set (pre-bound param)', async () => {
    const callFn = jest.fn().mockResolvedValue({
      success: true,
      windows: [{ title: 'Calculator', hwnd: 99999 }],
    });

    const result = await executeXmlScenario({
      scenario: makeScenario(
        [{ command: 'LISTWINDOWS', target: 'SYSTEM', parameter: '' }],
        { process: 'calc.exe', app: 'calculator' },
      ),
      params: { hwnd: 'HANDLE:12345' }, // pre-bound by caller
      callFn,
    });

    expect(result.vars['hwnd']).toBe('HANDLE:12345'); // should NOT be overwritten
  });

  // ── conditional="absent" ──────────────────────────────────────────────────

  it('skips conditional=absent steps when {{hwnd}} is bound', async () => {
    const callFn = jest.fn().mockResolvedValue({ success: true });

    const result = await executeXmlScenario({
      scenario: makeScenario([
        { command: 'LAUNCH', target: 'calc.exe', parameter: '', conditional: 'absent' },
        { command: 'READ',   target: '{{hwnd}}', parameter: '' },
      ]),
      params: { hwnd: 'HANDLE:42' },
      callFn,
    });

    const launchStep = result.steps.find(s => s.command === 'LAUNCH');
    expect(launchStep?.skipped).toBe(true);
    expect(callFn).not.toHaveBeenCalledWith(expect.anything(), 'calc.exe', 'LAUNCH', '');
  });

  it('runs conditional=absent steps when {{hwnd}} is NOT bound', async () => {
    const callFn = jest.fn().mockResolvedValue({ success: true });

    const result = await executeXmlScenario({
      scenario: makeScenario([
        { command: 'LAUNCH', target: 'calc.exe', parameter: '', conditional: 'absent' },
      ]),
      callFn,
    });

    const launchStep = result.steps.find(s => s.command === 'LAUNCH');
    expect(launchStep?.skipped).toBeUndefined();
    expect(launchStep?.success).toBe(true);
  });

  // ── Regular command dispatch ───────────────────────────────────────────────

  it('passes helper/target/command/parameter to callFn correctly', async () => {
    const callFn = jest.fn().mockResolvedValue({ success: true, value: 'hello' });

    await executeXmlScenario({
      scenario: makeScenario(
        [{ command: 'READ', target: 'HANDLE:777', parameter: '' }],
        { helper: 'KeyWin.exe' },
      ),
      callFn,
    });

    expect(callFn).toHaveBeenCalledWith('KeyWin.exe', 'HANDLE:777', 'READ', '');
  });

  it('records returned value from a READ-like command', async () => {
    const callFn = jest.fn().mockResolvedValue({ success: true, value: '42' });
    const result = await executeXmlScenario({
      scenario: makeScenario([{ command: 'READ', target: 'SYSTEM', parameter: '' }]),
      callFn,
    });
    expect(result.steps[0].value).toBe('42');
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  it('records failure when callFn returns success:false', async () => {
    const callFn = jest.fn().mockResolvedValue({ success: false, error: 'element not found' });
    const result = await executeXmlScenario({
      scenario: makeScenario([{ command: 'CLICKID', target: 'HANDLE:1', parameter: 'btnOk' }]),
      callFn,
    });
    expect(result.success).toBe(false);
    expect(result.failedSteps).toBe(1);
    expect(result.steps[0].error).toBe('element not found');
  });

  it('records failure when callFn throws', async () => {
    const callFn = jest.fn().mockRejectedValue(new Error('helper crashed'));
    const result = await executeXmlScenario({
      scenario: makeScenario([{ command: 'READ', target: 'HANDLE:1', parameter: '' }]),
      callFn,
    });
    expect(result.success).toBe(false);
    expect(result.steps[0].error).toBe('helper crashed');
  });

  it('continues executing remaining steps after a failure', async () => {
    const callFn = jest.fn()
      .mockResolvedValueOnce({ success: false, error: 'step 1 failed' })
      .mockResolvedValueOnce({ success: true });

    const result = await executeXmlScenario({
      scenario: makeScenario([
        { command: 'READ', target: 'SYSTEM', parameter: '' },
        { command: 'READ', target: 'SYSTEM', parameter: '' },
      ]),
      callFn,
    });

    expect(result.totalSteps).toBe(2);
    expect(result.failedSteps).toBe(1);
    expect(callFn).toHaveBeenCalledTimes(2); // both steps attempted
  });

  // ── Result aggregation ────────────────────────────────────────────────────

  it('result.success is true when all steps succeed', async () => {
    const callFn = jest.fn().mockResolvedValue({ success: true });
    const result = await executeXmlScenario({
      scenario: makeScenario([
        { command: 'READ', target: 'A', parameter: '' },
        { command: 'READ', target: 'B', parameter: '' },
      ]),
      callFn,
    });
    expect(result.success).toBe(true);
    expect(result.failedSteps).toBe(0);
    expect(result.totalSteps).toBe(2);
  });

  it('result includes scenario metadata', async () => {
    const result = await executeXmlScenario({
      scenario: makeScenario([], { id: 'my-id', label: 'My Label', app: 'myapp' }),
      callFn: jest.fn(),
    });
    expect(result.scenarioId).toBe('my-id');
    expect(result.label).toBe('My Label');
    expect(result.app).toBe('myapp');
  });
});

// ── XmlScenarioLoader.load / listScenarios (filesystem) ───────────────────────

const MINIMAL_SCENARIOS_XML = `<?xml version="1.0" encoding="utf-8"?>
<ScenarioLibrary app="testapp" helper="KeyWin.exe" process="testapp.exe">
  <Scenario id="intro" label="Start App">
    <Steps>
      <Step command="LISTWINDOWS" target="SYSTEM" parameter="" />
      <Step command="LAUNCH"      target="testapp.exe" parameter="" conditional="absent" />
    </Steps>
  </Scenario>
  <Scenario id="do-work" label="Do Work">
    <Steps>
      <ScenarioRef ref="intro" />
      <Step command="READ" target="{{hwnd}}" parameter="" />
    </Steps>
  </Scenario>
</ScenarioLibrary>`;

describe('XmlScenarioLoader (file system)', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xmlscenario-test-'));
    fs.mkdirSync(path.join(tmpDir, 'testapp'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'testapp', 'scenarios.xml'), MINIMAL_SCENARIOS_XML, 'utf-8');
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('listScenarios returns app metadata and scenario ids', () => {
    const loader = new XmlScenarioLoader(tmpDir);
    const info = loader.listScenarios('testapp');
    expect(info.app).toBe('testapp');
    expect(info.helper).toBe('KeyWin.exe');
    expect(info.scenarios.map(s => s.id)).toEqual(['intro', 'do-work']);
  });

  it('load resolves a flat scenario', () => {
    const loader = new XmlScenarioLoader(tmpDir);
    const scenario = loader.load('testapp', 'intro');
    expect(scenario.id).toBe('intro');
    expect(scenario.steps.length).toBe(2);
    expect(scenario.steps[0].command).toBe('LISTWINDOWS');
    expect(scenario.steps[1].conditional).toBe('absent');
  });

  it('load expands ScenarioRef recursively into flat steps', () => {
    const loader = new XmlScenarioLoader(tmpDir);
    const scenario = loader.load('testapp', 'do-work');
    // "do-work" → ScenarioRef("intro") + READ
    // "intro" has 2 steps → total should be 3 steps
    expect(scenario.steps.length).toBe(3);
    expect(scenario.steps[0].command).toBe('LISTWINDOWS'); // from intro
    expect(scenario.steps[1].command).toBe('LAUNCH');      // from intro
    expect(scenario.steps[2].command).toBe('READ');        // do-work's own step
  });

  it('load throws for unknown app', () => {
    const loader = new XmlScenarioLoader(tmpDir);
    expect(() => loader.load('nonexistent', 'any')).toThrow('scenarios.xml not found');
  });

  it('load throws for unknown scenarioId', () => {
    const loader = new XmlScenarioLoader(tmpDir);
    expect(() => loader.load('testapp', 'no-such-scenario')).toThrow('not found');
  });

  it('detects circular ScenarioRef', () => {
    // Write a circular scenario file
    const circularXml = `<?xml version="1.0" encoding="utf-8"?>
<ScenarioLibrary>
  <Scenario id="a" label="A">
    <Steps><ScenarioRef ref="b" /></Steps>
  </Scenario>
  <Scenario id="b" label="B">
    <Steps><ScenarioRef ref="a" /></Steps>
  </Scenario>
</ScenarioLibrary>`;
    const circularDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xmlcirc-'));
    fs.mkdirSync(path.join(circularDir, 'circ'), { recursive: true });
    fs.writeFileSync(path.join(circularDir, 'circ', 'scenarios.xml'), circularXml, 'utf-8');
    try {
      const loader = new XmlScenarioLoader(circularDir);
      expect(() => loader.load('circ', 'a')).toThrow(/[Cc]ircular/);
    } finally {
      fs.rmSync(circularDir, { recursive: true, force: true });
    }
  });
});
