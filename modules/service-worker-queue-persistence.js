// Persists queue recovery journals without sharing them between live tabs.

'use strict';

const REGISTRY_KEY = 'ocpQueuePersistenceRegistry.v1';
const CLEANUP_MARKER_KEY = 'ocpQueuePersistenceCleanup.v1';
const SNAPSHOT_KEY_PREFIX = 'ocpQueueSnapshot.v1.';
const SNAPSHOT_SCHEMA_VERSION = 1;
const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_QUEUE_SIZE = 10;
const MAX_ITEM_TEXT_LENGTH = 500_000;
const MAX_ITEM_ICON_LENGTH = 20_000;
const INSTANCE_ID_PATTERN = /^[a-zA-Z0-9-]{16,80}$/;
let registryMutationChain = Promise.resolve();

function snapshotKey(instanceId) {
    return `${SNAPSHOT_KEY_PREFIX}${instanceId}`;
}

function createInstanceId() {
    return crypto.randomUUID();
}

function getSenderOrigin(sender) {
    try {
        return new URL(sender?.url || sender?.tab?.url || '').origin;
    } catch (_) {
        return null;
    }
}

async function getRegistry() {
    const stored = await chrome.storage.session.get(REGISTRY_KEY);
    const registry = stored?.[REGISTRY_KEY];
    return registry && typeof registry === 'object' && !Array.isArray(registry)
        ? registry
        : {};
}

async function saveRegistry(registry) {
    await chrome.storage.session.set({ [REGISTRY_KEY]: registry });
}

function withRegistryLock(operation) {
    const result = registryMutationChain.then(operation, operation);
    registryMutationChain = result.then(() => undefined, () => undefined);
    return result;
}

function sanitizeQueueItem(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (typeof value.text !== 'string' || value.text.length > MAX_ITEM_TEXT_LENGTH) return null;
    if (typeof value.icon !== 'string' || value.icon.length > MAX_ITEM_ICON_LENGTH) return null;
    if (typeof value.queueId !== 'string' || !value.queueId || value.queueId.length > 100) return null;

    const item = {
        queueId: value.queueId,
        icon: value.icon,
        text: value.text,
        autoSend: value.autoSend !== false
    };

    if (typeof value.source === 'string' && value.source.length <= 100) {
        item.source = value.source;
    }
    if (value.isManualCard === true) {
        item.isManualCard = true;
    }
    return item;
}

function sanitizeStatus(value) {
    if (!value || typeof value !== 'object' || typeof value.text !== 'string') return null;
    return {
        text: value.text.slice(0, 200),
        type: typeof value.type === 'string' ? value.type.slice(0, 30) : 'info',
        tooltip: typeof value.tooltip === 'string'
            ? value.tooltip.slice(0, 500)
            : value.text.slice(0, 500)
    };
}

function sanitizeSnapshot(value, expectedOrigin = null) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (value.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) return null;
    if (typeof value.origin !== 'string' || (expectedOrigin && value.origin !== expectedOrigin)) return null;

    const savedAt = Number(value.savedAt);
    if (!Number.isFinite(savedAt) || savedAt <= 0) return null;

    const rawItems = Array.isArray(value.items) ? value.items : [];
    const items = rawItems.map(sanitizeQueueItem);
    if (items.some((item) => !item)) return null;

    const inFlightItem = value.inFlightItem == null ? null : sanitizeQueueItem(value.inFlightItem);
    if (value.inFlightItem != null && !inFlightItem) return null;
    if (items.length + (inFlightItem ? 1 : 0) > MAX_QUEUE_SIZE) return null;
    const queueIds = items.map((item) => item.queueId);
    if (inFlightItem) queueIds.push(inFlightItem.queueId);
    if (new Set(queueIds).size !== queueIds.length) return null;

    const timerDurationMs = Math.max(0, Number(value.timerDurationMs) || 0);
    const timerRemainingMs = Math.min(
        timerDurationMs,
        Math.max(0, Number(value.timerRemainingMs) || 0)
    );

    return {
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        origin: value.origin,
        savedAt,
        items,
        inFlightItem,
        nextQueueItemId: Math.max(1, Math.floor(Number(value.nextQueueItemId) || 1)),
        timerDurationMs,
        timerRemainingMs,
        status: sanitizeStatus(value.status)
    };
}

async function cleanupExpiredSnapshotsOnce() {
    const marker = await chrome.storage.session.get(CLEANUP_MARKER_KEY);
    const lastCleanupAt = Number(marker?.[CLEANUP_MARKER_KEY]) || 0;
    if (Date.now() - lastCleanupAt < 24 * 60 * 60 * 1000) return;

    await chrome.storage.session.set({ [CLEANUP_MARKER_KEY]: Date.now() });
    const allLocalValues = await chrome.storage.local.get(null);
    const now = Date.now();
    const expiredKeys = Object.entries(allLocalValues)
        .filter(([key, value]) => (
            key.startsWith(SNAPSHOT_KEY_PREFIX)
            && (
                !value
                || !Number.isFinite(Number(value.savedAt))
                || now - Number(value.savedAt) > SNAPSHOT_TTL_MS
            )
        ))
        .map(([key]) => key);

    if (expiredKeys.length > 0) {
        await chrome.storage.local.remove(expiredKeys);
    }
}

async function claimInstanceId(candidateId, tabId, origin) {
    return withRegistryLock(async () => {
        const registry = await getRegistry();
        let instanceId = INSTANCE_ID_PATTERN.test(candidateId || '') ? candidateId : null;

        if (instanceId) {
            const currentOwner = registry[instanceId];
            const isSameContext = Number(currentOwner?.tabId) === tabId
                && currentOwner?.origin === origin;
            if (currentOwner && !isSameContext) {
                // Keep ownership tombstoned for this browser session. This prevents a
                // late-loading duplicated tab from inheriting a just-closed tab's queue.
                instanceId = null;
            }
        }

        if (!instanceId) {
            instanceId = Object.entries(registry).find(([, owner]) => (
                Number(owner?.tabId) === tabId && owner?.origin === origin
            ))?.[0] || createInstanceId();
        }

        registry[instanceId] = { tabId, origin, claimedAt: Date.now() };
        await saveRegistry(registry);
        return instanceId;
    });
}

async function isOwnedBySender(instanceId, sender) {
    const tabId = sender?.tab?.id;
    const origin = getSenderOrigin(sender);
    if (!Number.isInteger(tabId) || !origin || !INSTANCE_ID_PATTERN.test(instanceId || '')) return false;
    const registry = await getRegistry();
    const owner = registry[instanceId];
    return Number(owner?.tabId) === tabId && owner?.origin === origin;
}

export async function claimQueuePersistenceContext(request, sender) {
    const tabId = sender?.tab?.id;
    const origin = getSenderOrigin(sender);
    if (!Number.isInteger(tabId) || !origin) {
        return { success: false, error: 'Queue persistence requires a content-script tab.' };
    }

    await cleanupExpiredSnapshotsOnce();
    const instanceId = await claimInstanceId(request?.candidateInstanceId, tabId, origin);
    const key = snapshotKey(instanceId);
    const stored = await chrome.storage.local.get(key);
    const rawSnapshot = stored?.[key];
    const snapshot = sanitizeSnapshot(rawSnapshot, origin);

    if (rawSnapshot && (
        !snapshot
        || Date.now() - snapshot.savedAt > SNAPSHOT_TTL_MS
    )) {
        await chrome.storage.local.remove(key);
    }

    return {
        success: true,
        instanceId,
        snapshot: snapshot && Date.now() - snapshot.savedAt <= SNAPSHOT_TTL_MS
            ? snapshot
            : null
    };
}

export async function saveQueuePersistenceSnapshot(request, sender) {
    const instanceId = request?.instanceId;
    const origin = getSenderOrigin(sender);
    if (!origin || !await isOwnedBySender(instanceId, sender)) {
        return { success: false, error: 'This tab does not own the queue recovery journal.' };
    }

    const snapshot = sanitizeSnapshot(request?.snapshot, origin);
    if (!snapshot) {
        return { success: false, error: 'Invalid queue recovery journal.' };
    }

    await chrome.storage.local.set({ [snapshotKey(instanceId)]: snapshot });
    return { success: true };
}

export async function deleteQueuePersistenceSnapshot(request, sender) {
    const instanceId = request?.instanceId;
    if (!await isOwnedBySender(instanceId, sender)) {
        return { success: false, error: 'This tab does not own the queue recovery journal.' };
    }
    await chrome.storage.local.remove(snapshotKey(instanceId));
    return { success: true };
}
