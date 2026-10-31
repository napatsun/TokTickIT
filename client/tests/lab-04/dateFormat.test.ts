import { describe, it, expect } from "vitest";
import { formatDate, formatDateTime, MONTHS_SHORT } from "../../src/lib/dateFormat";

describe("dateFormat — shared 3-letter month formatter", () => {
  it("keeps every month abbreviation strictly 3 characters (never 'Sept')", () => {
    expect(MONTHS_SHORT).toHaveLength(12);
    for (const month of MONTHS_SHORT) {
      expect(month).toHaveLength(3);
    }
    expect(MONTHS_SHORT[8]).toBe("Sep");
  });

  it("formats September and October dates with consistent 3-letter months", () => {
    const sep = new Date(2026, 8, 2, 14, 5, 0);
    const oct = new Date(2026, 9, 31, 9, 30, 0);

    expect(formatDate(sep)).toBe("2 Sep 2026");
    expect(formatDate(oct)).toBe("31 Oct 2026");
    expect(formatDate(sep.toISOString())).toMatch(/^\d{1,2} Sep 2026$/);
    expect(formatDate(oct.toISOString())).toMatch(/^\d{1,2} Oct 2026$/);
  });

  it("formats date-times with 3-letter month and zero-padded HH:mm", () => {
    const sepMorning = new Date(2026, 8, 2, 8, 5, 0);
    expect(formatDateTime(sepMorning)).toBe("2 Sep 2026, 08:05");
  });

  it("handles invalid date strings gracefully without throwing", () => {
    expect(formatDate("not-a-date")).toBe("not-a-date");
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
  });
});
