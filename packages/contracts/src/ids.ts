/**
 * Returns one UUID from Node's Web Crypto helper.
 *
 * Purpose: the default id source. The bare `crypto.randomUUID` method loses its receiver if it is passed unbound.
 * Inputs: none.
 * Side effects: none.
 */
function randomUuid(): string {
  // Call as a method. An unbound `crypto.randomUUID` throws because `this` is no longer Crypto.
  return crypto.randomUUID();
}

/**
 * Creates one stable section or image id.
 *
 * Purpose: callers invoke this when adding a section or an image. Rendering must not call it.
 * The string identifies a block. It is not an authorization secret, and it is not an array index.
 * Inputs: generateId, the id source. When omitted, this calls crypto.randomUUID.
 * Side effects: calls generateId once.
 */
export function createStableId(generateId: () => string = randomUuid): string {
  // One call. Later reads of the stored string do not call the generator again.
  return generateId();
}
