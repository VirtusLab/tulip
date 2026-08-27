import { describe, expect, it } from "vitest";
import { splitCategoryMarkdown } from "./sections.js";

describe("splitCategoryMarkdown", () => {
  it("splits Production/Test subsections in order", () => {
    const result = splitCategoryMarkdown(
      "## Production code\n\nProd body.\n\n## Test code\n\nTest body.\n",
    );
    expect(result.intro).toBe("");
    expect(result.subsections).toEqual([
      { kind: "production", heading: "Production code", markdown: "\n\nProd body.\n\n" },
      { kind: "test", heading: "Test code", markdown: "\n\nTest body.\n" },
    ]);
  });

  it("is case-insensitive and order-independent", () => {
    const result = splitCategoryMarkdown("## test code\nT\n## production code\nP\n");
    expect(result.subsections.map((s) => s.kind)).toEqual(["test", "production"]);
  });

  it("keeps text before the first heading as intro", () => {
    const result = splitCategoryMarkdown("Some lead-in.\n\n## Production code\n\nBody.\n");
    expect(result.intro).toBe("Some lead-in.\n\n");
    expect(result.subsections).toHaveLength(1);
  });

  it("treats markdown with no recognized headings as intro-only", () => {
    const result = splitCategoryMarkdown("Just prose, no headings at all.");
    expect(result.intro).toBe("Just prose, no headings at all.");
    expect(result.subsections).toEqual([]);
  });

  it("does not match a heading that isn't on its own line or has extra text", () => {
    const result = splitCategoryMarkdown("Some text ## Production code more text\n");
    expect(result.subsections).toEqual([]);
  });
});
