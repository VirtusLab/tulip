import { config } from "../config.js";

/** A non-2xx response from a forge's REST API. `status` lets a caller add a hint for specific
 * codes (e.g. GitLab's 404 for a private project). */
export class HttpStatusError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpStatusError";
    this.status = status;
  }
}

/** GETs `url` and returns the body. `apiName` ("GitHub", "GitLab") names the API in errors. Times
 * out after {@link config}.timeouts.apiFetchMs; throws {@link HttpStatusError} on a non-2xx
 * status. */
export async function getText(
  fetchUrl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  apiName: string,
): Promise<string> {
  try {
    const response = await fetchUrl(url, {
      headers,
      signal: AbortSignal.timeout(config.timeouts.apiFetchMs),
    });
    if (!response.ok) {
      throw new HttpStatusError(
        `${apiName} API returned ${response.status} for ${url}`,
        response.status,
      );
    }
    return await response.text();
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(
        `${apiName} API request timed out after ${config.timeouts.apiFetchMs}ms: ${url}`,
      );
    }
    throw error;
  }
}

/** {@link getText}, parsed as JSON. */
export async function getJson<T>(
  fetchUrl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  apiName: string,
): Promise<T> {
  const text = await getText(fetchUrl, url, headers, apiName);
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${apiName} API returned invalid JSON for ${url}`, { cause: error });
    }
    throw error;
  }
}

/** `Authorization: Bearer` header for `token`, or none when it is unset or empty. Bearer survives
 * a cross-origin redirect safely (fetch strips Authorization there). Throws on a token that can't
 * be a header value, because fetch's own rejection message would contain the token; the message
 * names `envName` and never echoes the value. */
export function bearerAuthHeaders(
  token: string | undefined,
  envName: string,
): Record<string, string> {
  if (!token) {
    return {};
  }
  if (!/^[\x21-\x7E]+$/.test(token)) {
    throw new Error(
      `${envName} contains characters that can't be sent in an HTTP header (such as whitespace or a line break); check its value`,
    );
  }
  return { Authorization: `Bearer ${token}` };
}
