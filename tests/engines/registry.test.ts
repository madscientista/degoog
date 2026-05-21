import { describe, test, expect, beforeAll } from "bun:test";
import {
  initEngines,
  getEngineMap,
  getEngineRegistry,
  getEnginesForSearchType,
} from "../../src/server/extensions/engines/registry";

describe("engines registry", () => {
  beforeAll(async () => {
    const orig = process.env.DEGOOG_ENGINES_DIR;
    process.env.DEGOOG_ENGINES_DIR = "/nonexistent-dir-for-tests";
    await initEngines();
    if (orig !== undefined) process.env.DEGOOG_ENGINES_DIR = orig;
    else delete process.env.DEGOOG_ENGINES_DIR;
  });

  test("no built-in engines remain", () => {
    const map = getEngineMap();
    expect(map["duckduckgo"]).toBeUndefined();
    expect(map["bing"]).toBeUndefined();
    expect(map["brave"]).toBeUndefined();
    expect(map["wikipedia"]).toBeUndefined();
    expect(map["reddit"]).toBeUndefined();
  });

  test("registry is empty with no installed engines", () => {
    const reg = getEngineRegistry();
    expect(reg.length).toBe(0);
  });

  test("getEnginesForSearchType returns empty list with no engines installed", async () => {
    const engines = await getEnginesForSearchType("web", {});
    expect(engines.length).toBe(0);
  });
});
