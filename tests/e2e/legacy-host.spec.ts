import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { expect, test } from '@playwright/test';

/**
 * The old host, against the real server: page routes on mcpwn.dev are sent to
 * mcproof.dev, and /api/mcp/* on mcpwn.dev is answered where it is, so a run
 * issued before the rename keeps its endpoint. Sent with node:http so the Host
 * header is exactly what a request to the old domain carries.
 */
const PORT = Number(process.env.PORT ?? 3000);

function send(method: 'GET' | 'POST', path: string, host: string) {
  return new Promise<{
    status: number;
    location: string | undefined;
    headers: IncomingHttpHeaders;
  }>((resolve, reject) => {
    const req = httpRequest(
      {
        host: 'localhost',
        port: PORT,
        path,
        method,
        headers: {
          host,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
      },
      (res) => {
        res.resume();
        resolve({
          status: res.statusCode ?? 0,
          location: res.headers.location,
          headers: res.headers,
        });
      },
    );
    req.on('error', reject);
    if (method === 'POST')
      req.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
    req.end();
  });
}

test.describe('the old host', () => {
  test('sends a page route on mcpwn.dev to the same path on mcproof.dev', async () => {
    const home = await send('GET', '/', 'mcpwn.dev');
    const connect = await send('GET', '/connect?x=1', 'mcpwn.dev');

    expect(home.status).toBe(308);
    expect(home.location).toBe('https://mcproof.dev/');
    expect(connect.status).toBe(308);
    expect(connect.location).toBe('https://mcproof.dev/connect?x=1');
  });

  test('answers /api/mcp/* on mcpwn.dev itself, with no redirect', async () => {
    const res = await send('POST', '/api/mcp/2b1c0e4a-0000-4000-8000-000000000001', 'mcpwn.dev');

    expect([301, 302, 303, 307, 308]).not.toContain(res.status);
    expect(res.location).toBeUndefined();
  });

  // Security lane S3: the old endpoint is answered with the base security headers
  // and none of the page policies, exactly like the endpoint on the new host.
  test('answers the old endpoint with the base headers and no page policy', async () => {
    const { headers } = await send(
      'POST',
      '/api/mcp/2b1c0e4a-0000-4000-8000-000000000001',
      'mcpwn.dev',
    );

    expect(headers['strict-transport-security']).toBe('max-age=63072000; includeSubDomains');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-powered-by']).toBeUndefined();
    expect(headers['cross-origin-resource-policy']).toBeUndefined();
    expect(headers['cross-origin-opener-policy']).toBeUndefined();
    expect(headers['content-security-policy-report-only']).toBeUndefined();
  });

  test('leaves every other host alone', async () => {
    const res = await send('GET', '/connect', 'localhost');

    expect(res.status).toBe(200);
    expect(res.location).toBeUndefined();
  });
});
