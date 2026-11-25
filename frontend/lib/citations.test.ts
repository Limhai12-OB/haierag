import { describe, expect, it } from "vitest";
import { extractMarkers } from "./citations";

describe("extractMarkers", () => {
  it("returns unique markers in order", () => {
    expect(extractMarkers("A [2] b [1][2] c [10]")).toEqual([2, 1, 10]);
  });
});
