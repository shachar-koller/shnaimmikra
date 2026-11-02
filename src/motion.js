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

const SPRING_STIFFNESS = 300, SPRING_DAMPING = 28;
const STRETCH_LIMIT = .24, STRETCH_VELOCITY = 9;
const glides = new WeakMap();

/** A damped spring from `from` to `to` in 60 fps samples. Positions are in tab widths, velocities in tab widths per second. */
export function springPath(from, to, velocity = 0) {
  const path = [{ x: from, v: velocity }];
  let x = from, v = velocity;
  while (path.length < 120) {
    for (let step = 0; step < 4; step += 1) {
      v += (SPRING_STIFFNESS * (to - x) - SPRING_DAMPING * v) / 240;
      x += v / 240;
    }
    if (Math.abs(to - x) < .002 && Math.abs(v) < .05) break;
    path.push({ x, v });
  }
  path.push({ x: to, v: 0 });
  return path;
}

/** Faster travel pulls the lens longer and thinner, up to a limit, like a droplet. */
export function lensFrame({ x, v }) {
  const stretch = STRETCH_LIMIT * (1 - Math.exp(-Math.abs(v) / STRETCH_VELOCITY));
  return { transform: `translateX(${x * 100}%) scale(${1 + stretch}, ${1 - stretch * .4})` };
}

/**
 * Glides the tab lens to `to`. The spring is sampled ahead of time so the compositor plays it,
 * and morph() can't disturb it because nothing is written to the style attribute. A tap during
 * a glide picks up the current position and velocity instead of restarting.
 */
export function glide(lens, from, to) {
  if (reducedMotion() || !lens) return;
  const running = glides.get(lens);
  let start = { x: from, v: 0 };
  if (running?.animation.playState === 'running') {
    const index = Math.floor(running.animation.currentTime / running.duration * (running.path.length - 1));
    start = running.path[Math.min(index, running.path.length - 1)];
    running.animation.cancel();
  }
  const path = springPath(start.x, to, start.v);
  const duration = (path.length - 1) * 1000 / 60;
  glides.set(lens, { path, duration, animation: lens.animate(path.map(lensFrame), { duration }) });
}

/** Moves the bar's soft highlight under the pointer, as glass catches light where it is touched. */
export function followPointer(bar, { clientX, clientY }) {
  if (reducedMotion()) return;
  const { left, top } = bar.getBoundingClientRect();
  const glint = bar.querySelector('.tabglint');
  glint.style.setProperty('--x', `${clientX - left}px`);
  glint.style.setProperty('--y', `${clientY - top}px`);
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
