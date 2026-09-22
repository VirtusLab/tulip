import { describe, expect, it } from "vitest";
import { formatDuration, startTimer } from "./duration.js";

describe("formatDuration", () => {
  it("prints whole seconds under a minute, rounding to nearest", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(400)).toBe("0s");
    expect(formatDuration(44_600)).toBe("45s");
    expect(formatDuration(59_400)).toBe("59s");
  });

  it("prints unpadded minutes and seconds under an hour", () => {
    expect(formatDuration(63_000)).toBe("1m3s");
    expect(formatDuration(12 * 60_000)).toBe("12m0s");
    expect(formatDuration(59 * 60_000 + 59_000)).toBe("59m59s");
  });

  it("rolls 59.5s and above into the next minute", () => {
    expect(formatDuration(59_600)).toBe("1m0s");
  });

  it("prints hours and minutes from an hour up", () => {
    expect(formatDuration(62 * 60_000)).toBe("1h2m");
    expect(formatDuration(3 * 3_600_000)).toBe("3h0m");
  });
});

describe("startTimer", () => {
  it("formats the time elapsed since the timer was started", () => {
    let now = 1_000;
    const elapsed = startTimer(() => now);

    now += 63_000;

    expect(elapsed()).toBe("1m3s");
  });
});
