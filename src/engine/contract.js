/**
 * Shared boundary for browser WASM and desktop native Stockfish adapters.
 * This file defines data only. Game integration is still pending.
 *
 * @typedef {Object} EngineSearchRequest
 * @property {string} requestId Unique for each search.
 * @property {number} revision The game revision when search began.
 * @property {string} initialFen Starting position, including custom setup.
 * @property {string[]} moves Complete UCI move history since initialFen.
 * @property {number} moveTimeMs Positive search budget.
 * @property {number} skillLevel Stockfish Skill Level; validate against the pinned build.
 *
 * @typedef {Object} EngineSearchResult
 * @property {string} requestId
 * @property {number} revision
 * @property {string|null} bestMove UCI move, or null for a terminal position.
 *
 * @typedef {Object} EngineAdapter
 * @property {(request: EngineSearchRequest, options: {signal: AbortSignal}) => Promise<EngineSearchResult>} search
 * @property {() => Promise<void>} dispose
 *
 * @typedef {Object} EngineLineTransport Low-level private transport, never exposed over desktop IPC.
 * @property {(line: string) => void} send One UCI line without CR/LF; invalid input or use after disposal throws.
 * @property {() => Promise<void>} dispose Idempotent; prevents further callbacks and releases the process/Worker.
 *
 * Transport factories receive onLine(string) and onError(Error) callbacks before
 * starting their process/Worker. Unexpected failure reports once. Search ordering,
 * readiness, cancellation and revision validation belong to the EngineAdapter.
 *
 * A controller must cancel before move/undo/reset and reject results whose requestId
 * or revision no longer matches. It must apply bestMove through session.tryMove().
 */
export const ENGINE_PROTOCOL_VERSION = 1;
