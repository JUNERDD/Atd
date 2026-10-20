# The view runtime

How a view's two documents are built, what their scripts can call, how the window sends messages without script, and two complete examples. The examples show the mechanics (documents, data, sends and updates) on deliberately plain markup: take the API from them, not their layout or look, which each view decides from its own subject and data (`SKILL.md`, workflow step 3, and `design.md`).

## The documents

The service builds a full document around each surface's markup each time it is shown: around `widget` for the widget in the conversation, and around `html` for the window. Both look like this, with `data-surface` naming the surface:

```html
<!doctype html>
<html
  lang="{the app's language}"
  data-platform="macos"
  data-theme="{light or dark}"
  data-surface="{widget or window}"
>
  <head>
    <style>
      /* the kit CSS of your blocks, in @layer apple.base and apple.components */
    </style>
    <style>
      html,
      body {
        margin: 0;
        background: transparent;
      }
      [hidden] {
        display: none !important;
      }
      /* the widget's document also sets overflow: hidden on html and body */
    </style>
    <script>
      /* the runtime: defines window.atd, applies data-theme and lang, reports the height */
    </script>
  </head>
  <body>
    {your widget or html, verbatim}
    <script>
      /* the kit script: AppleFeedback, AppleMotion, and AppleBlocks for blocks that have one */
    </script>
    <script>
      /* starts press states, the glass glint and the block enhancers */
    </script>
  </body>
</html>
```

What follows from it:

- The widget and the window are separate documents: each loads only its own markup and scripts, and they share nothing but the data and the blocks you name.
- Your `<style>` is outside the kit's layers, so it beats kit rules without `!important`. Adjust the kit through its tokens and hooks (`--accent`, `--list-inset`, `--switch-on`, `--motion-origin` …) and your own classes, not by restyling a component's insides.
- A view's accent: set `--accent` to a system hue on `:root`, in the `widget` and in the `html` alike, since they are separate documents (`<style>:root { --accent: var(--system-indigo); }</style>`). The kit derives `--accent-text`, `--accent-fill`, `--accent-on` and `--focus-ring` from it, readable in both appearances, but only on `:root` (and on elements with a `data-tint` attribute). Set on an inner element without that attribute, it changes only direct uses of `--accent`, while text, filled controls and focus rings keep the default blue.
- The document makes the `hidden` attribute win over the `display` that kit components set, so show and hide elements with `hidden` rather than with inline styles.
- Your `<script>` runs as the parser reaches it, before the kit script: `atd` exists, but `AppleFeedback`, `AppleMotion` and `AppleBlocks` do not yet. Start your code in a `DOMContentLoaded` listener, where everything exists and the kit has set up the markup already in the page.
- Pressed states also reach elements you add later. A block with an enhancer, such as `slider` or `stepper`, needs `AppleBlocks.slider.init(container)` (or `AppleBlocks.stepper.init`) after you insert new ones; calling it again is safe.

```html
<script>
  document.addEventListener('DOMContentLoaded', () => {
    // atd, AppleFeedback, AppleMotion and the AppleBlocks of your blocks all exist here.
    atd.onData((data) => render(data));
  });
</script>
```

## `window.atd`

| Member                 | What it does                                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `atd.ready`            | A promise that resolves once the host has connected.                                                                                                                                                                           |
| `atd.data`             | The current data: `show_ui`'s `data`, replaced by each later `update_ui`. `null` before `ready`, or when there is none.                                                                                                        |
| `atd.onData(callback)` | Calls `callback(data)` once after `ready` with the current data, possibly `null`, then after every `update_ui`. Returns a function that unsubscribes. Render from here.                                                        |
| `atd.surface`          | `"widget"` or `"window"`: which document this is, also set as `data-surface` on the document.                                                                                                                                  |
| `atd.state`            | In the window, what `setState` last saved for this view, or `null`. Read it after `ready`. Always `null` in the widget.                                                                                                        |
| `atd.setState(value)`  | Window only. Saves JSON of at most 65,536 bytes, about 250 ms after the last call. It comes back when the user opens the window again; it is kept on this Mac only for a while; the agent never sees it. Throws in the widget. |
| `atd.send(text)`       | Window only. Sends `text`, trimmed, as the user's message. Returns a promise; rejects in the widget.                                                                                                                           |
| `atd.openLink(url)`    | Window only. Opens an `http:` or `https:` URL in the user's browser. Returns a promise; rejects in the widget.                                                                                                                 |
| `atd.theme`            | `"light"` or `"dark"`: the app's appearance, also set as `data-theme` on the document.                                                                                                                                         |
| `atd.locale`           | The app's language as a BCP 47 tag, such as `en` or `zh-CN`. The view's copy follows the user's language, which may differ.                                                                                                    |
| `atd:context` event    | Fired on `window` when the theme or the language changes. Tokens follow by themselves; redraw only what your script painted, such as a canvas.                                                                                 |

`atd.send` goes to the waiting `show_ui` call as its answer while that call still waits; otherwise it becomes a user message in the task, a new turn when the agent is idle and a queued one while it works. It rejects with an `Error` whose message says why when the text is empty or longer than 10,000 characters, when the user has not interacted with the window yet, or when the host refuses it: no recent interaction with the window, less than a second after its previous message, or more than ten in a minute. Show that message next to the control the user used.

Links: in the window, clicking `<a href="https://…">` (or `http:`) opens the page in the browser, except a `download` link; a `#fragment` link scrolls within the document; any other link, relative ones included, does nothing. `atd.openLink(url)` does the same from script, for absolute URLs only. Like messages, links open only after the user interacted with the window, and the host limits how often. In the widget no link opens: a click anywhere on it opens the window.

Errors and size: uncaught errors and rejected promises show the user a warning beside the widget or in the window, and the agent never sees them. The runtime reports the document's height whenever it changes: the host sizes the widget's frame to it, between 32 and 240 px, and cuts off the rest; the window's frame always fills the window under its title bar, and its document scrolls when it is taller.

## Declarative sends

These work in the window; in the widget they do nothing. The runtime listens on the whole document, so they also work on markup you add later.

- `<form data-atd-send>`, or `<form data-atd-send="Heading">`: submitting the form sends one message, the heading on the first line when there is one, then one `Label: value` line per named control in form order. A field's label is the text of its `<label>`, else its `aria-label`, else its `name`. Radio buttons and checkboxes that share a `name` make one line: its label is the enclosing `<fieldset>`'s `<legend>`, else the `aria-label` of the nearest `role="radiogroup"` or `role="group"`, and its value lists each checked option's `value` (its label text when it has none), joined with `, `. A lone checkbox sends `Its label: Yes` when checked and nothing when not. File inputs are ignored; a named submit button adds its `value`. A form with nothing to send is refused.
- Any other element with `data-atd-send="text"`, usually a `<button type="button">`: clicking it sends the text.
- While sending, the submit button or the element is `aria-busy="true"` and `disabled`, and afterwards it is restored. Success sets `data-atd-state="sent"` on the form or element and dispatches an `atd:sent` event on it. Failure sets `data-atd-state="error"` and `data-atd-error` to the reason, dispatches `atd:error` with the reason in `event.detail.message`, and announces it.
- Show the outcome with `[data-atd-state="sent"]` and `[data-atd-state="error"]` selectors or by listening for the events. The window stays open afterwards until the user closes it, and a later send from it arrives as an ordinary user message, so show what was sent and lock the form if sending again would make no sense (Example 1).

For a form to read well as a message:

- Give every named control a visible `<label>` that names the question, and options a `value` written as the user would say it.
- Unchecked boxes and unselected options send nothing, so their absence means no. When the user should see that answer in their message, offer the choice as a `<select>` or a radio group.
- Put radio buttons, segmented controls and sets of checkboxes in a `<fieldset>` with a `<legend>`, or in a `role="radiogroup"` or `role="group"` element with an `aria-label`, so their line names the question ("Pace: Relaxed"). When a message should read differently from the form, compose it yourself and call `atd.send` from your own handler, as Example 2 does.
- Validate before sending: `required`, `min`, `max` and `pattern` on the fields, and the submit button `disabled` while the form is invalid, with the reason beside the field (Example 1).

Choosing among visual options: each option can be a button that sends its own choice.

```html
<div class="choices" role="group" aria-label="Layout">
  <button class="choice pressable" type="button" data-atd-send="Use the split layout">
    <svg viewBox="0 0 64 40" aria-hidden="true">…</svg>
    <span class="t-headline">Split</span>
    <span class="t-callout">List beside the details</span>
  </button>
  …
</div>
```

When the user should compare the options before committing, make them selectable instead (`aria-pressed`, or a radio group) and send the selected one from a single primary button.

## Example 1: a waiting form

You are about to export 24 photos and need their settings together. Call `show_ui` with these arguments and the `html` below; there is no `data`, and no `widget`, so the conversation shows a plain card with the title, and the composer asks the user to respond in the window:

```json
{
  "title": "Export Settings",
  "wait": true,
  "window": { "width": 420, "height": 420 },
  "blocks": ["field", "list", "switch", "button", "motion"]
}
```

```html
<form class="view" data-atd-send="Export settings" lang="en">
  <fieldset>
    <div class="stack">
      <div class="group">
        <label class="field__label" for="format">Format</label>
        <select id="format" name="format">
          <option>JPEG</option>
          <option>HEIC</option>
          <option>PNG</option>
        </select>
      </div>
      <div class="group">
        <label class="field__label" for="size">Longest Side in Pixels</label>
        <input
          class="field"
          id="size"
          name="size"
          type="number"
          inputmode="numeric"
          min="256"
          max="8192"
          value="2048"
          required
          aria-describedby="size-hint"
        />
        <p class="field-message" id="size-hint">Enter a size from 256 to 8,192 pixels.</p>
      </div>
      <ul class="list list--flush">
        <li>
          <label class="list__row">
            <span class="list__label">Keep Location Data</span>
            <input
              class="switch"
              type="checkbox"
              role="switch"
              switch
              name="location"
              value="Yes"
            />
          </label>
        </li>
      </ul>
      <div class="actions">
        <p class="t-callout" id="outcome"></p>
        <button class="btn-filled" type="submit">
          <span class="activity-indicator" aria-hidden="true" style="--motion-delay: 400ms"></span>
          Export 24 Photos
        </button>
      </div>
    </div>
  </fieldset>
</form>
<style>
  .view {
    padding: var(--space-4) var(--margin-page);
  }
  .view fieldset {
    min-inline-size: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
  .stack {
    display: grid;
    gap: var(--space-4);
  }
  .group {
    display: grid;
    gap: var(--space-1);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-3);
  }
  #outcome {
    margin-block: 0;
    margin-inline-end: auto;
  }
</style>
<script>
  document.addEventListener('DOMContentLoaded', () => {
    const form = document.querySelector('.view');
    const size = form.elements.size;
    const hint = document.getElementById('size-hint');
    const submit = form.querySelector('[type="submit"]');
    const outcome = document.getElementById('outcome');

    form.addEventListener('input', () => {
      const valid = size.checkValidity();
      size.setAttribute('aria-invalid', String(!valid));
      if (valid) hint.removeAttribute('data-tone');
      else hint.dataset.tone = 'error';
      submit.disabled = !valid;
    });
    form.addEventListener('atd:sent', () => {
      form.querySelector('fieldset').disabled = true;
      outcome.textContent = 'Settings sent.';
      AppleFeedback.announce(outcome.textContent);
    });
    form.addEventListener('atd:error', (event) => {
      outcome.textContent = event.detail.message;
    });
  });
</script>
```

When the user clicks Export 24 Photos, the call returns:

```text
The user responded through the view: Export settings
Format: HEIC
Longest Side in Pixels: 2048
Keep Location Data: Yes
```

The last line is missing when the switch stays off. If the user types an answer in the composer instead, the response is their text; if they skip, it is `The user dismissed the view without responding.` Then export, and report the result in text.

## Example 2: a data view with a widget, kept current with `update_ui`

You found duplicate photos, and the user decides which to remove, maybe over several rounds. Call `show_ui` without `wait`, with the `widget` and `html` below:

```json
{
  "title": "Duplicate Photos",
  "window": { "width": 480, "height": 520 },
  "blocks": ["list", "button", "empty-state", "motion"],
  "data": {
    "items": [
      { "name": "IMG_2041 copy.jpg", "folder": "Pictures/Kyoto", "bytes": 4210000 },
      { "name": "IMG_2042 copy.jpg", "folder": "Pictures/Kyoto", "bytes": 3980000 },
      { "name": "Scan 3 (1).png", "folder": "Downloads", "bytes": 1530000 }
    ],
    "note": null
  }
}
```

The widget, here a figure and a caption, one of the glance forms `design.md` describes; it follows the same data:

```html
<div class="glance" lang="en">
  <p class="t-title2 t-emph" id="count"></p>
  <p class="t-callout text-secondary" id="detail"></p>
</div>
<style>
  .glance {
    display: grid;
    gap: var(--space-1);
    padding: var(--space-3) var(--margin-page) var(--space-4);
  }
  .glance p {
    margin: 0;
  }
</style>
<script>
  document.addEventListener('DOMContentLoaded', () => {
    const count = document.getElementById('count');
    const detail = document.getElementById('detail');
    const size = new Intl.NumberFormat('en', {
      style: 'unit',
      unit: 'megabyte',
      maximumFractionDigits: 1,
    });
    atd.onData((data) => {
      const items = Array.isArray(data?.items) ? data.items : [];
      const bytes = items.reduce((sum, item) => sum + (Number(item.bytes) || 0), 0);
      count.textContent =
        items.length === 0
          ? 'No duplicates left'
          : `${items.length} duplicate ${items.length === 1 ? 'photo' : 'photos'}`;
      detail.textContent =
        items.length === 0 ? 'Every photo is unique.' : `${size.format(bytes / 1e6)} to free up`;
    });
  });
</script>
```

The window:

```html
<div class="view" lang="en">
  <ul class="list list--flush" id="photos" aria-label="Duplicate photos"></ul>
  <div class="empty-state" id="empty" hidden>
    <svg
      class="empty-state__symbol"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
    <h2 class="empty-state__title">No Duplicates Left</h2>
    <p class="empty-state__description">Every photo in these folders is now unique.</p>
  </div>
  <p class="t-callout" id="note"></p>
  <div class="actions" id="actions">
    <p class="t-callout text-secondary" id="hint">Select photos to move them to the Trash.</p>
    <button class="btn-bordered btn-destructive" id="trash" type="button" aria-disabled="true">
      <span class="activity-indicator" aria-hidden="true" style="--motion-delay: 400ms"></span>
      <span id="trash-label">Move to Trash</span>
    </button>
  </div>
</div>
<style>
  .view {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4) var(--margin-page);
  }
  .view p {
    margin: 0;
  }
  #note:empty {
    display: none;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-3);
  }
  #hint {
    margin-inline-end: auto;
  }
</style>
<script>
  document.addEventListener('DOMContentLoaded', () => {
    const view = document.querySelector('.view');
    const list = document.getElementById('photos');
    const button = document.getElementById('trash');
    const label = document.getElementById('trash-label');
    const hint = document.getElementById('hint');
    const note = document.getElementById('note');
    const size = new Intl.NumberFormat(view.lang, {
      style: 'unit',
      unit: 'megabyte',
      maximumFractionDigits: 1,
    });
    let rows = [];

    const chosen = () => rows.filter((row) => row.box.checked).map((row) => row.item);
    const busy = () => button.getAttribute('aria-busy') === 'true';
    const sync = () => {
      const count = chosen().length;
      button.setAttribute('aria-disabled', String(busy() || count === 0));
      if (!busy()) label.textContent = count > 0 ? `Move ${count} to Trash` : 'Move to Trash';
      hint.hidden = count > 0;
    };
    const say = (text) => {
      note.textContent = text;
      if (text) AppleFeedback.announce(text);
    };

    const render = (data) => {
      const items = Array.isArray(data?.items) ? data.items : [];
      rows = items.map((item) => {
        const box = document.createElement('input');
        box.type = 'checkbox';
        const title = document.createElement('span');
        title.className = 'list__title';
        title.textContent = item.name;
        const detail = document.createElement('span');
        detail.className = 'list__subtitle';
        detail.textContent = `${item.folder} · ${size.format(item.bytes / 1e6)}`;
        const text = document.createElement('span');
        text.className = 'list__label';
        text.append(title, detail);
        const row = document.createElement('label');
        row.className = 'list__row';
        row.append(box, text);
        const entry = document.createElement('li');
        entry.append(row);
        return { item, box, entry };
      });
      list.replaceChildren(...rows.map((row) => row.entry));
      list.hidden = rows.length === 0;
      document.getElementById('empty').hidden = rows.length > 0;
      document.getElementById('actions').hidden = rows.length === 0;
      button.removeAttribute('aria-busy');
      say(typeof data?.note === 'string' ? data.note : '');
      sync();
    };

    list.addEventListener('change', sync);
    button.addEventListener('click', async () => {
      const photos = chosen();
      if (busy() || photos.length === 0) return;
      const names = photos.map((photo) => `“${photo.name}” in ${photo.folder}`).join(', ');
      const which = photos.length === 1 ? 'this photo' : `these ${photos.length} photos`;
      button.setAttribute('aria-busy', 'true');
      label.textContent = 'Moving…';
      sync();
      try {
        await atd.send(`Move ${which} to the Trash: ${names}`);
      } catch (error) {
        button.removeAttribute('aria-busy');
        sync();
        say(error.message);
      }
    });
    atd.onData(render);
  });
</script>
```

The call returns at once with the view's id. The widget shows "3 duplicate photos" and how much space they take; the user clicks it to open the window. Selecting photos stays in the window. When the user selects two and clicks Move 2 to Trash, this arrives as their message, starting a new turn:

```text
Move these 2 photos to the Trash: “IMG_2041 copy.jpg” in Pictures/Kyoto, “IMG_2042 copy.jpg” in Pictures/Kyoto
```

Move them, then close the loop with `update_ui`, sending the complete data again:

```json
{
  "id": "<the id show_ui returned>",
  "data": {
    "items": [{ "name": "Scan 3 (1).png", "folder": "Downloads", "bytes": 1530000 }],
    "note": "Moved 2 photos to the Trash."
  }
}
```

The window clears its busy button, shows and announces the note, and lists what is left, and the widget now reads "1 duplicate photo". If a move fails, keep that photo in `items` and say why in `note` ("Couldn't move “IMG_2042 copy.jpg” because Preview has it open. The other photo is in the Trash."), so the window never stays busy. Then reply in a line, without listing what the view shows.
