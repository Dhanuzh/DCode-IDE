import { describe, expect, it } from "vitest";
import {
  MAX_RECENT_PROJECTS,
  parseRecents,
  pushRecent,
  type RecentProject,
} from "./recentProjects";

describe("parseRecents", () => {
  it("reads well-formed entries and fills in missing names", () => {
    expect(
      parseRecents(
        JSON.stringify([
          { path: "/home/u/proj", name: "proj", at: 5 },
          { path: "/home/u/other" },
        ]),
      ),
    ).toEqual([
      { path: "/home/u/proj", name: "proj", at: 5 },
      { path: "/home/u/other", name: "other", at: 0 },
    ]);
  });

  it("survives junk", () => {
    expect(parseRecents(null)).toEqual([]);
    expect(parseRecents("not json")).toEqual([]);
    expect(parseRecents('{"a":1}')).toEqual([]);
    expect(parseRecents('[{"path":""},3,null]')).toEqual([]);
  });
});

describe("pushRecent", () => {
  it("puts the newest first and dedupes by path", () => {
    const existing: RecentProject[] = [
      { path: "/a", name: "a", at: 1 },
      { path: "/b", name: "b", at: 2 },
    ];
    const next = pushRecent(existing, "/b/", 9);
    expect(next.map((r) => r.path)).toEqual(["/b", "/a"]);
    expect(next[0].at).toBe(9);
  });

  it("caps the list", () => {
    let list: RecentProject[] = [];
    for (let i = 0; i < MAX_RECENT_PROJECTS + 5; i++) {
      list = pushRecent(list, `/p${i}`, i);
    }
    expect(list).toHaveLength(MAX_RECENT_PROJECTS);
    expect(list[0].path).toBe(`/p${MAX_RECENT_PROJECTS + 4}`);
  });
});
