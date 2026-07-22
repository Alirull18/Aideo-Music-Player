// Canvas-based dominant color extraction utility for dynamic ambient backdrops
const colorCache = new Map<string, string>();

export function extractDominantColor(imageUrl: string | null | undefined): Promise<string> {
  if (!imageUrl) {
    return Promise.resolve('rgba(139, 92, 246, 0.25)'); // default accent fallback
  }

  if (colorCache.has(imageUrl)) {
    return Promise.resolve(colorCache.get(imageUrl)!);
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

        for (let i = 0; i < imageData.length; i += 16) { // sample pixels
          const r = imageData[i];
          const g = imageData[i + 1];
          const b = imageData[i + 2];
          const a = imageData[i + 3];

          // Filter out near-black, near-white, or transparent pixels
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
        colorCache.set(imageUrl, color);
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
