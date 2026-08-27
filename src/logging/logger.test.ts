import { describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger.js";

const FIXED_NOW = () => new Date("2026-01-02T03:04:05.000Z");

describe("createLogger", () => {
  it("prefixes info messages with a timestamp and level", () => {
    const write = vi.fn();
    const logger = createLogger({ now: FIXED_NOW, write });

    logger.info("starting phase 1");

    expect(write).toHaveBeenCalledWith("[2026-01-02T03:04:05.000Z] [INFO] starting phase 1");
  });

  it("suppresses debug messages by default", () => {
    const write = vi.fn();
    const logger = createLogger({ now: FIXED_NOW, write });

    logger.debug("verbose detail");

    expect(write).not.toHaveBeenCalled();
  });

  it("emits debug messages when verbose is enabled", () => {
    const write = vi.fn();
    const logger = createLogger({ now: FIXED_NOW, write, verbose: true });

    logger.debug("verbose detail");

    expect(write).toHaveBeenCalledWith("[2026-01-02T03:04:05.000Z] [DEBUG] verbose detail");
  });

  it("always emits info messages, even when verbose is enabled", () => {
    const write = vi.fn();
    const logger = createLogger({ now: FIXED_NOW, write, verbose: true });

    logger.info("starting phase 1");

    expect(write).toHaveBeenCalledOnce();
  });

  it("defaults to the system clock and console.log", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createLogger();

    logger.info("hello");

    expect(logSpy).toHaveBeenCalledOnce();
    expect(logSpy.mock.calls[0]?.[0]).toMatch(
      /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[INFO\] hello$/,
    );
    logSpy.mockRestore();
  });
});
