import type { Dispatch, JSX } from "react";
import type { ErrorIssue } from "@reactiv/contracts";
import type { EditorCommand } from "../editor/editor-reducer.js";
import type { DraftCarouselSection, DraftImage } from "../editor/draft-document.js";
import { useEditorDispatch, useEditorState } from "../editor/editor-context.js";
import {
  addImageLimitMessage,
  countDraftImages,
  draftFieldIssues,
  issueForImageField,
  messageBesideField,
  sectionIndexForId,
} from "../editor/field-issues.js";
import {
  ADD_IMAGE_LABEL,
  ALT_TEXT_LABEL,
  ASPECT_RATIO_CHOICES,
  ASPECT_RATIO_FIELD_LABEL,
  IMAGE_URL_LABEL,
  REMOVE_IMAGE_LABEL,
  copyCarouselImages,
  imageUrlFieldError,
  isAspectRatioName,
  removeImageName,
} from "./carousel-fields.js";
import "./carousel-section.css";

/**
 * Copies a carousel and replaces its aspect ratio.
 *
 * Purpose: updateSection receives the slides as well, so a ratio change does not drop images.
 * Inputs: section, the current draft row. aspectRatio, the radio the author chose.
 * Side effects: none.
 */
function carouselWithAspectRatio(
  section: DraftCarouselSection,
  aspectRatio: DraftCarouselSection["aspectRatio"],
): DraftCarouselSection {
  // The slides are copied. Their ids, addresses, and alt text stay on those copies.
  const images = copyCarouselImages(section.images);
  return {
    id: section.id,
    type: "carousel",
    aspectRatio,
    images,
  };
}

/**
 * Renders one aspect-ratio radio.
 *
 * Purpose: Portrait, Landscape, and Square stay in one group for this carousel.
 * Inputs: section, the carousel row. value, the stored name. label, the visible choice.
 * onSelect, the handler that stores a choice.
 * Side effects: none until the radio changes.
 */
function AspectRatioChoice({
  section,
  value,
  label,
  onSelect,
}: {
  section: DraftCarouselSection;
  value: DraftCarouselSection["aspectRatio"];
  label: string;
  onSelect: (value: string) => void;
}): JSX.Element {
  const radioId = `carousel-aspect-${section.id}-${value}`;
  return (
    <label htmlFor={radioId}>
      <input
        id={radioId}
        type="radio"
        name={`carousel-aspect-${section.id}`}
        value={value}
        checked={section.aspectRatio === value}
        onChange={() => {
          // Store the selected name. The slides are not reordered.
          onSelect(value);
        }}
      />
      {label}
    </label>
  );
}

/**
 * Renders the address, alt text, and remove control for one slide.
 *
 * Purpose: editing this slide does not change another slide's fields.
 * Inputs: section, the carousel row. image, the slide. index, its zero-based position.
 * dispatch, the editor command sender.
 * Side effects: dispatches updateImage or removeImage when a control changes.
 */
function CarouselImageFields({
  section,
  image,
  index,
  sectionIndex,
  issues,
  dispatch,
}: {
  section: DraftCarouselSection;
  image: DraftImage;
  index: number;
  sectionIndex: number;
  issues: readonly ErrorIssue[];
  dispatch: Dispatch<EditorCommand>;
}): JSX.Element {
  const urlId = `carousel-url-${section.id}-${image.id}`;
  const altId = `carousel-alt-${section.id}-${image.id}`;
  const urlErrorId = `${urlId}-error`;
  const altErrorId = `${altId}-error`;
  // Empty is unfinished. A non-empty invalid address names this field. An over-long address uses the schema sentence.
  const urlError = messageBesideField(
    issueForImageField(issues, sectionIndex, index, "url"),
    imageUrlFieldError(image.url),
  );
  // Alt text may be empty. A string past the ceiling stays typed and names this field.
  const altError = messageBesideField(issueForImageField(issues, sectionIndex, index, "alt"), null);

  /**
   * Stores a new address on this slide.
   *
   * Purpose: the input keeps the typed characters, including an empty or invalid URL, and the alt stays.
   * Inputs: url, the browser's current string.
   * Side effects: dispatches updateImage.
   */
  function changeImageUrl(url: string): void {
    // The slide id and the alt text are copied forward. The address is not normalized first.
    dispatch({
      type: "updateImage",
      sectionId: section.id,
      imageId: image.id,
      image: { url, alt: image.alt },
    });
  }

  /**
   * Stores new alt text on this slide.
   *
   * Purpose: the description can be cleared without changing this slide's address.
   * Inputs: alt, the browser's current string.
   * Side effects: dispatches updateImage.
   */
  function changeImageAlt(alt: string): void {
    // The slide id and the address are copied forward.
    dispatch({
      type: "updateImage",
      sectionId: section.id,
      imageId: image.id,
      image: { url: image.url, alt },
    });
  }

  /**
   * Removes this slide.
   *
   * Purpose: Remove image deletes this slide only. The carousel remains when the list becomes empty.
   * Inputs: none. The slide id is the one this row renders.
   * Side effects: dispatches removeImage.
   */
  function removeThisImage(): void {
    // The other slides and the aspect ratio stay on the section.
    dispatch({ type: "removeImage", sectionId: section.id, imageId: image.id });
  }

  return (
    <li className="carousel-image">
      <div className="carousel-field">
        <label htmlFor={urlId}>{IMAGE_URL_LABEL}</label>
        <input
          id={urlId}
          type="text"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          value={image.url}
          aria-invalid={urlError !== null}
          aria-describedby={urlError === null ? undefined : urlErrorId}
          onChange={(event) => {
            // Store the raw address. Do not replace notaurl with the previous URL.
            changeImageUrl(event.target.value);
          }}
        />
        {urlError !== null ? (
          <p id={urlErrorId} className="field-error">
            {urlError}
          </p>
        ) : null}
      </div>
      <div className="carousel-field">
        <label htmlFor={altId}>{ALT_TEXT_LABEL}</label>
        <input
          id={altId}
          type="text"
          value={image.alt}
          aria-invalid={altError !== null}
          aria-describedby={altError === null ? undefined : altErrorId}
          onChange={(event) => {
            // Store the alt text as typed, including a blank string and a string past the ceiling.
            changeImageAlt(event.target.value);
          }}
        />
        {altError !== null ? (
          <p id={altErrorId} className="field-error">
            {altError}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        className="carousel-remove"
        aria-label={removeImageName(index)}
        onClick={() => {
          // Remove this slide only. A later slide keeps its id.
          removeThisImage();
        }}
      >
        {REMOVE_IMAGE_LABEL}
      </button>
    </li>
  );
}

/**
 * Edits the aspect ratio and the image list of one carousel.
 *
 * Purpose: each control dispatches one command for this section. An empty image URL is stored and does not throw.
 * Inputs: section, the selected carousel row.
 * Side effects: dispatches updateSection, addImage, updateImage, or removeImage.
 */
export function CarouselInspector({ section }: { section: DraftCarouselSection }): JSX.Element {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  // One pass over the draft. The add control uses both image ceilings.
  const issues = draftFieldIssues(state.draft);
  const sectionIndex = sectionIndexForId(state.draft.data.sections, section.id);
  const limitMessage = addImageLimitMessage(section.images.length, countDraftImages(state.draft.data.sections));
  const limitId = `carousel-add-limit-${section.id}`;

  /**
   * Stores the chosen aspect ratio on this carousel.
   *
   * Purpose: Portrait, Landscape, and Square change only this section's ratio.
   * Inputs: value, the radio value.
   * Side effects: dispatches updateSection when the value is one of the three names and it changed.
   */
  function selectAspectRatio(value: string): void {
    if (!isAspectRatioName(value)) {
      // An unexpected radio value is not written onto the draft.
      return;
    }
    if (value === section.aspectRatio) {
      // Choosing the current ratio again is not an edit.
      return;
    }
    // The id and the slides stay. The ratio is the only field this control replaces.
    dispatch({
      type: "updateSection",
      sectionId: section.id,
      section: carouselWithAspectRatio(section, value),
    });
  }

  /**
   * Appends one empty slide to this carousel.
   *
   * Purpose: Add image creates a new id and leaves the URL and alt blank for the author to type.
   * Inputs: none. The section id comes from the current row.
   * Side effects: dispatches addImage.
   */
  function addImage(): void {
    if (limitMessage !== null) {
      // The button is disabled at the ceiling. A click that still arrives does not append a slide.
      return;
    }
    // The reducer issues the id. This control does not invent one.
    dispatch({ type: "addImage", sectionId: section.id });
  }

  return (
    <div className="carousel-fields">
      <div role="radiogroup" aria-label={ASPECT_RATIO_FIELD_LABEL} className="carousel-aspect">
        {ASPECT_RATIO_CHOICES.map((choice) => (
          <AspectRatioChoice
            key={choice.value}
            section={section}
            value={choice.value}
            label={choice.label}
            onSelect={selectAspectRatio}
          />
        ))}
      </div>
      {section.images.length > 0 ? (
        <ul className="carousel-image-list">
          {section.images.map((image, index) => (
            <CarouselImageFields
              key={image.id}
              section={section}
              image={image}
              index={index}
              sectionIndex={sectionIndex}
              issues={issues}
              dispatch={dispatch}
            />
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        className="carousel-add"
        disabled={limitMessage !== null}
        aria-describedby={limitMessage === null ? undefined : limitId}
        onClick={() => {
          // Append a blank slide after the ones already in this carousel.
          addImage();
        }}
      >
        {ADD_IMAGE_LABEL}
      </button>
      {limitMessage !== null ? (
        <p id={limitId} className="field-error">
          {limitMessage}
        </p>
      ) : null}
    </div>
  );
}
