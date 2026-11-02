// Turns the Settings glass level into the tab bar's material, and bends the page behind the bar
// around the capsule's curved edge. Only Chromium can run an SVG filter as a backdrop-filter;
// Safari and Firefox keep the rim layer in style.css instead.
const BAR_WIDTH = 230, BAR_HEIGHT = 52; // .tabbar: four 56px tabs and 46px tall, plus 3px of padding.
const BEVEL = 20; // How far in from the edge the glass curves, in px.
const MAP_SCALE = 2;
let channels = null;

/**
 * Plain values for one glass level. The stops are opaque, restrained, the default (where tint and
 * blur are nearly gone), and well past realistic, where only optics and light are left to push.
 */
const STOPS = [0, 25, 50, 100];
export function glassStyle(level, dark) {
  const blend = (...values) => {
    const span = STOPS.findIndex((stop, index) => level <= STOPS[index + 1]);
    const value = values[span] + (values[span + 1] - values[span]) * (level - STOPS[span]) / (STOPS[span + 1] - STOPS[span]);
    return Math.round(value * 100) / 100;
  };
  return {
    // How far the very edge samples toward the center. Past about 8px the image folds into a mirrored ring.
    shift: blend(0, 7, 13, 34),
    // How much further red bends than blue, as a share of the shift.
    dispersion: blend(0, 0, 0, .2),
    properties: {
      '--glass-tint-amount': `${blend(97, dark ? 36 : 28, 4, 0)}%`,
      '--glass-blur': `${blend(28, 5, 1, 0)}px`,
      '--glass-refract-blur': `${blend(28, 3.5, .5, 0)}px`,
      '--glass-saturate': `${dark ? blend(100, 150, 190, 260) : blend(100, 170, 220, 320)}%`,
      '--glass-rim-blur': `${blend(8, 9, 5, 14)}px`,
      '--glass-rim-saturate': `${dark ? blend(100, 150, 200, 260) : blend(100, 200, 260, 340)}%`,
      '--glass-rim-brightness': dark ? blend(1, 1.14, 1.3, 1.6) : blend(1, 1.08, 1.18, 1.4),
      '--glass-rim-opacity': blend(0, .9, 1, 1),
      '--glass-rim-reach': `${blend(32, 32, 32, 48)}%`,
      '--glass-edge-opacity': blend(.2, .85, 1, 1),
      '--glass-edge-width': `${blend(1, 1, 1, 2.5)}px`,
      '--glass-reflection-opacity': blend(0, .7, 1, 1),
      '--glass-gloss': `rgba(255, 255, 255, ${dark ? blend(0, 0, 0, .4) : blend(0, 0, 0, .8)})`,
      '--glass-depth-size': `${blend(7, 7, 7, 20)}px`,
    },
  };
}

export function applyGlass(level, dark) {
  const { shift, dispersion, properties } = glassStyle(level, dark);
  for (const [name, value] of Object.entries(properties)) document.documentElement.style.setProperty(name, value);
  channels ||= mountRefraction();
  if (!channels) return;
  channels.red.setAttribute('scale', shift * 2 * (1 + dispersion));
  channels.green.setAttribute('scale', shift * 2);
  channels.blue.setAttribute('scale', shift * 2 * (1 - dispersion));
}

/** RGBA for an feDisplacementMap: red shifts x and green shifts y, with 128 meaning no shift. */
export function refractionMap(width, height, bevel) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const radius = height / 2;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const x = column + .5, y = row + .5;
      // Distance and direction from the capsule's center line.
      const dx = x - Math.min(Math.max(x, radius), width - radius);
      const dy = y - radius;
      const distance = Math.hypot(dx, dy) || 1;
      const depth = Math.min(Math.max((radius - distance) / bevel, 0), 1);
      // Curves like a rounded pane: steepest at the rim and flat by the end of the bevel.
      const shift = (1 - depth) ** 2.4;
      const at = (row * width + column) * 4;
      pixels[at] = 127.5 * (1 - shift * dx / distance);
      pixels[at + 1] = 127.5 * (1 - shift * dy / distance);
      pixels[at + 2] = 128;
      pixels[at + 3] = 255;
    }
  }
  return pixels;
}

function mountRefraction() {
  if (!navigator.userAgent.includes('Chrome/')) return null;
  const width = BAR_WIDTH * MAP_SCALE, height = BAR_HEIGHT * MAP_SCALE;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const pixels = refractionMap(width, height, BEVEL * MAP_SCALE);
  canvas.getContext('2d').putImageData(new ImageData(pixels, width, height), 0, 0);
  // Each color bends by its own amount, then they add back together. Equal amounts change nothing.
  const channel = (name, row) => `<feDisplacementMap in="SourceGraphic" in2="map" xChannelSelector="R" yChannelSelector="G" result="${name}-bent"/>
      <feColorMatrix in="${name}-bent" values="${row} 0 0 0 1 0" result="${name}"/>`;
  // Outside #app, so a render can't patch it away. display:none would disable the filter.
  document.body.insertAdjacentHTML('beforeend', `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
    <filter id="glass-refraction" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feImage href="${canvas.toDataURL()}" x="0" y="0" width="${BAR_WIDTH}" height="${BAR_HEIGHT}" preserveAspectRatio="none" result="map"/>
      ${channel('red', '1 0 0 0 0 0 0 0 0 0 0 0 0 0 0')}
      ${channel('green', '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0')}
      ${channel('blue', '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0')}
      <feBlend in="red" in2="green" mode="screen" result="yellow"/>
      <feBlend in="yellow" in2="blue" mode="screen"/>
    </filter>
  </svg>`);
  document.documentElement.classList.add('refraction');
  const bent = name => document.querySelector(`#glass-refraction [result="${name}-bent"]`);
  return { red: bent('red'), green: bent('green'), blue: bent('blue') };
}
