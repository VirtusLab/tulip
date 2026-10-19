import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { GhApiError, ghApi, ghGraphql } from "./gh.js";

describe("ghApi", () => {
  it("passes the host, method, endpoint and jq filter, and trims the output", async () => {
    const runGh = vi.fn(async () => "value\n");

    await expect(ghApi("ghe.example.com", runGh)("repos/o/r", { jq: ".x" })).resolves.toBe("value");
    expect(runGh).toHaveBeenCalledWith([
      "api",
      "--hostname",
      "ghe.example.com",
      "--method",
      "GET",
      "repos/o/r",
      "--jq",
      ".x",
    ]);
  });

  it("sends a body as an --input file", async () => {
    let sent: unknown;
    const runGh = vi.fn(async (args: string[]) => {
      sent = JSON.parse(await readFile(args[args.indexOf("--input") + 1] as string, "utf8"));
      return "";
    });

    await ghApi("github.com", runGh)("repos/o/r/git/refs", { method: "POST", body: { a: 1 } });

    expect(sent).toEqual({ a: 1 });
  });

  it("turns gh's failure line into a GhApiError with the HTTP status", async () => {
    const runGh = vi.fn(async () => {
      throw Object.assign(new Error("Command failed"), {
        stderr: "gh: Reference already exists (HTTP 422)\n",
      });
    });

    const error = await ghApi("github.com", runGh)("x").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GhApiError);
    expect(error).toMatchObject({ message: "Reference already exists (HTTP 422)", status: 422 });
  });

  it("finds the status when gh prints a hint after it", async () => {
    const runGh = vi.fn(async () => {
      throw Object.assign(new Error("Command failed"), {
        stderr:
          'gh: Not Found (HTTP 404)\nThis API operation needs the "repo" scope. To request it, run:  gh auth refresh -s repo\n',
      });
    });

    await expect(ghApi("github.com", runGh)("x")).rejects.toMatchObject({
      message: "Not Found (HTTP 404)",
      status: 404,
    });
  });

  it("keeps the original error when gh printed nothing, e.g. when it was interrupted", async () => {
    const interrupted = Object.assign(new Error("Command failed: gh api x"), { stderr: "" });
    const runGh = vi.fn(async () => {
      throw interrupted;
    });

    await expect(ghApi("github.com", runGh)("x")).rejects.toBe(interrupted);
  });

  it("leaves the status unset when gh reports none", async () => {
    const runGh = vi.fn(async () => {
      throw Object.assign(new Error("Command failed"), { stderr: "GraphQL: Something broke\n" });
    });

    await expect(ghApi("github.com", runGh)("graphql")).rejects.toMatchObject({
      message: "GraphQL: Something broke",
      status: undefined,
    });
  });
});

describe("ghGraphql", () => {
  it("posts the query and variables and returns the data", async () => {
    let sent: unknown;
    const runGh = vi.fn(async (args: string[]) => {
      sent = JSON.parse(await readFile(args[args.indexOf("--input") + 1] as string, "utf8"));
      return '{"viewer":{"login":"me"}}';
    });

    const data = await ghGraphql(ghApi("github.com", runGh), "query { viewer { login } }", {});

    expect(data).toEqual({ viewer: { login: "me" } });
    expect(sent).toEqual({ query: "query { viewer { login } }", variables: {} });
    expect(runGh.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining(["--method", "POST", "graphql", "--jq", ".data"]),
    );
  });
});
