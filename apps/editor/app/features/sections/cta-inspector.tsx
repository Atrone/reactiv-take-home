import type { JSX } from "react";
import { assertNever } from "@reactiv/contracts";
import type { DraftCtaSection } from "../editor/draft-document.js";
import { useEditorDispatch, useEditorState } from "../editor/editor-context.js";
import {
  draftFieldIssues,
  issueForSectionField,
  messageBesideField,
  sectionIndexForId,
} from "../editor/field-issues.js";
import { ColorPicker } from "./color-picker.js";
import { colorFieldError, contrastWarning } from "./text-contrast.js";
import {
  BUTTON_COLOR_ERROR,
  DEFAULT_CTA_BACKGROUND_COLOR,
  DEFAULT_CTA_LABEL_COLOR,
  LABEL_COLOR_ERROR,
  labelFieldError,
  linkFieldError,
} from "./cta-fields.js";
import "./cta-section.css";

/** One CTA field the inspector can replace without changing the others. */
type CtaFieldName = "label" | "url" | "backgroundColor" | "labelColor";

/**
 * Copies a CTA section and replaces one field.
 *
 * Purpose: updateSection receives every field, and an invalid link or color does not drop the others.
 * Inputs: section, the current draft row. field, the control the author changed. value, the raw string from that control.
 * Side effects: none.
 */
function ctaSectionWithField(section: DraftCtaSection, field: CtaFieldName, value: string): DraftCtaSection {
  switch (field) {
    case "label":
      // The link and both colors stay on the section. A blank label is stored and reported, not thrown.
      return {
        id: section.id,
        type: "cta",
        label: value,
        url: section.url,
        backgroundColor: section.backgroundColor,
        labelColor: section.labelColor,
      };
    case "url":
      // notaurl and an unfinished URL are stored as typed.
      return {
        id: section.id,
        type: "cta",
        label: section.label,
        url: value,
        backgroundColor: section.backgroundColor,
        labelColor: section.labelColor,
      };
    case "backgroundColor":
      // "#" and "#12" are stored as typed. The preview chooses the paint color later.
      return {
        id: section.id,
        type: "cta",
        label: section.label,
        url: section.url,
        backgroundColor: value,
        labelColor: section.labelColor,
      };
    case "labelColor":
      // The button color is a different field and is left unchanged.
      return {
        id: section.id,
        type: "cta",
        label: section.label,
        url: section.url,
        backgroundColor: section.backgroundColor,
        labelColor: value,
      };
    default:
      // A new field name fails here until this copy learns a branch for it.
      return assertNever(field);
  }
}

/**
 * Joins the ids of the messages that currently describe a control.
 *
 * Purpose: a color input points at its error, its contrast warning, or neither.
 * Inputs: first and second, element ids that exist, or null when that message is hidden.
 * Side effects: none.
 */
function describedBy(first: string | null, second: string | null): string | undefined {
  const ids: string[] = [];
  if (first !== null) {
    // The field error is the first description when that string is non-empty and invalid.
    ids.push(first);
  }
  if (second !== null) {
    // The contrast warning is separate from the field error.
    ids.push(second);
  }
  if (ids.length === 0) {
    return undefined;
  }
  return ids.join(" ");
}

/**
 * Edits the label, link, button color, and label color of one CTA section.
 *
 * Purpose: each control dispatches updateSection with the raw string, including an incomplete URL or color.
 * Each color swatch writes the same field as the text input beside it. The preview reads the same draft.
 * This component does not fetch and does not reject a color.
 * Inputs: section, the selected CTA row.
 * Side effects: dispatches updateSection when a control changes.
 */
export function CtaInspector({ section }: { section: DraftCtaSection }): JSX.Element {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const labelId = `cta-label-${section.id}`;
  const linkId = `cta-link-${section.id}`;
  const buttonColorId = `cta-button-color-${section.id}`;
  const labelColorId = `cta-label-color-${section.id}`;
  const labelErrorId = `${labelId}-error`;
  const linkErrorId = `${linkId}-error`;
  const buttonColorErrorId = `${buttonColorId}-error`;
  const labelColorErrorId = `${labelColorId}-error`;
  const contrastId = `cta-contrast-${section.id}`;
  // One pass over the draft. The path uses this section's index.
  const issues = draftFieldIssues(state.draft);
  const sectionIndex = sectionIndexForId(state.draft.data.sections, section.id);
  // A whitespace-only label is blank. A label past the ceiling uses the schema sentence.
  const labelError = messageBesideField(
    issueForSectionField(issues, sectionIndex, "label"),
    labelFieldError(section.label),
  );
  // Empty is unfinished. A non-empty invalid URL names the Link field. An over-long URL uses the schema sentence.
  const linkError = messageBesideField(issueForSectionField(issues, sectionIndex, "url"), linkFieldError(section.url));
  // Empty is unfinished. A non-empty invalid color names that color field.
  const buttonColorError = messageBesideField(
    issueForSectionField(issues, sectionIndex, "backgroundColor"),
    colorFieldError(section.backgroundColor, BUTTON_COLOR_ERROR),
  );
  const labelColorError = messageBesideField(
    issueForSectionField(issues, sectionIndex, "labelColor"),
    colorFieldError(section.labelColor, LABEL_COLOR_ERROR),
  );
  // The warning compares the two CTA colors. An invalid color has no ratio, so it does not warn.
  const contrast = contrastWarning(section.labelColor, section.backgroundColor);

  /**
   * Stores one changed field on the draft.
   *
   * Purpose: the input keeps the typed characters, and the other three fields are copied forward.
   * Inputs: field, the control. value, the browser's current string for that control.
   * Side effects: dispatches updateSection.
   */
  function changeField(field: CtaFieldName, value: string): void {
    // The id and type stay. The value is not normalized before it reaches the draft.
    dispatch({
      type: "updateSection",
      sectionId: section.id,
      section: ctaSectionWithField(section, field, value),
    });
  }

  return (
    <div className="cta-fields">
      <div className="cta-field">
        <label htmlFor={labelId}>Label</label>
        <input
          id={labelId}
          type="text"
          value={section.label}
          aria-invalid={labelError !== null}
          aria-describedby={describedBy(labelError === null ? null : labelErrorId, null)}
          onChange={(event) => {
            // Store the label characters exactly as typed, including a blank string.
            changeField("label", event.target.value);
          }}
        />
        {labelError !== null ? (
          <p id={labelErrorId} className="field-error">
            {labelError}
          </p>
        ) : null}
      </div>
      <div className="cta-field">
        <label htmlFor={linkId}>Link</label>
        {/* type="text" so an incomplete value such as notaurl is not rewritten by the browser. */}
        <input
          id={linkId}
          type="text"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          value={section.url}
          aria-invalid={linkError !== null}
          aria-describedby={describedBy(linkError === null ? null : linkErrorId, null)}
          onChange={(event) => {
            // Store the raw link. Do not replace notaurl with the previous valid URL.
            changeField("url", event.target.value);
          }}
        />
        {linkError !== null ? (
          <p id={linkErrorId} className="field-error">
            {linkError}
          </p>
        ) : null}
      </div>
      <div className="cta-field">
        <label htmlFor={buttonColorId}>Button color</label>
        <div className="color-field-row">
          {/* type="text" so an incomplete value such as "#" is not replaced by the previous color. */}
          <input
            id={buttonColorId}
            type="text"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            value={section.backgroundColor}
            aria-invalid={buttonColorError !== null}
            aria-describedby={describedBy(
              buttonColorError === null ? null : buttonColorErrorId,
              contrast === null ? null : contrastId,
            )}
            onChange={(event) => {
              // Store the raw button color. Do not replace "#" with the previous valid color.
              changeField("backgroundColor", event.target.value);
            }}
          />
          <ColorPicker
            memoryKey={`${section.id}:backgroundColor`}
            label="Choose button color"
            value={section.backgroundColor}
            fallback={DEFAULT_CTA_BACKGROUND_COLOR}
            onChange={(value) => {
              // The swatch writes the same button color field the text input writes.
              changeField("backgroundColor", value);
            }}
          />
        </div>
        {buttonColorError !== null ? (
          <p id={buttonColorErrorId} className="field-error">
            {buttonColorError}
          </p>
        ) : null}
      </div>
      <div className="cta-field">
        <label htmlFor={labelColorId}>Label color</label>
        <div className="color-field-row">
          <input
            id={labelColorId}
            type="text"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            value={section.labelColor}
            aria-invalid={labelColorError !== null}
            aria-describedby={describedBy(
              labelColorError === null ? null : labelColorErrorId,
              contrast === null ? null : contrastId,
            )}
            onChange={(event) => {
              // Store the raw label color without changing the button color.
              changeField("labelColor", event.target.value);
            }}
          />
          <ColorPicker
            memoryKey={`${section.id}:labelColor`}
            label="Choose label color"
            value={section.labelColor}
            fallback={DEFAULT_CTA_LABEL_COLOR}
            onChange={(value) => {
              // The swatch writes the same label color field the text input writes.
              changeField("labelColor", value);
            }}
          />
        </div>
        {labelColorError !== null ? (
          <p id={labelColorErrorId} className="field-error">
            {labelColorError}
          </p>
        ) : null}
        {contrast !== null ? (
          <p id={contrastId} className="contrast-warning">
            {contrast}
          </p>
        ) : null}
      </div>
    </div>
  );
}
