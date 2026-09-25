'use strict';

// modules/popup-page-modules-buttonIcons.js
// Instructions for AI: do not remove comments! MUST NOT REMOVE COMMENTS.
// Popup helper shared by module UIs whose buttons are injected into the chat toolbar: binds the small
// square icon inputs (`input[data-icon-key]`) inside a container to that module's `settings.icons`.
// Defaults and normalization come from modules/module-button-icons.js (must be loaded first).
//
// Usage:
//   const renderIcons = window.OCPModuleIconInputs.bind(container, 'crossChat', (icons) => save({ icons }));
//   renderIcons(settings.icons); // after settings load
//
// Behavior: focusing a field selects its emoji so typing or picking (Win+. / Ctrl+Cmd+Space) replaces
// it; the value is saved on change (blur or Enter); an empty field restores the default icon.

window.OCPModuleIconInputs = {
  bind(container, moduleId, onChange) {
    const { defaults, normalize, normalizeIcon } = window.OCPModuleButtonIcons;
    const moduleDefaults = defaults[moduleId];
    const inputs = [...(container?.querySelectorAll('input[data-icon-key]') ?? [])]
      .filter((input) => Object.hasOwn(moduleDefaults, input.dataset.iconKey));
    let current = normalize(moduleId, null);

    for (const input of inputs) {
      const key = input.dataset.iconKey;
      const fallback = moduleDefaults[key];
      input.placeholder = fallback;
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.title = `${input.title ? `${input.title}\n` : ''}Clear the field to restore the default ${fallback}.`;

      // Select-all on focus; swallow only the mouseup of the focusing click, which would otherwise
      // collapse the selection into a caret.
      let selectedOnFocus = false;
      input.addEventListener('focus', () => {
        input.select();
        selectedOnFocus = true;
      });
      input.addEventListener('mouseup', (event) => {
        if (selectedOnFocus) event.preventDefault();
        selectedOnFocus = false;
      });

      input.addEventListener('change', () => {
        const icon = normalizeIcon(input.value, fallback);
        input.value = icon;
        if (icon === current[key]) return;
        current = { ...current, [key]: icon };
        onChange(current);
      });
    }

    return function render(icons) {
      current = normalize(moduleId, icons);
      for (const input of inputs) input.value = current[input.dataset.iconKey];
    };
  },
};
