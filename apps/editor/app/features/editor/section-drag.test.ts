import { describe, expect, it } from "vitest";
import {
  DRAG_START_THRESHOLD_PX,
  bandAtClientY,
  destinationIndex,
  pointerPassedDragThreshold,
  type DragBand,
} from "./section-drag.js";

/**
 * Builds three stacked rows with a gap between them.
 *
 * Purpose: the hit tests can name a row, a gap, and the space above and below the list.
 * Inputs: none.
 * Side effects: none.
 */
function sampleBands(): DragBand[] {
  // 40px rows and an 8px gap match the list spacing the shell test lays out.
  return [
    { index: 0, top: 0, height: 40 },
    { index: 1, top: 48, height: 40 },
    { index: 2, top: 96, height: 40 },
  ];
}

/**
 * Asserts a short press stays a click and a longer move becomes a drag.
 *
 * Purpose: the threshold is what keeps selecting a row distinct from dragging it.
 * Inputs: none.
 * Side effects: none.
 */
function expectTheDragThresholdToIgnoreAShortSlip(): void {
  // Five pixels is under the six-pixel threshold. Six pixels starts the drag.
  expect(pointerPassedDragThreshold(20, 20 + DRAG_START_THRESHOLD_PX - 1)).toBe(false);
  expect(pointerPassedDragThreshold(20, 20 - (DRAG_START_THRESHOLD_PX - 1))).toBe(false);
  expect(pointerPassedDragThreshold(20, 20 + DRAG_START_THRESHOLD_PX)).toBe(true);
  expect(pointerPassedDragThreshold(20, 20 - DRAG_START_THRESHOLD_PX)).toBe(true);
}

/**
 * Asserts the pointer Y picks a row half, a gap, or the space outside the list.
 *
 * Purpose: the drop line uses the same rule the release will use.
 * Inputs: none.
 * Side effects: none.
 */
function expectBandAtClientYToChooseTheRowHalf(): void {
  const bands = sampleBands();
  // Above the list, and the upper half of the first row, both insert before it.
  expect(bandAtClientY(bands, -4)).toEqual({ index: 0, placeAfter: false });
  expect(bandAtClientY(bands, 10)).toEqual({ index: 0, placeAfter: false });
  // The lower half of the first row, and the gap under it, insert after it.
  expect(bandAtClientY(bands, 30)).toEqual({ index: 0, placeAfter: true });
  expect(bandAtClientY(bands, 44)).toEqual({ index: 0, placeAfter: true });
  // The second row's midpoint is 68. One pixel on either side chooses the half.
  expect(bandAtClientY(bands, 67)).toEqual({ index: 1, placeAfter: false });
  expect(bandAtClientY(bands, 68)).toEqual({ index: 1, placeAfter: true });
  // Below the last row inserts after that row. An empty list has no target.
  expect(bandAtClientY(bands, 200)).toEqual({ index: 2, placeAfter: true });
  expect(bandAtClientY([], 10)).toBeNull();
}

/**
 * Asserts the destination index is the slot after the dragged row is removed.
 *
 * Purpose: dropping before or after a row has to account for the gap the dragged row leaves.
 * Inputs: none.
 * Side effects: none.
 */
function expectDestinationIndexToAccountForTheRemovedRow(): void {
  // Moving down onto the next row's lower half advances one slot.
  expect(destinationIndex(0, 1, true)).toBe(1);
  // The next row's upper half is still the dragged row's current slot.
  expect(destinationIndex(0, 1, false)).toBe(0);
  // Moving up onto the previous row's upper half retreats one slot.
  expect(destinationIndex(2, 1, false)).toBe(1);
  // After the previous row is the dragged row's current slot.
  expect(destinationIndex(2, 1, true)).toBe(2);
  // A later row's lower half, and the space before the first row, land on those ends.
  expect(destinationIndex(0, 2, true)).toBe(2);
  expect(destinationIndex(2, 0, false)).toBe(0);
  // Dropping on the dragged row itself does not change its index.
  expect(destinationIndex(1, 1, false)).toBe(1);
  expect(destinationIndex(1, 1, true)).toBe(1);
}

/**
 * Registers the drag-math cases.
 *
 * Purpose: the pointer session in the shell uses these three rules.
 * Inputs: none.
 * Side effects: registers vitest cases.
 */
function registerDragMathCases(): void {
  // Threshold, hit testing, and the index the reducer will receive.
  it("ignores a pointer move shorter than the drag threshold", expectTheDragThresholdToIgnoreAShortSlip);
  it("chooses the row half under the pointer", expectBandAtClientYToChooseTheRowHalf);
  it("returns the index the section occupies after it is removed", expectDestinationIndexToAccountForTheRemovedRow);
}

describe("section drag", registerDragMathCases);
