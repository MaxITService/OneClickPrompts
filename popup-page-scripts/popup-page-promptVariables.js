// popup-page-promptVariables.js
// Manages Smart Variables from the popup Button Configuration section.
'use strict';

const OCP_PROMPT_VARIABLES_STORAGE_KEY = 'ocpPromptVariablesSettings';

const SMART_VARIABLE_BUILTINS = [
    {
        token: '{{today}}',
        description: 'Current date and time, formatted as YYYY-MM-DD HH:mm.'
    },
    {
        token: '{{date}}',
        description: 'Current date only, formatted as YYYY-MM-DD.'
    },
    {
        token: '{{time}}',
        description: 'Current local time only, formatted as HH:mm.'
    },
    {
        token: '{{input:Variable Name}}',
        description: 'Ask for this value in a small input when the button runs.'
    },
    {
        token: '{{var:name}}',
        description: 'Use a custom global variable from the list below.'
    }
];

function normalizeSmartVariableSettings(settings = {}) {
    const customVariables = Array.isArray(settings.customVariables) ? settings.customVariables : [];
    return {
        enabled: settings.enabled === true,
        dateExampleInitialized: settings.dateExampleInitialized === true,
        customVariables: customVariables
            .filter(item => item && typeof item === 'object')
            .map(item => ({
                name: String(item.name || '').trim(),
                value: String(item.value ?? '')
            }))
            .filter(item => item.name)
    };
}

async function loadSmartVariableSettings() {
    try {
        const result = await chrome.storage.local.get([OCP_PROMPT_VARIABLES_STORAGE_KEY]);
        return normalizeSmartVariableSettings(result?.[OCP_PROMPT_VARIABLES_STORAGE_KEY]);
    } catch (error) {
        logToGUIConsole(`Error loading smart variables: ${error.message}`);
        return normalizeSmartVariableSettings();
    }
}

async function saveSmartVariableSettings(settings) {
    const normalized = normalizeSmartVariableSettings(settings);
    await chrome.storage.local.set({ [OCP_PROMPT_VARIABLES_STORAGE_KEY]: normalized });
    return normalized;
}

function insertIntoButtonText(token) {
    const textarea = document.getElementById('buttonText');
    if (!textarea) {
        showToast('Button text field not found.', 'error');
        return;
    }

    const insertion = String(token || '');
    textarea.focus();
    if (typeof textarea.setRangeText === 'function') {
        const start = textarea.selectionStart ?? textarea.value.length;
        const end = textarea.selectionEnd ?? textarea.value.length;
        textarea.setRangeText(insertion, start, end, 'end');
    } else {
        textarea.value += insertion;
    }
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    showToast('Placeholder inserted into button text.', 'success', 1600);
}

function renderSmartVariableBuiltins() {
    const container = document.getElementById('smartVariablesBuiltins');
    if (!container) return;

    container.replaceChildren();
    SMART_VARIABLE_BUILTINS.forEach(({ token, description }) => {
        const item = document.createElement('div');
        item.className = 'smart-variable-builtin';

        const body = document.createElement('div');
        const code = document.createElement('code');
        code.textContent = token;
        const desc = document.createElement('span');
        desc.textContent = description;
        body.appendChild(code);
        body.appendChild(desc);

        const insertButton = document.createElement('button');
        insertButton.type = 'button';
        insertButton.textContent = 'Insert';
        insertButton.addEventListener('click', () => insertIntoButtonText(token));

        item.appendChild(body);
        item.appendChild(insertButton);
        container.appendChild(item);
    });
}

function createSmartVariableRow(variable, index, draft, rerender) {
    const row = document.createElement('div');
    row.className = 'smart-variables-custom-row';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'name';
    nameInput.value = variable.name || '';
    nameInput.addEventListener('input', () => {
        draft.customVariables[index].name = nameInput.value;
    });

    const valueInput = document.createElement('textarea');
    valueInput.rows = 2;
    valueInput.placeholder = 'value';
    valueInput.value = variable.value || '';
    valueInput.addEventListener('input', () => {
        draft.customVariables[index].value = valueInput.value;
    });

    const insertButton = document.createElement('button');
    insertButton.type = 'button';
    insertButton.textContent = 'Insert';
    insertButton.addEventListener('click', () => {
        const name = draft.customVariables[index]?.name?.trim();
        if (!name) {
            showToast('Name this variable before inserting it.', 'warning');
            return;
        }
        insertIntoButtonText(`{{var:${name}}}`);
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.textContent = 'Delete';
    deleteButton.className = 'danger';
    deleteButton.addEventListener('click', () => {
        draft.customVariables.splice(index, 1);
        rerender();
    });

    row.appendChild(nameInput);
    row.appendChild(valueInput);
    row.appendChild(insertButton);
    row.appendChild(deleteButton);
    return row;
}

function renderSmartVariableCustomList(draft) {
    const list = document.getElementById('smartVariablesCustomList');
    if (!list) return;

    const rerender = () => renderSmartVariableCustomList(draft);
    list.replaceChildren();

    if (draft.customVariables.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'smart-variables-empty';
        empty.textContent = 'No custom variables yet.';
        list.appendChild(empty);
        return;
    }

    draft.customVariables.forEach((variable, index) => {
        list.appendChild(createSmartVariableRow(variable, index, draft, rerender));
    });
}

async function initializeSmartVariablesPanel() {
    const panel = document.getElementById('smartVariablesPanel');
    if (!panel) return;

    const enabledToggle = document.getElementById('smartVariablesEnabled');
    const addButton = document.getElementById('addSmartVariable');
    const saveButton = document.getElementById('saveSmartVariables');
    let draft = await loadSmartVariableSettings();

    renderSmartVariableBuiltins();
    if (enabledToggle) {
        enabledToggle.checked = draft.enabled;
        enabledToggle.addEventListener('change', async () => {
            draft.enabled = enabledToggle.checked;
            draft = await saveSmartVariableSettings(draft);
            showToast(`Smart variables ${draft.enabled ? 'enabled' : 'disabled'}.`, 'success', 1600);
        });
    }

    renderSmartVariableCustomList(draft);

    addButton?.addEventListener('click', () => {
        draft.customVariables.push({ name: '', value: '' });
        renderSmartVariableCustomList(draft);
    });

    saveButton?.addEventListener('click', async () => {
        draft = await saveSmartVariableSettings(draft);
        renderSmartVariableCustomList(draft);
        showToast('Smart variables saved.', 'success');
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initializeSmartVariablesPanel();
});
