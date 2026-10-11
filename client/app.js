/**
 * client/app.js — the Bomberman-Dom client app.
 *
 * The mini-framework drives every screen (nickname → waiting → game → game
 * over): the view is a pure function of the store's state, and WebSocket
 * messages from the server call setState() and navigate().
 *
 * NOTE: the game BOARD is intentionally NOT rendered through this view — it
 * gets its own requestAnimationFrame loop + direct-DOM renderer in Phase 5.
 * The framework re-runs the whole view on every setState(); doing that 60x/s
 * would trash the frame budget.
 */
import { createApp, createRouter } from '../framework/index.js';
import { MSG } from '../shared/protocol.js';
import { createSocket } from './net/socket.js';
import { gameScreen } from './screens/game.js';
import { gameoverScreen } from './screens/gameover.js';
import { nicknameScreen } from './screens/nickname.js';
import { waitingScreen } from './screens/waiting.js';

const app = createApp({
  state: {
    screen: 'nickname',
    nickname: '',
    joining: false,
    joinError: null,
    me: null,
    players: [],
    countdown: null,
    chat: [],
    winnerId: null,
  },
  view,
});

// URL ↔ screen. `protect` keeps an un-joined visitor on the nickname screen
// (e.g. a refresh on /waiting while disconnected).
function protect(screen) {
  return app.getState().me ? screen : 'nickname';
}

const router = createRouter({
  '/': () => app.setState({ screen: 'nickname' }),
  '/waiting': () => app.setState({ screen: protect('waiting') }),
  '/game': () => app.setState({ screen: protect('game') }),
  '/gameover': () => app.setState({ screen: protect('gameover') }),
});

// ---- actions passed to the screens -----------------------------------------
const actions = {
  join(nickname) {
    const clean = String(nickname ?? '').trim();
    if (!clean || app.getState().joining) return;
    app.setState({ nickname: clean, joining: true, joinError: null });
    socket.connect(); // the JOIN is sent when the socket opens
  },
  sendChat(text) {
    const clean = String(text ?? '').trim();
    if (!clean) return;
    socket.send({ type: MSG.CHAT, text: clean });
  },
  backToLobby() {
    router.navigate('/waiting');
  },
};

// ---- WebSocket wiring --------------------------------------------------------
// `joined` remembers whether the server has accepted us on the CURRENT
// connection, so a reconnect re-sends the JOIN instead of duplicating it.
let joined = false;

const socket = createSocket({
  onOpen: () => {
    const state = app.getState();
    if (state.nickname && !joined) socket.send({ type: MSG.JOIN, nickname: state.nickname });
  },
  onMessage: handleServerMessage,
  onClose: () => {
    joined = false;
  },
});

function handleServerMessage(msg) {
  switch (msg.type) {
    case MSG.WELCOME:
      joined = true;
      app.setState({
        me: { id: msg.id, nickname: msg.nickname, color: msg.color, slot: msg.slot },
        joining: false,
        joinError: null,
      });
      router.navigate('/waiting');
      break;

    case MSG.LOBBY:
      app.setState({ players: msg.players, countdown: msg.countdown ?? null });
      if (msg.state === 'playing') {
        if (app.getState().screen !== 'game') router.navigate('/game');
      } else if (app.getState().screen !== 'waiting') {
        router.navigate('/waiting');
      }
      break;

    case MSG.CHAT_MSG:
      app.setState(s => ({ chat: [...s.chat, { from: msg.from, text: msg.text, ts: msg.ts }] }));
      scrollChatToBottom();
      break;

    case MSG.GAME_START:
      // Phase 4 will send the map with this message; for now just move in.
      router.navigate('/game');
      break;

    case MSG.ERROR:
      if (app.getState().screen === 'nickname') {
        app.setState({ joining: false, joinError: msg.message || msg.code });
      } else {
        console.warn('server error:', msg.code, msg.message);
      }
      break;

    default:
      break;
  }
}

function scrollChatToBottom() {
  requestAnimationFrame(() => {
    const list = document.querySelector('.chat-messages');
    if (list) list.scrollTop = list.scrollHeight;
  });
}

// ---- view: the whole UI is a pure function of the store state ---------------
function view(state) {
  switch (state.screen) {
    case 'waiting':
      return waitingScreen(state, actions);
    case 'game':
      return gameScreen(state, actions);
    case 'gameover':
      return gameoverScreen(state, actions);
    default:
      return nicknameScreen(state, actions);
  }
}

app.mount('#app');
router.start();
