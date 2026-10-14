/**
 * Name of the shared contracts package.
 *
 * The editor and the configuration service both depend on this package.
 */
export const CONTRACTS_PACKAGE_NAME = "@reactiv/contracts" as const;

/**
 * Prefix for the private REST contract.
 *
 * `/v1` is the HTTP contract. It is not `schemaVersion`, and it is not `revision`.
 */
export const HTTP_API_PREFIX = "/v1" as const;

/**
 * The only document format this package accepts.
 *
 * A missing version, a string, or any number other than 1 fails validation.
 * This value is the document format. It is not the HTTP prefix, and it is not
 * the concurrency counter stored in `revision`.
 */
export const SUPPORTED_SCHEMA_VERSION = 1 as const;
