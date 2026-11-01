// One-shot animations. State changes themselves are CSS transitions in style.css.
const EASE_OUT = 'cubic-bezier(.22, 1, .36, 1)';
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Slides content in from the direction of travel: 1 = forward, -1 = backward. */
export function slideIn(elements, direction = 1) {
  if (reducedMotion()) return;
  for (const element of elements) {
    element?.animate(
      [{ opacity: 0, transform: `translateX(${direction * 16}px)` }, { opacity: 1, transform: 'none' }],
      { duration: 280, easing: EASE_OUT },
    );
  }
}

export function pop(element, scale = 1.14) {
  if (reducedMotion() || !element) return;
  element.animate(
    [{ transform: 'scale(1)' }, { transform: `scale(${scale})`, offset: .4 }, { transform: 'scale(1)' }],
    { duration: 300, easing: EASE_OUT },
  );
}

export function haptic(pattern) {
  if (reducedMotion()) return;
  try { navigator.vibrate?.(pattern); } catch { /* Optional device feedback. */ }
}

/** A small burst in the theme's own colors, reserved for finishing all three readings. */
export function celebrate(origin) {
  if (reducedMotion() || !origin) return;
  const { left, top, width, height } = origin.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.className = 'burst';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.left = `${left + width / 2}px`;
  layer.style.top = `${top + height / 2}px`;
  const count = 26;
  const flights = Array.from({ length: count }, (_, index) => {
    const piece = document.createElement('i');
    piece.className = `burst-piece burst-${index % 3}`;
    layer.append(piece);
    const angle = (index / count) * Math.PI * 2 + Math.random() * .4;
    const reach = 70 + Math.random() * 90;
    const x = Math.cos(angle) * reach, y = Math.sin(angle) * reach * .75;
    const spin = (Math.random() - .5) * 540;
    return piece.animate([
      { transform: 'translate(0, 0) rotate(0) scale(.4)', opacity: 1 },
      { transform: `translate(${x}px, ${y}px) rotate(${spin / 2}deg) scale(1)`, opacity: 1, offset: .55, easing: 'ease-in' },
      { transform: `translate(${x * 1.15}px, ${y + 70}px) rotate(${spin}deg) scale(.7)`, opacity: 0 },
    ], { duration: 850 + Math.random() * 350, easing: EASE_OUT, fill: 'forwards' }).finished;
  });
  document.body.append(layer);
  Promise.allSettled(flights).then(() => layer.remove());
}
