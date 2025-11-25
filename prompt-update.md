# Selector Update Prompt for AI

## Purpose
This prompt helps AI assistants update CSS selectors in `utils.js` when website UI structures change. Use this when a website (ChatGPT, Claude, Copilot, etc.) has updated their interface and buttons/editors are no longer being detected.

---

## Instructions for AI

### Context
You are updating selectors in the `InjectionTargetsOnWebsite` class in `utils.js`. This class stores CSS selectors for different AI chat websites to locate:
- **Containers**: Where to inject custom buttons
- **Editors**: Text input areas (textarea or contenteditable divs)
- **Send Buttons**: The button that sends messages
- **Thread Root**: The conversation thread container

### Your Task
I will provide you with HTML code from a website. You need to:

1. **Identify the website** from the HTML (ChatGPT, Claude, Copilot, DeepSeek, AIStudio, Grok, Gemini, or Perplexity)

2. **Analyze the HTML** to find:
   - The **send button** element
   - The **editor/input** element (textarea or contenteditable)
   - The **container** that wraps the input area
   - The **thread/conversation** root element (if visible)

3. **Create CSS selectors** following these rules:
   - **Prioritize stable attributes**: `aria-label`, `data-testid`, `id`, `role`
   - **Use specific classes first**: Unique class names or class combinations
   - **Avoid generic classes alone**: Don't rely solely on `button`, `div`, `flex`, etc.
   - **Create fallback selectors**: List 3-6 selectors per element, from most specific to most generic
   - **Use attribute selectors with wildcards** when appropriate: `[class*="Button_claude"]`, `[aria-label*="Send"]`
   - **Preserve legacy selectors**: Keep old selectors at the end as fallbacks

4. **Update the selectors array** in `utils.js` for the identified website

5. **Explain your changes**: List what you identified and why you chose those selectors

---

## Handling Different HTML Structures

### Common Patterns You'll Encounter:

#### 1. **Custom Web Components** (AIStudio, Gemini)
```html
<ms-chunk-editor>
  <ms-autosize-textarea>
    <textarea aria-label="Type something"></textarea>
  </ms-autosize-textarea>
  <run-button>
    <button type="submit">Run</button>
  </run-button>
</ms-chunk-editor>
```
**Strategy**: 
- Target custom elements: `ms-autosize-textarea textarea`, `run-button button`
- Use descendant selectors: `custom-element descendant`
- Fallback to standard elements inside: `textarea`, `button`

#### 2. **ContentEditable Editors** (Claude, ChatGPT, Perplexity)
```html
<div class="ProseMirror" contenteditable="true" data-testid="chat-input">
  <p>Text here...</p>
</div>
```
**Strategy**:
- Look for `contenteditable="true"` attribute
- Check for editor framework classes: `.ProseMirror`, `.ql-editor`, `[data-lexical-editor]`
- Use `data-testid` or `aria-label` if available
- Examples: `div.ProseMirror[contenteditable="true"]`, `div[data-lexical-editor="true"]`

#### 3. **Standard Textareas** (Grok, Copilot, DeepSeek)
```html
<textarea 
  aria-label="Ask Grok anything" 
  placeholder="Message Copilot"
  class="w-full text-fg-primary">
</textarea>
```
**Strategy**:
- Prioritize `aria-label` or `placeholder`
- Use specific class combinations
- Examples: `textarea[aria-label="Ask Grok anything"]`, `textarea[placeholder*="Message"]`

#### 4. **Buttons with Icons/SVG** (Most sites)
```html
<button aria-label="Send message" type="button" class="send-btn">
  <svg>...</svg>
</button>
```
**Strategy**:
- Use `aria-label` (most stable)
- Check for `data-testid`
- Look for unique classes
- Consider `:has(svg)` if button contains icon
- Examples: `button[aria-label="Send message"]`, `button:has(svg)[type="submit"]`

#### 5. **Nested Button Structures** (AIStudio)
```html
<run-button>
  <button type="submit" class="run-button">Run</button>
</run-button>
```
**Strategy**:
- Target both parent and child: `run-button button[type="submit"]`
- Provide fallback to just the button: `button.run-button`

#### 6. **Shadow DOM / Web Components** (Gemini)
```html
<chat-window>
  <input-container>
    <rich-textarea>
      <div class="ql-editor" contenteditable="true"></div>
    </rich-textarea>
  </input-container>
</chat-window>
```
**Strategy**:
- Target custom elements directly: `chat-window input-container`
- Drill down to standard elements: `rich-textarea div.ql-editor`
- Fallback to generic: `input-container`, `main`

---

## Selector Priority Guidelines

### For Send Buttons:

**Priority Order:**
1. **Unique aria-label + specific class**: `button[aria-label="Send message"][class*="UniqueClass"]`
2. **Unique aria-label + type**: `button[aria-label="Send message"][type="button"]`
3. **data-testid**: `button[data-testid="send-button"]`
4. **Custom element + button**: `run-button button[type="submit"]`
5. **Specific class combinations**: `button.specific-class.another-class`
6. **Contextual selectors**: `form button[type="submit"]`
7. **Generic fallbacks**: `button[type="submit"]`, `button[aria-label*="send" i]`

**Special Cases:**
- If button has unique SVG: `button:has(svg[viewBox="specific"])`
- If button is disabled when empty: `button:not([disabled])`
- If multiple buttons exist: Use more specific parent context

### For Editors:

**Priority Order:**
1. **Unique ID + framework class**: `div.ProseMirror#prompt-textarea[contenteditable="true"]`
2. **Unique aria-label (textarea)**: `textarea[aria-label="Write your prompt to Claude"]`
3. **Unique placeholder**: `textarea[placeholder="Message ChatGPT"]`
4. **data-testid**: `div[data-testid="chat-input"][contenteditable="true"]`
5. **Custom element + editor**: `ms-autosize-textarea textarea`, `rich-textarea div.ql-editor`
6. **Framework class + attribute**: `div.ProseMirror[contenteditable="true"]`, `div[data-lexical-editor="true"]`
7. **Generic with attribute**: `div[contenteditable="true"]`, `textarea`

**Editor Framework Detection:**
- **ProseMirror**: `.ProseMirror[contenteditable="true"]`
- **Lexical**: `[data-lexical-editor="true"]`
- **Quill**: `.ql-editor[contenteditable="true"]`
- **TipTap**: `.tiptap.ProseMirror`
- **Custom**: Look for unique classes or custom elements

### For Containers:

**Priority Order:**
1. **Unique class combinations**: `div.flex.flex-col.bg-bg-000.rounded-2xl`
2. **Form with data attributes**: `form[data-type="unified-composer"]`
3. **Structural with :has()**: `div:has(#prompt-textarea)`, `div:has(textarea[placeholder="Message"])`
4. **Custom elements**: `chat-window input-container`, `ms-chunk-editor`
5. **Child combinator**: `form > div.rounded-\\[28px\\]`
6. **Generic structural**: `footer`, `section`, `main`

**Container Tips:**
- Look for the **immediate parent** of the editor
- Check for **form elements** wrapping the input
- Use **:has()** to find containers with specific children
- Consider **custom elements** as containers

---

## Analyzing New/Unknown Websites

If you receive HTML from a **completely new website** or **unfamiliar structure**, follow this systematic approach:

### Step 1: Identify the Website
- Look for domain-specific text, logos, or unique identifiers
- Check for custom element prefixes (e.g., `ms-` for Microsoft, `grok-` for Grok)
- Look at class naming patterns (e.g., `Button_claude__`, `chatgpt-`, `perplexity-`)

### Step 2: Find the Send Button
**Look for these indicators (in order):**
1. **Text content**: "Send", "Submit", "Run", "Ask", "Go", etc.
2. **aria-label**: `aria-label="Send message"`, `aria-label="Submit"`, `aria-label="Run"`
3. **data-testid**: `data-testid="send-button"`, `data-testid="submit-button"`
4. **Icon/SVG**: Look for buttons containing SVG with upward arrow, paper plane, or send icon
5. **Button type**: `type="submit"` buttons near the input
6. **Position**: Usually to the right of or below the input area
7. **Classes**: Look for classes like `send`, `submit`, `run`, `primary`, `action`

**Red flags (NOT the send button):**
- Buttons with "Cancel", "Clear", "Attach", "Upload", "Settings"
- Disabled buttons: `disabled`, `aria-disabled="true"`
- Hidden buttons: `display: none`, `visibility: hidden`

### Step 3: Find the Editor/Input
**Look for these indicators:**
1. **Textarea**: `<textarea>` elements with relevant `aria-label` or `placeholder`
2. **ContentEditable**: `<div contenteditable="true">` or `<p contenteditable="true">`
3. **Framework classes**: `.ProseMirror`, `.ql-editor`, `[data-lexical-editor]`, `.tiptap`
4. **Custom elements**: `<rich-textarea>`, `<ms-autosize-textarea>`, `<chat-input>`
5. **IDs**: `#prompt-textarea`, `#ask-input`, `#userInput`, `#chat-input`
6. **Placeholder text**: Usually says "Type", "Ask", "Message", "Write", etc.
7. **aria-label**: Describes the input purpose

**Common patterns:**
- ProseMirror: `div.ProseMirror[contenteditable="true"]`
- Lexical: `div[contenteditable="true"][data-lexical-editor="true"]`
- Quill: `div.ql-editor[contenteditable="true"]`
- Plain textarea: `textarea[aria-label*="message" i]`

### Step 4: Find the Container
**Look for the parent element that wraps both editor and button:**
1. **Form elements**: `<form>` wrapping the input area
2. **Semantic elements**: `<footer>`, `<section>`, `<main>` containing the input
3. **Custom elements**: `<input-container>`, `<chat-window>`, `<composer>`
4. **Div with unique classes**: Look for classes suggesting "composer", "input", "editor", "footer"
5. **Structural parent**: The immediate parent of the editor that also contains the button

**Test with :has():**
- `div:has(textarea[placeholder="..."])`
- `form:has(button[aria-label="Send message"])`

### Step 5: Find the Thread Root (Optional)
**Look for the conversation/chat history container:**
1. **Semantic elements**: `<main>`, `<article>`, `<section>` containing messages
2. **Custom elements**: `<chat-history>`, `<infinite-scroller>`, `<conversation>`
3. **Classes**: Look for `thread`, `messages`, `conversation`, `history`, `chat`
4. **data attributes**: `data-testid="conversation"`, `data-content="conversation"`
5. **Scrollable container**: Usually has `overflow-y: auto` or `overflow: scroll`

### Step 6: Create Robust Selectors
**For each element, create 4-6 selectors:**
1. **Most specific**: Combine unique attributes (ID + class + attribute)
2. **Moderately specific**: Use 2-3 identifying features
3. **Framework-aware**: Target editor framework or custom elements
4. **Attribute-based**: Use stable attributes like `aria-label`, `data-testid`
5. **Generic fallback**: Use element type + common attributes
6. **Last resort**: Just the element type (e.g., `textarea`, `button[type="submit"]`)

### Example: Analyzing Unknown Site

**Given this HTML:**
```html
<chat-composer>
  <input-area>
    <custom-editor contenteditable="true" data-editor-id="main">
      <p>Type here...</p>
    </custom-editor>
  </input-area>
  <action-bar>
    <submit-btn>
      <button type="button" data-action="send" aria-label="Send your message">
        <icon-send></icon-send>
      </button>
    </submit-btn>
  </action-bar>
</chat-composer>
```

**Analysis:**
- **Website**: Unknown (custom elements suggest proprietary framework)
- **Send Button**: `<button type="button" data-action="send" aria-label="Send your message">`
- **Editor**: `<custom-editor contenteditable="true" data-editor-id="main">`
- **Container**: `<chat-composer>` or `<input-area>`

**Selectors Created:**
```javascript
sendButtons: [
    'button[data-action="send"][aria-label="Send your message"]', // Most specific
    'submit-btn button[type="button"]', // Custom element + button
    'button[aria-label*="Send" i]', // Flexible aria-label
    'button[data-action="send"]', // Data attribute only
    'action-bar button', // Contextual
    'button[type="button"]' // Generic fallback
],
editors: [
    'custom-editor[contenteditable="true"][data-editor-id="main"]', // Most specific
    'custom-editor[contenteditable="true"]', // Without ID
    'input-area custom-editor', // Contextual
    '[data-editor-id="main"]', // Data attribute
    'div[contenteditable="true"]', // Generic (might not work with custom element)
    '[contenteditable="true"]' // Last resort
],
containers: [
    'chat-composer input-area', // Custom elements
    'chat-composer', // Parent custom element
    'input-area', // Direct parent
    'div:has(custom-editor)', // Structural fallback
]
```

---

## Example Format


When I provide HTML, respond like this:

```
## Analysis

**Website Identified**: Claude

**Send Button Found**:
- Element: `<button aria-label="Send message" class="font-base-bold Button_claude__tTMUm" type="button">`
- Key attributes: `aria-label="Send message"`, `class*="Button_claude"`, `font-base-bold`

**Editor Found**:
- Element: `<div contenteditable="true" class="tiptap ProseMirror" data-testid="chat-input">`
- Key attributes: `contenteditable="true"`, `class="ProseMirror"`, `data-testid="chat-input"`

**Container Found**:
- Element: `<div class="flex flex-col bg-bg-000 rounded-2xl">`
- Key attributes: `class="flex flex-col bg-bg-000 rounded-2xl"`

## Proposed Selectors

### Send Buttons (in priority order):
1. `button[aria-label="Send message"][class*="Button_claude"]` - Most specific, matches Claude-specific class
2. `button[aria-label="Send message"].font-base-bold` - Matches bold font class
3. `button[aria-label="Send message"][type="button"]` - Generic with aria-label
4. `button.bg-accent-main-000.text-oncolor-100` - Legacy fallback
5. `button[type="button"][aria-label="Send message"]` - Generic fallback

### Editors:
1. `div.ProseMirror[contenteditable="true"][data-testid="chat-input"]` - Most specific
2. `div.ProseMirror[contenteditable="true"]` - Fallback without testid
3. `div[contenteditable="true"]` - Generic fallback

### Containers:
1. `div.flex.flex-col.bg-bg-000.rounded-2xl` - Specific class combo
2. `div.flex.flex-col.bg-bg-000` - Slightly less specific
3. `div:has(div.ProseMirror[contenteditable="true"])` - Structural fallback

## Implementation

[Then provide the code update to utils.js]
```

---

## Usage

**To update selectors, provide:**

```
Update selectors for [Website Name]:

[Paste HTML code here - include the input area, send button, and surrounding container]
```

**Example:**

```
Update selectors for Claude:

<div class="flex flex-col bg-bg-000 rounded-2xl">
  <div class="ProseMirror" contenteditable="true" data-testid="chat-input">
    <p>Type here...</p>
  </div>
  <button aria-label="Send message" class="Button_claude__tTMUm" type="button">
    <svg>...</svg>
  </button>
</div>
```

---

## Important Notes

1. **Always test selectors** after updating - ask the user to verify
2. **Keep legacy selectors** as fallbacks - don't delete old ones, move them down
3. **Use comments** to explain what each selector targets
4. **Avoid over-specificity** - don't create selectors that are too fragile
5. **Consider variations** - websites may show different UI states (empty editor, with content, etc.)
6. **Line endings**: LF only (even on Windows)
7. **Encoding**: UTF-8

---

## File Location

**Target file**: `c:\Code\Released Software\OneClickPrompts\utils.js`

**Section to update**: `InjectionTargetsOnWebsite.getDefaultSelectors()` method

**Structure**:
```javascript
getDefaultSelectors(site) {
    const selectors = {
        WebsiteName: {
            containers: [...],
            sendButtons: [...],
            editors: [...],
            threadRoot: '...',
            buttonsContainerId: '...'
        },
        // ... other websites
    };
    return selectors[site] || {};
}
```

---

## Quick Reference: Current Websites

- **ChatGPT**: chatgpt.com, chat.openai.com
- **Claude**: claude.ai
- **Copilot**: github.com/copilot
- **DeepSeek**: chat.deepseek.com
- **AIStudio**: aistudio.google.com
- **Grok**: grok.com
- **Gemini**: gemini.google.com
- **Perplexity**: perplexity.ai

---

## Ready to Use

Simply paste HTML code from any of these websites and say:

**"Update selectors for [Website]: [HTML code]"**

The AI will analyze the HTML, identify the elements, create optimal selectors, and update `utils.js` accordingly.
