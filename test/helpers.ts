export interface RecordedCall {
  url: URL;
  method: string;
  /** Parsed JSON body, FormData instance, or undefined. */
  body: unknown;
}

export type Responder = (call: RecordedCall) => unknown | Promise<unknown>;

/**
 * A fake `fetch` that records each call and lets the test decide the response.
 * Returning a `Response` uses it verbatim; any other value is sent as JSON.
 */
export function mockFetch(responder: Responder) {
  const calls: RecordedCall[] = [];
  const fetchImpl = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    let body: unknown;
    if (typeof init.body === "string") {
      body = JSON.parse(init.body);
    } else if (init.body instanceof FormData) {
      body = init.body;
    }
    const call: RecordedCall = { url, method: (init.method ?? "GET").toUpperCase(), body };
    calls.push(call);
    const result = await responder(call);
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetchImpl as typeof fetch, calls };
}

/** Routes fake requests by WeChat API path, e.g. `/cgi-bin/draft/add`. */
export function routeFetch(routes: Record<string, Responder>) {
  return mockFetch((call) => {
    const handler = routes[call.url.pathname];
    if (!handler) throw new Error(`Unexpected request to ${call.url.pathname}`);
    return handler(call);
  });
}

export const TOKEN_ROUTE = {
  "/cgi-bin/stable_token": () => ({ access_token: "TOKEN", expires_in: 7200 }),
};

/** Smallest valid PNG (1x1 transparent pixel). */
export const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
