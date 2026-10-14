import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ChangeEvent, type JSX, type ReactNode } from "react";
import { normalizeHexColor } from "@reactiv/contracts";
import "./color-picker.css";

/** The last valid swatch for each section field, kept while the settings pane stays mounted. */
type SwatchMemory = {
  colors: Readonly<Record<string, string>>;
  remember: (key: string, color: string) => void;
};

/** Props for a swatch that writes into an existing color text input. */
type ColorPickerProps = {
  memoryKey: string;
  value: string;
  fallback: string;
  label: string;
  onChange: (value: string) => void;
};

/** Shares swatch memory across the text and button inspectors. */
const SwatchMemoryContext = createContext<SwatchMemory | null>(null);

/**
 * Remembers the last valid swatch for every color field in the open document.
 *
 * Purpose: leaving a section and coming back can still show that field's last valid color when the text input is incomplete.
 * Inputs: children, the section settings pane.
 * Side effects: none until a color field stores a valid swatch.
 */
export function ColorSwatchMemoryProvider({ children }: { children: ReactNode }): JSX.Element {
  const [colors, setColors] = useState<Readonly<Record<string, string>>>({});

  /**
   * Stores one valid swatch without dropping the others.
   *
   * Purpose: each section field keeps its own color when the author selects a different row.
   * Inputs: key, the section and field. color, lowercase #rrggbb.
   * Side effects: updates the remembered swatches when the color changed.
   */
  const remember = useCallback((key: string, color: string) => {
    // A repeat of the stored color does not replace the map.
    setColors((current) => {
      if (current[key] === color) {
        return current;
      }
      return { ...current, [key]: color };
    });
  }, []);

  // The inspector reads this pair. remember stays stable across color updates.
  const value = useMemo(() => ({ colors, remember }), [colors, remember]);
  return <SwatchMemoryContext.Provider value={value}>{children}</SwatchMemoryContext.Provider>;
}

/**
 * Remembers the last valid swatch for one color field.
 *
 * Purpose: the native color input can only display #rrggbb, and an incomplete draft string must stay in the text input.
 * Inputs: memoryKey, the section and field this swatch belongs to. current, the raw draft color.
 * fallback, the swatch used when this field has never been valid.
 * Side effects: stores a valid color so a later incomplete keystroke, or a later visit to this section, can still show it.
 */
function useSwatchColor(memoryKey: string, current: string, fallback: string): string {
  const memory = useContext(SwatchMemoryContext);
  // #RGB and #RRGGBB expand to lowercase #rrggbb. "#" and "#12" stay null.
  const normalized = normalizeHexColor(current);
  const remembered = memory?.colors[memoryKey];

  useEffect(() => {
    if (normalized === null || memory === null) {
      // An incomplete string is not stored, and a missing provider has nothing to update.
      return;
    }
    // Keep this field's swatch for the next incomplete edit and for the next time this section is selected.
    memory.remember(memoryKey, normalized);
  }, [memory, memoryKey, normalized]);

  if (normalized !== null) {
    // The text input is a valid hex color, so the swatch shows that color.
    return normalized;
  }
  if (remembered !== undefined) {
    // The text input is incomplete. The swatch keeps the last valid color and does not write it back.
    return remembered;
  }
  // This field has never held a valid color during this visit to the editor.
  return fallback;
}

/**
 * Renders a color swatch that writes into one existing color field.
 *
 * Purpose: choosing a color updates the same draft string the text input in the details pane shows.
 * Inputs: props.memoryKey, the section and field. props.value, the raw draft color.
 * props.fallback, the swatch when the field has never been valid. props.label, the accessible name.
 * props.onChange, the field writer the text input already uses.
 * Side effects: calls onChange with #rrggbb when the author picks a color.
 */
export function ColorPicker({ memoryKey, value, fallback, label, onChange }: ColorPickerProps): JSX.Element {
  // The swatch follows a valid text value. An incomplete value stays out of this control until a color is picked.
  const swatch = useSwatchColor(memoryKey, value, fallback);

  /**
   * Stores the picked color on the same field as the text input.
   *
   * Purpose: the details pane color input and the preview read that one draft string.
   * Inputs: event, the color input's change event. Its value is #rrggbb.
   * Side effects: calls onChange.
   */
  function pickColor(event: ChangeEvent<HTMLInputElement>): void {
    // The browser supplies lowercase #rrggbb. That string replaces the text input's draft value.
    onChange(event.target.value);
  }

  return (
    <input className="color-picker" type="color" aria-label={label} value={swatch} onChange={pickColor} />
  );
}
