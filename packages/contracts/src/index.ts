export { CONTRACTS_PACKAGE_NAME, HTTP_API_PREFIX, SUPPORTED_SCHEMA_VERSION } from "./versions.js";
export {
  ALT_LIMIT_MESSAGE,
  CAROUSEL_IMAGE_LIMIT_MESSAGE,
  CTA_LABEL_LIMIT_MESSAGE,
  DESCRIPTION_LIMIT_MESSAGE,
  DOCUMENT_IMAGE_LIMIT_MESSAGE,
  LIMITS,
  SECTION_LIMIT_MESSAGE,
  TITLE_LIMIT_MESSAGE,
  URL_LIMIT_MESSAGE,
  isPayloadWithinLimit,
  payloadUtf8ByteLength,
} from "./limits.js";
export { hexColorSchema, normalizeHexColor } from "./color.js";
export { ABSOLUTE_HTTP_URL_MESSAGE, httpUrlSchema, isAbsoluteHttpUrl } from "./url.js";
export {
  ASPECT_RATIOS,
  CTA_LABEL_REQUIRED_MESSAGE,
  configurationSchema,
  editableDocumentSchema,
  imageSchema,
  sectionSchema,
} from "./document.js";
export type { Configuration, EditableDocument, Image, Section } from "./document.js";
export { createStableId } from "./ids.js";
export {
  ASPECT_RATIO_DISPLAY,
  assertNever,
  createSection,
  getSectionRegistryEntry,
  sectionRegistry,
} from "./registry.js";
export type { AspectRatioDisplay, SectionRegistryEntry } from "./registry.js";
export { createDemoDocument } from "./demo-document.js";
export { createHarborDocument, createMarketDocument } from "./brand-fixtures.js";
export {
  ERROR_CODES,
  VALIDATION_FAILED_MESSAGE,
  errorBodySchema,
  errorCodeSchema,
  errorIssueSchema,
  errorObjectSchema,
  formatError,
  formatIssuePath,
  issuesFromZodError,
} from "./error.js";
export type { ErrorBody, ErrorCode, ErrorIssue, FormatErrorInput } from "./error.js";
export {
  logCompletedRequest,
  redactSecretHeaders,
  safeRequestLogRecord,
  writeRequestLogStdout,
} from "./request-log.js";
export type { RequestLogHeaders, RequestLogInput, RequestLogRecord, RequestLogWriter } from "./request-log.js";
export { configurationJsonSchema, editableDocumentJsonSchema, errorBodyJsonSchema } from "./json-schema.js";
