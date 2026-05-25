import { describe, test, expect } from "bun:test";
import { canBalrogPass } from "../../src/server/routes/settings-auth";

describe("routes/settings-auth", () => {
  test("canBalrogPass returns undefined when no cookie or header", () => {
    const req = new Request("http://localhost/", { headers: {} });
    const c = {
      req: Object.assign(req, {
        header: (name: string) => req.headers.get(name) ?? undefined,
        query: (name: string) =>
          new URL(req.url).searchParams.get(name) ?? undefined,
      }),
    };
    const token = canBalrogPass(
      c as unknown as Parameters<typeof canBalrogPass>[0],
    );
    expect(token).toBeUndefined();
  });

});
