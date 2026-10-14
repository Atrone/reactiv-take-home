import { createContext, useContext, useEffect, type JSX, type ReactNode } from "react";
import { useEditorDispatch, useEditorState } from "./editor-context.js";
import { loaderReconciliationDecision, type LoadedDocument } from "./save-reconciliation.js";

/** The latest successful loader document. Null when this render's loader failed or has not arrived. */
const ServerPageContext = createContext<LoadedDocument | null>(null);

/**
 * Reads the latest loader document.
 *
 * Purpose: Compare and Reload use the server payload without copying it into the draft.
 * Inputs: none.
 * Side effects: none. Returns null when the provider is missing or the loader failed.
 */
export function useServerPage(): LoadedDocument | null {
  // The default is null. A missing provider does not invent a document.
  return useContext(ServerPageContext);
}

/**
 * Applies a loader payload without hydrating a dirty draft.
 *
 * Purpose: a revalidation whose ETag and document differ from the dirty draft becomes `conflictObserved`.
 * The same ETag is ignored. A newer ETag is not stored as `baseEtag`.
 * Inputs: loaded, the latest successful loader document, or null when this render has no document.
 * children, the editor that reads the server page.
 * Side effects: may dispatch `conflictObserved`. Does not dispatch `hydrate` and does not write the draft.
 */
export function LoaderReconciliation({
  loaded,
  children,
}: {
  loaded: LoadedDocument | null;
  children: ReactNode;
}): JSX.Element {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  // The effect below is the only place a loader payload is applied, and it never hydrates.

  /**
   * Reconciles the current loader payload with the mounted editor.
   *
   * Purpose: run the decision after render. A conflict keeps the draft. Anything else changes nothing.
   * Inputs: none. It reads the loader prop and the editor state from this render.
   * Side effects: may dispatch `conflictObserved` once while status is not already `conflict`.
   */
  function reconcileLoader(): void {
    if (loaded === null) {
      // A failed revalidation has no document to apply. The draft stays mounted.
      return;
    }
    const decision = loaderReconciliationDecision(state, loaded);
    if (decision === "conflict" && state.status !== "conflict") {
      // The draft, the dirty flag, and baseEtag stay. The newer tag is not adopted.
      dispatch({ type: "conflictObserved" });
    }
  }

  useEffect(reconcileLoader, [loaded, state, dispatch]);

  return <ServerPageContext.Provider value={loaded}>{children}</ServerPageContext.Provider>;
}
