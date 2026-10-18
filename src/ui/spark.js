// Tiny step-line sparkline (inline SVG) that redraws in place.

const NS = 'http://www.w3.org/2000/svg';

/**
 * @param {{width?:number, height?:number, minRange?:number}} opts
 *   minRange (cents) keeps a 1¢ wiggle from filling the whole height.
 */
export function createSparkline({ width = 84, height = 22, minRange = 4 } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'spark');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  const dot = document.createElementNS(NS, 'circle');
  dot.setAttribute('r', '2.25');
  svg.append(path, dot);

  function draw(points) {
    svg.style.visibility = points.length < 2 ? 'hidden' : 'visible';
    if (points.length < 2) return;
    const t0 = points[0].t;
    const span = Math.max(1, points.at(-1).t - t0);
    let lo = Math.min(...points.map((p) => p.price));
    let hi = Math.max(...points.map((p) => p.price));
    if (hi - lo < minRange) {
      const mid = (hi + lo) / 2;
      [lo, hi] = [mid - minRange / 2, mid + minRange / 2];
    }
    const x = (t) => ((t - t0) / span) * (width - 4) + 1;
    const y = (p) => height - 3 - ((p - lo) / (hi - lo)) * (height - 6);
    let d = `M${x(points[0].t).toFixed(1)} ${y(points[0].price).toFixed(1)}`;
    for (const p of points.slice(1)) d += ` H${x(p.t).toFixed(1)} V${y(p.price).toFixed(1)}`;
    path.setAttribute('d', d);
    const last = points.at(-1);
    dot.setAttribute('cx', x(last.t).toFixed(1));
    dot.setAttribute('cy', y(last.price).toFixed(1));
  }

  return { el: svg, draw };
}
