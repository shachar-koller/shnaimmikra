// Patches the live DOM to match new markup instead of replacing it, so elements
// survive a render: CSS transitions run, focus stays put, live regions keep working.
// Listeners must be assigned with `.onclick`, which each render overwrites.
const keyOf = node => node.nodeType === Node.ELEMENT_NODE ? node.id || node.dataset.key || null : null;
const sameKind = (a, b) => a.nodeType === b.nodeType && a.nodeName === b.nodeName;

function patchAttributes(from, to) {
  for (const { name } of [...from.attributes]) if (!to.hasAttribute(name)) from.removeAttribute(name);
  for (const { name, value } of [...to.attributes]) if (from.getAttribute(name) !== value) from.setAttribute(name, value);
}

function patchNode(from, to) {
  if (from.nodeType !== Node.ELEMENT_NODE) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return;
  }
  patchAttributes(from, to);
  patchChildren(from, to);
}

function patchChildren(parent, next) {
  const keyed = new Map();
  for (const child of parent.children) if (keyOf(child)) keyed.set(keyOf(child), child);
  let cursor = parent.firstChild;
  for (const child of [...next.childNodes]) {
    const key = keyOf(child);
    const match = key ? keyed.get(key) : cursor && !keyOf(cursor) ? cursor : null;
    if (match && sameKind(match, child)) {
      if (match === cursor) cursor = cursor.nextSibling;
      else parent.insertBefore(match, cursor);
      patchNode(match, child);
    } else {
      parent.insertBefore(child, cursor);
    }
  }
  while (cursor) {
    const following = cursor.nextSibling;
    cursor.remove();
    cursor = following;
  }
}

export function morph(target, html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  patchChildren(target, template.content);
}
