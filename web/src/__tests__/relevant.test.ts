/**
 * Tests for the §2.3 conditional logic evaluator (web copy).
 * Vitest mirror of mobile/src/__tests__/relevant.test.ts.
 */
import { describe, test, expect } from "vitest";
import { evaluateRelevant, evaluateExpression } from "@/lib/relevant";

// ---------------------------------------------------------------------------
// evaluateRelevant — empty / missing expression
// ---------------------------------------------------------------------------

describe("evaluateRelevant — empty expression", () => {
  test("undefined returns true", () => expect(evaluateRelevant(undefined, {})).toBe(true));
  test("empty string returns true", () => expect(evaluateRelevant("", {})).toBe(true));
  test("whitespace-only returns true", () => expect(evaluateRelevant("   ", {})).toBe(true));
});

// ---------------------------------------------------------------------------
// Equality
// ---------------------------------------------------------------------------

describe("evaluateRelevant — equality", () => {
  const v = { status: "active", count: "3" };
  test("= match", () => expect(evaluateRelevant("status = 'active'", v)).toBe(true));
  test("= mismatch", () => expect(evaluateRelevant("status = 'inactive'", v)).toBe(false));
  test("!= different", () => expect(evaluateRelevant("status != 'inactive'", v)).toBe(true));
  test("!= same", () => expect(evaluateRelevant("status != 'active'", v)).toBe(false));
  test("numeric string = literal", () => expect(evaluateRelevant("count = 3", v)).toBe(true));
});

// ---------------------------------------------------------------------------
// Numeric comparisons
// ---------------------------------------------------------------------------

describe("evaluateRelevant — numeric comparisons", () => {
  const v = { age: "25" };
  test("> true", () => expect(evaluateRelevant("age > 18", v)).toBe(true));
  test("> false", () => expect(evaluateRelevant("age > 30", v)).toBe(false));
  test("< true", () => expect(evaluateRelevant("age < 30", v)).toBe(true));
  test(">= equal", () => expect(evaluateRelevant("age >= 25", v)).toBe(true));
  test("<= equal", () => expect(evaluateRelevant("age <= 25", v)).toBe(true));
  test("<= false", () => expect(evaluateRelevant("age <= 24", v)).toBe(false));
  test("negative literal", () => expect(evaluateRelevant("age >= -1", v)).toBe(true));
});

// ---------------------------------------------------------------------------
// Logical connectives
// ---------------------------------------------------------------------------

describe("evaluateRelevant — and / or", () => {
  const v = { type: "survey", status: "active", role: "admin" };
  test("and both true", () => expect(evaluateRelevant("type = 'survey' and status = 'active'", v)).toBe(true));
  test("and one false", () => expect(evaluateRelevant("type = 'survey' and status = 'inactive'", v)).toBe(false));
  test("or first true", () => expect(evaluateRelevant("type = 'survey' or type = 'form'", v)).toBe(true));
  test("or both false", () => expect(evaluateRelevant("type = 'x' or status = 'y'", v)).toBe(false));
  test("and binds tighter than or", () => {
    // false or (true and true) → true
    expect(evaluateRelevant("type = 'form' or status = 'active' and role = 'admin'", v)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// selected()
// ---------------------------------------------------------------------------

describe("evaluateRelevant — selected()", () => {
  test("array contains value", () =>
    expect(evaluateRelevant("selected(tags, 'health')", { tags: ["health", "edu"] })).toBe(true));
  test("array missing value", () =>
    expect(evaluateRelevant("selected(tags, 'finance')", { tags: ["health"] })).toBe(false));
  test("empty array → false", () =>
    expect(evaluateRelevant("selected(tags, 'health')", { tags: [] })).toBe(false));
  test("string exact match", () =>
    expect(evaluateRelevant("selected(cat, 'A')", { cat: "A" })).toBe(true));
  test("undefined field → false", () =>
    expect(evaluateRelevant("selected(missing, 'x')", {})).toBe(false));
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("evaluateRelevant — edge cases", () => {
  test("malformed → true (safe default)", () => expect(evaluateRelevant("!!!garbage", {})).toBe(true));
  test("double-quoted string", () =>
    expect(evaluateRelevant('status = "active"', { status: "active" })).toBe(true));
  test("underscored field name", () =>
    expect(evaluateRelevant("my_field = 'yes'", { my_field: "yes" })).toBe(true));
});

// ---------------------------------------------------------------------------
// evaluateExpression
// ---------------------------------------------------------------------------

describe("evaluateExpression", () => {
  test("addition", () => expect(evaluateExpression("a + b", { a: "3", b: "4" })).toBe(7));
  test("precedence", () => expect(evaluateExpression("a + b * c", { a: "1", b: "2", c: "3" })).toBe(7));
  test("parentheses", () => expect(evaluateExpression("(a + b) * c", { a: "1", b: "2", c: "3" })).toBe(9));
  test("undefined field → 0", () => expect(evaluateExpression("a + missing", { a: "5" })).toBe(5));
  test("empty → NaN", () => expect(evaluateExpression("", {})).toBeNaN());
});
