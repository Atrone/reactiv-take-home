import { useEffect, useRef, useState, type JSX } from "react";
import { useFetcher, useInRouterContext } from "react-router";
import { validateDraft } from "./draft-document.js";
import { useEditorDispatch, useEditorState } from "./editor-context.js";
import { captureSaveSnapshot, UNSAVED_CHANGES_MESSAGE } from "./save-reconciliation.js";
import {
  DRAFT_NOT_SAVED_MESSAGE,
  SAVED_MESSAGE,
  SAVE_FAILED_MESSAGE,
  buildSaveFetcherCall,
  interpretSaveFetcherResult,
  saveControlDisabled,
} from "./save-document.js";

/**
 * Renders the Save button.
 *
 * Purpose: the same disabled rule applies with or without a data router. The click handler is optional.
 * Inputs: disabled, whether the draft can be written. onClick, the save handler, omitted when no router can post it.
 * Side effects: none until the button is activated.
 */
function SaveButton({ disabled, onClick }: { disabled: boolean; onClick?: () => void }): JSX.Element {
  // type="button" keeps Save from navigating. Disabled follows the draft, not a placeholder sentence.
  return (
    <button type="button" disabled={disabled} onClick={onClick}>
      Save
    </button>
  );
}

/**
 * Posts Save through the route fetcher and reconciles the response.
 *
 * Purpose: the browser submits `{ document, baseEtag }` to the editor action. Saved appears only after
 * `saveAcknowledged` leaves the editor clean. A newer sequence stays dirty and says unsaved changes.
 * A 412 keeps the draft and becomes a conflict. It is not submitted again with a newer tag.
 * A failure keeps every draft field, stays dirty, and can be posted again with the current ETag.
 * Inputs: none. The draft and the ETag come from editor state.
 * Side effects: may dispatch saveStarted, saveAcknowledged, saveFailed, or conflictObserved. Does not navigate and does not set Authorization.
 */
function SaveButtonWithFetcher(): JSX.Element {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const fetcher = useFetcher();
  const pendingSequence = useRef<number | null>(null);
  const dataAtSubmit = useRef<unknown>(undefined);
  const submitLock = useRef(false);
  const [failureMessage, setFailureMessage] = useState<string | null>(null);
  const [failureRequestId, setFailureRequestId] = useState<string | null>(null);
  const [conflictRequestId, setConflictRequestId] = useState<string | null>(null);
  const [unsavedAfterSave, setUnsavedAfterSave] = useState(false);
  // Saved follows the reducer. A settled fetcher is not enough, and a newer draft stays dirty.
  const showSaved = state.status === "saved" && state.dirty === false;
  const showFailure = state.status === "error" && failureMessage !== null;
  const showUnsaved = unsavedAfterSave && state.dirty && state.status === "idle";
  const showConflictRequest = state.status === "conflict" && conflictRequestId !== null && conflictRequestId !== "";
  const showFailureRequest = showFailure && failureRequestId !== null && failureRequestId !== "";

  /**
   * Applies the fetcher body for the click that is still waiting.
   *
   * Purpose: acknowledge with the sequence captured at saveStarted, keep the draft on 412, or keep it when the write failed.
   * Inputs: none. It reads the fetcher and the refs from this click.
   * Side effects: may dispatch one save command and store a failure sentence or a conflict request id.
   */
  function acknowledgeSaveResult(): void {
    // Wait while the request is in flight or the body is still the one from before this click.
    const interpretation = interpretSaveFetcherResult(
      fetcher.state,
      fetcher.data,
      dataAtSubmit.current,
      pendingSequence.current,
    );
    if (interpretation.kind === "wait") {
      return;
    }
    // This body has been applied. A later render must not acknowledge it again.
    pendingSequence.current = null;
    submitLock.current = false;
    if (interpretation.kind === "conflict") {
      // The 412 did not store this draft. Do not say Saved, do not move baseEtag, and do not PUT again.
      setFailureMessage(null);
      setFailureRequestId(null);
      setUnsavedAfterSave(false);
      setConflictRequestId(interpretation.requestId);
      dispatch({ type: "conflictObserved" });
      return;
    }
    if (interpretation.kind === "failed") {
      // The draft stays dirty. The sentence is the action's safe message, or the fallback.
      setFailureMessage(interpretation.message || SAVE_FAILED_MESSAGE);
      setFailureRequestId(interpretation.requestId === "" ? null : interpretation.requestId);
      setUnsavedAfterSave(false);
      setConflictRequestId(null);
      dispatch({ type: "saveFailed" });
      return;
    }
    // A newer local sequence means the server stored the older snapshot. The draft stays dirty.
    const newerThanSnapshot = state.localSequence > interpretation.sequence;
    setFailureMessage(null);
    setFailureRequestId(null);
    setConflictRequestId(null);
    setUnsavedAfterSave(newerThanSnapshot);
    dispatch({
      type: "saveAcknowledged",
      configuration: interpretation.configuration,
      etag: interpretation.etag,
      sequence: interpretation.sequence,
    });
  }

  useEffect(acknowledgeSaveResult, [fetcher.state, fetcher.data, dispatch]);

  /**
   * Starts a save of the current valid draft.
   *
   * Purpose: record the sequence and an immutable copy of the draft, then post that copy and the current ETag.
   * Save and Retry save both use this path. A second click during the request is ignored.
   * Typing after the click still updates the draft. A 412 is not caught here and sent again.
   * Inputs: none. The draft and baseEtag are the ones in editor state.
   * Side effects: dispatches saveStarted and submits the fetcher. Does not navigate.
   */
  function onSave(): void {
    // One save is in flight. The reducer also ignores a second saveStarted.
    if (submitLock.current || state.status === "saving") {
      return;
    }
    // A missing tag cannot be sent as If-Match. A clean or invalid draft is not written.
    if (state.baseEtag === null || saveControlDisabled(state)) {
      return;
    }
    const validity = validateDraft(state.draft);
    if (!validity.ok) {
      // The inspectors already show the field errors. This click does not clear the draft.
      return;
    }
    // The snapshot is the body for this click. Later keystrokes change the draft and a new sequence.
    const snapshot = captureSaveSnapshot(validity.document, state.localSequence, state.baseEtag);
    submitLock.current = true;
    pendingSequence.current = snapshot.sequence;
    dataAtSubmit.current = fetcher.data;
    setFailureMessage(null);
    setFailureRequestId(null);
    setConflictRequestId(null);
    dispatch({ type: "saveStarted" });
    // The helper names the app action and the JSON body. It does not attach the private token.
    const call = buildSaveFetcherCall(snapshot.document, snapshot.baseEtag);
    void fetcher.submit(call.body, call.options);
  }

  return (
    <>
      <SaveButton disabled={saveControlDisabled(state)} onClick={onSave} />
      {showSaved ? (
        <p id="save-status" className="save-status" role="status" aria-live="polite">
          {SAVED_MESSAGE}
        </p>
      ) : null}
      {showUnsaved ? (
        <p id="unsaved-changes" className="save-status">
          {UNSAVED_CHANGES_MESSAGE}
        </p>
      ) : null}
      {showFailure ? (
        <div className="save-failure">
          <p id="draft-not-saved" className="save-status" role="status" aria-live="polite">
            {DRAFT_NOT_SAVED_MESSAGE}
          </p>
          <p id="save-error" className="save-error" role="alert">
            {failureMessage}
          </p>
          {showFailureRequest ? <p>Reference: {failureRequestId}</p> : null}
          <button type="button" onClick={onSave} disabled={saveControlDisabled(state)}>
            Retry save
          </button>
        </div>
      ) : null}
      {showConflictRequest ? <p>Request id: {conflictRequestId}</p> : null}
    </>
  );
}

/**
 * Renders Save, using the route fetcher when this page is inside the data router.
 *
 * Purpose: the editor posts to its action in the running app. Tests that render the shell alone still see the disabled rule.
 * Inputs: none.
 * Side effects: none until Save is activated inside the router.
 */
export function SaveController(): JSX.Element {
  const state = useEditorState();
  const inRouter = useInRouterContext();
  // Outside the data router there is no action to post to. The button still follows the draft.
  if (!inRouter) {
    return <SaveButton disabled={saveControlDisabled(state)} />;
  }
  return <SaveButtonWithFetcher />;
}
