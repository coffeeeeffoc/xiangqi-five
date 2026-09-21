import { chooseAction } from './computer.js';
self.onmessage = ({ data }) => {
  try { self.postMessage({ action: chooseAction(data.state, data.difficulty) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
