import type { JSX } from "react";
import { assertNever } from "@reactiv/contracts";
import type { DraftTextSection } from "../editor/draft-document.js";
import { useEditorDispatch, useEditorState } from "../editor/editor-context.js";
import {
  draftFieldIssues,
  issueForSectionField,
  messageBesideField,
  sectionIndexForId,
} from "../editor/field-issues.js";
import { ColorPicker } from "./color-picker.js";
import {
  DEFAULT_TEXT_DESCRIPTION_COLOR,
  DEFAULT_TEXT_TITLE_COLOR,
  DESCRIPTION_COLOR_ERROR,
  TEXT_PREVIEW_BACKGROUND,
  TITLE_COLOR_ERROR,
  colorFieldError,
  contrastWarning,
} from "./text-contrast.js";
import "./text-section.css";

/** One text field the inspector can replace without changing the others. */
type TextFieldName = "title" | "description" | "titleColor" | "descriptionColor";

/**
 * Copies a text section and replaces one field.
 *
 * Purpose: updateSection receives every field, and an invalid color does not drop the title or the description.
 * Inputs: section, the current draft row. field, the control the author changed. value, the raw string from that control.
 * Side effects: none.
 */
function textSectionWithField(section: DraftTextSection, field: TextFieldName, value: string): DraftTextSection {
  switch (field) {
    case "title":
      // The description and both colors stay on the section.
      return {
        id: section.id,
        type: "text",
        title: value,
        description: section.description,
        titleColor: section.titleColor,
        descriptionColor: section.descriptionColor,
      };
    case "description":
      // A newline in the description is stored as typed.
      return {
        id: section.id,
        type: "text",
        title: section.title,
        description: value,
        titleColor: section.titleColor,
        descriptionColor: section.descriptionColor,
      };
    case "titleColor":
      // "#" and "#12" are stored as typed. The preview chooses the paint color later.
      return {
        id: section.id,
        type: "text",
        title: section.title,
        description: section.description,
        titleColor: value,
        descriptionColor: section.descriptionColor,
      };
    case "descriptionColor":
      // The title color is a different field and is left unchanged.
      return {
        id: section.id,
        type: "text",
        title: section.title,
        description: section.description,
        titleColor: section.titleColor,
        descriptionColor: value,
      };
    default:
      // A new field name fails here until this copy learns a branch for it.
      return assertNever(field);
  }
}

/**
 * Joins the ids of the messages that currently describe a control.
 *
 * Purpose: the color input points at its error, its contrast warning, or neither.
 * Inputs: first and second, element ids that exist, or null when that message is hidden.
 * Side effects: none.
 */
function describedBy(first: string | null, second: string | null): string | undefined {
  const ids: string[] = [];
  if (first !== null) {
    // The hex error is the first description when the string is non-empty and invalid.
    ids.push(first);
  }
  if (second !== null) {
    // The contrast warning is separate from the hex error.
    ids.push(second);
  }
  if (ids.length === 0) {
    return undefined;
  }
  return ids.join(" ");
}

/**
 * Edits the title, description, and both colors of one text section.
 *
 * Purpose: each control dispatches updateSection with the raw string, including an incomplete color.
 * Each color swatch writes the same field as the text input beside it. The preview reads the same draft.
 * This component does not fetch and does not reject a color.
 * Inputs: section, the selected text row.
 * Side effects: dispatches updateSection when a control changes.
 */
export function TextInspector({ section }: { section: DraftTextSection }): JSX.Element {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const titleId = `text-title-${section.id}`;
  const descriptionId = `text-description-${section.id}`;
  const titleColorId = `text-title-color-${section.id}`;
  const descriptionColorId = `text-description-color-${section.id}`;
  const titleErrorId = `${titleId}-error`;
  const descriptionErrorId = `${descriptionId}-error`;
  const titleColorErrorId = `${titleColorId}-error`;
  const descriptionColorErrorId = `${descriptionColorId}-error`;
  const titleContrastId = `${titleColorId}-contrast`;
  // One pass over the draft. The path uses this section's index.
  const issues = draftFieldIssues(state.draft);
  const sectionIndex = sectionIndexForId(state.draft.data.sections, section.id);
  // A title or description over the shared ceiling keeps the typed string and names that field.
  const titleError = messageBesideField(issueForSectionField(issues, sectionIndex, "title"), null);
  const descriptionError = messageBesideField(issueForSectionField(issues, sectionIndex, "description"), null);
  // Empty is not an error. A non-empty invalid string names the field.
  const titleColorError = messageBesideField(
    issueForSectionField(issues, sectionIndex, "titleColor"),
    colorFieldError(section.titleColor, TITLE_COLOR_ERROR),
  );
  const descriptionColorError = messageBesideField(
    issueForSectionField(issues, sectionIndex, "descriptionColor"),
    colorFieldError(section.descriptionColor, DESCRIPTION_COLOR_ERROR),
  );
  // The warning uses the white phone background. An invalid title color does not warn.
  const titleContrast = contrastWarning(section.titleColor, TEXT_PREVIEW_BACKGROUND);

  /**
   * Stores one changed field on the draft.
   *
   * Purpose: the input keeps the typed characters, and the other three fields are copied forward.
   * Inputs: field, the control. value, the browser's current string for that control.
   * Side effects: dispatches updateSection.
   */
  function changeField(field: TextFieldName, value: string): void {
    // The id and type stay. The value is not normalized before it reaches the draft.
    dispatch({
      type: "updateSection",
      sectionId: section.id,
      section: textSectionWithField(section, field, value),
    });
  }

  return (
    <div className="text-fields">
      <div className="text-field">
        <label htmlFor={titleId}>Title</label>
        <input
          id={titleId}
          type="text"
          value={section.title}
          aria-invalid={titleError !== null}
          aria-describedby={describedBy(titleError === null ? null : titleErrorId, null)}
          onChange={(event) => {
            // Store the title characters exactly as typed, including a string past the ceiling.
            changeField("title", event.target.value);
          }}
        />
        {titleError !== null ? (
          <p id={titleErrorId} className="field-error">
            {titleError}
          </p>
        ) : null}
      </div>
      <div className="text-field">
        <label htmlFor={descriptionId}>Description</label>
        <textarea
          id={descriptionId}
          value={section.description}
          aria-invalid={descriptionError !== null}
          aria-describedby={describedBy(descriptionError === null ? null : descriptionErrorId, null)}
          onChange={(event) => {
            // Store the description, including a newline, exactly as typed.
            changeField("description", event.target.value);
          }}
        />
        {descriptionError !== null ? (
          <p id={descriptionErrorId} className="field-error">
            {descriptionError}
          </p>
        ) : null}
      </div>
      <div className="text-field">
        <label htmlFor={titleColorId}>Title color</label>
        <div className="color-field-row">
          {/* type="text" so an incomplete value such as "#" is not replaced by the previous color. */}
          <input
            id={titleColorId}
            type="text"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            value={section.titleColor}
            aria-invalid={titleColorError !== null}
            aria-describedby={describedBy(
              titleColorError === null ? null : titleColorErrorId,
              titleContrast === null ? null : titleContrastId,
            )}
            onChange={(event) => {
              // Store the raw title color. Do not replace "#" with the previous valid color.
              changeField("titleColor", event.target.value);
            }}
          />
          <ColorPicker
            memoryKey={`${section.id}:titleColor`}
            label="Choose title color"
            value={section.titleColor}
            fallback={DEFAULT_TEXT_TITLE_COLOR}
            onChange={(value) => {
              // The swatch writes the same title color field the text input writes.
              changeField("titleColor", value);
            }}
          />
        </div>
        {titleColorError !== null ? (
          <p id={titleColorErrorId} className="field-error">
            {titleColorError}
          </p>
        ) : null}
        {titleContrast !== null ? (
          <p id={titleContrastId} className="contrast-warning">
            {titleContrast}
          </p>
        ) : null}
      </div>
      <div className="text-field">
        <label htmlFor={descriptionColorId}>Description color</label>
        <div className="color-field-row">
          <input
            id={descriptionColorId}
            type="text"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            value={section.descriptionColor}
            aria-invalid={descriptionColorError !== null}
            aria-describedby={describedBy(descriptionColorError === null ? null : descriptionColorErrorId, null)}
            onChange={(event) => {
              // Store the raw description color without changing the title color.
              changeField("descriptionColor", event.target.value);
            }}
          />
          <ColorPicker
            memoryKey={`${section.id}:descriptionColor`}
            label="Choose description color"
            value={section.descriptionColor}
            fallback={DEFAULT_TEXT_DESCRIPTION_COLOR}
            onChange={(value) => {
              // The swatch writes the same description color field the text input writes.
              changeField("descriptionColor", value);
            }}
          />
        </div>
        {descriptionColorError !== null ? (
          <p id={descriptionColorErrorId} className="field-error">
            {descriptionColorError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
