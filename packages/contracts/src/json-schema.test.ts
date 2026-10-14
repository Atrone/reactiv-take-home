import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ERROR_CODES,
  configurationJsonSchema,
  configurationSchema,
  editableDocumentJsonSchema,
  editableDocumentSchema,
  errorBodyJsonSchema,
  errorBodySchema,
} from "./index.js";

/**
 * Compares a generated schema with a fresh Zod conversion.
 *
 * Purpose: the exported description has to come from the runtime schema.
 * Inputs: exportedSchema, the package export. schema, the Zod schema it describes.
 * Side effects: none.
 */
function expectGenerated(exportedSchema: Record<string, unknown>, schema: z.ZodType): void {
  const fresh = z.toJSONSchema(schema) as unknown;
  expect(JSON.parse(JSON.stringify(exportedSchema))).toEqual(JSON.parse(JSON.stringify(fresh)));
}

/**
 * Proves the JSON Schema exports are generated from the Zod schemas.
 *
 * Purpose: there is no handwritten second copy of the document or error shape.
 * Inputs: none.
 * Side effects: none.
 */
function matchesZodJsonSchema(): void {
  expectGenerated(editableDocumentJsonSchema, editableDocumentSchema);
  expectGenerated(configurationJsonSchema, configurationSchema);
  expectGenerated(errorBodyJsonSchema, errorBodySchema);
  const documentText = JSON.stringify(editableDocumentJsonSchema);
  expect(documentText).toContain('"const":1');
  expect(documentText).toContain('"additionalProperties":false');
  expect(documentText).toContain('"maxItems":100');
  expect(documentText).toContain('"maxItems":20');
  expect(documentText).toContain('"maxLength":200');
  expect(documentText).toContain('"maxLength":5000');
  expect(documentText).toContain('"maxLength":120');
  expect(documentText).toContain('"maxLength":300');
  expect(documentText).toContain('"maxLength":2048');
  expect(JSON.stringify(errorBodyJsonSchema)).toContain("VALIDATION_FAILED");
}

/**
 * Reads the property names from a generated object schema.
 *
 * Purpose: compare the request schema with the success schema by their fields.
 * Inputs: schema, one exported JSON Schema object.
 * Side effects: none. Throws when the schema has no properties object.
 */
function propertyNames(schema: Record<string, unknown>): string[] {
  // Generated object schemas publish their fields on `properties`.
  const properties = schema.properties;
  if (properties === null || typeof properties !== "object" || Array.isArray(properties)) {
    throw new Error("Expected JSON Schema properties.");
  }
  const names: string[] = [];
  for (const name of Object.keys(properties)) {
    names.push(name);
  }
  names.sort();
  return names;
}

/**
 * Shows which fields the request and success schemas publish.
 *
 * Purpose: a write body has schemaVersion and data, and a configuration adds id, revision, and updatedAt.
 * Inputs: none.
 * Side effects: none.
 */
function publishesRequestAndSuccessShapes(): void {
  // A write body stops at schemaVersion and data. A configuration adds the service fields.
  expect(propertyNames(editableDocumentJsonSchema)).toEqual(["data", "schemaVersion"]);
  expect(propertyNames(configurationJsonSchema)).toEqual(["data", "id", "revision", "schemaVersion", "updatedAt"]);
  const errorText = JSON.stringify(errorBodyJsonSchema);
  // Every exported code appears in the generated error schema.
  for (const code of ERROR_CODES) {
    expect(errorText).toContain(code);
  }
}

/**
 * Registers JSON Schema generation tests.
 *
 * Purpose: keep the published description tied to the Zod schemas.
 * Inputs: none.
 * Side effects: registers Vitest cases.
 */
function registerJsonSchemaTests(): void {
  it("generates JSON Schema from the Zod schemas", matchesZodJsonSchema);
  it("publishes the request fields, success fields, and error codes", publishesRequestAndSuccessShapes);
}

describe("generated JSON Schema", registerJsonSchemaTests);
