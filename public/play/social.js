import { $, toast } from './dom.js';
import { cleanSpeech, isEmote } from '../../shared/social.js';

/** @param {{send: (message: object) => void, canSend: () => boolean, canSpeak: () => boolean, isWisp: () => boolean, me: () => string | null, name: (id: string) => string}} hooks */
export function createSocial(hooks) {
  /** @type {{playerId: string, text: string, at: number}[]} */
  let messages = [];
  let lastSent = 0;
  const input = /** @type {HTMLInputElement} */ ($('chat-input'));

  function render() {
    $('btn-chat').hidden = !hooks.canSend();
    $('chat-form').hidden = !hooks.canSpeak();
    for (const button of document.querySelectorAll('[data-emote]')) {
      const emoteButton = /** @type {HTMLButtonElement} */ (button);
      emoteButton.hidden = hooks.isWisp() ? emoteButton.dataset.emote !== 'shine' : emoteButton.dataset.emote === 'shine';
    }
    $('chat-empty').textContent = hooks.canSpeak() ? 'Say hello to the room!' : 'Make your light shine.';
    const list = $('chat-list');
    list.replaceChildren();
    for (const message of messages) {
      const li = document.createElement('li');
      li.classList.toggle('mine', message.playerId === hooks.me());
      const name = document.createElement('strong');
      name.textContent = hooks.name(message.playerId);
      const body = document.createElement('span');
      body.textContent = message.text;
      li.append(name, body);
      list.append(li);
    }
    $('chat-empty').hidden = messages.length > 0;
    list.scrollTop = list.scrollHeight;
  }

  /** @param {any} message */
  function onMessage(message) {
    if (message.t === 'chatHistory' && Array.isArray(message.messages)) {
      messages = message.messages.filter((/** @type {any} */ m) => typeof m.playerId === 'string' && cleanSpeech(m.text) === m.text && Number.isFinite(m.at)).slice(-30);
    } else if (message.t === 'say' && typeof message.playerId === 'string' && cleanSpeech(message.text) === message.text && Number.isFinite(message.at)) {
      messages.push(message);
      if (messages.length > 30) messages.shift();
    } else return;
    render();
  }

  $('chat-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const text = cleanSpeech(input.value);
    if (!text || !hooks.canSpeak()) return;
    if (Date.now() - lastSent < 700) return;
    lastSent = Date.now();
    hooks.send({ t: 'say', text });
    input.value = '';
    input.focus();
  });
  for (const button of document.querySelectorAll('[data-emote]')) {
    button.addEventListener('click', () => {
      const kind = /** @type {HTMLElement} */ (button).dataset.emote;
      if (!isEmote(kind) || !hooks.canSend() || (hooks.isWisp() ? kind !== 'shine' : kind === 'shine')) return;
      if (Date.now() - lastSent < 700) return;
      lastSent = Date.now();
      hooks.send({ t: 'emote', kind });
      toast(kind === 'shine' ? '✨ Shine!' : kind === 'victory' ? '✌ Victory!' : kind === 'fart' ? '💨 Pfft!' : '💢 Hmph!');
    });
  }
  return { render, onMessage };
}
