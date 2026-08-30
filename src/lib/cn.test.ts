import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("joins class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false && "b", undefined, null, "c")).toBe("a c");
  });

  it("lets the later Tailwind utility win", () => {
    expect(cn("p-2", "p-6")).toBe("p-6");
    expect(cn("text-muted", "text-ink")).toBe("text-ink");
  });
});
