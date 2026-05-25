import { beforeEach, describe, expect, test } from "bun:test";
import type { SearchResponse } from "../../src/server/types";
import {
  clear,
  get,
  hasFailedEngines,
  set,
} from "../../src/server/utils/cache";

const mockResponse = (timings: { resultCount: number }[]): SearchResponse => ({
  results: [],
  query: "test",
  totalTime: 0,
  type: "web",
  engineTimings: timings.map((t) => ({
    name: "e",
    time: 0,
    resultCount: t.resultCount,
  })),
  relatedSearches: [],
});

describe("cache", () => {
  beforeEach(async () => {
    await clear();
  });

  describe("get / set / clear", () => {
    test("returns null for missing key", async () => {
      expect(await get("missing")).toBe(null);
    });

    test("returns value after set", async () => {
      const res = mockResponse([{ resultCount: 5 }]);
      await set("k1", res);
      expect(await get("k1")).toEqual(res);
    });

    test("clear removes all entries", async () => {
      await set("k1", mockResponse([{ resultCount: 1 }]));
      await clear();
      expect(await get("k1")).toBe(null);
    });

    test("returns null after TTL expires", async () => {
      const res = mockResponse([{ resultCount: 1 }]);
      await set("k1", res, 50);
      expect(await get("k1")).toEqual(res);
      await Bun.sleep(60);
      expect(await get("k1")).toBe(null);
    });
  });

  describe("hasFailedEngines", () => {
    test("returns true when any engine has resultCount 0", () => {
      const res = mockResponse([{ resultCount: 5 }, { resultCount: 0 }]);
      expect(hasFailedEngines(res)).toBe(true);
    });

    test("returns false when all engines have results", () => {
      const res = mockResponse([{ resultCount: 3 }, { resultCount: 2 }]);
      expect(hasFailedEngines(res)).toBe(false);
    });
  });

});
