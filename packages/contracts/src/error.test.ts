import { describe, expect, it } from "vitest";
import {
  ERROR_CODES,
  VALIDATION_FAILED_MESSAGE,
  editableDocumentSchema,
  errorBodySchema,
  errorObjectSchema,
  formatError,
  issuesFromZodError,
  type FormatErrorInput,
} from "./index.js";

/**
 * Builds the example validation error.
 *
 * Purpose: lock the error JSON from the architecture note.
 * Inputs: none.
 * Side effects: none.
 */
function buildsValidationError(): void {
  const body = formatError({
    code: "VALIDATION_FAILED",
    message: "Some fields need attention.",
    requestId: "generated-request-id",
    issues: [{ path: "data.sections[2].url", message: "Use an absolute HTTP(S) URL." }],
  });
  expect(body).toEqual({
    error: {
      code: "VALIDATION_FAILED",
      message: "Some fields need attention.",
      requestId: "generated-request-id",
      issues: [{ path: "data.sections[2].url", message: "Use an absolute HTTP(S) URL." }],
    },
  });
  expect(Object.hasOwn(body, "stack")).toBe(false);
  expect(Object.hasOwn(body.error, "stack")).toBe(false);
  expect(errorBodySchema.safeParse(body).success).toBe(true);
  expect(VALIDATION_FAILED_MESSAGE).toBe("Some fields need attention.");
}

/**
 * Omits issues for codes other than validation failures.
 *
 * Purpose: every exported code fits the one error object.
 * Inputs: none.
 * Side effects: none.
 */
function acceptsEveryErrorCode(): void {
  for (const code of ERROR_CODES) {
    const body = formatError({
      code,
      message: "Safe message.",
      requestId: "generated-request-id",
      ...(code === "VALIDATION_FAILED" ? { issues: [] } : {}),
    });
    expect(body.error.code).toBe(code);
    expect(Object.hasOwn(body.error, "stack")).toBe(false);
    if (code === "VALIDATION_FAILED") {
      expect(body.error.issues).toEqual([]);
    } else {
      expect(body.error.issues).toBeUndefined();
    }
    // Every built body still satisfies the published error schema.
    expect(errorBodySchema.safeParse(body).success).toBe(true);
  }
}

/**
 * Asserts that the builder throws the contract message.
 *
 * Purpose: a bad error payload fails closed and the thrown text does not echo it.
 * Inputs: input, the builder payload. secret, optional text that must stay out of the thrown message.
 * Side effects: none. Calls formatError, which throws for these inputs.
 */
function expectRejectedError(input: FormatErrorInput, secret?: string): void {
  let thrown: unknown;
  try {
    // The builder throws instead of returning a body for these inputs.
    formatError(input);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Error);
  if (thrown instanceof Error) {
    expect(thrown.message).toBe("The error builder received a value outside the error contract.");
    if (secret !== undefined) {
      expect(thrown.message).not.toContain(secret);
    }
  }
}

/**
 * Rejects a stack field on the typed builder.
 *
 * Purpose: error bodies carry no stack traces, tokens, or SQL.
 * Inputs: none.
 * Side effects: none. The builder throws, and the thrown message omits the payload.
 */
function rejectsStackTraceField(): void {
  const input = {
    code: "INTERNAL" as const,
    message: "Safe message.",
    requestId: "generated-request-id",
    stack: "Error: secretTokenValue",
  };
  let thrown: unknown;
  try {
    // @ts-expect-error stack traces are outside the error contract
    formatError(input);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Error);
  if (thrown instanceof Error) {
    expect(thrown.message).not.toContain("secretTokenValue");
  }
  let castThrown: unknown;
  try {
    formatError(input as unknown as FormatErrorInput);
  } catch (error) {
    castThrown = error;
  }
  expect(castThrown).toBeInstanceOf(Error);
  if (castThrown instanceof Error) {
    expect(castThrown.message).toContain("error contract");
    expect(castThrown.message).not.toContain("secretTokenValue");
  }
}

/**
 * Rejects a token field and a stack field nested in an issue.
 *
 * Purpose: the strict builder refuses secrets even when the caller casts the type.
 * Inputs: none.
 * Side effects: none.
 */
function rejectsTokenAndNestedStack(): void {
  const tokenInput = {
    code: "UNAUTHORIZED" as const,
    message: "Authentication failed.",
    requestId: "generated-request-id",
    token: "secretTokenValue",
  };
  let tokenThrown: unknown;
  try {
    formatError(tokenInput as unknown as FormatErrorInput);
  } catch (error) {
    tokenThrown = error;
  }
  expect(tokenThrown).toBeInstanceOf(Error);
  if (tokenThrown instanceof Error) {
    expect(tokenThrown.message).toContain("error contract");
    expect(tokenThrown.message).not.toContain("secretTokenValue");
  }
  const issueInput = {
    code: "VALIDATION_FAILED" as const,
    message: "Some fields need attention.",
    requestId: "generated-request-id",
    issues: [{ path: "data.sections[2].url", message: "Use an absolute HTTP(S) URL.", stack: "secretTokenValue" }],
  };
  let thrown: unknown;
  try {
    formatError(issueInput as unknown as FormatErrorInput);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Error);
  if (thrown instanceof Error) {
    expect(thrown.message).not.toContain("secretTokenValue");
  }
  expect(
    errorBodySchema.safeParse({
      error: {
        code: "INTERNAL",
        message: "Safe message.",
        requestId: "generated-request-id",
        stack: "Error: secretTokenValue",
      },
    }).success,
  ).toBe(false);
}

/**
 * Maps a bad CTA URL to the example field path.
 *
 * Purpose: issue paths use data.sections[2].url before any HTTP layer exists.
 * Inputs: none.
 * Side effects: none.
 */
function mapsUrlIssuePath(): void {
  const result = editableDocumentSchema.safeParse({
    schemaVersion: 1,
    data: {
      sections: [
        {
          id: "text-1",
          type: "text",
          title: "One",
          description: "",
          titleColor: "#112233",
          descriptionColor: "#112233",
        },
        {
          id: "text-2",
          type: "text",
          title: "Two",
          description: "",
          titleColor: "#112233",
          descriptionColor: "#112233",
        },
        {
          id: "cta-1",
          type: "cta",
          label: "Shop",
          url: "javascript:alert(1)",
          backgroundColor: "#112233",
          labelColor: "#112233",
        },
      ],
    },
  });
  expect(result.success).toBe(false);
  if (result.success) {
    return;
  }
  const issues = issuesFromZodError(result.error);
  expect(issues).toContainEqual({
    path: "data.sections[2].url",
    message: "Use an absolute HTTP(S) URL.",
  });
  const body = formatError({
    code: "VALIDATION_FAILED",
    message: "Some fields need attention.",
    requestId: "generated-request-id",
    issues,
  });
  expect(body.error.issues).toContainEqual({
    path: "data.sections[2].url",
    message: "Use an absolute HTTP(S) URL.",
  });
}

/**
 * Requires field issues only on validation failures.
 *
 * Purpose: other codes omit issues, and a validation failure without the array is invalid.
 * Inputs: none.
 * Side effects: none.
 */
function rejectsMismatchedIssues(): void {
  // A validation failure without issues, and a non-validation code with issues, both fail.
  expectRejectedError(
    {
      code: "VALIDATION_FAILED",
      message: "secretTokenValue",
      requestId: "generated-request-id",
    },
    "secretTokenValue",
  );
  expect(
    errorObjectSchema.safeParse({
      code: "VALIDATION_FAILED",
      message: "Some fields need attention.",
      requestId: "generated-request-id",
    }).success,
  ).toBe(false);
  expectRejectedError(
    {
      code: "INTERNAL",
      message: "Safe message.",
      requestId: "generated-request-id",
      issues: [{ path: "data.sections[0].title", message: "secretTokenValue" }],
    },
    "secretTokenValue",
  );
  const emptyIssues = formatError({
    code: "INTERNAL",
    message: "Safe message.",
    requestId: "generated-request-id",
    issues: [],
  });
  expect(emptyIssues.error.issues).toBeUndefined();
  expect(Object.keys(emptyIssues.error).sort()).toEqual(["code", "message", "requestId"]);
}

/**
 * Rejects an empty message, an empty request id, an unknown code, and a blank issue.
 *
 * Purpose: the error object keeps every required string non-empty.
 * Inputs: none.
 * Side effects: none.
 */
function rejectsEmptyErrorFields(): void {
  // Each of these fails the strict error object before a body is built.
  expectRejectedError({
    code: "INTERNAL",
    message: "",
    requestId: "generated-request-id",
  });
  expectRejectedError({
    code: "INTERNAL",
    message: "Safe message.",
    requestId: "",
  });
  const unknownCode = {
    code: "NOPE",
    message: "Safe message.",
    requestId: "generated-request-id",
  };
  expectRejectedError(unknownCode as unknown as FormatErrorInput);
  expect(errorBodySchema.safeParse({ error: unknownCode }).success).toBe(false);
  expectRejectedError({
    code: "VALIDATION_FAILED",
    message: "Some fields need attention.",
    requestId: "generated-request-id",
    issues: [{ path: "", message: "Missing title." }],
  });
  expectRejectedError({
    code: "VALIDATION_FAILED",
    message: "Some fields need attention.",
    requestId: "generated-request-id",
    issues: [{ path: "data.sections[0].title", message: "" }],
  });
}

/**
 * Rejects SQL, authorization, and a stack field beside the error wrapper.
 *
 * Purpose: those fields are outside the error contract, including on the wrapper.
 * Inputs: none.
 * Side effects: none.
 */
function rejectsSqlAndAuthorizationFields(): void {
  // sql and authorization are hidden fields, so the caller has to cast them in.
  const sqlInput = {
    code: "INTERNAL" as const,
    message: "Safe message.",
    requestId: "generated-request-id",
    sql: "select secretTokenValue",
  };
  expectRejectedError(sqlInput as unknown as FormatErrorInput, "secretTokenValue");
  const authorizationInput = {
    code: "UNAUTHORIZED" as const,
    message: "Authentication failed.",
    requestId: "generated-request-id",
    authorization: "Bearer secretTokenValue",
  };
  expectRejectedError(authorizationInput as unknown as FormatErrorInput, "secretTokenValue");
  expect(
    errorBodySchema.safeParse({
      error: {
        code: "INTERNAL",
        message: "Safe message.",
        requestId: "generated-request-id",
      },
      stack: "Error: secretTokenValue",
    }).success,
  ).toBe(false);
}

/**
 * Copies field issues so a later edit of the input does not change the body.
 *
 * Purpose: the returned issues contain path and message only.
 * Inputs: none.
 * Side effects: none.
 */
function copiesValidationIssues(): void {
  const issue = {
    path: "data.sections[0].title",
    message: "Title must be 200 characters or fewer.",
  };
  const body = formatError({
    code: "VALIDATION_FAILED",
    message: "Some fields need attention.",
    requestId: "generated-request-id",
    issues: [issue],
  });
  // Changing the caller's object after the build must leave the returned issue alone.
  issue.message = "changed";
  expect(body.error.issues).toEqual([{ path: "data.sections[0].title", message: "Title must be 200 characters or fewer." }]);
  expect(Object.keys(body.error).sort()).toEqual(["code", "issues", "message", "requestId"]);
}

/**
 * Registers error-contract tests.
 *
 * Purpose: prove the single error object without an HTTP status map.
 * Inputs: none.
 * Side effects: registers Vitest cases.
 */
function registerErrorTests(): void {
  it("builds the validation error object", buildsValidationError);
  it("accepts every exported error code", acceptsEveryErrorCode);
  it("rejects a stack field on the typed builder", rejectsStackTraceField);
  it("rejects token and nested stack fields", rejectsTokenAndNestedStack);
  it("maps a URL failure to data.sections[2].url", mapsUrlIssuePath);
  it("requires issues only for validation failures", rejectsMismatchedIssues);
  it("rejects empty error fields and an unknown code", rejectsEmptyErrorFields);
  it("rejects sql, authorization, and a wrapper stack", rejectsSqlAndAuthorizationFields);
  it("copies validation issues", copiesValidationIssues);
}

describe("shared error contract", registerErrorTests);
