import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

/** Pixels the pointer must travel before a press becomes a drag. */
export const DRAG_START_THRESHOLD_PX = 6;

/** One rendered row, measured from the top of the viewport. */
export type DragBand = {
  index: number;
  top: number;
  height: number;
};

/** The row the pointer is over, and which edge the drop line uses. */
export type SectionDragIndicator = {
  sectionId: string;
  overIndex: number;
  placeAfter: boolean;
};

/** A drag started by the browser drag-and-drop events rather than pointer moves. */
type HtmlDrag = {
  sectionId: string;
  fromIndex: number;
};

/** Pointer session for one drag. The list index is the index at pointer down. */
type DragSession = {
  sectionId: string;
  fromIndex: number;
  pointerId: number;
  startY: number;
  moved: boolean;
  cancelled: boolean;
  overIndex: number;
  placeAfter: boolean;
};

/**
 * Shows or clears the grabbing cursor for the whole page.
 *
 * Purpose: the pointer can leave the row while the section is still being dragged.
 * Inputs: active, whether a drag is past the start threshold.
 * Side effects: toggles the section-dragging class on the document element.
 */
function setDraggingChrome(active: boolean): void {
  // The class overrides row and button cursors until the drag ends.
  document.documentElement.classList.toggle("section-dragging", active);
}

/**
 * Reports whether the pointer has moved far enough to count as a drag.
 *
 * Purpose: a click on a row still selects that section.
 * Inputs: startY, the pointer-down client Y. clientY, the latest pointer Y.
 * Side effects: none.
 */
export function pointerPassedDragThreshold(startY: number, clientY: number): boolean {
  // The distance is unsigned so a drag up and a drag down both count.
  return Math.abs(clientY - startY) >= DRAG_START_THRESHOLD_PX;
}

/**
 * Finds the row under a client Y and which half of that row was hit.
 *
 * Purpose: the drop line follows the pointer before the draft order changes.
 * Inputs: bands, the rows in list order. clientY, the pointer's viewport Y.
 * Side effects: none. Returns null when there are no rows.
 */
export function bandAtClientY(
  bands: readonly DragBand[],
  clientY: number,
): { index: number; placeAfter: boolean } | null {
  const first = bands[0];
  if (first === undefined) {
    // An empty list has nowhere to drop.
    return null;
  }
  if (clientY < first.top) {
    // Above the first row. The drop sits before that row.
    return { index: first.index, placeAfter: false };
  }
  for (let position = 0; position < bands.length; position += 1) {
    const band = bands[position];
    if (band === undefined) {
      // A hole is not a row. The next band is still checked.
      continue;
    }
    const bottom = band.top + band.height;
    if (clientY <= bottom) {
      const midpoint = band.top + band.height / 2;
      // The lower half inserts after this row. The upper half inserts before it.
      return { index: band.index, placeAfter: clientY >= midpoint };
    }
    const next = bands[position + 1];
    if (next !== undefined && clientY < next.top) {
      // The pointer is in the gap under this row, so the drop is after it.
      return { index: band.index, placeAfter: true };
    }
  }
  const last = bands[bands.length - 1];
  if (last === undefined) {
    // The loop already returned when the list was empty. This guards the type.
    return null;
  }
  // Below the last row. The drop sits after that row.
  return { index: last.index, placeAfter: true };
}

/**
 * Converts a hovered row into the index the dragged section will occupy.
 *
 * Purpose: the reducer inserts into the list after the dragged section has been removed.
 * Inputs: fromIndex, the section's index at pointer down. overIndex, the row under the pointer.
 * placeAfter, whether the pointer is in that row's lower half.
 * Side effects: none.
 */
export function destinationIndex(fromIndex: number, overIndex: number, placeAfter: boolean): number {
  // The slot counts the dragged row as still present.
  let slot = placeAfter ? overIndex + 1 : overIndex;
  if (fromIndex < slot) {
    // Removing the dragged row shifts every later slot left by one.
    slot -= 1;
  }
  return slot;
}

/**
 * Tracks a pointer drag over the section list and commits one place on release.
 *
 * Purpose: the author drags a section to a new index. A click that does not travel still selects the row.
 * Inputs: sectionCount, how many rows are on screen. onPlace, called once with the section id and the destination index.
 * Side effects: listens on window during a drag, updates the drop indicator, and may call onPlace.
 */
export function useSectionDrag(
  sectionCount: number,
  onPlace: (sectionId: string, toIndex: number) => void,
): {
  indicator: SectionDragIndicator | null;
  onRowPointerDown: (event: ReactPointerEvent<HTMLLIElement>, sectionId: string, index: number) => void;
  onRowClickCapture: (event: ReactMouseEvent<HTMLLIElement>) => void;
  onRowDragStart: (event: ReactDragEvent<HTMLLIElement>, sectionId: string, index: number) => void;
  onRowDragOver: (event: ReactDragEvent<HTMLLIElement>, index: number) => void;
  onRowDrop: (event: ReactDragEvent<HTMLLIElement>, index: number) => void;
  onRowDragEnd: () => void;
} {
  // The pointer listener is created on pointer down and reads the latest place callback here.
  const onPlaceRef = useRef(onPlace);
  onPlaceRef.current = onPlace;
  const sessionRef = useRef<DragSession | null>(null);
  const htmlDragRef = useRef<HtmlDrag | null>(null);
  const suppressClickRef = useRef(false);
  const stopRef = useRef<(() => void) | null>(null);
  const [indicator, setIndicator] = useState<SectionDragIndicator | null>(null);

  /**
   * Drops a drag that is still running when the list unmounts.
   *
   * Purpose: window listeners and the grabbing cursor do not outlive the editor.
   * Inputs: none.
   * Side effects: removes the window listeners and clears the cursor.
   */
  function clearDragOnUnmount(): void {
    // The session is abandoned. A late pointerup must not place a section.
    sessionRef.current = null;
    const stop = stopRef.current;
    stopRef.current = null;
    if (stop !== null) {
      // The same capture flags used at registration have to be used here.
      stop();
    }
    setDraggingChrome(false);
  }

  useEffect(() => {
    // The cleanup runs on unmount. A drag that is still down ends without a place.
    return clearDragOnUnmount;
  }, []);

  /**
   * Removes the window listeners for the current drag.
   *
   * Purpose: pointerup, cancel, and unmount share one way to detach those listeners.
   * Inputs: none.
   * Side effects: removes the listeners when a drag registered them.
   */
  function stopListeners(): void {
    const stop = stopRef.current;
    // Clear the ref first so a second call does not remove the same listeners twice.
    stopRef.current = null;
    if (stop !== null) {
      stop();
    }
  }

  /**
   * Measures the section rows currently in the list.
   *
   * Purpose: the drop target follows the rows on screen, including after the indicator renders.
   * Inputs: none.
   * Side effects: reads layout rectangles. Does not write them.
   */
  function measureBands(): DragBand[] {
    const rows = document.querySelectorAll(".section-list .section-row");
    const bands: DragBand[] = [];
    rows.forEach((row, index) => {
      if (!(row instanceof HTMLElement)) {
        // querySelectorAll can include non-elements in older hosts. Skip those nodes.
        return;
      }
      const rect = row.getBoundingClientRect();
      // The index is the list position. The rectangle is viewport space, like clientY.
      bands.push({ index, top: rect.top, height: rect.height });
    });
    return bands;
  }

  /**
   * Ends the pointer session and places the section when the drag was completed.
   *
   * Purpose: one release is one edit. A cancelled drag or a click does not reorder the draft.
   * Inputs: none. The session ref holds the section id and the last drop target.
   * Side effects: clears the indicator and the cursor. May call onPlace once.
   */
  function finish(): void {
    const session = sessionRef.current;
    // Drop the session before placing so a place-triggered render cannot see a live drag.
    sessionRef.current = null;
    setIndicator(null);
    setDraggingChrome(false);
    stopListeners();
    if (session === null) {
      // pointerup after unmount has nothing to commit.
      return;
    }
    if (session.moved) {
      // The following click belongs to the drag, not to the select button underneath it.
      suppressClickRef.current = true;
    }
    if (!session.moved || session.cancelled) {
      // A click or Escape leaves the draft order alone.
      return;
    }
    const toIndex = destinationIndex(session.fromIndex, session.overIndex, session.placeAfter);
    if (toIndex === session.fromIndex) {
      // Dropping the section on its current slot is not an edit.
      return;
    }
    onPlaceRef.current(session.sectionId, toIndex);
  }

  /**
   * Listens for move, release, cancel, and Escape until the drag ends.
   *
   * Purpose: the pointer can leave the row that received pointer down.
   * Inputs: none. The session ref is already set.
   * Side effects: adds window listeners in the capture phase.
   */
  function listen(): void {
    /**
     * Moves the drop line to the row under the pointer.
     *
     * Purpose: the draft stays put until release. The line shows where the section will land.
     * Inputs: event, the window pointermove.
     * Side effects: may prevent the default action and update the indicator.
     */
    function onMove(event: PointerEvent): void {
      const session = sessionRef.current;
      if (session === null || event.pointerId !== session.pointerId || session.cancelled) {
        // A different pointer, or a drag that Escape already cancelled, does not move the line.
        return;
      }
      if (!session.moved && !pointerPassedDragThreshold(session.startY, event.clientY)) {
        // A small slip is still a click.
        return;
      }
      if (!session.moved) {
        // The first move past the threshold owns the cursor for the rest of the gesture.
        session.moved = true;
        setDraggingChrome(true);
      }
      // Keep the page from selecting text or scrolling while the section is in hand.
      event.preventDefault();
      const selection = window.getSelection();
      if (selection !== null && selection.rangeCount > 0) {
        selection.removeAllRanges();
      }
      const hit = bandAtClientY(measureBands(), event.clientY);
      if (hit === null) {
        // The rows were unmounted. Keep the last target.
        return;
      }
      session.overIndex = hit.index;
      session.placeAfter = hit.placeAfter;
      const sectionId = session.sectionId;
      setIndicator((current) => {
        if (
          current !== null &&
          current.sectionId === sectionId &&
          current.overIndex === hit.index &&
          current.placeAfter === hit.placeAfter
        ) {
          // The same line does not need another render.
          return current;
        }
        return { sectionId, overIndex: hit.index, placeAfter: hit.placeAfter };
      });
    }

    /**
     * Places the section when the pointer is released.
     *
     * Purpose: mouseup and touch end both finish the same gesture.
     * Inputs: event, the window pointerup.
     * Side effects: may call finish.
     */
    function onUp(event: PointerEvent): void {
      const session = sessionRef.current;
      if (session === null || event.pointerId !== session.pointerId) {
        // Another pointer's release does not finish this drag.
        return;
      }
      finish();
    }

    /**
     * Drops the gesture when the browser cancels the pointer.
     *
     * Purpose: a system gesture must not leave the section on a new row.
     * Inputs: event, the window pointercancel.
     * Side effects: may call finish without placing.
     */
    function onCancel(event: PointerEvent): void {
      const session = sessionRef.current;
      if (session === null || event.pointerId !== session.pointerId) {
        // A cancel for a different pointer leaves this drag alone.
        return;
      }
      // finish reads this flag and skips the place.
      session.cancelled = true;
      finish();
    }

    /**
     * Cancels the drag when Escape is pressed.
     *
     * Purpose: the author can put the section back without releasing onto a new row.
     * Inputs: event, the window keydown.
     * Side effects: clears the drop line. The place waits until the pointer is released.
     */
    function onKey(event: KeyboardEvent): void {
      if (event.key !== "Escape") {
        // Arrow keys and other typing do not cancel the gesture.
        return;
      }
      const session = sessionRef.current;
      if (session === null) {
        // Escape outside a drag is left to the browser.
        return;
      }
      session.cancelled = true;
      setIndicator(null);
      setDraggingChrome(false);
      // The release still arrives. finish will see the cancelled flag.
      event.preventDefault();
    }

    // Capture runs before a row can stop the event. passive is false so preventDefault can run.
    window.addEventListener("pointermove", onMove, { passive: false, capture: true });
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onCancel, true);
    window.addEventListener("keydown", onKey, true);
    stopRef.current = () => {
      // The capture flag has to match addEventListener or the listener stays attached.
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onCancel, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }

  /**
   * Starts a drag from a section row.
   *
   * Purpose: a mouse or pen can drag the row. Touch scrolling stays available except on the handle.
   * Inputs: event, the row pointerdown. sectionId, the section under the pointer. index, that row's index.
   * Side effects: may register window listeners. Does not place a section yet.
   */
  function onRowPointerDown(event: ReactPointerEvent<HTMLLIElement>, sectionId: string, index: number): void {
    // A new press is a new gesture. A drop that never received its click must not swallow this one.
    suppressClickRef.current = false;
    if (event.button !== 0) {
      // A secondary button does not pick up a section.
      return;
    }
    if (sectionCount < 2) {
      // One row has nowhere to move.
      return;
    }
    if (sessionRef.current !== null) {
      // A second pointer does not start another drag.
      return;
    }
    const element = event.target instanceof Element ? event.target : null;
    if (element === null) {
      // A text node is not a drag surface. The event still selects nothing here.
      return;
    }
    if (element.closest(".remove-section") !== null) {
      // Remove keeps its own click. Starting a drag there would swallow it.
      return;
    }
    const fromHandle = element.closest(".section-drag") !== null;
    const fromPointingDevice = event.pointerType === "mouse" || event.pointerType === "pen";
    if (!fromHandle && !fromPointingDevice) {
      // A touch on the row scrolls the page. Touch reordering starts on the handle.
      return;
    }
    sessionRef.current = {
      sectionId,
      fromIndex: index,
      pointerId: event.pointerId,
      startY: event.clientY,
      moved: false,
      cancelled: false,
      overIndex: index,
      placeAfter: false,
    };
    listen();
  }

  /**
   * Reports whether the pointer is in the lower half of the row that received the event.
   *
   * Purpose: a browser drag-and-drop drop uses the same half rule as a pointer drag.
   * Inputs: event, a drag event whose current target is the section row.
   * Side effects: reads the row's layout rectangle.
   */
  function placeAfterRow(event: ReactDragEvent<HTMLLIElement>): boolean {
    const rect = event.currentTarget.getBoundingClientRect();
    // The lower half inserts after this row. The upper half inserts before it.
    return event.clientY >= rect.top + rect.height / 2;
  }

  /**
   * Remembers a browser drag-and-drop gesture.
   *
   * Purpose: some drags report dragstart and drop instead of pointermove.
   * Inputs: event, the row dragstart. sectionId, the section being dragged. index, its index at drag start.
   * Side effects: stores the gesture and may set the drag cursor. Does not place a section yet.
   */
  function onRowDragStart(event: ReactDragEvent<HTMLLIElement>, sectionId: string, index: number): void {
    if (sectionCount < 2) {
      // One row has nowhere to move.
      event.preventDefault();
      return;
    }
    const element = event.target instanceof Element ? event.target : null;
    if (element !== null && element.closest(".remove-section") !== null) {
      // Remove keeps its own click. A drag from that button is cancelled.
      event.preventDefault();
      return;
    }
    htmlDragRef.current = { sectionId, fromIndex: index };
    if (event.dataTransfer !== null) {
      // The payload lets the browser accept the drop. A host that rejects setData still keeps the ref.
      event.dataTransfer.effectAllowed = "move";
      try {
        event.dataTransfer.setData("text/plain", sectionId);
      } catch {
        // The ref already names the section. The drop does not read this payload.
      }
    }
    setDraggingChrome(true);
  }

  /**
   * Draws the drop line during a browser drag-and-drop gesture.
   *
   * Purpose: the row under the pointer has to accept the drop, or the browser will not deliver it.
   * Inputs: event, the dragover. index, the row under the pointer.
   * Side effects: prevents the default dragover action and may update the indicator.
   */
  function onRowDragOver(event: ReactDragEvent<HTMLLIElement>, index: number): void {
    const drag = htmlDragRef.current;
    if (drag === null) {
      // A file or a selection dragged in from outside the list is ignored.
      return;
    }
    // preventDefault is what allows the following drop.
    event.preventDefault();
    if (event.dataTransfer !== null) {
      event.dataTransfer.dropEffect = "move";
    }
    const placeAfter = placeAfterRow(event);
    setIndicator((current) => {
      if (
        current !== null &&
        current.sectionId === drag.sectionId &&
        current.overIndex === index &&
        current.placeAfter === placeAfter
      ) {
        // The same line does not need another render.
        return current;
      }
      return { sectionId: drag.sectionId, overIndex: index, placeAfter };
    });
  }

  /**
   * Places the section when a browser drag-and-drop gesture is dropped.
   *
   * Purpose: the drop is one edit. A drop on the section's current slot is not.
   * Inputs: event, the drop. index, the row that received it.
   * Side effects: may call onPlace and clears the drop line.
   */
  function onRowDrop(event: ReactDragEvent<HTMLLIElement>, index: number): void {
    const drag = htmlDragRef.current;
    htmlDragRef.current = null;
    if (drag === null) {
      // The gesture was already finished or did not start on a section.
      return;
    }
    // The browser should not also treat this drop as a navigation or a text drop.
    event.preventDefault();
    const placeAfter = placeAfterRow(event);
    if (sessionRef.current !== null) {
      // The pointer release that follows this drop must not place the section a second time.
      sessionRef.current.cancelled = true;
      sessionRef.current.moved = false;
    }
    setIndicator(null);
    setDraggingChrome(false);
    // The click after a drop belongs to the drag, not to the select button under the pointer.
    suppressClickRef.current = true;
    const toIndex = destinationIndex(drag.fromIndex, index, placeAfter);
    if (toIndex === drag.fromIndex) {
      // Dropping the section on its current slot is not an edit.
      return;
    }
    onPlaceRef.current(drag.sectionId, toIndex);
  }

  /**
   * Clears a browser drag that ended without a drop.
   *
   * Purpose: Escape or a drop outside the list puts the section back.
   * Inputs: none.
   * Side effects: clears the drop line and the cursor when a drop has not already done so.
   */
  function onRowDragEnd(): void {
    if (htmlDragRef.current === null) {
      // Drop already finished this gesture.
      return;
    }
    htmlDragRef.current = null;
    setIndicator(null);
    setDraggingChrome(false);
  }

  /**
   * Stops the click that follows a completed drag.
   *
   * Purpose: releasing a drag must not also select the row under the pointer.
   * Inputs: event, the click captured on the row.
   * Side effects: may prevent and stop that click.
   */
  function onRowClickCapture(event: ReactMouseEvent<HTMLLIElement>): void {
    if (!suppressClickRef.current) {
      // A normal click still selects the section.
      return;
    }
    // One drag consumes one click. The next click is a selection again.
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  return { indicator, onRowPointerDown, onRowClickCapture, onRowDragStart, onRowDragOver, onRowDrop, onRowDragEnd };
}
