import { describe, test, expect } from "bun:test";
import { getRandomUserAgent } from "../../src/server/utils/user-agents";

describe("user-agents", () => {
  test("getRandomUserAgent returns a non-empty string", () => {
    const ua = getRandomUserAgent();
    expect(typeof ua).toBe("string");
    expect(ua.length).toBeGreaterThan(0);
  });

  test("getRandomUserAgent returns a string that looks like a user agent", () => {
    const ua = getRandomUserAgent();
    expect(ua).toMatch(/Mozilla/);
  });

});
