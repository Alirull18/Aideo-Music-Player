import { SimpleLRU } from './lruCache';

const colorCache = new SimpleLRU<string, string>(300);

export function rgbToHsl(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

export function hslToRgb(h: number, s: number, l: number) {
  h /= 360; s /= 100; l /= 100;
  let r = l;
  let g = l;
  let b = l;

  if (s !== 0) {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  };
}

export function hexToHsl(hex: string) {
  let r = 139, g = 92, b = 246;
  if (hex.startsWith('rgb')) {
    const m = hex.match(/\d+/g);
    if (m && m.length >= 3) {
      r = parseInt(m[0]); g = parseInt(m[1]); b = parseInt(m[2]);
    }
  } else if (hex.startsWith('#')) {
    const clean = hex.replace('#', '');
    r = parseInt(clean.substring(0, 2), 16);
    g = parseInt(clean.substring(2, 4), 16);
    b = parseInt(clean.substring(4, 6), 16);
  }

  const hsl = rgbToHsl(r, g, b);
  return {
    h: Math.round(hsl.h),
    s: Math.round(hsl.s),
    l: Math.round(hsl.l)
  };
}

export function extractDominantColor(imageUrl: string | null | undefined): Promise<string> {
  if (!imageUrl) {
    return Promise.resolve('rgba(139, 92, 246, 0.25)'); // default ambient accent fallback
  }

  if (colorCache.has(`ambient:${imageUrl}`)) {
    return Promise.resolve(colorCache.get(`ambient:${imageUrl}`)!);
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve('rgba(139, 92, 246, 0.25)');
          return;
        }

        canvas.width = 40;
        canvas.height = 40;
        ctx.drawImage(img, 0, 0, 40, 40);

        const imageData = ctx.getImageData(0, 0, 40, 40).data;
        let rSum = 0, gSum = 0, bSum = 0, count = 0;

        for (let i = 0; i < imageData.length; i += 16) {
          const r = imageData[i];
          const g = imageData[i + 1];
          const b = imageData[i + 2];
          const a = imageData[i + 3];

          if (a > 128 && (r + g + b > 60) && (r + g + b < 700)) {
            rSum += r;
            gSum += g;
            bSum += b;
            count++;
          }
        }

        if (count === 0) {
          resolve('rgba(139, 92, 246, 0.25)');
          return;
        }

        const avgR = Math.round(rSum / count);
        const avgG = Math.round(gSum / count);
        const avgB = Math.round(bSum / count);

        const color = `rgba(${avgR}, ${avgG}, ${avgB}, 0.35)`;
        colorCache.set(`ambient:${imageUrl}`, color);
        resolve(color);
      } catch (_) {
        resolve('rgba(139, 92, 246, 0.25)');
      }
    };

    img.onerror = () => {
      resolve('rgba(139, 92, 246, 0.25)');
    };

    img.src = imageUrl;
  });
}

export function extractAccentColor(dataUrl: string | null | undefined): Promise<string> {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.trim()) {
    return Promise.resolve('#8b5cf6');
  }

  if (colorCache.has(`accent:${dataUrl}`)) {
    return Promise.resolve(colorCache.get(`accent:${dataUrl}`)!);
  }

  return new Promise((resolve) => {
    const img = new Image();
    if (!dataUrl.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 10; canvas.height = 10;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve('#8b5cf6'); return; }
        ctx.drawImage(img, 0, 0, 10, 10);
        const data = ctx.getImageData(0, 0, 10, 10).data;

        const bins: Record<string, { r: number, g: number, b: number, count: number }> = {};
        for (let i = 0; i < data.length; i += 4) {
          const pr = data[i];
          const pg = data[i+1];
          const pb = data[i+2];
          const pa = data[i+3];
          if (pa < 128) continue;

          const l = (Math.max(pr, pg, pb) + Math.min(pr, pg, pb)) / 2;
          if (l > 240 || l < 20) continue;

          const binKey = `${pr >> 5},${pg >> 5},${pb >> 5}`;
          if (!bins[binKey]) {
            bins[binKey] = { r: pr, g: pg, b: pb, count: 1 };
          } else {
            bins[binKey].r += pr;
            bins[binKey].g += pg;
            bins[binKey].b += pb;
            bins[binKey].count++;
          }
        }

        let dominantColor = '#8b5cf6';
        let maxCount = 0;
        for (const key in bins) {
          const bin = bins[key];
          if (bin.count > maxCount) {
            maxCount = bin.count;
            const avgR = Math.round(bin.r / bin.count);
            const avgG = Math.round(bin.g / bin.count);
            const avgB = Math.round(bin.b / bin.count);

            const hsl = rgbToHsl(avgR, avgG, avgB);
            const targetL = Math.max(50, Math.min(75, hsl.l));
            const targetS = hsl.s < 10 ? 0 : Math.max(55, Math.min(95, hsl.s));

            const adjustedRgb = hslToRgb(hsl.h, targetS, targetL);
            dominantColor = `rgb(${adjustedRgb.r},${adjustedRgb.g},${adjustedRgb.b})`;
          }
        }
        colorCache.set(`accent:${dataUrl}`, dominantColor);
        resolve(dominantColor);
      } catch (_) {
        resolve('#8b5cf6');
      }
    };
    img.onerror = () => resolve('#8b5cf6');
    img.src = dataUrl;
  });
}

export function extractTopColors(imageUrl: string | null | undefined, count = 3): Promise<string[]> {
  const fallback = ['#8b5cf6', '#6366f1', '#a855f7'];
  if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.trim()) {
    return Promise.resolve(fallback.slice(0, count));
  }

  const cacheKey = `topColors:${count}:${imageUrl}`;
  if (colorCache.has(cacheKey)) {
    try {
      return Promise.resolve(JSON.parse(colorCache.get(cacheKey)!));
    } catch {
      // ignore
    }
  }

  return new Promise((resolve) => {
    const img = new Image();
    if (!imageUrl.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(fallback.slice(0, count));
          return;
        }
        ctx.drawImage(img, 0, 0, 32, 32);
        const data = ctx.getImageData(0, 0, 32, 32).data;

        const bins: Record<string, { r: number; g: number; b: number; count: number; h: number; s: number; l: number }> = {};
        for (let i = 0; i < data.length; i += 4) {
          const pr = data[i];
          const pg = data[i + 1];
          const pb = data[i + 2];
          const pa = data[i + 3];
          if (pa < 128) continue;

          const hsl = rgbToHsl(pr, pg, pb);
          // Filter out near black and near white
          if (hsl.l < 15 || hsl.l > 92) continue;

          // Quantize hue into 12 sectors (30 deg each), saturation into 2, lightness into 2
          const hBin = Math.floor(hsl.h / 30);
          const sBin = hsl.s > 45 ? 1 : 0;
          const lBin = hsl.l > 50 ? 1 : 0;
          const binKey = `${hBin}_${sBin}_${lBin}`;

          if (!bins[binKey]) {
            bins[binKey] = { r: pr, g: pg, b: pb, count: 1, h: hsl.h, s: hsl.s, l: hsl.l };
          } else {
            bins[binKey].r += pr;
            bins[binKey].g += pg;
            bins[binKey].b += pb;
            bins[binKey].count++;
          }
        }

        const sortedBins = Object.values(bins).sort((a, b) => b.count - a.count);
        const selectedColors: string[] = [];
        const selectedHues: number[] = [];

        for (const bin of sortedBins) {
          const avgR = Math.round(bin.r / bin.count);
          const avgG = Math.round(bin.g / bin.count);
          const avgB = Math.round(bin.b / bin.count);
          const hsl = rgbToHsl(avgR, avgG, avgB);

          // Check if hue is sufficiently distinct from already selected hues
          const isDistinct = selectedHues.every(h => {
            const diff = Math.abs(h - hsl.h);
            const dist = Math.min(diff, 360 - diff);
            return dist >= 35;
          });

          if (isDistinct || selectedColors.length === 0) {
            const targetL = Math.max(45, Math.min(70, hsl.l));
            const targetS = Math.max(55, Math.min(95, hsl.s));
            const tuned = hslToRgb(hsl.h, targetS, targetL);
            selectedColors.push(`rgb(${tuned.r},${tuned.g},${tuned.b})`);
            selectedHues.push(hsl.h);
            if (selectedColors.length >= count) break;
          }
        }

        // If we don't have enough distinct colors, generate harmonious analogous/triad stops
        if (selectedColors.length === 0) {
          resolve(fallback.slice(0, count));
          return;
        }

        const firstRgb = selectedColors[0].match(/\d+/g);
        const primaryHsl = firstRgb ? rgbToHsl(parseInt(firstRgb[0]), parseInt(firstRgb[1]), parseInt(firstRgb[2])) : { h: 260, s: 70, l: 60 };

        while (selectedColors.length < count) {
          const offset = selectedColors.length === 1 ? 55 : -55;
          const harmonizedHue = (primaryHsl.h + offset + 360) % 360;
          const tuned = hslToRgb(harmonizedHue, Math.max(60, primaryHsl.s), Math.max(50, primaryHsl.l));
          selectedColors.push(`rgb(${tuned.r},${tuned.g},${tuned.b})`);
        }

        colorCache.set(cacheKey, JSON.stringify(selectedColors));
        resolve(selectedColors);
      } catch (_) {
        resolve(fallback.slice(0, count));
      }
    };

    img.onerror = () => resolve(fallback.slice(0, count));
    img.src = imageUrl;
  });
}
