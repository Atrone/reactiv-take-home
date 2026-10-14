# Field rules

Save, export, import, and the private API use one document schema. The numbers live in the shared `LIMITS` object from the architecture validation table.

An invalid draft stays on the page. The editor keeps what was typed, shows the issue beside the field, and leaves Save and export blocked until the draft is valid. Crossing a limit returns an error. It does not shorten the stored document or the draft.

## Required to save

- A CTA label. After the ends are trimmed it must be 1–120 characters.
- Valid colors on every text and CTA section. Schema version 1 accepts `#RGB` and `#RRGGBB`. Alpha colors are unsupported.
- A valid absolute HTTP(S) URL for every image URL and every CTA URL that is non-empty. The URL is at most 2,048 characters, with no embedded credentials.
- Unique section ids in the document, and unique image ids inside one carousel.
- Schema version 1.

A non-empty image URL must be valid. An empty image URL cannot be saved.

## Optional

- Text title. An empty title can be saved.
- Text description. An empty description can be saved.
- Image alt text. An empty alt can be saved when the image URL is valid.
- An empty image list. An empty carousel can be saved.
- An empty section list. A document with no sections can be saved.

## Limits

| Input | Limit |
| --- | --- |
| Title | 200 characters |
| Description | 5,000 characters |
| CTA label | 1–120 characters after the non-blank check |
| Alt text | 300 characters |
| URL | 2,048 characters |
| Images in one carousel | 20 |
| Images in the document | 100 |
| Sections | 100 |
| Import file and API body | 256 KiB UTF-8 |

Add image stops at 20 slides in that carousel, and at 100 slides in the document, and explains which ceiling was reached. The private API still rejects a 21st image, a 101st image, a 101st section, an over-long field, a blank CTA label, and a body one byte over 256 KiB.
