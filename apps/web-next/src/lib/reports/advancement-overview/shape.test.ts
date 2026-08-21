import { describe, expect, it } from "vitest";
import { barFill, pct, usd } from "./shape";

describe("advancement overview shape", () => {
  it("formats money and percents", () => {
    expect(usd(20180242)).toBe("$20,180,242");
    expect(usd(-13297404)).toBe("-$13,297,404");
    expect(usd(null)).toBe("—");
    expect(pct(126, 0)).toBe("126%");
    expect(pct(-46.8)).toBe("-46.8%");
  });

  it("clamps bar fill to 0–100", () => {
    expect(barFill(36)).toBe(36);
    expect(barFill(169)).toBe(100);
    expect(barFill(-4)).toBe(0);
    expect(barFill(null)).toBe(0);
  });
});
