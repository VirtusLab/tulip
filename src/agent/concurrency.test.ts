import { describe, expect, it } from "vitest";
import { createConcurrencyLimiter } from "./concurrency.js";

describe("createConcurrencyLimiter", () => {
  it("never runs more than `limit` calls concurrently", async () => {
    const limiter = createConcurrencyLimiter(3);
    let inFlight = 0;
    let peak = 0;

    const task = () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      return new Promise<void>((resolve) => setTimeout(resolve, 5)).then(() => {
        inFlight--;
      });
    };

    await Promise.all(Array.from({ length: 10 }, () => limiter.run(task)));

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBe(3); // with 10 tasks and a cap of 3, the cap should actually be hit
  });

  it("admits queued work in FIFO order", async () => {
    const limiter = createConcurrencyLimiter(1);
    const order: number[] = [];

    const runs = [1, 2, 3].map((id) =>
      limiter.run(async () => {
        order.push(id);
      }),
    );
    await Promise.all(runs);

    expect(order).toEqual([1, 2, 3]);
  });

  it("releases the slot even when the task rejects", async () => {
    const limiter = createConcurrencyLimiter(1);

    await expect(
      limiter.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // If the slot weren't released, this would hang forever.
    await expect(limiter.run(async () => "ok")).resolves.toBe("ok");
  });
});
