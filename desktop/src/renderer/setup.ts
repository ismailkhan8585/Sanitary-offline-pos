import { $, posLocal } from './bridge.js';

const form = $<HTMLFormElement>('form');
const message = $<HTMLParagraphElement>('message');
const button = $<HTMLButtonElement>('connect');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const address = $<HTMLInputElement>('address').value;
  message.hidden = true;
  button.disabled = true;
  try {
    if (!(await posLocal.testServer(address))) throw new Error('Server not found. Check the address and that the server PC is on.');
    await posLocal.setServer(address);
  } catch (err) {
    message.textContent = err instanceof Error ? err.message : String(err);
    message.hidden = false;
  } finally {
    button.disabled = false;
  }
});
