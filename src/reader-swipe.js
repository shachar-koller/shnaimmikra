import { reducedMotion, springPath } from './motion.js';
import { swipeDirection } from './reader-model.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const transform = ({ x = 0, y = 0, angle = 0, scale = 1 } = {}) =>
  `translate3d(${x}px, ${y}px, 0) rotate(${angle}deg) scale(${scale})`;

/** Owns just the card's motion. Reading position changes only after a committed throw. */
export function createCardSwipe({ canStep, onSwipe, onDirection }) {
  let card = null, stroke = null, animation = null, turn = null;
  let pose = {};

  function stopAnimation() {
    animation?.cancel();
    animation = null;
  }

  function paint(next) {
    pose = next;
    if (reducedMotion()) return;
    // A filled animation survives an unrelated DOM morph without inline styles.
    const previous = animation;
    const frame = { transform: transform(pose) };
    animation = card.animate([frame, frame], { duration: 1, fill: 'both' });
    previous?.cancel();
  }

  function settle(from = pose) {
    stopAnimation();
    pose = {};
    if (!card?.isConnected || reducedMotion()) return;
    const path = springPath(0, 1);
    animation = card.animate(path.map(({ x }) => ({
      // Reveal long verses from their top so scaling never moves the reading line.
      transformOrigin: from.scale === undefined ? '50% 80%' : '50% 0%',
      transform: transform({
        x: (from.x || 0) * (1 - x), y: (from.y || 0) * (1 - x),
        angle: (from.angle || 0) * (1 - x), scale: 1 + ((from.scale ?? 1) - 1) * (1 - x),
      }),
    })), { duration: (path.length - 1) * 1000 / 60 });
  }

  function releaseCapture() {
    const id = stroke?.id;
    stroke = null;
    if (id !== undefined && card?.hasPointerCapture(id)) card.releasePointerCapture(id);
  }

  function resetStroke() {
    releaseCapture();
    stroke = null;
    settle();
  }

  function cancel() {
    turn = null;
    releaseCapture();
    stroke = null;
    stopAnimation();
    pose = {};
  }

  function finish() { turn?.(); }

  function dismiss(direction, commit) {
    finish();
    if (!card || reducedMotion()) { cancel(); commit(); return; }
    onDirection?.(direction);
    const element = card;
    const from = getComputedStyle(element).transform;
    const start = pose;
    stopAnimation();
    // Travel beyond either viewport edge, including on a wide desktop layout.
    const distance = Math.max(innerWidth, element.offsetWidth) + element.offsetWidth;
    const flight = element.animate([
      { transform: from },
      { transform: transform({ x: direction * distance, y: (start.y || 0) + 65, angle: direction * 24 }) },
    ], { duration: 240, easing: 'cubic-bezier(.32, .05, .65, 1)', fill: 'forwards' });
    animation = flight;
    const complete = () => {
      if (turn !== complete) return;
      turn = null;
      stopAnimation();
      pose = {};
      commit();
      if (card?.isConnected) settle({ y: 12, scale: .96 });
    };
    turn = complete;
    flight.finished.then(complete, () => {});
  }

  function bind(element) {
    if (element === card) return;
    cancel();
    card = element;
    card.onpointerdown = event => {
      // A second finger is a pinch. Mouse drags on the Hebrew still select text.
      if (!event.isPrimary) { if (stroke) resetStroke(); return; }
      if (event.target.closest('button, a, select') ||
          (event.pointerType === 'mouse' && (event.button !== 0 || event.target.closest('.pasuk-text')))) return;
      if (!(window.getSelection()?.isCollapsed ?? true)) return;
      if (event.pointerType === 'mouse') event.preventDefault();
      finish();
      stopAnimation();
      pose = {};
      stroke = { id: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp, dragging: false };
    };
    card.onpointermove = event => {
      if (stroke?.id !== event.pointerId) return;
      const dx = event.clientX - stroke.x, dy = event.clientY - stroke.y;
      if (!(window.getSelection()?.isCollapsed ?? true) || event.timeStamp - stroke.at > 700) {
        resetStroke(); return;
      }
      if (!stroke.dragging) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
        if (Math.abs(dx) < Math.abs(dy) * 1.5) { resetStroke(); return; }
        stroke.dragging = true;
        try { card.setPointerCapture(event.pointerId); } catch { /* Synthetic input has no active pointer. */ }
      }
      const x = canStep(Math.sign(dx)) ? dx : dx * .16;
      if (stroke.direction !== Math.sign(dx)) {
        stroke.direction = Math.sign(dx);
        onDirection?.(stroke.direction);
      }
      paint({ x, y: clamp(dy * .25, -40, 40), angle: clamp(x / card.offsetWidth * 18, -18, 18) });
    };
    card.onpointerup = event => {
      if (stroke?.id !== event.pointerId) return;
      const direction = swipeDirection({
        dx: event.clientX - stroke.x, dy: event.clientY - stroke.y, ms: event.timeStamp - stroke.at,
        width: card.clientWidth, selecting: !(window.getSelection()?.isCollapsed ?? true),
      });
      releaseCapture();
      stroke = null;
      if (direction && canStep(direction)) onSwipe(direction);
      else settle();
    };
    card.onpointercancel = () => { if (stroke) resetStroke(); };
    card.onlostpointercapture = event => {
      // Touch starts with implicit capture on the text. Moving capture to the card
      // bubbles a loss from that child, while the card still owns the gesture.
      if (event.target === card && stroke?.id === event.pointerId) resetStroke();
    };
  }

  return { bind, dismiss, finish, cancel, active: () => !!(stroke?.dragging || turn) };
}
