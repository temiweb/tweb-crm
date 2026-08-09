import { describe, expect, it } from "vitest";
import { cleanPhone, parsePackage, waLink } from "./order-utils";

describe("package parsing", () => {
  it("parses legacy Nigerian package labels", () => {
    expect(parsePackage("Buy 3 Net Tapes = ₦28,000 (save more)")).toEqual({
      packName: "Buy 3 Net Tapes",
      qty: 3,
      price: 28000,
    });
  });

  it("parses legacy Ghanaian package labels", () => {
    expect(parsePackage("Buy 2 Pack = GH₵120", "ghana")).toEqual({
      packName: "Buy 2 Pack",
      qty: 2,
      price: 120,
    });
  });

  it("parses product labels that encode quantity in parentheses", () => {
    expect(parsePackage("Product (10 Net) = ₦12,000")).toEqual({
      packName: "Product",
      qty: 10,
      price: 12000,
    });
  });
});

describe("phone normalization", () => {
  it.each([
    ["08054377777", "08054377777"],
    ["+234 805 437 7777", "08054377777"],
    ["2348054377777", "08054377777"],
  ])("normalizes %s", (input, expected) => {
    expect(cleanPhone(input)).toBe(expected);
  });

  it("builds valid WhatsApp links for Nigerian and Ghanaian bare numbers", () => {
    expect(waLink("8054377777", "Hello", "nigeria")).toContain("wa.me/2348054377777");
    expect(waLink("244123456", "Hello", "ghana")).toContain("wa.me/233244123456");
  });
});
