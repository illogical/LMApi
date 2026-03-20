# Plan: History Browser — Full Conversation Modal

## Context
The history browser's expanded row currently renders `prompt` and `responseText` inline in a small table cell. For chat requests, the `messages` field (stored as a JSON string) holds the entire conversation array, which can be very large. The inline area is too small for practical use. The goal is to replace it with a dedicated modal that renders the full conversation in a large scrollable view, with a download button, and clears its DOM content on close to reclaim memory.

## Key Fields Available
- `row.messages` — full JSON string of the messages array (chat requests only)
- `row.prompt` — single prompt text (generate requests)
- `row.responseText` — model response
- `row.thinking` — model reasoning output (if present)
- `row.toolCalls` — tool call JSON (if present)

## Implementation Plan

### 1. Add Modal HTML (before `</body>`)
Add a full-screen overlay modal with:
- Large scrollable `<div id="conv-modal-body">` for conversation content
- Header bar showing record ID + model name
- "Download .txt" button
- "✕ Close" button

### 2. Add Modal CSS (inline `<style>` block in `<head>`)
- Overlay: fixed, full viewport, semi-transparent backdrop, `z-index: 1000`
- Modal panel: centered, ~90vw × 90vh, flex column layout
- Body: `overflow-y: auto`, `white-space: pre-wrap`, monospace font, comfortable padding
- Message bubbles: visually distinguish `user`, `assistant`, `system`, `tool` roles with subtle color bands
- Hidden by default (`display: none`), shown with `.conv-modal-open` class on `<body>` or direct style toggle

### 3. Replace Inline Expanded Section
In `renderHistory()`, change the expanded row from inline prompt/response display to a single "View Full Conversation" button:
```html
<button class="btn-view-conv" data-id="${row.id}">View Full Conversation</button>
```
Attach a click handler (delegated on tbody) that calls `openConvModal(row)`.

The existing expand/collapse toggle (`toggleRow`) can remain for the basic prompt/response preview, OR can be replaced entirely by the modal button — **replace entirely** (simpler, matches user intent).

### 4. `openConvModal(row)` Function
1. Parse `row.messages` JSON (if present); fall back to building a synthetic `[{role:'user', content: row.prompt}, {role:'assistant', content: row.responseText}]`
2. Set modal header: `#${row.id} · ${row.modelName}`
3. Render messages into `#conv-modal-body`:
   - Each message as a labeled block: `[ROLE]\n${content}`
   - If `row.thinking` present, prepend a `[THINKING]` block
   - If `row.toolCalls` present, append a `[TOOL CALLS]` block
4. Store formatted text string in closure variable `currentConvText` for download
5. Show modal

### 5. Download Button Handler
- Builds a `Blob` from `currentConvText` (type `text/plain`)
- Creates a temporary `<a>` with `download` attribute: `conversation-${row.id}.txt`
- Clicks it and revokes the object URL immediately after

### 6. Close Button Handler
- Hide modal
- Set `#conv-modal-body` innerHTML to `''` — clears rendered DOM
- Set `currentConvText = null` — releases string reference

### 7. Keyboard Support
- `Escape` key closes the modal (add/remove listener when modal opens/closes)
- Click on backdrop (outside modal panel) closes modal

## Files to Modify
- `src/public/history-browser.html` — all changes are self-contained here

## No Backend Changes Needed
The `messages` field is already returned by `/api/prompt-history`. No new endpoints required.

## Verification
1. Start server (`npm run dev`)
2. Open `/history` in browser
3. Click any row → modal opens immediately with full conversation
4. Click "Download .txt" → `.txt` file downloads with full conversation content
5. Click ✕ or press Escape or click backdrop → modal closes, `#conv-modal-body` is empty (verify in DevTools Elements panel)
6. For generate (non-chat) requests where `messages` is null → modal falls back to prompt/response display gracefully
