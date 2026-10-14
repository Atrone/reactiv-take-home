import { z } from "zod";
import { configurationSchema, editableDocumentSchema } from "./document.js";
import { errorBodySchema } from "./error.js";

/**
 * Converts a Zod schema into JSON Schema.
 *
 * Purpose: publish the contract from the runtime schema, with no second handwritten copy.
 * Inputs: schema, a document or error schema.
 * Side effects: none. Throws when Zod returns something other than an object.
 */
function jsonSchemaFrom(schema: z.ZodType): Record<string, unknown> {
  // Zod derives the description from the same schema `safeParse` uses.
  const generated = z.toJSONSchema(schema) as unknown;
  if (typeof generated !== "object" || generated === null || Array.isArray(generated)) {
    throw new Error("Zod did not generate a JSON Schema object.");
  }
  return generated as Record<string, unknown>;
}

/** JSON Schema for a POST or PUT body, generated from `editableDocumentSchema`. */
export const editableDocumentJsonSchema = jsonSchemaFrom(editableDocumentSchema);

/** JSON Schema for a success body, generated from `configurationSchema`. */
export const configurationJsonSchema = jsonSchemaFrom(configurationSchema);

/** JSON Schema for the error body, generated from `errorBodySchema`. */
export const errorBodyJsonSchema = jsonSchemaFrom(errorBodySchema);
