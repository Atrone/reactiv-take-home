import { PassThrough } from "node:stream";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import type { RenderToPipeableStreamOptions } from "react-dom/server";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter, type AppLoadContext, type EntryContext } from "react-router";
import { assertEditorServerEnv } from "./services/configuration.server.js";

export const streamTimeout = 5_000;

/**
 * Renders one request with the React Router server runtime.
 *
 * Purpose: turn the framework route tree into an HTML response.
 * Inputs: request, response status and headers, the router context, and the load context.
 * Side effects: returns a streamed HTML response and logs render errors that occur after the shell is sent.
 */
export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext: AppLoadContext,
): Promise<Response> {
  // This prompt does not read load context. The parameter keeps the framework server signature.
  void loadContext;
  try {
    // Refuse the request when the private URL or token is missing or the token is still the example placeholder.
    assertEditorServerEnv();
  } catch (error) {
    // Reject the returned promise so the server adapter handles a setup failure.
    return Promise.reject(error);
  }
  // HEAD carries no body. Answer with the same status and headers.
  if (request.method.toUpperCase() === "HEAD") {
    return Promise.resolve(
      new Response(null, {
        status: responseStatusCode,
        headers: responseHeaders,
      }),
    );
  }

  return new Promise((resolve, reject) => {
    // The shell flag decides whether a later render error rejects or only logs.
    let shellRendered = false;
    // Bots and SPA mode wait for the full document before the response starts.
    const userAgent = request.headers.get("user-agent");
    const readyOption: keyof RenderToPipeableStreamOptions =
      (userAgent && isbot(userAgent)) || routerContext.isSpaMode ? "onAllReady" : "onShellReady";
    /**
     * Holds the render pipe until React Router returns the real one.
     *
     * Purpose: give onReady a function before the render call assigns pipe.
     * Inputs: destination, ignored until the real pipe replaces this function.
     * Side effects: none.
     */
    function pipeNotReady(_destination: PassThrough): void {
      // Replaced synchronously after renderToPipeableStream returns.
    }

    /**
     * Holds abort until React Router returns the real one.
     *
     * Purpose: give the timeout a function before the render call assigns abort.
     * Inputs: none.
     * Side effects: none.
     */
    function abortNotReady(): void {
      // Replaced synchronously after renderToPipeableStream returns.
    }

    // Assigned when renderToPipeableStream returns. Callbacks run after that assignment.
    let pipe: (destination: PassThrough) => void = pipeNotReady;
    let abort: () => void = abortNotReady;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    /**
     * Sends HTML once React is ready to respond.
     *
     * Purpose: convert the pipeable render into a web Response.
     * Inputs: none. Closes over the response status and headers.
     * Side effects: resolves the request and pipes HTML to the client.
     */
    function onReady(): void {
      // The shell is committed, so later errors are logged instead of rejected.
      shellRendered = true;
      // End the abort timer when the stream closes.
      const body = new PassThrough({
        /**
         * Clears the abort timer after the stream finishes.
         *
         * Purpose: drop the timer once the response body is done.
         * Inputs: callback, invoked after the timer is cleared.
         * Side effects: clears the timeout.
         */
        final(callback: (error?: Error | null) => void): void {
          // The response is finished, so the abort timer must not fire.
          clearTimeout(timeoutId);
          timeoutId = undefined;
          callback();
        },
      });
      // Adapt the Node stream to the response body the framework expects.
      const stream = createReadableStreamFromReadable(body);
      responseHeaders.set("Content-Type", "text/html");
      pipe(body);
      resolve(
        new Response(stream, {
          headers: responseHeaders,
          status: responseStatusCode,
        }),
      );
    }

    /**
     * Fails the request when the document shell cannot render.
     *
     * Purpose: surface a shell failure to the caller.
     * Inputs: error, the render failure.
     * Side effects: rejects the response promise.
     */
    function onShellError(error: unknown): void {
      // The shell never started, so the framework handles this rejection.
      reject(error);
    }

    /**
     * Records a render error after streaming has started.
     *
     * Purpose: mark the response as a server error without reading secrets.
     * Inputs: error, the streaming failure.
     * Side effects: sets status 500 and logs the error only after the shell has rendered.
     */
    function onError(error: unknown): void {
      // A later chunk failed. Update the status stored for this response.
      responseStatusCode = 500;
      // Shell errors reject above and are logged by the caller.
      if (shellRendered) {
        console.error(error);
      }
    }

    // Start the render. React invokes the ready callback on a later turn.
    const rendered = renderToPipeableStream(<ServerRouter context={routerContext} url={request.url} />, {
      [readyOption]: onReady,
      onShellError,
      onError,
    });
    /**
     * Aborts a render that outlives the stream timeout.
     *
     * Purpose: release a request that never finishes rendering.
     * Inputs: none.
     * Side effects: aborts the React render stream.
     */
    function abortRender(): void {
      // The timer fired, so stop the render and let the response end.
      abort();
    }

    // Capture the stream controls before the abort timer can run.
    pipe = rendered.pipe;
    abort = rendered.abort;
    // Leave one extra second for rejected boundaries to flush.
    timeoutId = setTimeout(abortRender, streamTimeout + 1000);
  });
}
