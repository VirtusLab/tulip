import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "../process/exec.js";

/** Runs a `gh` subcommand (e.g. `["pr", "view", ...]`) and returns its stdout. Mockable in tests. */
export type CommandRunner = (args: string[]) => Promise<string>;

/** Invokes the `gh` binary on PATH. The default {@link CommandRunner} for the gh wrappers. */
export const defaultRunGh: CommandRunner = (args) => runCommand("gh", args);

export interface GhApiRequest {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  jq?: string;
}

export type GhApi = (endpoint: string, request?: GhApiRequest) => Promise<string>;

export class GhApiError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
  ) {
    super(message);
    this.name = "GhApiError";
  }
}

export function ghApi(host: string, runGh: CommandRunner = defaultRunGh): GhApi {
  const call = async (args: string[]) => {
    try {
      return (await runGh(args)).trim();
    } catch (error) {
      throw toGhApiError(error);
    }
  };
  return async (endpoint, request = {}) => {
    const args = ["api", "--hostname", host, "--method", request.method ?? "GET", endpoint];
    if (request.jq !== undefined) {
      args.push("--jq", request.jq);
    }
    if (request.body === undefined) {
      return call(args);
    }
    // A file rather than `-f` fields: a body can be megabytes, past ARG_MAX.
    const dir = await mkdtemp(join(tmpdir(), "tulip-gh-"));
    try {
      const input = join(dir, "body.json");
      await writeFile(input, JSON.stringify(request.body), "utf8");
      return await call([...args, "--input", input]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

export async function ghGraphql<T>(
  api: GhApi,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  return JSON.parse(
    await api("graphql", { method: "POST", body: { query, variables }, jq: ".data" }),
  ) as T;
}

const HTTP_STATUS = /\(HTTP (\d{3})\)$/;

/** gh reports a failed request on stderr as `gh: <message> (HTTP <status>)`. */
function toGhApiError(error: unknown): Error {
  const stderr = (error as { stderr?: unknown }).stderr;
  if (typeof stderr !== "string" || stderr.trim() === "") {
    return error instanceof Error ? error : new Error(String(error));
  }
  // gh can print a hint (e.g. a missing token scope) after the failure line.
  const lines = stderr.trim().split("\n");
  const line = lines.find((candidate) => HTTP_STATUS.test(candidate)) ?? (lines.at(-1) as string);
  const status = HTTP_STATUS.exec(line)?.[1];
  return new GhApiError(
    line.replace(/^gh: /, ""),
    status === undefined ? undefined : Number(status),
  );
}
