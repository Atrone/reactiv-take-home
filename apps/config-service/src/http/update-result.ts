import { VALIDATION_FAILED_MESSAGE, type ErrorCode, type ErrorIssue } from "@reactiv/contracts";
import type { ConditionalUpdateResult } from "../configurations/configuration-service.js";
import {
  CONFIGURATION_NOT_FOUND_MESSAGE,
  PRECONDITION_FAILED_MESSAGE,
  PRECONDITION_REQUIRED_MESSAGE,
} from "./service-error.js";

/** One update the route will not commit, including a header that never reached the repository. */
export type UpdateRouteFailure =
  | { reason: "precondition-required" }
  | Exclude<ConditionalUpdateResult, { ok: true }>;

/** Status, code, and safe message for one update failure. */
export type MappedUpdateFailure = {
  statusCode: 404 | 412 | 422 | 428;
  code: ErrorCode;
  message: string;
  issues?: ErrorIssue[];
};

/**
 * Copies field issues onto a plain list.
 *
 * Purpose: keep path and message, and leave extra keys off the mapped error.
 * Inputs: issues, the list from document validation.
 * Side effects: none.
 */
function copyIssues(issues: readonly ErrorIssue[]): ErrorIssue[] {
  const copied: ErrorIssue[] = [];
  for (const issue of issues) {
    // One contract issue. The path is the field, such as data.sections[1].titleColor.
    copied.push({
      path: issue.path,
      message: issue.message,
    });
  }
  return copied;
}

/**
 * Maps an update failure onto its HTTP status.
 *
 * Purpose: turn a repository or header result into 404, 412, 422, or 428 without teaching the repository those codes.
 * Inputs: failure, the precondition problem or the service result. A success is not passed here.
 * Side effects: none.
 */
export function mapUpdateFailure(failure: UpdateRouteFailure): MappedUpdateFailure {
  switch (failure.reason) {
    case "precondition-required":
      // Missing, *, and weak If-Match values never become a write.
      return { statusCode: 428, code: "PRECONDITION_REQUIRED", message: PRECONDITION_REQUIRED_MESSAGE };
    case "revision-conflict":
      // The row is still there. The caller's revision is not the stored one.
      return { statusCode: 412, code: "PRECONDITION_FAILED", message: PRECONDITION_FAILED_MESSAGE };
    case "not-found":
      // This tenant has no such id. The update did not insert one.
      return { statusCode: 404, code: "NOT_FOUND", message: CONFIGURATION_NOT_FOUND_MESSAGE };
    case "validation-failed":
      // The document failed before the conditional update, so the revision was not incremented.
      return {
        statusCode: 422,
        code: "VALIDATION_FAILED",
        message: VALIDATION_FAILED_MESSAGE,
        issues: copyIssues(failure.issues),
      };
    default: {
      // A new reason has to be mapped on purpose. The failure value stays out of the message.
      const unexpected: never = failure;
      void unexpected;
      throw new Error("Unexpected update failure.");
    }
  }
}
