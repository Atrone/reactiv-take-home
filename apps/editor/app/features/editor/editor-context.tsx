import {
  createContext,
  useContext,
  useReducer,
  useRef,
  type Context,
  type Dispatch,
  type JSX,
  type ReactNode,
} from "react";
import { createStableId, type Configuration } from "@reactiv/contracts";
import {
  createEditorReducer,
  createInitialEditorState,
  type EditorCommand,
  type EditorReducer,
  type EditorState,
} from "./editor-reducer.js";

/** The current editor. Null until `EditorProvider` renders. */
export const EditorStateContext = createContext<EditorState | null>(null);

/** Dispatch for editor commands. Null until `EditorProvider` renders. */
export const EditorDispatchContext = createContext<Dispatch<EditorCommand> | null>(null);

/** Props for the editor provider. `generateId` defaults to one UUID per new section or image. */
export type EditorProviderProps = {
  children: ReactNode;
  generateId?: () => string;
  initialConfiguration?: Configuration;
  initialEtag?: string | null;
};

/** The loader payload captured on the first render. Later renders do not replace it. */
type EditorHydrateSeed = {
  configuration: Configuration | undefined;
  etag: string | null;
};

/**
 * Reads the id generator the latest render provided.
 *
 * Purpose: the reducer is created once and still uses a generator passed on a later render.
 * Inputs: generateIdRef, the ref holding the optional generator.
 * Side effects: calls that generator once, or `createStableId` when the ref is empty.
 */
function generateIdFromRef(generateIdRef: { readonly current: (() => string) | undefined }): string {
  const generateId = generateIdRef.current;
  if (generateId === undefined) {
    // The browser UUID path. Tests pass their own generator instead.
    return createStableId();
  }
  return generateId();
}

/**
 * Builds a reducer that reads the generator ref when an id is needed.
 *
 * Purpose: one reducer instance serves the provider without capturing only the first generator.
 * Inputs: generateIdRef, the ref updated on each render.
 * Side effects: none until an add command runs.
 */
function bindEditorReducer(generateIdRef: { readonly current: (() => string) | undefined }): EditorReducer {
  /**
   * Issues one id from the current generator.
   *
   * Purpose: add commands call this, and it sees the generator from the latest render.
   * Inputs: none.
   * Side effects: calls the generator once.
   */
  function generateId(): string {
    // The ref is read at call time, not when the reducer was created.
    return generateIdFromRef(generateIdRef);
  }
  return createEditorReducer(generateId);
}

/**
 * Reads a context value or throws when the provider is missing.
 *
 * Purpose: the state and dispatch hooks share one null check.
 * Inputs: context, the state context or the dispatch context. hookName, the hook the caller used.
 * Side effects: none. Throws when the value is still the default null.
 */
function requireContext<T>(context: Context<T | null>, hookName: string): T {
  const value = useContext(context);
  if (value === null) {
    // The default null is not a second draft. Callers must sit under EditorProvider.
    throw new Error(`${hookName} must be used within EditorProvider.`);
  }
  return value;
}

/**
 * Builds the editor state for one provider mount.
 *
 * Purpose: the route hydrates once from the loader payload. React does not call this again when that payload changes.
 * Inputs: reducer, the editor reducer. seed, the configuration and ETag from the first render.
 * Side effects: none. The hydrate command does not fetch.
 */
function editorStateFromSeed(reducer: EditorReducer, seed: EditorHydrateSeed): EditorState {
  const initial = createInitialEditorState();
  if (seed.configuration === undefined) {
    // Tests that mount the provider alone start from the empty editor.
    return initial;
  }
  // The same hydrate rules as a dispatch: one copy for the draft and one for the baseline.
  return reducer(initial, {
    type: "hydrate",
    configuration: seed.configuration,
    etag: seed.etag,
  });
}

/**
 * Provides the editor draft and the command dispatch.
 *
 * Purpose: the shell, the inspector, and the preview read one draft from this context.
 * Inputs: props.children, the tree that reads the contexts. props.generateId, the optional id source.
 * props.initialConfiguration and props.initialEtag, the loader result used only on the first render.
 * Side effects: none until a child dispatches a command. A second loader payload does not hydrate again.
 */
export function EditorProvider({
  children,
  generateId,
  initialConfiguration,
  initialEtag = null,
}: EditorProviderProps): JSX.Element {
  const generateIdRef = useRef(generateId);
  // The latest generator is what the next add command calls.
  generateIdRef.current = generateId;
  const reducerRef = useRef<EditorReducer | null>(null);
  if (reducerRef.current === null) {
    // One reducer for this provider. A new generator does not reset the draft.
    reducerRef.current = bindEditorReducer(generateIdRef);
  }
  const reducer = reducerRef.current;

  /**
   * Passes the first loader payload into the reducer initializer.
   *
   * Purpose: useReducer calls this once, so a later loader identity cannot reset a dirty draft.
   * Inputs: seed, the configuration and ETag from the first render.
   * Side effects: none.
   */
  function initializeEditor(seed: EditorHydrateSeed): EditorState {
    // The reducer closed over the generator ref. Hydrate does not call that generator.
    return editorStateFromSeed(reducer, seed);
  }

  const [state, dispatch] = useReducer(
    reducer,
    { configuration: initialConfiguration, etag: initialEtag },
    initializeEditor,
  );
  return (
    <EditorStateContext.Provider value={state}>
      <EditorDispatchContext.Provider value={dispatch}>{children}</EditorDispatchContext.Provider>
    </EditorStateContext.Provider>
  );
}

/**
 * Reads the editor state.
 *
 * Purpose: a child of `EditorProvider` reads the one draft instead of copying sections into its own state.
 * Inputs: none.
 * Side effects: none. Throws when the provider is missing.
 */
export function useEditorState(): EditorState {
  // The value is the reducer state. It is not a default document stored on the context.
  return requireContext(EditorStateContext, "useEditorState");
}

/**
 * Reads the editor dispatch.
 *
 * Purpose: a child sends named commands instead of setting section state itself.
 * Inputs: none.
 * Side effects: none. Throws when the provider is missing.
 */
export function useEditorDispatch(): Dispatch<EditorCommand> {
  // Dispatch is stable for the life of the provider.
  return requireContext(EditorDispatchContext, "useEditorDispatch");
}
