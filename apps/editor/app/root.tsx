import type { JSX, ReactNode } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import type { Route } from "./+types/root";

/**
 * Renders the HTML document around the active route.
 *
 * Purpose: provide the server-rendered document shell.
 * Inputs: children, the rendered route content.
 * Side effects: none.
 */
export function Layout({ children }: { children: ReactNode }): JSX.Element {
  // The framework fills Meta, Links, and Scripts. This shell does not fetch configuration.
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

/**
 * Renders the matched route.
 *
 * Purpose: mount the route tree for the framework server runtime.
 * Inputs: none.
 * Side effects: none.
 */
export default function App(): JSX.Element {
  // The child route renders in this outlet. This shell does not call the configuration service.
  return <Outlet />;
}

/**
 * Renders a route failure inside the document shell.
 *
 * Purpose: show a plain error instead of an empty document.
 * Inputs: error, the route or render failure supplied by the framework.
 * Side effects: none. Stack traces are included only while Vite is in development.
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps): JSX.Element {
  // Start from a generic message that does not include environment values.
  let message = "Error";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;
  // Route responses keep their status. Other errors stay generic outside development.
  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details = error.status === 404 ? "The requested page could not be found." : error.statusText || details;
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }
  // Render text only. This boundary does not read the service token.
  return (
    <main>
      <h1>{message}</h1>
      <p>{details}</p>
      {stack ? (
        <pre>
          <code>{stack}</code>
        </pre>
      ) : null}
    </main>
  );
}
