/**
 * Performance tests for MCPServer
 * Measures throughput, latency (p50/p95/p99), and error rate under load.
 * These are deterministic (no real binaries needed) and run in-process.
 */
import * as net from 'net';
import * as http from 'http';
import { MCPServer } from './mcpServer';

jest.setTimeout(60_000);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.listen(0, '127.0.0.1', () => {
            const addr = srv.address() as net.AddressInfo;
            srv.close(() => resolve(addr.port));
        });
        srv.on('error', reject);
    });
}

function httpPost(port: number, body: string): Promise<{ status: number; body: string; durationMs: number }> {
    const t0 = Date.now();
    return new Promise((resolve, reject) => {
        const buf = Buffer.from(body, 'utf8');
        const req = http.request(
            {
                hostname: '127.0.0.1',
                port,
                path: '/',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': buf.length,
                },
            },
            (res) => {
                let data = '';
                res.on('data', (c) => (data += c));
                res.on('end', () =>
                    resolve({ status: res.statusCode ?? 0, body: data, durationMs: Date.now() - t0 })
                );
            }
        );
        req.on('error', reject);
        req.write(buf);
        req.end();
    });
}

function rpcBody(method: string, params: unknown, id: number): string {
    return JSON.stringify({ jsonrpc: '2.0', id, method, params });
}

function percentile(sortedMs: number[], p: number): number {
    const idx = Math.max(0, Math.ceil((p / 100) * sortedMs.length) - 1);
    return sortedMs[idx];
}

// ─── Test suite ──────────────────────────────────────────────────────────────

describe('MCPServer – performance', () => {
    let port: number;
    let srv: MCPServer;

    beforeAll(async () => {
        port = await getFreePort();
        srv = new MCPServer(undefined, port);
        await srv.start();
    }, 15_000);

    afterAll(async () => {
        await srv.stop();
        // Suppress fs.watchFile handle that would keep jest open
        const fs = require('fs') as typeof import('fs');
        try {
            const settingsPath = (srv as any).settingsPath as string;
            if (settingsPath) fs.unwatchFile(settingsPath);
        } catch { /* ignore */ }
    }, 10_000);

    // ── Serial baseline ──────────────────────────────────────────────────────

    it('50 serial initialize calls complete in < 5 s with 0 errors', async () => {
        const N = 50;
        const durations: number[] = [];
        let errors = 0;

        for (let i = 0; i < N; i++) {
            const res = await httpPost(
                port,
                rpcBody('initialize', { protocolVersion: '2024-11-05', capabilities: {} }, i + 1)
            );
            if (res.status !== 200) errors++;
            durations.push(res.durationMs);
        }

        durations.sort((a, b) => a - b);
        const p50 = percentile(durations, 50);
        const p95 = percentile(durations, 95);
        const total = durations.reduce((s, v) => s + v, 0);

        console.log(`Serial N=${N}: total=${total}ms  p50=${p50}ms  p95=${p95}ms`);

        expect(errors).toBe(0);
        expect(total).toBeLessThan(5_000);
        expect(p95).toBeLessThan(200);  // each request < 200 ms at p95
    });

    // ── Concurrency ──────────────────────────────────────────────────────────

    it('20 concurrent tools/list calls → all succeed', async () => {
        const N = 20;
        const results = await Promise.all(
            Array.from({ length: N }, (_, i) =>
                httpPost(port, rpcBody('tools/list', {}, i + 1))
            )
        );

        const statuses = results.map((r) => r.status);
        expect(statuses.every((s) => s === 200)).toBe(true);

        const parsed = results.map((r) => JSON.parse(r.body));
        expect(parsed.every((p) => !p.error)).toBe(true);
        expect(parsed.every((p) => Array.isArray(p.result?.tools))).toBe(true);
    });

    it('50 concurrent initialize calls → 0 errors, p99 < 500 ms', async () => {
        const N = 50;
        const results = await Promise.all(
            Array.from({ length: N }, (_, i) =>
                httpPost(
                    port,
                    rpcBody('initialize', { protocolVersion: '2024-11-05', capabilities: {} }, i + 100)
                )
            )
        );

        const errors = results.filter((r) => r.status !== 200).length;
        const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);
        const p99 = percentile(durations, 99);

        console.log(`Concurrent N=${N}: p50=${percentile(durations, 50)}ms  p99=${p99}ms`);

        expect(errors).toBe(0);
        expect(p99).toBeLessThan(500);
    });

    it('100 concurrent mixed calls (initialize + tools/list) → 0 errors', async () => {
        const N = 100;
        const calls = Array.from({ length: N }, (_, i) => {
            const method = i % 2 === 0 ? 'initialize' : 'tools/list';
            const params = i % 2 === 0 ? { protocolVersion: '2024-11-05', capabilities: {} } : {};
            return httpPost(port, rpcBody(method, params, i + 200));
        });

        const results = await Promise.all(calls);
        const errors   = results.filter((r) => r.status !== 200).length;
        const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);

        console.log(
            `Mixed N=${N}: p50=${percentile(durations, 50)}ms  p95=${percentile(durations, 95)}ms`
        );

        expect(errors).toBe(0);
    });

    // ── JSON-RPC id preservation under load ──────────────────────────────────

    it('response ids match request ids under concurrent load', async () => {
        const N = 30;
        const results = await Promise.all(
            Array.from({ length: N }, (_, i) =>
                httpPost(port, rpcBody('initialize', { protocolVersion: '2024-11-05', capabilities: {} }, i + 300))
            )
        );

        for (let i = 0; i < N; i++) {
            const parsed = JSON.parse(results[i].body);
            expect(parsed.id).toBe(i + 300);
        }
    });

    // ── Error-path performance ───────────────────────────────────────────────

    it('50 concurrent unknown-method calls → all return -32601, fast', async () => {
        const N = 50;
        const results = await Promise.all(
            Array.from({ length: N }, (_, i) =>
                httpPost(port, rpcBody('nonexistent/method', {}, i + 400))
            )
        );

        const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);
        const errors = results
            .map((r) => JSON.parse(r.body))
            .filter((p) => p.error?.code !== -32601);

        console.log(
            `Errors-under-load N=${N}: p50=${percentile(durations, 50)}ms  p95=${percentile(durations, 95)}ms`
        );

        expect(errors.length).toBe(0);
        expect(percentile(durations, 95)).toBeLessThan(300);
    });

    // ── Memory stability ─────────────────────────────────────────────────────

    it('memory does not grow >20 MB over 200 serial requests', async () => {
        if (global.gc) global.gc();
        const memBefore = process.memoryUsage().heapUsed;

        for (let i = 0; i < 200; i++) {
            await httpPost(
                port,
                rpcBody('tools/list', {}, i + 500)
            );
        }

        if (global.gc) global.gc();
        const memAfter = process.memoryUsage().heapUsed;
        const growthMB = (memAfter - memBefore) / (1024 * 1024);
        console.log(`Memory growth over 200 serial requests: ${growthMB.toFixed(2)} MB`);

        // 20 MB is a generous allowance for V8 heap fluctuations
        expect(growthMB).toBeLessThan(20);
    });
});
