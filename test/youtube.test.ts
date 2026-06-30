import { describe, it, expect, vi } from "vitest";

// youtube.ts is a server-only module; stub the import marker so the pure helpers
// (parseISODuration, isShort) can be unit-tested in the node test environment. The
// network functions (getUploads/enrich/getChannelMeta) are integration-exercised by
// `next build` against the live API, not unit-tested here.
vi.mock("server-only", () => ({}));

import { parseISODuration, isShort } from "../src/lib/youtube";

describe("parseISODuration (PHASE_1_SPEC §6 / acceptance §8)", () => {
  it("parses the spec example PT1H2M3S -> 3723", () => {
    expect(parseISODuration("PT1H2M3S")).toBe(3723);
  });
  it("parses minutes/seconds only", () => {
    expect(parseISODuration("PT2M3S")).toBe(123);
    expect(parseISODuration("PT45S")).toBe(45);
    expect(parseISODuration("PT10M")).toBe(600);
  });
  it("parses hours only and multi-hour", () => {
    expect(parseISODuration("PT2H")).toBe(7200);
    expect(parseISODuration("PT1H30M")).toBe(5400);
  });
  it("parses day component", () => {
    expect(parseISODuration("P1DT1H")).toBe(90000);
  });
  it("treats PT0S / empty / malformed as 0", () => {
    expect(parseISODuration("PT0S")).toBe(0);
    expect(parseISODuration("")).toBe(0);
    expect(parseISODuration("garbage")).toBe(0);
  });
});

describe("isShort (UU-fallback Shorts heuristic, §9 non-goal)", () => {
  it("flags <=60s clips as Shorts", () => {
    expect(isShort(60)).toBe(true);
    expect(isShort(1)).toBe(true);
  });
  it("does not flag long-form or zero-duration", () => {
    expect(isShort(61)).toBe(false);
    expect(isShort(600)).toBe(false);
    expect(isShort(0)).toBe(false);
  });
});
