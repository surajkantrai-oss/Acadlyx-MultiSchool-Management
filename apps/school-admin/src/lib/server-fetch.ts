import 'server-only';
import http from 'node:http';
import https from 'node:https';

/**
 * Minimal server-side `fetch` built on node:http(s).
 *
 * Why: Node's built-in fetch (undici) silently drops a caller-supplied `Host` header, but the
 * School Admin server must forward the browser's Host so the API resolves the school exactly as
 * it would for a direct request (tenant resolution is Host-based). This is the real request Host
 * — not a trusted internal header — and the API still validates it against TenantDomain.
 * Supports what the api-client uses: method, headers, string body, AbortSignal.
 */
export const hostForwardingFetch: typeof fetch = (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const transport = url.protocol === 'https:' ? https : http;
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  const body = typeof init.body === 'string' ? init.body : undefined;

  return new Promise<Response>((resolve, reject) => {
    const req = transport.request(
      url,
      { method: init.method ?? 'GET', headers, signal: init.signal ?? undefined },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(res.headers)) {
            if (typeof value === 'string') responseHeaders.set(name, value);
          }
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 500,
              headers: responseHeaders,
            }),
          );
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
};
