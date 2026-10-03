'use strict';

/**
 * Sandboxed preload: exposes only the fixed engine bridge. No ipcRenderer,
 * no generic channels, no file paths, no spawn, no raw UCI.
 */
const { contextBridge, ipcRenderer } = require('electron');

const PROTOCOL_VERSION = 1;

contextBridge.exposeInMainWorld('chessEngine', Object.freeze({
  protocolVersion: PROTOCOL_VERSION,
  search: (request) => ipcRenderer.invoke('chess:search', request),
  cancel: (requestId) => ipcRenderer.invoke('chess:cancel', requestId),
  dispose: () => ipcRenderer.invoke('chess:dispose'),
}));
