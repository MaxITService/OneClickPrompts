// floating-panel-ui-queue-dnd.js
// Version: 1.0
// Documentation:
// Provides pointer drag-and-drop reordering for queued prompts in every queue
// surface. Implements FLIP-style transitions to animate item movement and
// gracefully handles edge cases (queue item dispatched while dragging).
// Also implements dragging prompt buttons (inline toolbar / floating panel)
// onto any queue surface to enqueue them; see the section at the bottom.
// Extends window.MaxExtensionFloatingPanel with helper methods consumed by
// floating-panel-ui-queue.js and buttons.js (registerQueueDragSource).

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
        activeDisplayArea: null
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

    if (!displayArea.contains(state.placeholderElement)) {
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
    this.updateQueuePlaceholderPosition(event.clientX, event.clientY);
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

    this.teardownDragVisuals();
    state.isActive = false;
    state.preventClick = true;
    setTimeout(() => { state.preventClick = false; }, 0);

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
        el.classList.remove('max-extension-queued-item--dragging');
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
// Prompt button → queue drag-and-drop
// ---------------------------------------------------------------------------
// Any regular prompt button (inline toolbar or floating panel) can be dragged
// and dropped onto a queue surface to enqueue it. Clicking still sends: a drag
// only starts once the pointer travels BUTTON_QUEUE_DRAG_THRESHOLD px. Button
// edit mode owns the pointer for reordering, so nothing starts while it is on.
// While a drag is in flight every queue surface is force-revealed (even when
// dismissed, empty, or queue mode is off) so there is always a place to drop.

const BUTTON_QUEUE_DRAG_THRESHOLD = 5;
const QUEUE_DROP_AREA_SELECTOR = '.max-extension-inline-queue-items, #max-extension-queue-display';
const QUEUE_DROP_SURFACE_SELECTOR = '.max-extension-inline-queue-controls, #max-extension-queue-section';
const QUEUE_DROP_SKIP_ITEM_SELECTOR = '.max-extension-queued-item--placeholder, .max-extension-queued-item--dragging';

window.MaxExtensionFloatingPanel.initializeButtonQueueDrag = function () {
    if (this.buttonQueueDragState) return;
    this.buttonQueueDragState = {
        pending: null,
        active: null,
        boundMove: (event) => this.handleButtonQueuePointerMove(event),
        boundUp: (event) => this.handleButtonQueuePointerUp(event),
        boundCancel: (event) => this.handleButtonQueuePointerCancel(event),
        boundKeydown: (event) => {
            if (event.key !== 'Escape' || !this.buttonQueueDragState?.active) return;
            event.preventDefault();
            event.stopPropagation();
            this.cancelButtonQueueDrag();
        }
    };
};

/**
 * Makes a prompt button a drag source for the queue. Idempotent per element.
 * Must run before the element's send click listener is attached so the
 * post-drag click suppression can stop it via stopImmediatePropagation.
 */
window.MaxExtensionFloatingPanel.registerQueueDragSource = function (element, buttonConfig) {
    if (!element || !buttonConfig || element.__ocpQueueDragSourceBound) return;
    this.initializeButtonQueueDrag();
    element.__ocpQueueDragSourceBound = true;
    element.classList.add('ocp-queue-drag-source');

    element.addEventListener('pointerdown', (event) => this.handleButtonQueuePointerDown(event, element, buttonConfig));
    element.addEventListener('click', (event) => {
        if (!element.__ocpSuppressQueueDragClick) return;
        element.__ocpSuppressQueueDragClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
    });
};

window.MaxExtensionFloatingPanel.isButtonQueueDragAllowed = function (element) {
    if (!element || element.disabled) return false;
    if (window.MaxExtensionButtonEditMode?.active) return false;
    if (window.globalMaxExtensionConfig?.queueHideActivationToggle) return false;
    if (this.queueDndState?.isActive) return false;
    return true;
};

window.MaxExtensionFloatingPanel.handleButtonQueuePointerDown = function (event, element, buttonConfig) {
    const state = this.buttonQueueDragState;
    if (!state || event.button !== 0 || state.active || state.pending) return;
    if (!this.isButtonQueueDragAllowed(element)) return;

    state.pending = {
        element,
        buttonConfig,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY
    };
    this.attachButtonQueuePointerListeners();
};

window.MaxExtensionFloatingPanel.handleButtonQueuePointerMove = function (event) {
    const state = this.buttonQueueDragState;
    if (!state) return;

    if (state.pending && !state.active) {
        if (state.pending.pointerId !== event.pointerId) return;
        const distance = Math.hypot(event.clientX - state.pending.startX, event.clientY - state.pending.startY);
        if (distance < BUTTON_QUEUE_DRAG_THRESHOLD) return;
        this.startButtonQueueDrag(state.pending, event);
        if (!state.active) return;
    }

    if (!state.active || state.active.pointerId !== event.pointerId) return;
    event.preventDefault();
    this.updateButtonQueueDragPosition(event);
};

window.MaxExtensionFloatingPanel.handleButtonQueuePointerUp = function (event) {
    const state = this.buttonQueueDragState;
    if (!state) return;

    if (state.pending && !state.active) {
        if (state.pending.pointerId !== event.pointerId) return;
        state.pending = null;
        this.detachButtonQueuePointerListeners();
        return;
    }

    if (!state.active || state.active.pointerId !== event.pointerId) return;
    event.preventDefault();
    this.updateButtonQueueDragPosition(event);
    this.completeButtonQueueDrag();
};

window.MaxExtensionFloatingPanel.handleButtonQueuePointerCancel = function (event) {
    const state = this.buttonQueueDragState;
    if (!state) return;
    if (state.active && state.active.pointerId !== event.pointerId) return;
    if (state.pending && !state.active && state.pending.pointerId !== event.pointerId) return;
    this.cancelButtonQueueDrag();
};

window.MaxExtensionFloatingPanel.startButtonQueueDrag = function (pending, event) {
    const state = this.buttonQueueDragState;
    if (!state || !pending) return;
    const element = pending.element;
    if (!element?.isConnected || !this.isButtonQueueDragAllowed(element)) {
        state.pending = null;
        this.detachButtonQueuePointerListeners();
        return;
    }

    // Same ghost strategy as button edit mode: fixed-position clone on
    // document.body (no transformed/zoomed ancestor), sized to the layout box and
    // scaled by the measured visual scale so it looks identical to the source.
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
    ghost.className = 'ocp-queue-drag-ghost';
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
        buttonConfig: pending.buttonConfig,
        pointerId: pending.pointerId,
        ghost,
        offsetX: pending.startX - rect.left,
        offsetY: pending.startY - rect.top,
        target: null,
        indicator: null
    };
    state.pending = null;

    element.classList.add('ocp-queue-drag-source--active');
    document.body.classList.add('ocp-queue-button-dragging');
    document.addEventListener('keydown', state.boundKeydown, true);
    this.revealQueueDropTargets();
    this.updateButtonQueueDragPosition(event);
};

window.MaxExtensionFloatingPanel.updateButtonQueueDragPosition = function (event) {
    const active = this.buttonQueueDragState?.active;
    if (!active) return;
    active.ghost.style.left = `${event.clientX - active.offsetX}px`;
    active.ghost.style.top = `${event.clientY - active.offsetY}px`;
    this.applyQueueDropHover(this.resolveQueueDropTarget(event.clientX, event.clientY));
};

/**
 * Reveals every queue surface as a drop zone for the duration of a drag,
 * regardless of dismissed/empty/disabled state. Restored by concealQueueDropTargets.
 */
window.MaxExtensionFloatingPanel.revealQueueDropTargets = function () {
    (this.getInlineQueueControlWrappers?.() || []).forEach((wrapper) => {
        wrapper.classList.add('is-drop-ready');
        const itemsArea = wrapper.querySelector('.max-extension-inline-queue-items');
        if (itemsArea && itemsArea.childElementCount === 0) {
            this.renderQueueDisplayInto?.(itemsArea);
        }
    });

    const panelDropAllowed = this.isPanelVisible
        && this.queueDisplayArea
        && this.queueSectionElement
        && !this.queueSectionHiddenByInlineControls
        && !window.globalMaxExtensionConfig?.queueHideActivationToggle;
    if (panelDropAllowed) {
        this.queueSectionElement.classList.add('ocp-queue-drop-ready');
        this.queueDisplayArea.classList.add('ocp-queue-drop-ready');
        if (this.queueDisplayArea.childElementCount === 0) {
            this.renderQueueDisplayInto?.(this.queueDisplayArea);
        }
    }
};

window.MaxExtensionFloatingPanel.concealQueueDropTargets = function () {
    (this.getInlineQueueControlWrappers?.() || []).forEach((wrapper) => {
        wrapper.classList.remove('is-drop-ready', 'ocp-queue-drop-hover');
    });
    this.queueSectionElement?.classList.remove('ocp-queue-drop-ready', 'ocp-queue-drop-hover');
    this.queueDisplayArea?.classList.remove('ocp-queue-drop-ready');
    document.querySelectorAll(QUEUE_DROP_AREA_SELECTOR).forEach((area) => {
        area.classList.remove('ocp-queue-drop-hover');
    });
};

/**
 * Finds the queue surface under the pointer and the slot the button would land
 * in. Dropping anywhere on a queue bar/section (not just the items strip) is
 * accepted and appends; over the items strip the slot follows reading order.
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
    const active = this.buttonQueueDragState?.active;
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

window.MaxExtensionFloatingPanel.completeButtonQueueDrag = function () {
    const state = this.buttonQueueDragState;
    const active = state?.active;
    if (!active) return;

    const target = active.target;
    const buttonConfig = active.buttonConfig;
    const element = active.element;
    this.teardownButtonQueueDrag();

    if (!target) return;

    if (!window.globalMaxExtensionConfig) {
        window.globalMaxExtensionConfig = {};
    }
    if (!window.globalMaxExtensionConfig.enableQueueMode) {
        // Mirrors the "queue current editor text" button: a drop is an explicit
        // request to use the queue, so switch queue mode on for this profile.
        window.globalMaxExtensionConfig.enableQueueMode = true;
        this.syncQueueModeUiFromConfig?.();
        this.saveCurrentProfileConfig?.();
    }

    const inlineContainer = element?.closest?.('[id$="-custom-buttons-container"]');
    if (inlineContainer && !inlineContainer.closest('#max-extension-floating-panel')) {
        this.ensureInlineQueueControls?.(inlineContainer);
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
        return;
    }

    // Do not touch the timer: a stopped/paused queue stays that way with the new
    // item waiting; a running queue simply has one more prompt.
    const queue = Array.isArray(this.promptQueue) ? this.promptQueue : [];
    const count = queue.length;
    const position = Math.max(1, queue.indexOf(queueEntry) + 1);
    if (typeof showToast === 'function') {
        showToast(
            this.isQueueRunning === true
                ? `Queued at position ${position} of ${count}. Timer running.`
                : `Queued at position ${position} of ${count}. Press ▶️ to start the queue.`,
            'success',
            2800
        );
    }
    logConCgp('[queue-dnd] Prompt button dropped into queue at index', target.index);
};

window.MaxExtensionFloatingPanel.cancelButtonQueueDrag = function () {
    const state = this.buttonQueueDragState;
    if (!state) return;
    if (state.active) {
        this.teardownButtonQueueDrag();
        return;
    }
    state.pending = null;
    this.detachButtonQueuePointerListeners();
};

window.MaxExtensionFloatingPanel.teardownButtonQueueDrag = function () {
    const state = this.buttonQueueDragState;
    const active = state?.active;
    if (!active) return;

    active.ghost?.remove();
    active.indicator?.remove();
    active.element?.classList.remove('ocp-queue-drag-source--active');
    if (active.element) {
        // The pointerup that ends a drag is followed by a click on the source
        // button; swallow exactly that one so the prompt is not also sent.
        active.element.__ocpSuppressQueueDragClick = true;
        setTimeout(() => { active.element.__ocpSuppressQueueDragClick = false; }, 0);
    }

    document.body.classList.remove('ocp-queue-button-dragging');
    document.removeEventListener('keydown', state.boundKeydown, true);
    this.concealQueueDropTargets();

    state.active = null;
    state.pending = null;
    this.detachButtonQueuePointerListeners();
    this.updateInlineQueueControlsVisibility?.();
};

window.MaxExtensionFloatingPanel.attachButtonQueuePointerListeners = function () {
    const state = this.buttonQueueDragState;
    if (!state) return;
    window.addEventListener('pointermove', state.boundMove, { passive: false });
    window.addEventListener('pointerup', state.boundUp);
    window.addEventListener('pointercancel', state.boundCancel);
};

window.MaxExtensionFloatingPanel.detachButtonQueuePointerListeners = function () {
    const state = this.buttonQueueDragState;
    if (!state) return;
    window.removeEventListener('pointermove', state.boundMove);
    window.removeEventListener('pointerup', state.boundUp);
    window.removeEventListener('pointercancel', state.boundCancel);
};
