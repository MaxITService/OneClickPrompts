// floating-panel-ui-queue-dnd.js
// Version: 1.0
// Documentation:
// Provides pointer drag-and-drop reordering for queued prompts in every queue
// surface. Implements FLIP-style transitions to animate item movement and
// gracefully handles edge cases (queue item dispatched while dragging).
// Also implements dragging toolbar buttons/separators (inline toolbar and
// floating panel) to reorder them, and dropping prompt buttons onto a visible
// queue surface to enqueue them; see the section at the bottom.
// Extends window.MaxExtensionFloatingPanel with helper methods consumed by
// floating-panel-ui-queue.js, buttons.js and buttons-init-and-render.js
// (registerButtonDragSource).

'use strict';

const QUEUE_LONG_PRESS_MS = 80;
const QUEUE_DRAG_MOVE_THRESHOLD = 6;

window.MaxExtensionFloatingPanel.initializeQueueDragAndDrop = function () {
    if (this.queueDragInitialized) {
        return;
    }

    this.queueDragInitialized = true;
    this.queueDndState = {
        preRenderRects: null,
        pendingDrag: null,
        pressTimer: null,
        isActive: false,
        pointerId: null,
        preventClick: false,
        draggingId: null,
        draggingElement: null,
        placeholderElement: null,
        placeholderIndex: -1,
        originIndex: -1,
        dragStartPointer: null,
        containerRect: null,
        draggingDimensions: null,
        dragScale: 1,
        pointerLast: null,
        activeDisplayArea: null,
        // True while the pointer is outside every queue surface: releasing then
        // removes the item instead of reordering it.
        removeIntent: false
    };

    this.queueDndState.boundPointerMove = (event) => this.handleQueuePointerMove(event);
    this.queueDndState.boundPointerUp = (event) => this.handleQueuePointerUp(event);
    this.queueDndState.boundPointerCancel = (event) => this.handleQueuePointerCancel(event);
};

window.MaxExtensionFloatingPanel.decorateQueueItemForDrag = function (element, item, index, displayArea = this.queueDisplayArea) {
    if (!this.queueDndState || !displayArea) return;
    element.addEventListener('pointerdown', (event) => this.handleQueuePointerDown(event, item, index, element, displayArea));
};

window.MaxExtensionFloatingPanel.getActiveQueueDragArea = function () {
    return this.queueDndState?.activeDisplayArea || this.queueDisplayArea || null;
};

window.MaxExtensionFloatingPanel.handleQueueItemClick = function (event, index) {
    const state = this.queueDndState;
    if (state && (state.isActive || state.preventClick)) {
        event.preventDefault();
        event.stopPropagation();
        return;
    }
    const removed = this.removeFromQueue(index);
    if (removed) {
        this.offerQueueRemovalUndo?.(removed, index);
    }
};

window.MaxExtensionFloatingPanel.captureQueuePreRender = function () {
    const displayArea = this.getActiveQueueDragArea?.();
    if (!displayArea || !this.queueDndState) return;
    const map = new Map();
    const children = Array.from(displayArea.children);
    children.forEach((child, index) => {
        const queueId = child.dataset?.queueId;
        if (!queueId) return;
        map.set(queueId, child.getBoundingClientRect());
    });
    this.queueDndState.preRenderRects = map;
};

window.MaxExtensionFloatingPanel.applyQueuePostRenderEffects = function () {
    const displayArea = this.getActiveQueueDragArea?.();
    if (!displayArea || !this.queueDndState) return;
    const state = this.queueDndState;

    if (state.preRenderRects) {
        const children = Array.from(displayArea.children);
        children.forEach((child) => {
            const queueId = child.dataset?.queueId;
            if (!queueId) return;
            if (state.isActive && queueId === state.draggingId) {
                return;
            }
            const previousRect = state.preRenderRects.get(queueId);
            if (!previousRect) return;
            const newRect = child.getBoundingClientRect();
            const deltaX = previousRect.left - newRect.left;
            const deltaY = previousRect.top - newRect.top;
            if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return;

            child.style.transition = 'none';
            child.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
            requestAnimationFrame(() => {
                child.style.transition = 'transform 180ms ease';
                child.style.transform = '';
            });
        });
        state.preRenderRects = null;
    }

    if (state.isActive) {
        this.restoreDragArtifactsAfterRender();
    }
};

window.MaxExtensionFloatingPanel.restoreDragArtifactsAfterRender = function () {
    const displayArea = this.getActiveQueueDragArea?.();
    if (!displayArea || !this.queueDndState) return;
    const state = this.queueDndState;

    const replacement = state.draggingId
        ? displayArea.querySelector(`[data-queue-id="${state.draggingId}"]`)
        : null;

    if (!replacement) {
        this.cancelActiveQueueDrag({ reason: 'lost' });
        return;
    }

    state.draggingElement = replacement;
    const containerRect = displayArea.getBoundingClientRect();
    const elementRect = replacement.getBoundingClientRect();
    const dragScale = this.getQueueDragScale(displayArea);
    state.containerRect = containerRect;
    state.dragScale = dragScale;
    state.draggingDimensions = {
        width: elementRect.width / dragScale,
        height: elementRect.height / dragScale
    };

    replacement.classList.add('max-extension-queued-item--dragging');
    replacement.classList.toggle('max-extension-queued-item--remove-intent', state.removeIntent === true);
    replacement.style.position = 'absolute';
    replacement.style.zIndex = '3';
    replacement.style.pointerEvents = 'none';
    replacement.style.left = `${(elementRect.left - containerRect.left) / dragScale}px`;
    replacement.style.top = `${(elementRect.top - containerRect.top) / dragScale}px`;
    replacement.style.width = `${state.draggingDimensions.width}px`;
    replacement.style.height = `${state.draggingDimensions.height}px`;
    replacement.style.transform = 'translate(0, 0) scale(1.05)';

    if (!state.placeholderElement) {
        const placeholder = document.createElement('div');
        placeholder.className = 'max-extension-queued-item max-extension-queued-item--placeholder';
        state.placeholderElement = placeholder;
    }
    state.placeholderElement.style.width = `${state.draggingDimensions.width}px`;
    state.placeholderElement.style.height = `${state.draggingDimensions.height}px`;

    // While the pointer is outside every queue surface the list stays closed up
    // (no placeholder); it is re-inserted when the pointer comes back.
    if (!state.removeIntent && !displayArea.contains(state.placeholderElement)) {
        const siblings = Array.from(displayArea.children).filter((child) => child !== replacement);
        const target = (state.placeholderIndex >= 0 && state.placeholderIndex < siblings.length)
            ? siblings[state.placeholderIndex]
            : null;
        if (target) {
            displayArea.insertBefore(state.placeholderElement, target);
        } else {
            displayArea.appendChild(state.placeholderElement);
        }
    }

    displayArea.appendChild(replacement);
    displayArea.classList.add('max-extension-queue-drag-active');
};

window.MaxExtensionFloatingPanel.handleQueuePointerDown = function (event, item, index, element, displayArea) {
    if (!this.queueDndState || !displayArea?.contains(element)) return;
    if (event.button !== 0) return;

    const state = this.queueDndState;

    if (state.isActive) {
        event.preventDefault();
        return;
    }

    state.pendingDrag = {
        queueId: item.queueId,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        index,
        element,
        displayArea
    };
    state.pressTimer = setTimeout(() => {
        this.startQueueDrag(state.pendingDrag);
    }, QUEUE_LONG_PRESS_MS);

    this.attachQueuePointerListeners();
};

window.MaxExtensionFloatingPanel.handleQueuePointerMove = function (event) {
    const state = this.queueDndState;
    if (!state) return;

    if (state.pendingDrag && !state.isActive) {
        state.pendingDrag.latestX = event.clientX;
        state.pendingDrag.latestY = event.clientY;
        const dx = event.clientX - state.pendingDrag.startX;
        const dy = event.clientY - state.pendingDrag.startY;
        if (Math.hypot(dx, dy) > QUEUE_DRAG_MOVE_THRESHOLD) {
            const pendingDrag = state.pendingDrag;
            this.startQueueDrag(pendingDrag);
            if (state.isActive) {
                event.preventDefault();
                this.updateQueueDragPosition(event);
            }
        }
        return;
    }

    if (!state.isActive || state.pointerId !== event.pointerId) {
        return;
    }

    event.preventDefault();
    this.updateQueueDragPosition(event);
};

window.MaxExtensionFloatingPanel.handleQueuePointerUp = function (event) {
    const state = this.queueDndState;
    if (!state) return;

    if (state.pendingDrag && state.pendingDrag.pointerId === event.pointerId && !state.isActive) {
        this.clearPendingDrag();
        this.detachQueuePointerListeners();
        return;
    }

    if (!state.isActive || state.pointerId !== event.pointerId) {
        return;
    }

    this.completeQueueDrag();
    this.detachQueuePointerListeners();
};

window.MaxExtensionFloatingPanel.handleQueuePointerCancel = function (event) {
    const state = this.queueDndState;
    if (!state) return;

    if (state.isActive && state.pointerId === event.pointerId) {
        this.cancelActiveQueueDrag();
    }
    this.clearPendingDrag();
    this.detachQueuePointerListeners();
};

window.MaxExtensionFloatingPanel.startQueueDrag = function (pendingDrag) {
    if (!pendingDrag || !this.queueDndState || !pendingDrag.displayArea) return;

    const state = this.queueDndState;
    const element = pendingDrag.element;
    const displayArea = pendingDrag.displayArea;
    if (!element || !element.isConnected || !displayArea.contains(element)) {
        this.clearPendingDrag();
        return;
    }

    const containerRect = displayArea.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const dragScale = this.getQueueDragScale(displayArea);

    state.isActive = true;
    state.activeDisplayArea = displayArea;
    state.pointerId = pendingDrag.pointerId;
    state.draggingId = pendingDrag.queueId;
    state.draggingElement = element;
    state.originIndex = pendingDrag.index;
    state.dragStartPointer = {
        x: pendingDrag.latestX ?? pendingDrag.startX,
        y: pendingDrag.latestY ?? pendingDrag.startY
    };
    state.containerRect = containerRect;
    state.dragScale = dragScale;
    state.draggingDimensions = {
        width: elementRect.width / dragScale,
        height: elementRect.height / dragScale
    };
    state.placeholderIndex = pendingDrag.index;
    state.pendingDrag = null;
    if (state.pressTimer) {
        clearTimeout(state.pressTimer);
        state.pressTimer = null;
    }

    const placeholder = document.createElement('div');
    placeholder.className = 'max-extension-queued-item max-extension-queued-item--placeholder';
    placeholder.style.width = `${state.draggingDimensions.width}px`;
    placeholder.style.height = `${state.draggingDimensions.height}px`;
    state.placeholderElement = placeholder;

    displayArea.insertBefore(placeholder, element);
    displayArea.appendChild(element);

    element.classList.add('max-extension-queued-item--dragging');
    element.style.position = 'absolute';
    element.style.zIndex = '3';
    element.style.pointerEvents = 'none';
    element.style.left = `${(elementRect.left - containerRect.left) / dragScale}px`;
    element.style.top = `${(elementRect.top - containerRect.top) / dragScale}px`;
    element.style.width = `${state.draggingDimensions.width}px`;
    element.style.height = `${state.draggingDimensions.height}px`;
    element.style.transform = 'translate(0, 0) scale(1.05)';

    displayArea.classList.add('max-extension-queue-drag-active');
};

window.MaxExtensionFloatingPanel.updateQueueDragPosition = function (event) {
    const state = this.queueDndState;
    if (!state || !state.isActive || !state.draggingElement) return;

    const dx = event.clientX - state.dragStartPointer.x;
    const dy = event.clientY - state.dragStartPointer.y;
    const dragScale = state.dragScale || this.getQueueDragScale(state.activeDisplayArea);
    state.draggingElement.style.transform = `translate(${dx / dragScale}px, ${dy / dragScale}px) scale(1.05)`;
    state.pointerLast = { x: event.clientX, y: event.clientY };

    // Leaving every queue surface (with a margin) switches to "release to
    // remove"; coming back restores normal reordering.
    this.setQueueDragRemoveIntent(!this.isPointerOverAnyQueueSurface(event.clientX, event.clientY));
    if (state.removeIntent) return;
    this.updateQueuePlaceholderPosition(event.clientX, event.clientY);
};

/**
 * True when the pointer is over any queue surface (same test as
 * resolveQueueDropTarget) or within BUTTON_DRAG_CONTAINER_MARGIN of a visible
 * queue display area. Outside of that a dragged queued item is removed on release.
 */
window.MaxExtensionFloatingPanel.isPointerOverAnyQueueSurface = function (clientX, clientY) {
    if (this.resolveQueueDropTarget?.(clientX, clientY)) return true;
    const margin = BUTTON_DRAG_CONTAINER_MARGIN;
    const displayAreas = typeof this.getQueueDisplayAreas === 'function'
        ? this.getQueueDisplayAreas()
        : [this.queueDisplayArea].filter(Boolean);
    return displayAreas.some((displayArea) => {
        const rect = displayArea.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false; // hidden surface
        return clientX >= rect.left - margin
            && clientX <= rect.right + margin
            && clientY >= rect.top - margin
            && clientY <= rect.bottom + margin;
    });
};

/**
 * Toggles the "drag out to remove" state of the active queued-item drag: the
 * placeholder is pulled out so the list closes up (FLIP) and the dragged item
 * is dimmed with a trash hint; the reverse puts the placeholder back in the
 * slot it had. Survives a mid-drag re-render via restoreDragArtifactsAfterRender.
 */
window.MaxExtensionFloatingPanel.setQueueDragRemoveIntent = function (enabled) {
    const state = this.queueDndState;
    const displayArea = this.getActiveQueueDragArea?.();
    if (!state?.isActive || !displayArea || state.removeIntent === enabled) return;
    state.removeIntent = enabled;

    const dragging = state.draggingElement;
    const placeholder = state.placeholderElement;
    const beforeRects = this.captureQueueSiblingRects(displayArea);
    if (enabled) {
        if (placeholder && displayArea.contains(placeholder)) {
            displayArea.removeChild(placeholder);
        }
    } else if (placeholder && !displayArea.contains(placeholder)) {
        const siblings = Array.from(displayArea.children).filter((child) => child !== dragging);
        const target = (state.placeholderIndex >= 0 && state.placeholderIndex < siblings.length)
            ? siblings[state.placeholderIndex]
            : null;
        displayArea.insertBefore(placeholder, target);
    }
    dragging?.classList.toggle('max-extension-queued-item--remove-intent', enabled);
    this.playQueueSiblingsFlip(beforeRects, state.dragScale);
    state.containerRect = displayArea.getBoundingClientRect();
};

window.MaxExtensionFloatingPanel.captureQueueSiblingRects = function (displayArea) {
    const state = this.queueDndState;
    const rects = new Map();
    Array.from(displayArea.children).forEach((child) => {
        if (child === state?.draggingElement || child === state?.placeholderElement) return;
        rects.set(child, child.getBoundingClientRect());
    });
    return rects;
};

window.MaxExtensionFloatingPanel.playQueueSiblingsFlip = function (beforeRects, dragScale = 1) {
    const scale = Number.isFinite(dragScale) && dragScale > 0 ? dragScale : 1;
    beforeRects.forEach((previousRect, child) => {
        if (!child.isConnected) return;
        const newRect = child.getBoundingClientRect();
        const deltaX = (previousRect.left - newRect.left) / scale;
        const deltaY = (previousRect.top - newRect.top) / scale;
        if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return;
        child.style.transition = 'none';
        child.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
        requestAnimationFrame(() => {
            child.style.transition = 'transform 180ms ease';
            child.style.transform = '';
        });
    });
};

window.MaxExtensionFloatingPanel.getQueueDragScale = function (displayArea = this.getActiveQueueDragArea?.()) {
    if (displayArea && displayArea === this.inlineQueueControls?.queueDisplayArea) return 1;
    const scale = typeof this.getPanelScale === 'function' ? this.getPanelScale() : 1;
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
};

window.MaxExtensionFloatingPanel.updateQueuePlaceholderPosition = function (clientX, clientY) {
    const displayArea = this.getActiveQueueDragArea?.();
    if (!this.queueDndState || !displayArea) return;
    const state = this.queueDndState;
    const placeholder = state.placeholderElement;
    const dragging = state.draggingElement;
    if (!placeholder || !dragging) return;

    const containerRect = state.containerRect || displayArea.getBoundingClientRect();

    const clampToStart = clientY < containerRect.top || clientX < containerRect.left;
    const clampToEnd = clientY > containerRect.bottom || clientX > containerRect.right;

    if (clampToStart) {
        displayArea.insertBefore(placeholder, displayArea.firstChild);
        state.placeholderIndex = 0;
        return;
    }

    if (clampToEnd) {
        displayArea.insertBefore(placeholder, dragging);
        state.placeholderIndex = Array.from(displayArea.children).filter((child) => child !== dragging).length - 1;
        return;
    }

    const pointElement = document.elementFromPoint(clientX, clientY);
    const targetItem = pointElement
        ? pointElement.closest('.max-extension-queued-item')
        : null;

    if (!targetItem || !displayArea.contains(targetItem) || targetItem === dragging || targetItem === placeholder) {
        return;
    }

    const targetRect = targetItem.getBoundingClientRect();
    const insertAfter = clientX > targetRect.left + (targetRect.width / 2);
    let referenceNode = insertAfter ? targetItem.nextSibling : targetItem;
    while (referenceNode === dragging) {
        referenceNode = referenceNode?.nextSibling ?? null;
    }

    displayArea.insertBefore(placeholder, referenceNode);
    this.computePlaceholderIndex();
};

window.MaxExtensionFloatingPanel.computePlaceholderIndex = function () {
    const state = this.queueDndState;
    const displayArea = this.getActiveQueueDragArea?.();
    if (!state || !state.placeholderElement || !displayArea) return -1;
    const siblings = Array.from(displayArea.children).filter((child) => child !== state.draggingElement);
    const index = siblings.indexOf(state.placeholderElement);
    state.placeholderIndex = index;
    return index;
};

window.MaxExtensionFloatingPanel.completeQueueDrag = function () {
    const state = this.queueDndState;
    if (!state || !state.isActive) return;

    const queueId = state.draggingId;
    if (!queueId) {
        this.cancelActiveQueueDrag();
        return;
    }

    const targetIndex = this.computePlaceholderIndex();
    const currentIndex = this.promptQueue.findIndex((entry) => entry.queueId === queueId);
    if (currentIndex === -1) {
        this.cancelActiveQueueDrag({ reason: 'lost' });
        return;
    }

    const removeIntent = state.removeIntent === true;
    this.teardownDragVisuals();
    state.isActive = false;
    state.preventClick = true;
    setTimeout(() => { state.preventClick = false; }, 0);

    if (removeIntent) {
        // Released outside every queue surface: remove instead of reorder, with
        // the same Undo chip as click-to-remove.
        this.resetCompletedQueueDragState();
        const removed = this.removeFromQueue(currentIndex);
        if (removed) {
            this.offerQueueRemovalUndo?.(removed, currentIndex);
            logConCgp('[queue-dnd] Queued item dragged out of the queue and removed:', removed.text);
        } else {
            this.syncQueueUiFromState?.();
        }
        return;
    }

    if (targetIndex === -1 || targetIndex === currentIndex) {
        this.syncQueueUiFromState?.();
        this.resetCompletedQueueDragState();
        return;
    }

    const reordered = this.queueRuntime?.reorder(currentIndex, targetIndex);
    if (!reordered) {
        this.queueRuntime?.notifyState();
        this.resetCompletedQueueDragState();
        return;
    }
    this.resetCompletedQueueDragState();
    if (typeof showToast === 'function') {
        showToast('Queue order updated.', 'info', 2000);
    }
};

window.MaxExtensionFloatingPanel.resetCompletedQueueDragState = function () {
    const state = this.queueDndState;
    if (!state) return;
    state.draggingId = null;
    state.draggingElement = null;
    state.placeholderElement = null;
    state.placeholderIndex = -1;
    state.originIndex = -1;
    state.pointerId = null;
    state.dragStartPointer = null;
    state.containerRect = null;
    state.draggingDimensions = null;
    state.pointerLast = null;
    state.activeDisplayArea = null;
    state.removeIntent = false;
};

window.MaxExtensionFloatingPanel.cancelActiveQueueDrag = function (options = {}) {
    if (!this.queueDndState) return;
    const state = this.queueDndState;
    this.teardownDragVisuals();

    state.isActive = false;
    state.draggingId = null;
    state.draggingElement = null;
    state.placeholderElement = null;
    state.placeholderIndex = -1;
    state.originIndex = -1;
    state.pointerId = null;
    state.dragStartPointer = null;
    state.containerRect = null;
    state.draggingDimensions = null;
    state.pointerLast = null;
    state.activeDisplayArea = null;
    state.removeIntent = false;

    if (options.reason === 'lost' && typeof showToast === 'function') {
        showToast('Queued prompt was sent while dragging.', 'info', 3500);
    }

    this.detachQueuePointerListeners();
    this.clearPendingDrag();
};

window.MaxExtensionFloatingPanel.teardownDragVisuals = function () {
    const state = this.queueDndState;
    if (!state) return;
    const displayArea = this.getActiveQueueDragArea?.();

    if (state.draggingElement) {
        const el = state.draggingElement;
        el.classList.remove('max-extension-queued-item--dragging', 'max-extension-queued-item--remove-intent');
        el.style.position = '';
        el.style.zIndex = '';
        el.style.pointerEvents = '';
        el.style.left = '';
        el.style.top = '';
        el.style.width = '';
        el.style.height = '';
        el.style.transform = '';
    }

    if (state.placeholderElement && displayArea?.contains(state.placeholderElement)) {
        displayArea.removeChild(state.placeholderElement);
    }

    if (displayArea) {
        displayArea.classList.remove('max-extension-queue-drag-active');
    }
};

window.MaxExtensionFloatingPanel.attachQueuePointerListeners = function () {
    const state = this.queueDndState;
    if (!state) return;
    window.addEventListener('pointermove', state.boundPointerMove, { passive: false });
    window.addEventListener('pointerup', state.boundPointerUp);
    window.addEventListener('pointercancel', state.boundPointerCancel);
};

window.MaxExtensionFloatingPanel.detachQueuePointerListeners = function () {
    const state = this.queueDndState;
    if (!state) return;
    window.removeEventListener('pointermove', state.boundPointerMove);
    window.removeEventListener('pointerup', state.boundPointerUp);
    window.removeEventListener('pointercancel', state.boundPointerCancel);
};

window.MaxExtensionFloatingPanel.clearPendingDrag = function () {
    const state = this.queueDndState;
    if (!state) return;
    if (state.pressTimer) {
        clearTimeout(state.pressTimer);
        state.pressTimer = null;
    }
    state.pendingDrag = null;
};

// ---------------------------------------------------------------------------
// Prompt button drag: reorder in place, or drop onto the queue
// ---------------------------------------------------------------------------
// Every button and separator in a buttons container can be dragged without
// entering edit mode. While the pointer is over the toolbar the element is
// reordered live (same FLIP helpers as MaxExtensionButtonEditMode). Regular
// prompt buttons can additionally be dropped onto a *visible* queue surface to
// enqueue them; separators and system buttons are reorder-only. Nothing is
// revealed by a drag: hidden/dismissed queue bars stay hidden.
// Releasing outside the toolbar (and not on a queue) cancels the reorder.
// Clicking still sends: a drag only starts after BUTTON_DRAG_THRESHOLD px.
// Touch/pen pointers start a drag by a stationary long-press instead (same
// QUEUE_LONG_PRESS_MS / QUEUE_DRAG_MOVE_THRESHOLD as queued items), so a tap
// still clicks and a swipe over the toolbar still scrolls the page.
// Button edit mode owns the pointer while it is on, so this stays idle then.
// Advanced-tab kill switch: OneClickPromptsSelectorAutoDetector.settings
// .enableButtonDragAndDrop (checked at pointer-down, so it applies live).

const BUTTON_DRAG_THRESHOLD = 5;
// Pointer may leave the toolbar box by this much and still count as "inside"
// for reordering; releasing further away cancels the reorder.
const BUTTON_DRAG_CONTAINER_MARGIN = 24;
const BUTTON_CONTAINER_SELECTOR = '[id$="-custom-buttons-container"]';
const QUEUE_DROP_AREA_SELECTOR = '.max-extension-inline-queue-items, #max-extension-queue-display';
const QUEUE_DROP_SURFACE_SELECTOR = '.max-extension-inline-queue-controls, #max-extension-queue-section';
const QUEUE_DROP_SKIP_ITEM_SELECTOR = '.max-extension-queued-item--placeholder, .max-extension-queued-item--dragging';

window.MaxExtensionFloatingPanel.initializeButtonDrag = function () {
    if (this.buttonDragState) return;
    this.buttonDragState = {
        pending: null,
        active: null,
        // Long-press timer for touch/pen pointers (null for mouse).
        pressTimer: null,
        // Last persisted reorder that can still be undone (one at a time).
        pendingReorderUndo: null,
        boundMove: (event) => this.handleButtonDragPointerMove(event),
        boundUp: (event) => this.handleButtonDragPointerUp(event),
        boundCancel: (event) => this.handleButtonDragPointerCancel(event),
        boundKeydown: (event) => {
            if (event.key !== 'Escape' || !this.buttonDragState?.active) return;
            event.preventDefault();
            event.stopPropagation();
            this.cancelButtonDrag('escape');
        }
    };
};

/**
 * Makes a toolbar element draggable. Idempotent per element.
 * @param {HTMLElement} element
 * @param {{ buttonConfig?: object, queueDroppable?: boolean }} options -
 *   `queueDroppable` (needs `buttonConfig`) allows dropping onto the queue;
 *   reordering needs the element to carry `data-ocp-button-edit-index`.
 * For buttons this must run before the send click listener is attached so the
 * post-drag click suppression can stop it via stopImmediatePropagation.
 */
window.MaxExtensionFloatingPanel.registerButtonDragSource = function (element, options = {}) {
    if (!element || element.__ocpButtonDragSourceBound) return;
    this.initializeButtonDrag();
    element.__ocpButtonDragSourceBound = true;
    element.classList.add('ocp-button-drag-source');

    const buttonConfig = options.buttonConfig || null;
    const queueDroppable = options.queueDroppable === true && Boolean(buttonConfig);
    element.addEventListener('pointerdown', (event) => this.handleButtonDragPointerDown(event, element, buttonConfig, queueDroppable));
    element.addEventListener('click', (event) => {
        if (!element.__ocpSuppressDragClick) return;
        element.__ocpSuppressDragClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
    });
    // Touch: once a drag is active the browser must not turn the gesture into a
    // page scroll (which would fire pointercancel and kill the drag). touch-action
    // is fixed when the touch starts, so the class alone cannot stop a gesture
    // already in flight; cancelling touchmove can. Only while THIS element is
    // being dragged, so idle buttons never block scrolling.
    element.addEventListener('touchmove', (event) => {
        if (this.buttonDragState?.active?.element !== element || !event.cancelable) return;
        event.preventDefault();
    }, { passive: false });
    // A long-press on touch also opens the context menu; not while dragging.
    element.addEventListener('contextmenu', (event) => {
        if (this.buttonDragState?.active?.element === element) event.preventDefault();
    });
};

/**
 * @returns {string|null} Why a drag may not start right now, or null if it may.
 */
window.MaxExtensionFloatingPanel.getButtonDragRefusalReason = function (element) {
    if (!element || element.disabled) return 'disabled element';
    if (window.OneClickPromptsSelectorAutoDetector?.settings?.enableButtonDragAndDrop === false) return 'setting off';
    if (window.MaxExtensionButtonEditMode?.active) return 'edit mode active';
    if (this.queueDndState?.isActive) return 'queue-item drag active';
    return null;
};

window.MaxExtensionFloatingPanel.isButtonDragAllowed = function (element) {
    return this.getButtonDragRefusalReason(element) === null;
};

window.MaxExtensionFloatingPanel.handleButtonDragPointerDown = function (event, element, buttonConfig, queueDroppable) {
    const state = this.buttonDragState;
    if (!state || event.button !== 0 || state.active || state.pending) return;
    const refusalReason = this.getButtonDragRefusalReason(element);
    if (refusalReason) {
        logConCgp(`[button-dnd] Drag refused at pointer-down: ${refusalReason}`);
        return;
    }

    // Mouse: drag after BUTTON_DRAG_THRESHOLD px. Touch/pen: stationary
    // long-press; moving before the timer fires is a scroll, not a drag.
    const longPress = event.pointerType !== 'mouse';
    state.pending = {
        element,
        buttonConfig,
        queueDroppable,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        latestX: event.clientX,
        latestY: event.clientY,
        longPress
    };
    if (longPress) {
        element.classList.add('ocp-button-drag-source--pending');
        state.pressTimer = setTimeout(() => {
            state.pressTimer = null;
            const pending = state.pending;
            if (!pending || pending.pointerId !== event.pointerId || state.active) return;
            this.startButtonDrag(pending, { clientX: pending.latestX, clientY: pending.latestY });
        }, QUEUE_LONG_PRESS_MS);
    }
    this.attachButtonDragPointerListeners();
};

window.MaxExtensionFloatingPanel.handleButtonDragPointerMove = function (event) {
    const state = this.buttonDragState;
    if (!state) return;

    if (state.pending && !state.active) {
        if (state.pending.pointerId !== event.pointerId) return;
        const distance = Math.hypot(event.clientX - state.pending.startX, event.clientY - state.pending.startY);
        if (state.pending.longPress) {
            state.pending.latestX = event.clientX;
            state.pending.latestY = event.clientY;
            // Finger moved before the long-press fired: let the page scroll.
            if (distance > QUEUE_DRAG_MOVE_THRESHOLD) this.clearPendingButtonDrag();
            return;
        }
        if (distance < BUTTON_DRAG_THRESHOLD) return;
        this.startButtonDrag(state.pending, event);
        if (!state.active) return;
    }

    if (!state.active || state.active.pointerId !== event.pointerId) return;
    event.preventDefault();
    this.updateButtonDragPosition(event);
};

window.MaxExtensionFloatingPanel.handleButtonDragPointerUp = function (event) {
    const state = this.buttonDragState;
    if (!state) return;

    if (state.pending && !state.active) {
        if (state.pending.pointerId !== event.pointerId) return;
        this.clearPendingButtonDrag();
        return;
    }

    if (!state.active || state.active.pointerId !== event.pointerId) return;
    event.preventDefault();
    this.updateButtonDragPosition(event);
    this.completeButtonDrag();
};

window.MaxExtensionFloatingPanel.handleButtonDragPointerCancel = function (event) {
    const state = this.buttonDragState;
    if (!state) return;
    if (state.active && state.active.pointerId !== event.pointerId) return;
    if (state.pending && !state.active && state.pending.pointerId !== event.pointerId) return;
    this.cancelButtonDrag('pointercancel');
};

window.MaxExtensionFloatingPanel.clearPendingButtonDrag = function () {
    const state = this.buttonDragState;
    if (!state) return;
    if (state.pressTimer) {
        clearTimeout(state.pressTimer);
        state.pressTimer = null;
    }
    state.pending?.element?.classList.remove('ocp-button-drag-source--pending');
    state.pending = null;
    this.detachButtonDragPointerListeners();
};

window.MaxExtensionFloatingPanel.startButtonDrag = function (pending, event) {
    const state = this.buttonDragState;
    if (!state || !pending) return;
    const element = pending.element;
    const refusalReason = element?.isConnected ? this.getButtonDragRefusalReason(element) : 'element detached';
    if (refusalReason) {
        logConCgp(`[button-dnd] Drag refused at start: ${refusalReason}`);
        this.clearPendingButtonDrag();
        return;
    }
    if (state.pressTimer) {
        clearTimeout(state.pressTimer);
        state.pressTimer = null;
    }
    element.classList.remove('ocp-button-drag-source--pending');

    const container = element.closest(BUTTON_CONTAINER_SELECTOR);
    const canReorder = Boolean(container) && Number.isInteger(Number(element.dataset.ocpButtonEditIndex));
    const isSeparator = element.dataset.ocpButtonEditKind === 'separator';
    const kind = isSeparator ? 'separator' : (pending.queueDroppable ? 'prompt' : 'system');
    logConCgp(`[button-dnd] Drag start: kind=${kind} editIndex=${element.dataset.ocpButtonEditIndex ?? 'none'} queueDroppable=${pending.queueDroppable} container=${container?.id || 'none'}`);

    // Same ghost strategy as button edit mode: fixed-position clone on
    // document.body (no transformed/zoomed ancestor), sized to the layout box and
    // scaled by the measured visual scale so it looks identical to the source.
    // The source stays in flow (hidden) so live reordering reflows its siblings.
    const rect = element.getBoundingClientRect();
    const layoutWidth = element.offsetWidth || rect.width;
    const layoutHeight = element.offsetHeight || rect.height;
    const ghost = element.cloneNode(true);
    ghost.querySelectorAll('.ocp-button-delete-x').forEach((node) => node.remove());
    ghost.removeAttribute('id');
    ghost.removeAttribute('data-testid');
    ghost.removeAttribute('title');
    ghost.removeAttribute('data-ocp-tooltip');
    ghost.removeAttribute('data-ocp-tooltip-attached');
    ghost.className = 'ocp-button-drag-ghost';
    ghost.classList.toggle('ocp-button-drag-ghost--separator', isSeparator);
    // Keep the source's inline styles (font-size, padding) so the icon renders
    // identically; only geometry and margins are overridden.
    ghost.style.cssText += `;
        margin: 0;
        left: ${rect.left}px;
        top: ${rect.top}px;
        width: ${layoutWidth}px;
        height: ${layoutHeight}px;
        transform: scale(${layoutWidth ? rect.width / layoutWidth : 1}, ${layoutHeight ? rect.height / layoutHeight : 1});
    `;
    document.body.appendChild(ghost);

    state.active = {
        element,
        container,
        canReorder,
        buttonConfig: pending.buttonConfig,
        queueDroppable: pending.queueDroppable,
        pointerId: pending.pointerId,
        ghost,
        offsetX: pending.startX - rect.left,
        offsetY: pending.startY - rect.top,
        originalParent: element.parentNode,
        originalNextSibling: element.nextElementSibling,
        insideContainer: true,
        target: null,
        indicator: null,
        // Pointer went past the drag threshold at least once. A touch long-press
        // that never moves is a slow tap: its click must still go through.
        moved: !pending.longPress,
        startX: pending.startX,
        startY: pending.startY,
        // Over a queue surface with something that cannot be queued.
        blockedOnQueue: false
    };
    state.pending = null;

    element.classList.add('ocp-button-drag-source--active');
    element.style.visibility = 'hidden';
    // Keep receiving the pointer even if it leaves the element/document.
    try {
        element.setPointerCapture?.(pending.pointerId);
    } catch (_) {
        // Pointer already released; window listeners still cover this drag.
    }
    document.body.classList.add('ocp-button-dragging');
    document.body.classList.toggle('ocp-queue-button-dragging', pending.queueDroppable);
    document.addEventListener('keydown', state.boundKeydown, true);
    this.updateButtonDragPosition(event);
};

window.MaxExtensionFloatingPanel.updateButtonDragPosition = function (event) {
    const active = this.buttonDragState?.active;
    if (!active) return;
    active.ghost.style.left = `${event.clientX - active.offsetX}px`;
    active.ghost.style.top = `${event.clientY - active.offsetY}px`;
    if (!active.moved && Math.hypot(event.clientX - active.startX, event.clientY - active.startY) >= BUTTON_DRAG_THRESHOLD) {
        active.moved = true;
    }

    const queueTarget = this.resolveQueueDropTarget(event.clientX, event.clientY);
    const overQueue = Boolean(queueTarget);
    active.blockedOnQueue = overQueue && !active.queueDroppable;
    active.insideContainer = this.isPointerNearButtonContainer(active.container, event.clientX, event.clientY);

    // Over a queue surface with something that cannot be queued: show the
    // "blocked" ghost and neither highlight the queue nor reorder. Away from
    // both the toolbar and any queue the ghost dims: releasing there cancels.
    active.ghost.classList.toggle('ocp-button-drag-ghost--blocked', overQueue && !active.queueDroppable);
    active.ghost.classList.toggle('ocp-button-drag-ghost--queue', overQueue && active.queueDroppable);
    active.ghost.classList.toggle('ocp-button-drag-ghost--outside', !overQueue && !active.insideContainer);
    this.applyQueueDropHover(active.queueDroppable ? queueTarget : null);

    if (!overQueue && active.canReorder && active.insideContainer) {
        window.MaxExtensionButtonEditMode?.moveDraggedButton?.(event.clientX, event.clientY, active.element, active.container);
    }
};

window.MaxExtensionFloatingPanel.isPointerNearButtonContainer = function (container, clientX, clientY) {
    if (!container?.isConnected) return false;
    const rect = container.getBoundingClientRect();
    const margin = BUTTON_DRAG_CONTAINER_MARGIN;
    return clientX >= rect.left - margin
        && clientX <= rect.right + margin
        && clientY >= rect.top - margin
        && clientY <= rect.bottom + margin;
};

/**
 * Finds the visible queue surface under the pointer and the slot the button
 * would land in. Dropping anywhere on a queue bar/section (not just the items
 * strip) is accepted and appends; over the items strip the slot follows
 * reading order.
 * @returns {{ displayArea: HTMLElement, surface: HTMLElement, index: number } | null}
 */
window.MaxExtensionFloatingPanel.resolveQueueDropTarget = function (clientX, clientY) {
    const pointElement = document.elementFromPoint(clientX, clientY);
    if (!pointElement) return null;

    const surface = pointElement.closest(QUEUE_DROP_SURFACE_SELECTOR);
    if (!surface) return null;
    const displayArea = surface.querySelector(QUEUE_DROP_AREA_SELECTOR);
    if (!displayArea) return null;

    const items = Array.from(displayArea.querySelectorAll('.max-extension-queued-item'))
        .filter((item) => !item.matches(QUEUE_DROP_SKIP_ITEM_SELECTOR));
    let index = items.length;

    if (pointElement.closest(QUEUE_DROP_AREA_SELECTOR) === displayArea) {
        const hoveredItem = pointElement.closest('.max-extension-queued-item');
        const hoveredIndex = hoveredItem ? items.indexOf(hoveredItem) : -1;
        if (hoveredIndex >= 0) {
            const itemRect = hoveredItem.getBoundingClientRect();
            index = hoveredIndex + (clientX > itemRect.left + itemRect.width / 2 ? 1 : 0);
        } else {
            // In a gap or on the empty-state placeholder: first item that comes
            // after the pointer in reading order (rows top-to-bottom, then x).
            for (let i = 0; i < items.length; i++) {
                const itemRect = items[i].getBoundingClientRect();
                const inRow = clientY >= itemRect.top && clientY <= itemRect.bottom;
                if (itemRect.top > clientY || (inRow && clientX < itemRect.left + itemRect.width / 2)) {
                    index = i;
                    break;
                }
            }
        }
    }

    return { displayArea, surface, index };
};

window.MaxExtensionFloatingPanel.applyQueueDropHover = function (target) {
    const active = this.buttonDragState?.active;
    if (!active) return;
    const previous = active.target;

    if (previous && previous.displayArea !== target?.displayArea) {
        previous.displayArea.classList.remove('ocp-queue-drop-hover');
        previous.surface.classList.remove('ocp-queue-drop-hover');
        active.indicator?.remove();
    }

    active.target = target;
    if (!target) return;

    target.displayArea.classList.add('ocp-queue-drop-hover');
    target.surface.classList.add('ocp-queue-drop-hover');

    const items = Array.from(target.displayArea.querySelectorAll('.max-extension-queued-item'))
        .filter((item) => !item.matches(QUEUE_DROP_SKIP_ITEM_SELECTOR));
    if (items.length === 0) {
        // Empty state: the placeholder itself lights up via CSS; no slot marker.
        active.indicator?.remove();
        return;
    }

    if (!active.indicator) {
        const indicator = document.createElement('div');
        indicator.className = 'max-extension-queued-item max-extension-queued-item--placeholder ocp-queue-drop-indicator';
        indicator.setAttribute('aria-hidden', 'true');
        active.indicator = indicator;
    }
    // A queue re-render (e.g. an item was dispatched) wipes the indicator; it is
    // simply re-inserted on the next pointer move.
    const reference = items[target.index] || null;
    if (active.indicator.parentNode !== target.displayArea || active.indicator.nextSibling !== reference) {
        target.displayArea.insertBefore(active.indicator, reference);
    }
};

window.MaxExtensionFloatingPanel.restoreButtonDragOrigin = function (active) {
    const { element, originalParent, originalNextSibling } = active;
    if (!element || !originalParent?.isConnected) return;
    const reference = originalNextSibling?.parentNode === originalParent ? originalNextSibling : null;
    if (element.parentNode === originalParent && element.nextElementSibling === reference) return;
    const beforeRects = window.MaxExtensionButtonEditMode?.captureRects?.(active.container);
    originalParent.insertBefore(element, reference);
    if (beforeRects) window.MaxExtensionButtonEditMode.playFlip(beforeRects, active.container);
};

window.MaxExtensionFloatingPanel.completeButtonDrag = function () {
    const state = this.buttonDragState;
    const active = state?.active;
    if (!active) return;

    const { element, target, buttonConfig, queueDroppable, canReorder, container, blockedOnQueue } = active;
    const droppedOnQueue = Boolean(target) && queueDroppable;
    const cancelled = !droppedOnQueue && (blockedOnQueue || !active.insideContainer);

    if (droppedOnQueue || cancelled) {
        // Queueing is not a reorder, and releasing away from the toolbar (or on
        // a queue with something that cannot be queued, red ghost) cancels:
        // either way the element goes back where it came from.
        this.restoreButtonDragOrigin(active);
    }
    const orderChanged = canReorder
        && element.isConnected
        && (element.parentNode !== active.originalParent || element.nextElementSibling !== active.originalNextSibling);
    this.teardownButtonDrag();

    if (droppedOnQueue) {
        this.enqueueDroppedButton(buttonConfig, element, target);
        return;
    }

    if (cancelled) {
        logConCgp(`[button-dnd] Drag complete: ${blockedOnQueue ? 'blocked-on-queue' : 'cancelled-outside'}`);
        return;
    }

    if (!orderChanged) {
        logConCgp('[button-dnd] Drag complete: reorder-unchanged');
        return;
    }

    // saveOrderFromDom rewrites customButtons in place; snapshot the order
    // first so Undo can put it back.
    const previousOrder = Array.isArray(window.globalMaxExtensionConfig?.customButtons)
        ? [...window.globalMaxExtensionConfig.customButtons]
        : null;
    const origin = container?.closest('#max-extension-floating-panel') ? 'panel' : 'inline';
    Promise.resolve(window.MaxExtensionButtonEditMode?.saveOrderFromDom?.(container)).then((saved) => {
        if (saved !== true) {
            logConCgp('[button-dnd] Drag complete: reorder-not-saved');
            return;
        }
        logConCgp('[button-dnd] Drag complete: reorder-saved');
        if (previousOrder) this.offerButtonReorderUndo(previousOrder, origin);
    });
};

/**
 * "Buttons reordered — Undo" toast after a drag-reorder was persisted (same
 * pattern as MaxExtensionButtonEditMode.showDeleteUndoToast). Only one reorder
 * can be undone at a time: a newer reorder dismisses the older toast.
 * @param {object[]} previousOrder - customButtons as they were before the save.
 * @param {'panel'|'inline'} origin - Which toolbar to re-render after undoing.
 */
window.MaxExtensionFloatingPanel.offerButtonReorderUndo = function (previousOrder, origin) {
    const state = this.buttonDragState;
    if (!state || typeof showToast !== 'function') return;
    this.dismissButtonReorderUndo();

    // Serialized at snapshot time: the save broadcasts profileChanged, which
    // replaces globalMaxExtensionConfig with a fresh clone, so object identity
    // cannot be relied on at undo time (same approach as showDeleteUndoToast).
    const serialize = (button) => window.MaxExtensionButtonEditMode?.serializeButtonConfig?.(button) ?? JSON.stringify(button);
    const pending = { previousKeys: previousOrder.map(serialize), origin, toastElement: null };
    state.pendingReorderUndo = pending;
    showToast('Buttons reordered.', 'success', {
        duration: 6000,
        customButtons: [
            {
                text: 'Undo',
                title: 'Restore the previous button order',
                className: 'toast-action-primary',
                onClick: () => this.undoButtonReorder(pending)
            }
        ],
        onDismiss: () => {
            if (state.pendingReorderUndo === pending) state.pendingReorderUndo = null;
        }
    });
    // showToast returns nothing; the sticky toast it just appended is the last
    // child, remembered so a newer reorder can close it.
    pending.toastElement = document.getElementById('toastContainer')?.lastElementChild || null;
};

window.MaxExtensionFloatingPanel.dismissButtonReorderUndo = function () {
    const state = this.buttonDragState;
    const pending = state?.pendingReorderUndo;
    if (!pending) return;
    state.pendingReorderUndo = null;
    pending.toastElement?.querySelector('.toast-close')?.click();
};

window.MaxExtensionFloatingPanel.undoButtonReorder = async function (pending) {
    const state = this.buttonDragState;
    const editMode = window.MaxExtensionButtonEditMode;
    if (!state || state.pendingReorderUndo !== pending) return true;

    const config = window.globalMaxExtensionConfig;
    const buttons = Array.isArray(config?.customButtons) ? config.customButtons : null;
    // Same buttons (by content), only their order differs: anything else
    // (profile switched, button added/deleted/edited) makes the snapshot stale.
    const serialize = (button) => editMode?.serializeButtonConfig?.(button) ?? JSON.stringify(button);
    const pool = (buttons || []).map((button) => ({ key: serialize(button), button }));
    const restoredOrder = [];
    for (const key of pending.previousKeys) {
        const hit = pool.findIndex((entry) => entry && entry.key === key);
        if (hit === -1) break;
        restoredOrder.push(pool[hit].button);
        pool[hit] = null;
    }
    const restorable = buttons
        && buttons.length === pending.previousKeys.length
        && restoredOrder.length === pending.previousKeys.length;
    if (!restorable || typeof editMode?.saveCurrentProfileConfig !== 'function') {
        state.pendingReorderUndo = null;
        showToast('Could not undo: the buttons changed since the reorder.', 'error', 3500);
        return true;
    }

    const currentOrder = [...buttons];
    buttons.splice(0, buttons.length, ...restoredOrder);
    const saved = await editMode.saveCurrentProfileConfig();
    if (!saved) {
        buttons.splice(0, buttons.length, ...currentOrder);
        return false;
    }
    state.pendingReorderUndo = null;
    window.MaxExtensionButtonsInit?.updateButtonsForProfileChange?.(pending.origin);
    logConCgp(`[button-dnd] Reorder undone (${pending.origin})`);
    showToast('Button order restored.', 'success', 1800);
    return true;
};

window.MaxExtensionFloatingPanel.enqueueDroppedButton = function (buttonConfig, element, target) {
    if (!buttonConfig || !target) return;

    if (!window.globalMaxExtensionConfig) {
        window.globalMaxExtensionConfig = {};
    }
    if (!window.globalMaxExtensionConfig.enableQueueMode) {
        // The queue bar was visible (frozen items) but queue mode is off; a drop
        // is an explicit request to use the queue, same as the "queue current
        // editor text" button.
        window.globalMaxExtensionConfig.enableQueueMode = true;
        this.syncQueueModeUiFromConfig?.();
        this.saveCurrentProfileConfig?.();
    }

    const queueEntry = this.addToQueue({
        icon: buttonConfig.icon || element?.innerHTML || '⏳',
        text: buttonConfig.text,
        autoSend: buttonConfig.autoSend === true,
        source: 'button-drag'
    }, { index: target.index });

    if (!queueEntry) {
        if (typeof showToast === 'function') {
            showToast(`Queue is full (max ${this.QUEUE_MAX_SIZE} prompts).`, 'error', 3000);
        }
        logConCgp('[button-dnd] Drag complete: queue-full');
        return;
    }

    // Do not touch the timer: a stopped/paused queue stays that way with the new
    // item waiting; a running queue simply has one more prompt.
    const queue = Array.isArray(this.promptQueue) ? this.promptQueue : [];
    const count = queue.length;
    const index = queue.indexOf(queueEntry);
    const position = Math.max(1, index + 1);
    const statusText = this.isQueueRunning === true
        ? `Queued at position ${position} of ${count}. Timer running.`
        : `Queued at position ${position} of ${count}. Press ▶️ to start the queue.`;
    // Status chip with an Undo action (removes exactly this entry by queueId).
    if (typeof this.offerQueueAddUndo === 'function') {
        this.offerQueueAddUndo(queueEntry, statusText);
    } else if (typeof showToast === 'function') {
        showToast(statusText, 'success', 2800);
    }
    logConCgp(`[button-dnd] Drag complete: queued@${index}`);
};

window.MaxExtensionFloatingPanel.cancelButtonDrag = function (reason = 'cancel') {
    const state = this.buttonDragState;
    if (!state) return;
    if (state.active) {
        logConCgp(`[button-dnd] Drag cancelled: ${reason}`);
        this.restoreButtonDragOrigin(state.active);
        this.teardownButtonDrag();
        return;
    }
    this.clearPendingButtonDrag();
};

window.MaxExtensionFloatingPanel.teardownButtonDrag = function () {
    const state = this.buttonDragState;
    const active = state?.active;
    if (!active) return;

    active.ghost?.remove();
    active.indicator?.remove();
    if (active.target) {
        active.target.displayArea.classList.remove('ocp-queue-drop-hover');
        active.target.surface.classList.remove('ocp-queue-drop-hover');
    }
    if (active.element) {
        active.element.classList.remove('ocp-button-drag-source--active', 'ocp-button-drag-source--pending');
        active.element.style.visibility = '';
        try {
            if (active.element.hasPointerCapture?.(active.pointerId)) {
                active.element.releasePointerCapture(active.pointerId);
            }
        } catch (_) {
            // Capture already gone with the pointer.
        }
        // The pointerup that ends a drag is followed by a click on the source
        // button; swallow exactly that one so the prompt is not also sent.
        // A stationary touch long-press is a slow tap, though: let it click.
        if (active.moved) {
            active.element.__ocpSuppressDragClick = true;
            setTimeout(() => { active.element.__ocpSuppressDragClick = false; }, 0);
        }
    }

    document.body.classList.remove('ocp-button-dragging', 'ocp-queue-button-dragging');
    document.removeEventListener('keydown', state.boundKeydown, true);

    state.active = null;
    state.pending = null;
    if (state.pressTimer) {
        clearTimeout(state.pressTimer);
        state.pressTimer = null;
    }
    this.detachButtonDragPointerListeners();
};

window.MaxExtensionFloatingPanel.attachButtonDragPointerListeners = function () {
    const state = this.buttonDragState;
    if (!state) return;
    window.addEventListener('pointermove', state.boundMove, { passive: false });
    window.addEventListener('pointerup', state.boundUp);
    window.addEventListener('pointercancel', state.boundCancel);
};

window.MaxExtensionFloatingPanel.detachButtonDragPointerListeners = function () {
    const state = this.buttonDragState;
    if (!state) return;
    window.removeEventListener('pointermove', state.boundMove);
    window.removeEventListener('pointerup', state.boundUp);
    window.removeEventListener('pointercancel', state.boundCancel);
};
