import { describe, expect, it, vi } from "vitest";
import { config } from "../config.js";
import { bearerAuthHeaders, getJson, getText, HttpStatusError } from "./http.js";

const TEST_URL = "https://api.example.test/x";

describe("getText", () => {
  it("returns the body, sending the given headers and an abort signal", async () => {
    const fetchUrl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("X-Test")).toBe("1");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response("hello");
    });

    await expect(
      getText(fetchUrl as unknown as typeof fetch, TEST_URL, { "X-Test": "1" }, "GitLab"),
    ).resolves.toBe("hello");
  });

  it("throws an HttpStatusError naming the API, status and URL on a non-2xx response", async () => {
    const fetchUrl = vi.fn(async () => new Response("nope", { status: 404 }));

    const error = await getText(fetchUrl as unknown as typeof fetch, TEST_URL, {}, "GitLab").catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(HttpStatusError);
    expect((error as HttpStatusError).status).toBe(404);
    expect((error as Error).message).toBe(`GitLab API returned 404 for ${TEST_URL}`);
  });

  it("reports a timeout with the configured limit", async () => {
    const fetchUrl = vi.fn(async () => {
      const error = new Error("The operation was aborted due to timeout");
      error.name = "TimeoutError";
      throw error;
    });

    await expect(
      getText(fetchUrl as unknown as typeof fetch, TEST_URL, {}, "GitHub"),
    ).rejects.toThrow(
      `GitHub API request timed out after ${config.timeouts.apiFetchMs}ms: ${TEST_URL}`,
    );
  });

  it("reports a timeout that fires while the body is downloading", async () => {
    const fetchUrl = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              const error = new Error("aborted");
              error.name = "TimeoutError";
              controller.error(error);
            },
          }),
        ),
    );

    await expect(
      getText(fetchUrl as unknown as typeof fetch, TEST_URL, {}, "GitHub"),
    ).rejects.toThrow(
      `GitHub API request timed out after ${config.timeouts.apiFetchMs}ms: ${TEST_URL}`,
    );
  });

  it("rethrows a non-timeout fetch failure unchanged", async () => {
    const failure = new TypeError("fetch failed");
    const fetchUrl = vi.fn(async () => {
      throw failure;
    });

    await expect(getText(fetchUrl as unknown as typeof fetch, TEST_URL, {}, "GitHub")).rejects.toBe(
      failure,
    );
  });
});

describe("getJson", () => {
  it("parses the body as JSON", async () => {
    const fetchUrl = vi.fn(async () => new Response('{"a":1}'));

    await expect(
      getJson<{ a: number }>(fetchUrl as unknown as typeof fetch, TEST_URL, {}, "GitHub"),
    ).resolves.toEqual({ a: 1 });
  });

  it("names the API and URL when the body is not JSON", async () => {
    const fetchUrl = vi.fn(async () => new Response("<html>sign in</html>"));

    const error = await getJson(fetchUrl as unknown as typeof fetch, TEST_URL, {}, "GitLab").catch(
      (e: unknown) => e,
    );

    expect((error as Error).message).toBe(`GitLab API returned invalid JSON for ${TEST_URL}`);
    expect((error as Error).cause).toBeInstanceOf(SyntaxError);
  });
});

describe("bearerAuthHeaders", () => {
  it.each([undefined, ""])("returns no headers for %j", (token) => {
    expect(bearerAuthHeaders(token, "X_TOKEN")).toEqual({});
  });

  it("returns a Bearer Authorization header for a valid token", () => {
    expect(bearerAuthHeaders("ghp_abcd", "X_TOKEN")).toEqual({ Authorization: "Bearer ghp_abcd" });
  });

  it("rejects a malformed token, naming the variable but never echoing the value", () => {
    let message = "";
    try {
      bearerAuthHeaders("ghp_ab\ncd", "X_TOKEN");
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toBe(
      "X_TOKEN contains characters that can't be sent in an HTTP header (such as whitespace or a line break); check its value",
    );
    expect(message).not.toContain("ghp_ab");
  });
});
