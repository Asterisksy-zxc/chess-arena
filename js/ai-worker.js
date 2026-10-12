import { findBestMove } from './ai.js';

self.onmessage = (e) => {
  const { id, state, level } = e.data;
  const move = findBestMove(state, level);
  self.postMessage({ id, move });
};
