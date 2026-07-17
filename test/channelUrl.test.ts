import { describe, it, expect } from "vitest";
import { parseChannelUrl } from "../src/lib/channelUrl";

describe("parseChannelUrl — accepted forms (add-channels-by-URL)", () => {
  it("bare @handle (no URL)", () => {
    expect(parseChannelUrl("@somehandle")).toEqual({ kind: "handle", handle: "@somehandle" });
  });

  it("/@handle URL", () => {
    expect(parseChannelUrl("https://www.youtube.com/@somehandle")).toEqual({
      kind: "handle",
      handle: "@somehandle",
    });
  });

  it("/@handle URL without protocol", () => {
    expect(parseChannelUrl("youtube.com/@somehandle")).toEqual({
      kind: "handle",
      handle: "@somehandle",
    });
  });

  it("/channel/UC… extracts the id directly", () => {
    const id = "UCabcdefghijklmnopqrstuv"; // UC + 22 chars
    expect(parseChannelUrl(`https://www.youtube.com/channel/${id}`)).toEqual({
      kind: "id",
      channelId: id,
    });
  });

  it("/channel/<not-a-real-id> is rejected (not a valid UC… shape)", () => {
    expect(parseChannelUrl("https://www.youtube.com/channel/notarealid")).toBeNull();
  });

  it("/c/name is a best-effort handle candidate", () => {
    expect(parseChannelUrl("https://www.youtube.com/c/somename")).toEqual({
      kind: "handle",
      handle: "@somename",
    });
  });

  it("/user/name resolves via legacy username lookup", () => {
    expect(parseChannelUrl("https://www.youtube.com/user/somename")).toEqual({
      kind: "username",
      username: "somename",
    });
  });

  it("tolerates www. and m. subdomains", () => {
    expect(parseChannelUrl("https://m.youtube.com/@somehandle")).toEqual({
      kind: "handle",
      handle: "@somehandle",
    });
  });

  it("rejects a non-YouTube host", () => {
    expect(parseChannelUrl("https://example.com/@somehandle")).toBeNull();
  });

  it("rejects garbage input", () => {
    expect(parseChannelUrl("")).toBeNull();
    expect(parseChannelUrl("not a url at all")).toBeNull();
  });
});
