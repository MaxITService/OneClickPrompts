# What's New in 0.0.6.8

Changes users will notice since `0.0.6.7`.

## Easier button editing on chat pages

- You can now edit your prompt buttons directly on the chat page from the Settings button.
- You can reorder buttons and separators by dragging them in edit mode.
- You can edit button text without opening the popup.
- You can delete buttons from the page and undo accidental deletes.
- There is now a clear "Done editing" button.
- Dragging buttons feels smoother and easier to follow visually.
- New buttons now start with auto-send turned off, so they paste first unless you enable auto-send.
- New buttons use a sparkle icon by default.

## Faster button creation

- You can add a special `+` button that turns the current chat editor text into a saved prompt button.
- If the extension cannot read the editor text, it opens a small manual create menu instead.
- That create menu is simpler now: it has only one text field, not a confusing duplicated preview.

## Better queue workflow

- You can add a Queue button that queues the current editor text.
- Queued buttons can have their own default delay.
- Shift-click delay editing is available for queued buttons.
- Manual queue bulk-add now includes cards 7, 8, and 9.
- Queued items are preserved better when sending fails.
- Queue dragging behaves better, especially when the floating panel is scaled.
- The Queue button gives clearer visual feedback while the queue is running.

## More control over size and layout

- You can scale the floating panel and injected button rows.
- Tooltip size can be controlled separately from the main interface scale.
- Tooltip scale can be locked to, or separated from, the interface scale.
- Several popup/help texts were moved or simplified so the settings are easier to scan.

## Smart variables

- Button templates can now use smart variables like date/time placeholders.
- You can create your own reusable custom variables.
- Insert buttons make it easier to add variables into button text.
- Turning Smart Variables on or off no longer accidentally saves unfinished edits to variable names or values.

## Cross-chat and tooltip polish

- Cross-chat copy/paste/broadcast controls behave more consistently.
- The Paste tooltip can show a preview of the stored prompt.
- The Copy tooltip now correctly changes to "Copied!" after copying.
- Tooltips update more reliably when their text changes.
- Tooltips stay stable when moving the mouse between nearby buttons.

## Hotkeys

- You can edit button hotkeys.
- Disabled generated hotkeys are respected.
- Chrome/system shortcut conflicts now show a warning instead of simply blocking your choice.

## Reliability and cleanup

- Browser console logging can be controlled more cleanly from the Console tab.
- Page injection and recovery behavior is more resilient.
- Selector recovery toasts now offer clearer disable actions.
- The floating launcher is hidden during move mode.
- Removed an unused placeholder module.
- Version bumped to `0.0.6.8`.
