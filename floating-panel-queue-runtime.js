// floating-panel-queue-runtime.js
// Owns queue state transitions, recovery journaling, and read-only snapshots for queue views.

'use strict';

(() => {
    const QUEUE_INSTANCE_SESSION_KEY = 'ocpQueueInstanceId.v1';
    const QUEUE_SNAPSHOT_SCHEMA_VERSION = 1;

    class QueueRuntimeController {
        #owner;
        #mutationDepth = 0;
        #syncRequested = false;
        #syncRenderItems = false;
        #subscribers = new Set();
        #hydrationComplete = false;
        #mutatedBeforeHydration = false;
        #instanceId = null;
        #writeChain = Promise.resolve(true);
        #persistenceFailureLogged = false;

        constructor(owner) {
            this.#owner = owner;
            this.#normalizeState();
            this.ready = this.#hydratePersistence();

            window.addEventListener('pagehide', () => {
                void this.persistNow();
            }, { capture: true });
        }

        get snapshot() {
            this.#normalizeState();
            const items = this.#owner.promptQueue.map((item) => Object.freeze({ ...item }));
            return Object.freeze({
                items: Object.freeze(items),
                inFlightItem: this.#owner.queueInFlightItem
                    ? Object.freeze({ ...this.#owner.queueInFlightItem })
                    : null,
                phase: this.#owner.queuePhase,
                isRunning: this.#owner.isQueueRunning,
                timerId: this.#owner.queueTimerId,
                timerStartedAt: this.#owner.timerStartTime,
                timerDurationMs: this.#owner.currentTimerDelay,
                remainingPausedMs: this.#owner.remainingTimeOnPause,
                generation: this.#owner.queueGeneration,
                status: this.#owner.queueStatus
                    ? Object.freeze({ ...this.#owner.queueStatus })
                    : null
            });
        }

        isCurrentGeneration(generation) {
            return Number(generation) === this.#owner.queueGeneration;
        }

        subscribe(listener) {
            if (typeof listener !== 'function') throw new TypeError('Queue subscriber must be a function.');
            this.#subscribers.add(listener);
            return () => this.#subscribers.delete(listener);
        }

        #transaction(label, mutator, options = {}) {
            const { renderItems = true, sync = true, persist = true } = options;
            if (!this.#hydrationComplete) this.#mutatedBeforeHydration = true;

            this.#mutationDepth++;
            try {
                this.#normalizeState();
                return mutator(this.#owner);
            } catch (error) {
                logConCgp(`[queue-runtime] ${label} failed:`, error?.message || error);
                throw error;
            } finally {
                this.#normalizeState();
                this.#mutationDepth--;
                if (sync) {
                    this.#syncRequested = true;
                    this.#syncRenderItems ||= renderItems;
                }
                if (persist) this.#requestPersistence();
                if (this.#mutationDepth === 0) this.#flushSync();
            }
        }

        notifyState(options = {}) {
            const { renderItems = true, persist = true } = options;
            this.#syncRequested = true;
            this.#syncRenderItems ||= renderItems;
            if (persist) this.#requestPersistence();
            if (this.#mutationDepth === 0) this.#flushSync();
        }

        enqueue(buttonConfig, maxSize) {
            return this.enqueueMany([buttonConfig], maxSize)[0] || null;
        }

        enqueueMany(buttonConfigs, maxSize) {
            const candidates = Array.isArray(buttonConfigs) ? buttonConfigs : [];
            const limit = Number.isFinite(maxSize) ? Math.max(0, Math.floor(maxSize)) : Number.MAX_SAFE_INTEGER;
            return this.#transaction('enqueue-many', (queue) => {
                const occupiedSlots = queue.promptQueue.length + (queue.queueInFlightItem ? 1 : 0);
                const availableSlots = Math.max(0, limit - occupiedSlots);
                const entries = candidates.slice(0, availableSlots).map((buttonConfig) => ({
                    ...buttonConfig,
                    queueId: `queue-item-${queue.nextQueueItemId++}`
                }));
                queue.promptQueue.push(...entries);
                return entries;
            });
        }

        removeAt(index) {
            return this.#transaction('remove', (queue) => {
                if (!Number.isInteger(index) || index < 0 || index >= queue.promptQueue.length) return null;
                const removed = queue.promptQueue.splice(index, 1)[0] || null;
                if (queue.promptQueue.length === 0 && queue.queueTimerId !== null) {
                    this.#clearTimer(queue);
                    queue.timerStartTime = 0;
                    queue.currentTimerDelay = 0;
                    queue.remainingTimeOnPause = 0;
                    queue.queuePhase = 'idle';
                    queue.isQueueRunning = false;
                }
                return removed;
            });
        }

        removeById(queueId) {
            if (typeof queueId !== 'string' || !queueId) return null;
            return this.#transaction('remove-by-id', (queue) => {
                const index = queue.promptQueue.findIndex((item) => item?.queueId === queueId);
                if (index < 0) return null;
                return queue.promptQueue.splice(index, 1)[0] || null;
            });
        }

        takeNext() {
            return this.#transaction('take-next', (queue) => {
                if (queue.queueInFlightItem) return null;
                const item = queue.promptQueue.shift() || null;
                queue.queueInFlightItem = item;
                return item;
            });
        }

        confirmInFlightSent(queueId) {
            return this.#transaction('confirm-in-flight-sent', (queue) => {
                const item = queue.queueInFlightItem;
                if (!item) return false;
                if (queueId && item.queueId !== queueId) return false;
                queue.queueInFlightItem = null;
                return true;
            }, { renderItems: false });
        }

        restoreFront(item) {
            if (!item) return false;
            return this.#transaction('restore-front', (queue) => {
                if (
                    queue.queueInFlightItem === item
                    || (item.queueId && queue.queueInFlightItem?.queueId === item.queueId)
                ) {
                    queue.queueInFlightItem = null;
                }

                const alreadyQueued = queue.promptQueue.some((entry) => (
                    entry === item || (item.queueId && entry?.queueId === item.queueId)
                ));
                if (alreadyQueued) return false;
                queue.promptQueue.unshift(item);
                return true;
            });
        }

        reorder(fromIndex, toIndex) {
            return this.#transaction('reorder', (queue) => {
                if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= queue.promptQueue.length) return false;
                const boundedTarget = Math.min(queue.promptQueue.length - 1, Math.max(0, Number(toIndex) || 0));
                if (boundedTarget === fromIndex) return false;
                const [item] = queue.promptQueue.splice(fromIndex, 1);
                queue.promptQueue.splice(boundedTarget, 0, item);
                return true;
            });
        }

        schedule(delayMs, onElapsed, options = {}) {
            const durationMs = Math.max(0, Number(delayMs) || 0);
            return this.scheduleRemaining(durationMs, durationMs, onElapsed, options);
        }

        scheduleRemaining(totalDurationMs, remainingMs, onElapsed, options = {}) {
            const totalMs = Math.max(0, Number(totalDurationMs) || 0);
            const safeRemainingMs = Math.min(totalMs, Math.max(0, Number(remainingMs) || 0));
            return this.#transaction('schedule-remaining', (queue) => {
                this.#clearTimer(queue);
                queue.timerStartTime = Date.now() - (totalMs - safeRemainingMs);
                queue.currentTimerDelay = totalMs;
                queue.remainingTimeOnPause = 0;
                queue.queuePhase = 'waiting';
                queue.isQueueRunning = true;
                queue.queueStatus = null;

                const timerId = setTimeout(() => {
                    if (queue.queueTimerId !== timerId) return;
                    queue.queueTimerId = null;
                    queue.remainingTimeOnPause = 0;
                    queue.queuePhase = 'sending';
                    queue.isQueueRunning = true;
                    this.notifyState({ renderItems: false });
                    Promise.resolve(onElapsed?.()).catch((error) => {
                        logConCgp('[queue-runtime] Scheduled dispatch failed:', error?.message || error);
                    });
                }, safeRemainingMs);
                queue.queueTimerId = timerId;
                return timerId;
            }, { renderItems: false, ...options });
        }

        resume(onElapsed, options = {}) {
            const totalMs = Math.max(0, Number(this.#owner.currentTimerDelay) || 0);
            const remainingMs = Math.min(totalMs, Math.max(0, Number(this.#owner.remainingTimeOnPause) || 0));
            if (remainingMs <= 0) return null;
            return this.scheduleRemaining(totalMs, remainingMs, onElapsed, options);
        }

        beginImmediateDispatch(options = {}) {
            return this.#transaction('begin-immediate-dispatch', (queue) => {
                this.#clearTimer(queue);
                queue.remainingTimeOnPause = 0;
                queue.queuePhase = 'sending';
                queue.isQueueRunning = true;
                queue.queueStatus = null;
            }, { renderItems: false, ...options });
        }

        setPausedProgress(totalDurationMs, remainingMs, options = {}) {
            const totalMs = Math.max(0, Number(totalDurationMs) || 0);
            const safeRemainingMs = Math.min(totalMs, Math.max(0, Number(remainingMs) || 0));
            return this.#transaction('set-paused-progress', (queue) => {
                this.#clearTimer(queue);
                queue.timerStartTime = Date.now() - (totalMs - safeRemainingMs);
                queue.currentTimerDelay = totalMs;
                queue.remainingTimeOnPause = safeRemainingMs;
                queue.queuePhase = safeRemainingMs > 0 && queue.promptQueue.length > 0 ? 'paused' : 'idle';
                queue.isQueueRunning = false;
            }, { renderItems: false, ...options });
        }

        setStatus(text, type = 'info', tooltip = '') {
            return this.#transaction('set-status', (queue) => {
                queue.queueStatus = text ? { text: String(text), type, tooltip: tooltip || String(text) } : null;
            }, { renderItems: false });
        }

        finish(options = {}) {
            return this.#transaction('finish', (queue) => {
                this.#clearTimer(queue);
                queue.queueInFlightItem = null;
                queue.timerStartTime = 0;
                queue.currentTimerDelay = 0;
                queue.remainingTimeOnPause = 0;
                queue.queuePhase = 'idle';
                queue.isQueueRunning = false;
                queue.queueStatus = null;
            }, { renderItems: false, ...options });
        }

        pause() {
            return this.#transaction('pause', (queue) => {
                let remainingMs = Number(queue.remainingTimeOnPause) || 0;
                if (queue.queueTimerId !== null) {
                    const elapsedMs = Math.max(0, Date.now() - Number(queue.timerStartTime || Date.now()));
                    remainingMs = Math.max(0, Number(queue.currentTimerDelay || 0) - elapsedMs);
                    this.#clearTimer(queue);
                }
                queue.remainingTimeOnPause = remainingMs;
                queue.queuePhase = remainingMs > 0 && queue.promptQueue.length > 0 ? 'paused' : 'idle';
                queue.isQueueRunning = false;
                return remainingMs;
            }, { renderItems: false });
        }

        reset() {
            return this.#transaction('reset', (queue) => {
                this.#clearTimer(queue);
                queue.queueGeneration++;
                queue.promptQueue = [];
                queue.queueInFlightItem = null;
                queue.timerStartTime = 0;
                queue.currentTimerDelay = 0;
                queue.remainingTimeOnPause = 0;
                queue.queuePhase = 'idle';
                queue.isQueueRunning = false;
                queue.queueStatus = null;
            });
        }

        async flushPersistence() {
            if (!await this.ready) return false;
            return await this.#writeChain === true;
        }

        persistNow() {
            return this.#requestPersistence();
        }

        async #hydratePersistence() {
            try {
                let candidateInstanceId = null;
                try {
                    candidateInstanceId = sessionStorage.getItem(QUEUE_INSTANCE_SESSION_KEY);
                } catch (_) { }

                const response = await chrome.runtime.sendMessage({
                    type: 'queuePersistenceClaim',
                    candidateInstanceId
                });
                if (!response?.success || !response.instanceId) {
                    throw new Error(response?.error || 'Could not claim a queue recovery context.');
                }

                this.#instanceId = response.instanceId;
                try {
                    sessionStorage.setItem(QUEUE_INSTANCE_SESSION_KEY, this.#instanceId);
                } catch (_) { }

                const shouldRestore = !this.#mutatedBeforeHydration && response.snapshot;
                if (shouldRestore) {
                    this.#applyRecoveredSnapshot(response.snapshot);
                }

                this.#hydrationComplete = true;
                if (shouldRestore) {
                    this.notifyState({ persist: false });
                }

                queueMicrotask(() => {
                    if (shouldRestore || this.#mutatedBeforeHydration) {
                        this.#requestPersistence();
                    }
                });
                return true;
            } catch (error) {
                this.#hydrationComplete = true;
                logConCgp('[queue-runtime] Recovery journal unavailable:', error?.message || error);
                return false;
            }
        }

        #applyRecoveredSnapshot(snapshot) {
            const queue = this.#owner;
            queue.nextQueueItemId = Math.max(1, Math.floor(Number(snapshot?.nextQueueItemId) || 1));
            const recoveredItems = Array.isArray(snapshot?.items)
                ? snapshot.items.map((item) => this.#sanitizeRecoveredItem(item)).filter(Boolean)
                : [];
            const uncertainItem = this.#sanitizeRecoveredItem(snapshot?.inFlightItem);
            if (uncertainItem && !recoveredItems.some((item) => item.queueId === uncertainItem.queueId)) {
                recoveredItems.unshift(uncertainItem);
            }

            queue.promptQueue = recoveredItems.slice(0, queue.QUEUE_MAX_SIZE || 10);
            queue.queueInFlightItem = null;
            const largestNumericQueueId = queue.promptQueue.reduce((largest, item) => {
                const match = /^queue-item-(\d+)$/.exec(item.queueId);
                return match ? Math.max(largest, Number(match[1]) || 0) : largest;
            }, 0);
            queue.nextQueueItemId = Math.max(queue.nextQueueItemId, largestNumericQueueId + 1);
            queue.queueGeneration = Math.max(0, Number(queue.queueGeneration) || 0) + 1;
            queue.queueTimerId = null;
            queue.timerStartTime = 0;
            queue.currentTimerDelay = Math.max(0, Number(snapshot?.timerDurationMs) || 0);
            queue.remainingTimeOnPause = Math.min(
                queue.currentTimerDelay,
                Math.max(0, Number(snapshot?.timerRemainingMs) || 0)
            );
            queue.isQueueRunning = false;
            queue.queuePhase = queue.remainingTimeOnPause > 0 && queue.promptQueue.length > 0
                ? 'paused'
                : 'idle';
            queue.queueFinishedState = false;

            if (uncertainItem) {
                queue.queueStatus = {
                    text: 'Check last send',
                    type: 'warning',
                    tooltip: 'The page stopped during a send. The item was restored at the front, but it may already have been sent. Check the chat, then remove it or press Play.'
                };
            } else if (queue.promptQueue.length > 0) {
                queue.queueStatus = {
                    text: 'Queue recovered',
                    type: 'info',
                    tooltip: 'Recovered after a reload or crash. The queue is paused; press Play to continue.'
                };
            } else {
                queue.queueStatus = null;
            }

            this.#normalizeState();
        }

        #sanitizeRecoveredItem(value) {
            if (!value || typeof value !== 'object') return null;
            if (typeof value.text !== 'string' || typeof value.icon !== 'string') return null;
            const item = {
                queueId: typeof value.queueId === 'string' && value.queueId
                    ? value.queueId
                    : `queue-item-${this.#owner.nextQueueItemId++}`,
                icon: value.icon,
                text: value.text,
                autoSend: value.autoSend !== false
            };
            if (typeof value.source === 'string') item.source = value.source;
            if (value.isManualCard === true) item.isManualCard = true;
            return item;
        }

        #requestPersistence() {
            const snapshot = this.#createPersistenceSnapshot();
            const performWrite = async () => {
                const persistenceReady = await this.ready;
                if (!persistenceReady || !this.#instanceId) return false;

                try {
                    const response = await chrome.runtime.sendMessage(snapshot
                        ? {
                            type: 'queuePersistenceSave',
                            instanceId: this.#instanceId,
                            snapshot
                        }
                        : {
                            type: 'queuePersistenceDelete',
                            instanceId: this.#instanceId
                        });
                    const successful = response?.success === true;
                    if (successful) {
                        this.#persistenceFailureLogged = false;
                    } else if (!this.#persistenceFailureLogged) {
                        this.#persistenceFailureLogged = true;
                        logConCgp('[queue-runtime] Recovery journal write rejected:', response?.error || 'Unknown error');
                    }
                    return successful;
                } catch (error) {
                    if (!this.#persistenceFailureLogged) {
                        this.#persistenceFailureLogged = true;
                        logConCgp('[queue-runtime] Recovery journal write failed:', error?.message || error);
                    }
                    return false;
                }
            };

            this.#writeChain = this.#writeChain.then(performWrite, performWrite);
            return this.#writeChain;
        }

        #createPersistenceSnapshot() {
            const queue = this.#owner;
            if (queue.promptQueue.length === 0 && !queue.queueInFlightItem) return null;

            let remainingMs = Math.max(0, Number(queue.remainingTimeOnPause) || 0);
            if (queue.queueTimerId !== null) {
                const elapsedMs = Math.max(0, Date.now() - Number(queue.timerStartTime || Date.now()));
                remainingMs = Math.max(0, Number(queue.currentTimerDelay || 0) - elapsedMs);
            }

            return {
                schemaVersion: QUEUE_SNAPSHOT_SCHEMA_VERSION,
                origin: location.origin,
                savedAt: Date.now(),
                items: queue.promptQueue.map((item) => ({ ...item })),
                inFlightItem: queue.queueInFlightItem ? { ...queue.queueInFlightItem } : null,
                nextQueueItemId: queue.nextQueueItemId,
                timerDurationMs: Math.max(0, Number(queue.currentTimerDelay) || 0),
                timerRemainingMs: remainingMs,
                status: queue.queueStatus ? { ...queue.queueStatus } : null
            };
        }

        #normalizeState() {
            const queue = this.#owner;
            if (!Array.isArray(queue.promptQueue)) queue.promptQueue = [];
            if (!queue.queueInFlightItem || typeof queue.queueInFlightItem !== 'object') {
                queue.queueInFlightItem = null;
            }
            if (!Number.isFinite(queue.nextQueueItemId) || queue.nextQueueItemId < 1) queue.nextQueueItemId = 1;
            if (!Number.isFinite(queue.queueGeneration) || queue.queueGeneration < 0) queue.queueGeneration = 0;
            if (!queue.queueStatus || typeof queue.queueStatus.text !== 'string') queue.queueStatus = null;
            queue.timerStartTime = Math.max(0, Number(queue.timerStartTime) || 0);
            queue.currentTimerDelay = Math.max(0, Number(queue.currentTimerDelay) || 0);
            queue.remainingTimeOnPause = Math.max(0, Number(queue.remainingTimeOnPause) || 0);
            if (queue.queueTimerId == null) queue.queueTimerId = null;

            if (queue.queueTimerId !== null) {
                queue.queuePhase = 'waiting';
                queue.isQueueRunning = true;
            } else if (queue.isQueueRunning) {
                queue.queuePhase = 'sending';
            } else if (queue.remainingTimeOnPause > 0 && queue.promptQueue.length > 0) {
                queue.queuePhase = 'paused';
            } else {
                queue.queuePhase = 'idle';
                queue.timerStartTime = 0;
                queue.currentTimerDelay = 0;
                queue.remainingTimeOnPause = 0;
            }
        }

        #clearTimer(queue) {
            if (queue.queueTimerId !== null) clearTimeout(queue.queueTimerId);
            queue.queueTimerId = null;
        }

        #flushSync() {
            if (!this.#syncRequested) return;
            const renderItems = this.#syncRenderItems;
            this.#syncRequested = false;
            this.#syncRenderItems = false;
            const snapshot = this.snapshot;
            this.#subscribers.forEach((listener) => {
                try {
                    listener(snapshot, { renderItems });
                } catch (error) {
                    logConCgp('[queue-runtime] Subscriber failed:', error?.message || error);
                }
            });
        }
    }

    window.MaxExtensionQueueRuntimeController = QueueRuntimeController;
    window.MaxExtensionFloatingPanel.queueRuntime = new QueueRuntimeController(window.MaxExtensionFloatingPanel);
})();
