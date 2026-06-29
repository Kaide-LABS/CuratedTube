import { describe, it, expect } from "vitest";
import {
  uploadsFromChannelId,
  handleToChannelUrl,
  isAlreadyResolved,
  applyParking,
  summarize,
  findDuplicates,
  buildValidationReport,
} from "../scripts/roster-lib.mjs";

describe("uploadsFromChannelId", () => {
  it("UC -> UULF (long-form, default)", () => {
    expect(uploadsFromChannelId("UCo_RPqYFFTaTl_0Ojg-e8Bg")).toBe("UULFo_RPqYFFTaTl_0Ojg-e8Bg");
  });
  it("UC -> UU when useUU", () => {
    expect(uploadsFromChannelId("UCo_RPqYFFTaTl_0Ojg-e8Bg", true)).toBe("UUo_RPqYFFTaTl_0Ojg-e8Bg");
  });
  it("throws on a non-UC id (never fabricates a playlist)", () => {
    expect(() => uploadsFromChannelId("bogus")).toThrow();
  });
});

describe("handleToChannelUrl", () => {
  it("@handle -> /@handle", () => {
    expect(handleToChannelUrl("@AndrejKarpathy")).toBe("https://www.youtube.com/@AndrejKarpathy");
  });
  it("legacy custom url (coldfusion) -> /coldfusion (NOT treated as @handle)", () => {
    expect(handleToChannelUrl("coldfusion")).toBe("https://www.youtube.com/coldfusion");
  });
});

describe("isAlreadyResolved", () => {
  it("true for a real UC id", () => {
    expect(isAlreadyResolved({ channelId: "UCo_RPqYFFTaTl_0Ojg-e8Bg" })).toBe(true);
  });
  it("false for null / garbage", () => {
    expect(isAlreadyResolved({ channelId: null })).toBe(false);
    expect(isAlreadyResolved({ channelId: "UCnope" })).toBe(false);
  });
});

describe("applyParking", () => {
  it("parks a tier:null channel", () => {
    expect(applyParking({ tier: null }).parked).toBe(true);
  });
  it("leaves a classified channel untouched", () => {
    expect(applyParking({ tier: 2 }).parked).toBeUndefined();
  });
});

describe("summarize + findDuplicates + buildValidationReport", () => {
  const channels = [
    { handle: "@a", channelId: "UCAAAAAAAAAAAAAAAAAAAAAA", category: "Islamic", tier: 1 },
    { handle: "@b", channelId: "UCBBBBBBBBBBBBBBBBBBBBBB", category: "AI-ML", tier: 2, fellBackToUU: true },
    { handle: "@c", channelId: null, category: "x", tier: 3, unresolved: true },
    { handle: "@d", channelId: null, category: "UNCONFIRMED", tier: null, parked: true, confirm: true },
    { handle: "@a", channelId: "UCAAAAAAAAAAAAAAAAAAAAAA", category: "Islamic", tier: 1 }, // dup
  ];

  it("counts tiers, resolution, parking, fallbacks", () => {
    const s = summarize(channels);
    expect(s.total).toBe(5);
    expect(s.resolved).toBe(3); // two @a (dup both UC) + @b
    expect(s.unresolved).toBe(1);
    expect(s.parked).toBe(1);
    expect(s.fellBackToUU).toBe(1);
    expect(s.byTier[1]).toBe(2);
  });

  it("finds duplicate handles and channelIds", () => {
    const d = findDuplicates(channels);
    expect(d.some((x) => x.kind === "handle" && x.value === "@a")).toBe(true);
    expect(d.some((x) => x.kind === "channelId")).toBe(true);
  });

  it("renders a markdown report listing UNRESOLVED and parked", () => {
    const md = buildValidationReport(channels, { quotaUsed: 3, enriched: true });
    expect(md).toContain("Validation Report");
    expect(md).toContain("`@c`"); // unresolved
    expect(md).toContain("`@d`"); // parked
    expect(md).toContain("quota used: 3");
  });
});
