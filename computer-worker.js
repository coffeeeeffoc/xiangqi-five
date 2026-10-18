import { searchPosition } from './computer.js';
self.onmessage = ({ data }) => {
  try { self.postMessage(searchPosition(data.state, data.difficulty)); }
  catch (error) { self.postMessage({ error: error.message }); }
};
