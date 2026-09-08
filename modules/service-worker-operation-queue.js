// Serializes operations that read and then replace the same stored state.
// Independent namespaces can progress concurrently; a failed operation releases its slot.
const pending = new Map();

export function runStateOperation(namespace, operation) {
    const previous = pending.get(namespace) || Promise.resolve();
    const result = previous.then(operation);
    const settled = result.then(() => undefined, () => undefined);
    pending.set(namespace, settled);
    void settled.then(() => {
        if (pending.get(namespace) === settled) pending.delete(namespace);
    });
    return result;
}
