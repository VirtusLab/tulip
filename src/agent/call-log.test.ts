import { readFile, rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createLogger } from "../logging/logger.js";
import { createCallLog } from "./call-log.js";

describe("createCallLog", () => {
  it("appends each record as a timestamped JSON line", async () => {
    const now = () => new Date("2026-01-02T03:04:05.000Z");
    const log = createCallLog(createLogger({ write: () => {} }), now);
    try {
      log.record({ type: "end", ok: false, wallMs: 1, error: "boom" });
      log.record({ type: "end", ok: true, wallMs: 2 });

      const lines = (await readFile(log.path, "utf8")).trimEnd().split("\n");
      expect(lines.map((line) => JSON.parse(line))).toEqual([
        { time: "2026-01-02T03:04:05.000Z", type: "end", ok: false, wallMs: 1, error: "boom" },
        { time: "2026-01-02T03:04:05.000Z", type: "end", ok: true, wallMs: 2 },
      ]);
    } finally {
      await rm(log.path, { force: true });
    }
  });
});
