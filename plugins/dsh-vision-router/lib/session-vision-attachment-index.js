import { legacySessionEvents } from './session-event-history-compat.js';
function propertyBag(value) {
    return value !== null && (typeof value === 'object' || typeof value === 'function')
        ? value
        : undefined;
}
function weakKey(value) {
    return value !== null && (typeof value === 'object' || typeof value === 'function')
        ? value
        : undefined;
}
function attachmentRef(value) {
    return propertyBag(value) ? value : undefined;
}
function attachmentIdOf(ref) {
    const record = propertyBag(ref);
    return String(record?.attachmentId ?? record?.id);
}
function iterableValues(value) {
    const iterator = propertyBag(value)?.[Symbol.iterator];
    if (typeof iterator !== 'function') {
        throw new TypeError('Session attachment collector returned a non-iterable result');
    }
    return value;
}
function boundedMessage(error) {
    const record = propertyBag(error);
    const text = record?.message ?? error;
    return String(text ?? '').slice(0, 400);
}
/**
 * Attachment access boundary for one SessionVisionStateStore.
 *
 * The state store remains the sole bounded storage owner. This boundary owns
 * only cache access plus target-only cold recovery from the durable Session
 * event source. Synchronous lookup never performs historical I/O.
 */
export function createSessionVisionAttachmentIndex({ stateStore, collectEventAttachmentRefs, readSessionLog, logger, }) {
    const runtimeStore = stateStore;
    const lookup = runtimeStore.lookupAttachment;
    const primitiveLookup = typeof lookup === 'function'
        ? (session, attachmentId) => lookup.call(stateStore, session, attachmentId)
        : undefined;
    const attachmentRecoveryWarnings = new WeakMap();
    const recordAttachments = (session, refs) => {
        if (!session || !Array.isArray(refs) || refs.length === 0)
            return;
        stateStore.recordAttachments(session, refs);
    };
    const lookupAttachment = (session, attachmentId) => {
        if (primitiveLookup === undefined)
            return undefined;
        return primitiveLookup(session, attachmentId);
    };
    const recoverAttachmentsFromEvents = (session, ids, events) => {
        const found = new Map();
        if (!Array.isArray(events)
            || events.length === 0
            || typeof collectEventAttachmentRefs !== 'function') {
            return found;
        }
        const wanted = new Set(ids);
        const collected = collectEventAttachmentRefs(events);
        for (const value of iterableValues(collected)) {
            if (!value)
                continue;
            const ref = attachmentRef(value);
            if (ref === undefined)
                continue;
            const id = attachmentIdOf(ref);
            if (wanted.has(id) && !found.has(id))
                found.set(id, ref);
        }
        if (found.size > 0)
            stateStore.recordAttachments(session, [...found.values()]);
        return found;
    };
    const warnAttachmentRecoveryFailure = (session, attachmentId, error) => {
        const message = boundedMessage(error);
        const warningKey = `${String(attachmentId)}:${message}`;
        const key = weakKey(session);
        if (key !== undefined && attachmentRecoveryWarnings.get(key) === warningKey)
            return;
        if (key !== undefined)
            attachmentRecoveryWarnings.set(key, warningKey);
        logger?.warn?.('vision-router: session attachment recovery failed id=%s error=%s', String(attachmentId), message);
    };
    const resolveAttachments = async (session, attachmentIds) => {
        const requested = [
            ...new Set((Array.isArray(attachmentIds) ? attachmentIds : []).map((id) => String(id))),
        ];
        const resolved = new Map();
        const missing = [];
        for (const id of requested) {
            const cached = lookupAttachment(session, id);
            if (cached !== undefined)
                resolved.set(id, cached);
            else
                missing.push(id);
        }
        if (missing.length === 0 || session === undefined)
            return resolved;
        let events;
        if (typeof readSessionLog === 'function') {
            let result;
            try {
                result = await readSessionLog(session);
            }
            catch (error) {
                warnAttachmentRecoveryFailure(session, missing[0], error);
                return resolved;
            }
            const resultRecord = propertyBag(result);
            if (resultRecord?.supported === true) {
                const key = weakKey(session);
                if (key !== undefined)
                    attachmentRecoveryWarnings.delete(key);
                events = resultRecord.events;
            }
            else if (resultRecord?.supported !== false) {
                warnAttachmentRecoveryFailure(session, missing[0], new Error('Session log reader returned an invalid capability result'));
                return resolved;
            }
        }
        // Explicitly unsupported SessionQuery keeps the released Session-local
        // compatibility fallback. Advertised reader failures above never fall back.
        if (events === undefined)
            events = legacySessionEvents(session);
        const recovered = recoverAttachmentsFromEvents(session, missing, events);
        for (const [id, ref] of recovered)
            resolved.set(id, ref);
        return resolved;
    };
    const resolveAttachment = async (session, attachmentId) => {
        return (await resolveAttachments(session, [attachmentId])).get(String(attachmentId));
    };
    return Object.freeze({
        recordAttachments,
        lookupAttachment,
        resolveAttachment,
        resolveAttachments,
    });
}
