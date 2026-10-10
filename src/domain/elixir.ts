const MIRROR_ID = 28000006;

// The API gives Mirror no cost (it plays for the last card's cost + 1), but the game's deck average has counted
// it as 1.5 since the 2016-05-03 update. The catalog keeps the null; only averages use this.
export function averagingCost(id: number, elixirCost: number | null | undefined): number | null {
  return elixirCost ?? (id === MIRROR_ID ? 1.5 : null);
}
