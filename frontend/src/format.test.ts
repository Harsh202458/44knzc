import { describe, expect, it } from "vitest";
import { buildUrl } from "./api";
import { addDays, compactMW, fmtGW, fmtSignedGW, fmtTime, HALF_HOURS, toCsv } from "./format";

describe("format helpers", () => {
  it("formats power", () => {
    expect(fmtGW(12345)).toBe("12.3 GW");
    expect(fmtGW(null)).toBe("–");
    expect(fmtSignedGW(1700)).toBe("+1.7 GW");
    expect(fmtSignedGW(-400)).toBe("−0.4 GW");
    expect(compactMW(15000)).toBe("15K");
    expect(compactMW(500)).toBe("500");
  });

  it("shows UK local time (GMT in January, BST in July)", () => {
    expect(fmtTime("2026-01-15T07:30:00Z")).toBe("07:30");
    expect(fmtTime("2026-07-15T07:30:00Z")).toBe("08:30");
  });

  it("does date arithmetic on calendar dates", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-01-02", -1)).toBe("2026-01-01");
  });

  it("builds 48 half-hour options", () => {
    expect(HALF_HOURS).toHaveLength(48);
    expect(HALF_HOURS[18]).toBe("09:00");
  });

  it("escapes CSV", () => {
    expect(toCsv([{ a: 1, b: 'x,"y"' }])).toBe('a,b\n1,"x,""y"""');
  });

  it("builds query strings and drops empty params", () => {
    expect(buildUrl("/api/x", { a: 1, b: undefined, c: "" })).toBe("/api/x?a=1");
  });
});
