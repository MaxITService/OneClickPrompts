// floating-panel-ui-queue-dnd.js
// Version: 1.0
// Documentation:
// Provides long-press drag-and-drop reordering for queued prompts inside the
// floating panel. Implements FLIP-style transitions to animate item movement
// and gracefully handles edge cases (queue item dispatched while dragging).
// Extends window.MaxExtensionFloatingPanel with helper methods consumed by
// floating-panel-ui-queue.js.

'use strict';

const QUEUE_LONG_PRESS_MS = 80;
const QUEUE_DRAG_MOVE_THRESHOLD = 6;

window.MaxExtensionFloatingPanel.initializeQueueDragAndDrop = function () {
    if (!this.queueDisplayArea || this.queueDragInitialized) {
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
        pointerLast: null
    };

    this.queueDndState.boundPointerMove = (event) => this.handleQueuePointerMove(event);
    this.queueDndState.boundPointerUp = (event) => this.handleQueuePointerUp(event);
    this.queueDndState.boundPointerCancel = (event) => this.handleQueuePointerCancel(event);
};

window.MaxExtensionFloatingPanel.decorateQueueItemForDrag = function (element, item, index) {
    if (!this.queueDndState) return;
    element.addEventListener('pointerdown', (event) => this.handleQueuePointerDown(event, item, index, element));
};

window.MaxExtensionFloatingPanel.handleQueueItemClick = function (event, index) {
    const state = this.queueDndState;
    if (state && (state.isActive || state.preventClick)) {
        event.preventDefault();
        event.stopPropagation();
        return;
    }
    this.removeFromQueue(index);
};

window.MaxExtensionFloatingPanel.captureQueuePreRender = function () {
    if (!this.queueDisplayArea || !this.queueDndState) return;
    const map = new Map();
    const children = Array.from(this.queueDisplayArea.children);
    children.forEach((child, index) => {
        const queueId = child.dataset?.queueId;
        if (!queueId) return;
        map.set(queueId, child.getBoundingClientRect());
    });
    this.queueDndState.preRenderRects = map;
};

window.MaxExtensionFloatingPanel.applyQueuePostRenderEffects = function () {
    if (!this.queueDisplayArea || !this.queueDndState) return;
    const state = this.queueDndState;

    if (state.preRenderRects) {
        const children = Array.from(this.queueDisplayArea.children);
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
    if (!this.queueDisplayArea || !this.queueDndState) return;
    const state = this.queueDndState;

    const replacement = state.draggingId
        ? this.queueDisplayArea.querySelector(`[data-queue-id="${state.draggingId}"]`)
        : null;

    if (!replacement) {
        this.cancelActiveQueueDrag({ reason: 'lost' });
        return;
    }

    state.draggingElement = replacement;
    const containerRect = this.queueDisplayArea.getBoundingClientRect();
    const elementRect = replacement.getBoundingClientRect();
    state.containerRect = containerRect;
    state.draggingDimensions = {
        width: elementRect.width,
        height: elementRect.height
    };

    replacement.classList.add('max-extension-queued-item--dragging');
    replacement.style.position = 'absolute';
    replacement.style.zIndex = '3';
    replacement.style.pointerEvents = 'none';
    replacement.style.left = `${elementRect.left - containerRect.left}px`;
    replacement.style.top = `${elementRect.top - containerRect.top}px`;
    replacement.style.width = `${elementRect.width}px`;
    replacement.style.height = `${elementRect.height}px`;
    replacement.style.transform = 'translate(0, 0) scale(1.05)';

    if (!state.placeholderElement) {
        const placeholder = document.createElement('div');
        placeholder.className = 'max-extension-queued-item max-extension-queued-item--placeholder';
        placeholder.style.width = `${elementRect.width}px`;
        placeholder.style.height = `${elementRect.height}px`;
        state.placeholderElement = placeholder;
    }

    if (!this.queueDisplayArea.contains(state.placeholderElement)) {
        const siblings = Array.from(this.queueDisplayArea.children).filter((child) => child !== replacement);
        const target = (state.placeholderIndex >= 0 && state.placeholderIndex < siblings.length)
            ? siblings[state.placeholderIndex]
            : null;
        if (target) {
            this.queueDisplayArea.insertBefore(state.placeholderElement, target);
        } else {
            this.queueDisplayArea.appendChild(state.placeholderElement);
        }
    }

    this.queueDisplayArea.appendChild(replacement);
    this.queueDisplayArea.classList.add('max-extension-queue-drag-active');
};

window.MaxExtensionFloatingPanel.handleQueuePointerDown = function (event, item, index, element) {
    if (!this.queueDndState || !this.queueDisplayArea) return;
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
        element
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
            this.clearPendingDrag();
            this.detachQueuePointerListeners();
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
    if (!pendingDrag || !this.queueDndState || !this.queueDisplayArea) return;

    const state = this.queueDndState;
    const element = pendingDrag.element;
    if (!element || !element.isConnected) {
        this.clearPendingDrag();
        return;
    }

    const containerRect = this.queueDisplayArea.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();

    state.isActive = true;
    state.pointerId = pendingDrag.pointerId;
    state.draggingId = pendingDrag.queueId;
    state.draggingElement = element;
    state.originIndex = pendingDrag.index;
    state.dragStartPointer = {
        x: pendingDrag.latestX ?? pendingDrag.startX,
        y: pendingDrag.latestY ?? pendingDrag.startY
    };
    state.containerRect = containerRect;
    state.draggingDimensions = {
        width: elementRect.width,
        height: elementRect.height
    };
    state.placeholderIndex = pendingDrag.index;
    state.pendingDrag = null;
    if (state.pressTimer) {
        clearTimeout(state.pressTimer);
        state.pressTimer = null;
    }

    const placeholder = document.createElement('div');
    placeholder.className = 'max-extension-queued-item max-extension-queued-item--placeholder';
    placeholder.style.width = `${elementRect.width}px`;
    placeholder.style.height = `${elementRect.height}px`;
    state.placeholderElement = placeholder;

    this.queueDisplayArea.insertBefore(placeholder, element);
    this.queueDisplayArea.appendChild(element);

    element.classList.add('max-extension-queued-item--dragging');
    element.style.position = 'absolute';
    element.style.zIndex = '3';
    element.style.pointerEvents = 'none';
    element.style.left = `${elementRect.left - containerRect.left}px`;
    element.style.top = `${elementRect.top - containerRect.top}px`;
    element.style.width = `${elementRect.width}px`;
    element.style.height = `${elementRect.height}px`;
    element.style.transform = 'translate(0, 0) scale(1.05)';

    this.queueDisplayArea.classList.add('max-extension-queue-drag-active');
};

window.MaxExtensionFloatingPanel.updateQueueDragPosition = function (event) {
    const state = this.queueDndState;
    if (!state || !state.isActive || !state.draggingElement) return;

    const dx = event.clientX - state.dragStartPointer.x;
    const dy = event.clientY - state.dragStartPointer.y;
    state.draggingElement.style.transform = `translate(${dx}px, ${dy}px) scale(1.05)`;
    state.pointerLast = { x: event.clientX, y: event.clientY };
    this.updateQueuePlaceholderPosition(event.clientX, event.clientY);
};

window.MaxExtensionFloatingPanel.updateQueuePlaceholderPosition = function (clientX, clientY) {
    if (!this.queueDndState || !this.queueDisplayArea) return;
    const state = this.queueDndState;
    const placeholder = state.placeholderElement;
    const dragging = state.draggingElement;
    if (!placeholder || !dragging) return;

    const containerRect = state.containerRect || this.queueDisplayArea.getBoundingClientRect();

    const clampToStart = clientY < containerRect.top || clientX < containerRect.left;
    const clampToEnd = clientY > containerRect.bottom || clientX > containerRect.right;

    if (clampToStart) {
        this.queueDisplayArea.insertBefore(placeholder, this.queueDisplayArea.firstChild);
        state.placeholderIndex = 0;
        return;
    }

    if (clampToEnd) {
        this.queueDisplayArea.insertBefore(placeholder, dragging);
        state.placeholderIndex = Array.from(this.queueDisplayArea.children).filter((child) => child !== dragging).length - 1;
        return;
    }

    const pointElement = document.elementFromPoint(clientX, clientY);
    const targetItem = pointElement
        ? pointElement.closest('.max-extension-queued-item')
        : null;

    if (!targetItem || targetItem === dragging || targetItem === placeholder) {
        return;
    }

    const targetRect = targetItem.getBoundingClientRect();
    const insertAfter = clientX > targetRect.left + (targetRect.width / 2);
    let referenceNode = insertAfter ? targetItem.nextSibling : targetItem;
    while (referenceNode === dragging) {
        referenceNode = referenceNode?.nextSibling ?? null;
    }

    this.queueDisplayArea.insertBefore(placeholder, referenceNode);
    this.computePlaceholderIndex();
};

window.MaxExtensionFloatingPanel.computePlaceholderIndex = function () {
    const state = this.queueDndState;
    if (!state || !state.placeholderElement || !this.queueDisplayArea) return -1;
    const siblings = Array.from(this.queueDisplayArea.children).filter((child) => child !== state.draggingElement);
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
        this.renderQueueDisplay();
        return;
    }

    const [moved] = this.promptQueue.splice(currentIndex, 1);
    let insertionIndex = targetIndex;
    if (insertionIndex > this.promptQueue.length) {
        insertionIndex = this.promptQueue.length;
    }
    this.promptQueue.splice(insertionIndex, 0, moved);

    if (typeof this.renderQueueDisplay === 'function') {
        this.renderQueueDisplay();
    }
    if (typeof this.updateQueueControlsState === 'function') {
        this.updateQueueControlsState();
    }
    if (typeof showToast === 'function') {
        showToast('Queue order updated.', 'info', 2000);
    }
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
    state.pointerId = null;
    state.dragStartPointer = null;

    if (options.reason === 'lost' && typeof showToast === 'function') {
        showToast('Queued prompt was sent while dragging.', 'info', 3500);
    }

    this.detachQueuePointerListeners();
    this.clearPendingDrag();
};

window.MaxExtensionFloatingPanel.teardownDragVisuals = function () {
    const state = this.queueDndState;
    if (!state) return;

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

    if (state.placeholderElement && this.queueDisplayArea?.contains(state.placeholderElement)) {
        this.queueDisplayArea.removeChild(state.placeholderElement);
    }

    if (this.queueDisplayArea) {
        this.queueDisplayArea.classList.remove('max-extension-queue-drag-active');
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
