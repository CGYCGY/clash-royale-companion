import { expect, test } from "bun:test";
import { cardType } from "../../src/domain/cardType";

test("card type comes from the API id range", () => {
  expect(cardType(26000021)).toBe("troop");
  expect(cardType(27000000)).toBe("building");
  expect(cardType(28000011)).toBe("spell");
  expect(cardType(159000000)).toBeNull();
});
