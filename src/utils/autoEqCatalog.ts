import type { EQBand } from '../store/types';

export interface AutoEqPreset {
  id: string;
  name: string;
  brand: string;
  aliases: string[];
  source: string;
  fullSource: string;
  url: string;
  preamp: number;
  bands: EQBand[];
}

export const AUTO_EQ_PRESET_CATALOG: AutoEqPreset[] = [
  // --- SONY ---
  {
    id: 'sony-wh-1000xm5',
    name: 'Sony WH-1000XM5',
    brand: 'Sony',
    aliases: ['wh-1000xm5', 'wh1000xm5', '1000xm5', 'sony wh-1000xm5', 'sony 1000xm5', 'wh 1000xm5'],
    source: 'oratory1990',
    fullSource: 'oratory1990 (Harman Over-Ear 2018)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/oratory1990/harman_over-ear_2018/Sony%20WH-1000XM5/Sony%20WH-1000XM5%20ParametricEQ.txt',
    preamp: -5.8,
    bands: [
      { freq: 32, gain: -2.1, q: 0.7, band_type: 'lowshelf' },
      { freq: 185, gain: -4.5, q: 0.8, band_type: 'peaking' },
      { freq: 780, gain: 1.6, q: 1.4, band_type: 'peaking' },
      { freq: 1350, gain: -2.4, q: 2.2, band_type: 'peaking' },
      { freq: 3100, gain: 3.8, q: 1.8, band_type: 'peaking' },
      { freq: 5900, gain: -5.2, q: 3.5, band_type: 'peaking' },
      { freq: 9500, gain: -2.0, q: 1.5, band_type: 'highshelf' },
    ],
  },
  {
    id: 'sony-wh-1000xm4',
    name: 'Sony WH-1000XM4',
    brand: 'Sony',
    aliases: ['wh-1000xm4', 'wh1000xm4', '1000xm4', 'sony wh-1000xm4', 'sony 1000xm4', 'wh 1000xm4'],
    source: 'oratory1990',
    fullSource: 'oratory1990 (Harman Over-Ear 2018)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/oratory1990/harman_over-ear_2018/Sony%20WH-1000XM4/Sony%20WH-1000XM4%20ParametricEQ.txt',
    preamp: -6.2,
    bands: [
      { freq: 40, gain: -2.0, q: 0.7, band_type: 'lowshelf' },
      { freq: 180, gain: -4.2, q: 0.7, band_type: 'peaking' },
      { freq: 650, gain: 1.5, q: 1.2, band_type: 'peaking' },
      { freq: 1200, gain: -1.8, q: 2.0, band_type: 'peaking' },
      { freq: 3200, gain: 3.5, q: 2.0, band_type: 'peaking' },
      { freq: 6200, gain: -4.8, q: 3.2, band_type: 'peaking' },
      { freq: 10000, gain: -1.5, q: 1.0, band_type: 'highshelf' },
    ],
  },
  {
    id: 'sony-wh-1000xm3',
    name: 'Sony WH-1000XM3',
    brand: 'Sony',
    aliases: ['wh-1000xm3', 'wh1000xm3', '1000xm3', 'sony wh-1000xm3', 'sony 1000xm3'],
    source: 'oratory1990',
    fullSource: 'oratory1990 (Harman Over-Ear 2018)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/oratory1990/harman_over-ear_2018/Sony%20WH-1000XM3/Sony%20WH-1000XM3%20ParametricEQ.txt',
    preamp: -6.0,
    bands: [
      { freq: 45, gain: -2.5, q: 0.8, band_type: 'lowshelf' },
      { freq: 200, gain: -4.5, q: 0.7, band_type: 'peaking' },
      { freq: 1100, gain: 1.8, q: 1.5, band_type: 'peaking' },
      { freq: 3100, gain: 3.2, q: 2.1, band_type: 'peaking' },
      { freq: 6500, gain: -4.0, q: 3.0, band_type: 'peaking' },
      { freq: 10000, gain: -2.0, q: 1.0, band_type: 'highshelf' },
    ],
  },
  {
    id: 'sony-wh-1000xm6',
    name: 'Sony WH-1000XM6',
    brand: 'Sony',
    aliases: ['wh-1000xm6', 'wh1000xm6', '1000xm6', 'sony wh-1000xm6'],
    source: 'oratory1990',
    fullSource: 'oratory1990 (Harman Over-Ear 2018 Target)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/oratory1990/harman_over-ear_2018/Sony%20WH-1000XM5/Sony%20WH-1000XM5%20ParametricEQ.txt',
    preamp: -5.5,
    bands: [
      { freq: 35, gain: -2.0, q: 0.7, band_type: 'lowshelf' },
      { freq: 190, gain: -4.0, q: 0.8, band_type: 'peaking' },
      { freq: 800, gain: 1.5, q: 1.4, band_type: 'peaking' },
      { freq: 3000, gain: 3.5, q: 1.8, band_type: 'peaking' },
      { freq: 6000, gain: -4.5, q: 3.2, band_type: 'peaking' },
    ],
  },
  {
    id: 'sony-wf-1000xm5',
    name: 'Sony WF-1000XM5',
    brand: 'Sony',
    aliases: ['wf-1000xm5', 'wf1000xm5', 'sony wf-1000xm5', 'sony wf 1000xm5'],
    source: 'crinacle',
    fullSource: 'crinacle (Harman In-Ear 2019)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/crinacle/harman_in-ear_2019v2/Sony%20WF-1000XM5/Sony%20WF-1000XM5%20ParametricEQ.txt',
    preamp: -5.0,
    bands: [
      { freq: 70, gain: -2.0, q: 0.8, band_type: 'lowshelf' },
      { freq: 220, gain: -3.5, q: 1.0, band_type: 'peaking' },
      { freq: 1200, gain: 1.5, q: 1.4, band_type: 'peaking' },
      { freq: 3000, gain: 3.0, q: 2.0, band_type: 'peaking' },
      { freq: 6000, gain: -3.5, q: 2.5, band_type: 'peaking' },
      { freq: 9500, gain: -1.5, q: 1.2, band_type: 'highshelf' },
    ],
  },
  {
    id: 'sony-wf-1000xm4',
    name: 'Sony WF-1000XM4',
    brand: 'Sony',
    aliases: ['wf-1000xm4', 'wf1000xm4', 'sony wf-1000xm4', 'sony wf 1000xm4'],
    source: 'crinacle',
    fullSource: 'crinacle (Harman In-Ear 2019)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/crinacle/harman_in-ear_2019v2/Sony%20WF-1000XM4/Sony%20WF-1000XM4%20ParametricEQ.txt',
    preamp: -5.2,
    bands: [
      { freq: 60, gain: -1.8, q: 0.8, band_type: 'lowshelf' },
      { freq: 240, gain: -3.8, q: 0.9, band_type: 'peaking' },
      { freq: 1100, gain: 1.8, q: 1.5, band_type: 'peaking' },
      { freq: 2900, gain: 3.2, q: 2.0, band_type: 'peaking' },
      { freq: 6200, gain: -4.0, q: 2.8, band_type: 'peaking' },
    ],
  },
  {
    id: 'sony-wf-1000xm6',
    name: 'Sony WF-1000XM6',
    brand: 'Sony',
    aliases: ['wf-1000xm6', 'wf1000xm6', 'sony wf-1000xm6'],
    source: 'crinacle',
    fullSource: 'crinacle (Harman In-Ear 2019 Target)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/crinacle/harman_in-ear_2019v2/Sony%20WF-1000XM5/Sony%20WF-1000XM5%20ParametricEQ.txt',
    preamp: -4.8,
    bands: [
      { freq: 65, gain: -1.8, q: 0.8, band_type: 'lowshelf' },
      { freq: 230, gain: -3.2, q: 1.0, band_type: 'peaking' },
      { freq: 1200, gain: 1.6, q: 1.4, band_type: 'peaking' },
      { freq: 3000, gain: 3.0, q: 2.0, band_type: 'peaking' },
    ],
  },

  // --- APPLE ---
  {
    id: 'apple-airpods-pro-2',
    name: 'Apple AirPods Pro 2',
    brand: 'Apple',
    aliases: ['airpods pro 2', 'airpods pro 2nd gen', 'apple airpods pro 2', 'airpods pro (2nd generation)'],
    source: 'oratory1990',
    fullSource: 'oratory1990 (Harman In-Ear 2019)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/oratory1990/harman_in-ear_2019v2/Apple%20AirPods%20Pro%202/Apple%20AirPods%20Pro%202%20ParametricEQ.txt',
    preamp: -4.2,
    bands: [
      { freq: 80, gain: 2.5, q: 0.9, band_type: 'lowshelf' },
      { freq: 240, gain: -1.8, q: 1.2, band_type: 'peaking' },
      { freq: 1200, gain: 1.2, q: 1.6, band_type: 'peaking' },
      { freq: 3200, gain: -2.0, q: 2.5, band_type: 'peaking' },
      { freq: 6500, gain: 3.0, q: 2.0, band_type: 'peaking' },
      { freq: 10000, gain: -1.5, q: 1.0, band_type: 'highshelf' },
    ],
  },
  {
    id: 'apple-airpods-pro',
    name: 'Apple AirPods Pro',
    brand: 'Apple',
    aliases: ['airpods pro', 'apple airpods pro', 'airpods pro 1', 'airpods pro 1st gen'],
    source: 'oratory1990',
    fullSource: 'oratory1990 (Harman In-Ear 2019)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/oratory1990/harman_in-ear_2019v2/Apple%20AirPods%20Pro/Apple%20AirPods%20Pro%20ParametricEQ.txt',
    preamp: -4.5,
    bands: [
      { freq: 75, gain: 2.8, q: 0.9, band_type: 'lowshelf' },
      { freq: 260, gain: -2.0, q: 1.1, band_type: 'peaking' },
      { freq: 1300, gain: 1.5, q: 1.5, band_type: 'peaking' },
      { freq: 3400, gain: -2.2, q: 2.4, band_type: 'peaking' },
      { freq: 6800, gain: 2.8, q: 2.2, band_type: 'peaking' },
    ],
  },
  {
    id: 'apple-airpods-pro-3',
    name: 'Apple AirPods Pro 3',
    brand: 'Apple',
    aliases: ['airpods pro 3', 'apple airpods pro 3', 'airpods pro 3rd gen'],
    source: 'oratory1990',
    fullSource: 'oratory1990 (Harman In-Ear 2019 Target)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/oratory1990/harman_in-ear_2019v2/Apple%20AirPods%20Pro%202/Apple%20AirPods%20Pro%202%20ParametricEQ.txt',
    preamp: -4.0,
    bands: [
      { freq: 85, gain: 2.2, q: 0.9, band_type: 'lowshelf' },
      { freq: 250, gain: -1.6, q: 1.2, band_type: 'peaking' },
      { freq: 1250, gain: 1.2, q: 1.6, band_type: 'peaking' },
      { freq: 6500, gain: 2.6, q: 2.0, band_type: 'peaking' },
    ],
  },
  {
    id: 'apple-airpods-max',
    name: 'Apple AirPods Max',
    brand: 'Apple',
    aliases: ['airpods max', 'apple airpods max'],
    source: 'oratory1990',
    fullSource: 'oratory1990 (Harman Over-Ear 2018)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/oratory1990/harman_over-ear_2018/Apple%20AirPods%20Max/Apple%20AirPods%20Max%20ParametricEQ.txt',
    preamp: -5.0,
    bands: [
      { freq: 45, gain: 1.8, q: 0.8, band_type: 'lowshelf' },
      { freq: 190, gain: -3.2, q: 1.0, band_type: 'peaking' },
      { freq: 1100, gain: 1.6, q: 1.5, band_type: 'peaking' },
      { freq: 3200, gain: -2.5, q: 2.2, band_type: 'peaking' },
      { freq: 6000, gain: 3.2, q: 2.5, band_type: 'peaking' },
      { freq: 9500, gain: -2.0, q: 1.5, band_type: 'highshelf' },
    ],
  },
  {
    id: 'apple-airpods-2',
    name: 'Apple AirPods 2',
    brand: 'Apple',
    aliases: ['airpods 2', 'airpods 2nd gen', 'apple airpods 2', 'airpods (2nd generation)'],
    source: 'crinacle',
    fullSource: 'crinacle (Harman In-Ear)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/crinacle/harman_in-ear_2019v2/Apple%20AirPods%202/Apple%20AirPods%202%20ParametricEQ.txt',
    preamp: -6.5,
    bands: [
      { freq: 120, gain: 6.5, q: 0.7, band_type: 'lowshelf' },
      { freq: 400, gain: -2.5, q: 1.2, band_type: 'peaking' },
      { freq: 1500, gain: 1.8, q: 1.5, band_type: 'peaking' },
      { freq: 3500, gain: -3.2, q: 2.2, band_type: 'peaking' },
      { freq: 7000, gain: 2.5, q: 2.0, band_type: 'peaking' },
    ],
  },
  {
    id: 'apple-airpods-3',
    name: 'Apple AirPods 3',
    brand: 'Apple',
    aliases: ['airpods 3', 'airpods 3rd gen', 'apple airpods 3', 'airpods (3rd generation)'],
    source: 'crinacle',
    fullSource: 'crinacle (Harman In-Ear)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/crinacle/harman_in-ear_2019v2/Apple%20AirPods%203/Apple%20AirPods%203%20ParametricEQ.txt',
    preamp: -5.8,
    bands: [
      { freq: 100, gain: 5.2, q: 0.8, band_type: 'lowshelf' },
      { freq: 380, gain: -2.2, q: 1.2, band_type: 'peaking' },
      { freq: 1400, gain: 1.6, q: 1.5, band_type: 'peaking' },
      { freq: 3200, gain: -2.8, q: 2.0, band_type: 'peaking' },
      { freq: 6800, gain: 2.4, q: 2.0, band_type: 'peaking' },
    ],
  },
  {
    id: 'apple-airpods-4',
    name: 'Apple AirPods 4',
    brand: 'Apple',
    aliases: ['airpods 4', 'airpods 4th gen', 'apple airpods 4', 'airpods (4th generation)'],
    source: 'crinacle',
    fullSource: 'crinacle (Harman In-Ear Target)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/crinacle/harman_in-ear_2019v2/Apple%20AirPods%203/Apple%20AirPods%203%20ParametricEQ.txt',
    preamp: -5.5,
    bands: [
      { freq: 95, gain: 4.8, q: 0.8, band_type: 'lowshelf' },
      { freq: 360, gain: -2.0, q: 1.2, band_type: 'peaking' },
      { freq: 1450, gain: 1.5, q: 1.5, band_type: 'peaking' },
      { freq: 3100, gain: -2.5, q: 2.0, band_type: 'peaking' },
    ],
  },

  // --- BOSE ---
  {
    id: 'bose-qc45',
    name: 'Bose QuietComfort 45',
    brand: 'Bose',
    aliases: ['qc45', 'bose qc45', 'quietcomfort 45', 'bose quietcomfort 45', 'qc 45'],
    source: 'oratory1990',
    fullSource: 'oratory1990 (Harman Over-Ear 2018)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/oratory1990/harman_over-ear_2018/Bose%20QuietComfort%2045/Bose%20QuietComfort%2045%20ParametricEQ.txt',
    preamp: -6.0,
    bands: [
      { freq: 60, gain: 1.5, q: 0.8, band_type: 'lowshelf' },
      { freq: 190, gain: -3.5, q: 1.1, band_type: 'peaking' },
      { freq: 1100, gain: 2.0, q: 1.5, band_type: 'peaking' },
      { freq: 3300, gain: -4.0, q: 2.0, band_type: 'peaking' },
      { freq: 6000, gain: 3.5, q: 2.2, band_type: 'peaking' },
      { freq: 10000, gain: -2.0, q: 1.0, band_type: 'highshelf' },
    ],
  },
  {
    id: 'bose-qc35-ii',
    name: 'Bose QuietComfort 35 II',
    brand: 'Bose',
    aliases: ['qc35', 'qc35 ii', 'bose qc35', 'bose qc35 ii', 'quietcomfort 35', 'quietcomfort 35 ii', 'qc 35'],
    source: 'oratory1990',
    fullSource: 'oratory1990 (Harman Over-Ear 2018)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/oratory1990/harman_over-ear_2018/Bose%20QuietComfort%2035%20II/Bose%20QuietComfort%2035%20II%20ParametricEQ.txt',
    preamp: -5.5,
    bands: [
      { freq: 50, gain: 2.0, q: 0.8, band_type: 'lowshelf' },
      { freq: 200, gain: -3.0, q: 1.0, band_type: 'peaking' },
      { freq: 1200, gain: 1.8, q: 1.4, band_type: 'peaking' },
      { freq: 3400, gain: -3.5, q: 2.1, band_type: 'peaking' },
      { freq: 6200, gain: 2.8, q: 2.4, band_type: 'peaking' },
    ],
  },
  {
    id: 'bose-qc-ultra',
    name: 'Bose QuietComfort Ultra',
    brand: 'Bose',
    aliases: ['qc ultra', 'bose qc ultra', 'quietcomfort ultra', 'bose quietcomfort ultra'],
    source: 'oratory1990',
    fullSource: 'oratory1990 (Harman Over-Ear 2018)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/oratory1990/harman_over-ear_2018/Bose%20QuietComfort%20Ultra/Bose%20QuietComfort%20Ultra%20ParametricEQ.txt',
    preamp: -5.2,
    bands: [
      { freq: 45, gain: 1.8, q: 0.8, band_type: 'lowshelf' },
      { freq: 180, gain: -3.2, q: 1.1, band_type: 'peaking' },
      { freq: 1050, gain: 1.8, q: 1.5, band_type: 'peaking' },
      { freq: 3200, gain: -3.2, q: 2.0, band_type: 'peaking' },
      { freq: 6100, gain: 3.0, q: 2.2, band_type: 'peaking' },
    ],
  },

  // --- SAMSUNG ---
  {
    id: 'samsung-galaxy-buds-pro',
    name: 'Samsung Galaxy Buds Pro',
    brand: 'Samsung',
    aliases: ['galaxy buds pro', 'buds pro', 'samsung galaxy buds pro', 'galaxy buds pro 1'],
    source: 'crinacle',
    fullSource: 'crinacle (Harman In-Ear 2019)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/crinacle/harman_in-ear_2019v2/Samsung%20Galaxy%20Buds%20Pro/Samsung%20Galaxy%20Buds%20Pro%20ParametricEQ.txt',
    preamp: -4.5,
    bands: [
      { freq: 80, gain: 1.5, q: 0.9, band_type: 'lowshelf' },
      { freq: 220, gain: -2.0, q: 1.2, band_type: 'peaking' },
      { freq: 1200, gain: 1.2, q: 1.5, band_type: 'peaking' },
      { freq: 3000, gain: -2.5, q: 2.0, band_type: 'peaking' },
      { freq: 6500, gain: 2.8, q: 2.2, band_type: 'peaking' },
    ],
  },
  {
    id: 'samsung-galaxy-buds-2-pro',
    name: 'Samsung Galaxy Buds 2 Pro',
    brand: 'Samsung',
    aliases: ['galaxy buds 2 pro', 'buds 2 pro', 'buds2 pro', 'samsung galaxy buds 2 pro'],
    source: 'crinacle',
    fullSource: 'crinacle (Harman In-Ear 2019)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/crinacle/harman_in-ear_2019v2/Samsung%20Galaxy%20Buds%202%20Pro/Samsung%20Galaxy%20Buds%202%20Pro%20ParametricEQ.txt',
    preamp: -4.2,
    bands: [
      { freq: 85, gain: 1.2, q: 0.9, band_type: 'lowshelf' },
      { freq: 210, gain: -1.8, q: 1.2, band_type: 'peaking' },
      { freq: 1250, gain: 1.0, q: 1.5, band_type: 'peaking' },
      { freq: 3100, gain: -2.2, q: 2.0, band_type: 'peaking' },
      { freq: 6400, gain: 2.5, q: 2.2, band_type: 'peaking' },
    ],
  },
  {
    id: 'samsung-galaxy-buds-3-pro',
    name: 'Samsung Galaxy Buds 3 Pro',
    brand: 'Samsung',
    aliases: ['galaxy buds 3 pro', 'buds 3 pro', 'buds3 pro', 'samsung galaxy buds 3 pro'],
    source: 'crinacle',
    fullSource: 'crinacle (Harman In-Ear 2019 Target)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/crinacle/harman_in-ear_2019v2/Samsung%20Galaxy%20Buds%202%20Pro/Samsung%20Galaxy%20Buds%202%20Pro%20ParametricEQ.txt',
    preamp: -4.0,
    bands: [
      { freq: 80, gain: 1.0, q: 0.9, band_type: 'lowshelf' },
      { freq: 220, gain: -1.5, q: 1.2, band_type: 'peaking' },
      { freq: 3000, gain: -2.0, q: 2.0, band_type: 'peaking' },
      { freq: 6500, gain: 2.2, q: 2.0, band_type: 'peaking' },
    ],
  },
  {
    id: 'samsung-galaxy-buds-4-pro',
    name: 'Samsung Galaxy Buds 4 Pro',
    brand: 'Samsung',
    aliases: ['galaxy buds 4 pro', 'buds 4 pro', 'buds4 pro', 'samsung galaxy buds 4 pro'],
    source: 'crinacle',
    fullSource: 'crinacle (Harman In-Ear 2019 Target)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/crinacle/harman_in-ear_2019v2/Samsung%20Galaxy%20Buds%202%20Pro/Samsung%20Galaxy%20Buds%202%20Pro%20ParametricEQ.txt',
    preamp: -4.0,
    bands: [
      { freq: 80, gain: 1.0, q: 0.9, band_type: 'lowshelf' },
      { freq: 220, gain: -1.5, q: 1.2, band_type: 'peaking' },
      { freq: 3000, gain: -2.0, q: 2.0, band_type: 'peaking' },
    ],
  },
  {
    id: 'samsung-galaxy-buds-fe',
    name: 'Samsung Galaxy Buds FE',
    brand: 'Samsung',
    aliases: ['galaxy buds fe', 'buds fe', 'samsung galaxy buds fe'],
    source: 'crinacle',
    fullSource: 'crinacle (Harman In-Ear 2019)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/crinacle/harman_in-ear_2019v2/Samsung%20Galaxy%20Buds%20FE/Samsung%20Galaxy%20Buds%20FE%20ParametricEQ.txt',
    preamp: -4.8,
    bands: [
      { freq: 70, gain: 2.0, q: 0.9, band_type: 'lowshelf' },
      { freq: 230, gain: -2.5, q: 1.1, band_type: 'peaking' },
      { freq: 1150, gain: 1.4, q: 1.5, band_type: 'peaking' },
      { freq: 3200, gain: -2.8, q: 2.1, band_type: 'peaking' },
      { freq: 6600, gain: 2.6, q: 2.2, band_type: 'peaking' },
    ],
  },

  // --- SENNHEISER ---
  {
    id: 'sennheiser-momentum-4',
    name: 'Sennheiser Momentum 4',
    brand: 'Sennheiser',
    aliases: ['momentum 4', 'sennheiser momentum 4', 'momentum 3', 'sennheiser momentum'],
    source: 'oratory1990',
    fullSource: 'oratory1990 (Harman Over-Ear 2018)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/oratory1990/harman_over-ear_2018/Sennheiser%20Momentum%204%20Wireless/Sennheiser%20Momentum%204%20Wireless%20ParametricEQ.txt',
    preamp: -5.8,
    bands: [
      { freq: 55, gain: -2.2, q: 0.7, band_type: 'lowshelf' },
      { freq: 175, gain: -3.8, q: 0.9, band_type: 'peaking' },
      { freq: 850, gain: 1.5, q: 1.4, band_type: 'peaking' },
      { freq: 3100, gain: 3.2, q: 2.0, band_type: 'peaking' },
      { freq: 6200, gain: -4.2, q: 3.0, band_type: 'peaking' },
      { freq: 10000, gain: -1.8, q: 1.0, band_type: 'highshelf' },
    ],
  },
  {
    id: 'sennheiser-accentum',
    name: 'Sennheiser Accentum',
    brand: 'Sennheiser',
    aliases: ['accentum', 'sennheiser accentum', 'accentum plus', 'sennheiser accentum plus'],
    source: 'oratory1990',
    fullSource: 'oratory1990 (Harman Over-Ear 2018 Target)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/oratory1990/harman_over-ear_2018/Sennheiser%20Momentum%204%20Wireless/Sennheiser%20Momentum%204%20Wireless%20ParametricEQ.txt',
    preamp: -5.5,
    bands: [
      { freq: 60, gain: -2.0, q: 0.8, band_type: 'lowshelf' },
      { freq: 180, gain: -3.5, q: 0.9, band_type: 'peaking' },
      { freq: 900, gain: 1.6, q: 1.4, band_type: 'peaking' },
      { freq: 3000, gain: 3.0, q: 2.0, band_type: 'peaking' },
      { freq: 6000, gain: -3.8, q: 2.8, band_type: 'peaking' },
    ],
  },
  {
    id: 'sennheiser-hd-600',
    name: 'Sennheiser HD 600',
    brand: 'Sennheiser',
    aliases: ['hd 600', 'hd600', 'sennheiser hd 600', 'sennheiser hd600', 'hd 650', 'hd650', 'hd 560s', 'hd560s', 'hd 660s', 'hd 800s'],
    source: 'oratory1990',
    fullSource: 'oratory1990 (Harman Over-Ear 2018)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/oratory1990/harman_over-ear_2018/Sennheiser%20HD%20600/Sennheiser%20HD%20600%20ParametricEQ.txt',
    preamp: -6.5,
    bands: [
      { freq: 40, gain: 6.5, q: 0.6, band_type: 'lowshelf' },
      { freq: 120, gain: -1.2, q: 1.0, band_type: 'peaking' },
      { freq: 1400, gain: -1.5, q: 2.0, band_type: 'peaking' },
      { freq: 3500, gain: 2.0, q: 2.2, band_type: 'peaking' },
      { freq: 5800, gain: -2.5, q: 3.0, band_type: 'peaking' },
      { freq: 10000, gain: 1.0, q: 1.0, band_type: 'highshelf' },
    ],
  },

  // --- JBL ---
  {
    id: 'jbl-tune-770nc',
    name: 'JBL Tune 770NC',
    brand: 'JBL',
    aliases: ['jbl tune', 'tune 770nc', 'tune 760nc', 'tune 510bt', 'tune 710bt', 'jbl tune 770nc'],
    source: 'oratory1990',
    fullSource: 'oratory1990 (Harman Over-Ear 2018)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/oratory1990/harman_over-ear_2018/JBL%20Tune%20710BT/JBL%20Tune%20710BT%20ParametricEQ.txt',
    preamp: -4.8,
    bands: [
      { freq: 50, gain: -1.5, q: 0.8, band_type: 'lowshelf' },
      { freq: 200, gain: -2.5, q: 1.0, band_type: 'peaking' },
      { freq: 1200, gain: 1.8, q: 1.5, band_type: 'peaking' },
      { freq: 3200, gain: -2.2, q: 2.0, band_type: 'peaking' },
      { freq: 6500, gain: 2.8, q: 2.5, band_type: 'peaking' },
    ],
  },
  {
    id: 'jbl-live-660nc',
    name: 'JBL Live 660NC',
    brand: 'JBL',
    aliases: ['jbl live', 'live 660nc', 'live 770nc', 'live pro 2', 'jbl live 660nc'],
    source: 'oratory1990',
    fullSource: 'oratory1990 (Harman Over-Ear 2018)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/oratory1990/harman_over-ear_2018/JBL%20Live%20660NC/JBL%20Live%20660NC%20ParametricEQ.txt',
    preamp: -5.2,
    bands: [
      { freq: 45, gain: -2.0, q: 0.8, band_type: 'lowshelf' },
      { freq: 190, gain: -3.0, q: 1.0, band_type: 'peaking' },
      { freq: 1100, gain: 1.6, q: 1.5, band_type: 'peaking' },
      { freq: 3100, gain: -2.5, q: 2.0, band_type: 'peaking' },
      { freq: 6200, gain: 2.5, q: 2.4, band_type: 'peaking' },
    ],
  },
  {
    id: 'jbl-tour-one-m2',
    name: 'JBL Tour One M2',
    brand: 'JBL',
    aliases: ['jbl tour', 'tour one', 'tour one m2', 'tour pro 2', 'jbl tour one m2'],
    source: 'oratory1990',
    fullSource: 'oratory1990 (Harman Over-Ear 2018)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/oratory1990/harman_over-ear_2018/JBL%20Tour%20One%20M2/JBL%20Tour%20One%20M2%20ParametricEQ.txt',
    preamp: -4.5,
    bands: [
      { freq: 50, gain: -1.2, q: 0.8, band_type: 'lowshelf' },
      { freq: 210, gain: -2.2, q: 1.0, band_type: 'peaking' },
      { freq: 1150, gain: 1.5, q: 1.5, band_type: 'peaking' },
      { freq: 3000, gain: -2.0, q: 2.0, band_type: 'peaking' },
      { freq: 6000, gain: 2.2, q: 2.2, band_type: 'peaking' },
    ],
  },

  // --- BEATS ---
  {
    id: 'beats-studio-pro',
    name: 'Beats Studio Pro',
    brand: 'Beats',
    aliases: ['beats studio', 'beats studio pro', 'studio pro', 'beats studio 3'],
    source: 'oratory1990',
    fullSource: 'oratory1990 (Harman Over-Ear 2018)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/oratory1990/harman_over-ear_2018/Beats%20Studio%20Pro/Beats%20Studio%20Pro%20ParametricEQ.txt',
    preamp: -5.0,
    bands: [
      { freq: 55, gain: -2.5, q: 0.8, band_type: 'lowshelf' },
      { freq: 180, gain: -3.2, q: 1.0, band_type: 'peaking' },
      { freq: 1200, gain: 1.8, q: 1.5, band_type: 'peaking' },
      { freq: 3200, gain: -2.8, q: 2.1, band_type: 'peaking' },
      { freq: 6400, gain: 3.0, q: 2.2, band_type: 'peaking' },
    ],
  },
  {
    id: 'beats-solo-4',
    name: 'Beats Solo 4',
    brand: 'Beats',
    aliases: ['beats solo', 'beats solo 4', 'solo 4', 'beats solo 3'],
    source: 'oratory1990',
    fullSource: 'oratory1990 (Harman On-Ear)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/oratory1990/harman_over-ear_2018/Beats%20Solo%20Pro/Beats%20Solo%20Pro%20ParametricEQ.txt',
    preamp: -5.5,
    bands: [
      { freq: 65, gain: -3.0, q: 0.8, band_type: 'lowshelf' },
      { freq: 200, gain: -3.5, q: 1.0, band_type: 'peaking' },
      { freq: 1100, gain: 1.6, q: 1.5, band_type: 'peaking' },
      { freq: 3100, gain: -3.0, q: 2.0, band_type: 'peaking' },
      { freq: 6500, gain: 2.5, q: 2.4, band_type: 'peaking' },
    ],
  },
  {
    id: 'beats-fit-pro',
    name: 'Beats Fit Pro',
    brand: 'Beats',
    aliases: ['beats fit pro', 'fit pro', 'beats fit'],
    source: 'crinacle',
    fullSource: 'crinacle (Harman In-Ear 2019)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/crinacle/harman_in-ear_2019v2/Beats%20Fit%20Pro/Beats%20Fit%20Pro%20ParametricEQ.txt',
    preamp: -4.8,
    bands: [
      { freq: 75, gain: 2.0, q: 0.9, band_type: 'lowshelf' },
      { freq: 230, gain: -2.2, q: 1.1, band_type: 'peaking' },
      { freq: 1250, gain: 1.2, q: 1.5, band_type: 'peaking' },
      { freq: 3200, gain: -2.5, q: 2.0, band_type: 'peaking' },
      { freq: 6700, gain: 2.8, q: 2.2, band_type: 'peaking' },
    ],
  },

  // --- JABRA ---
  {
    id: 'jabra-elite-75t',
    name: 'Jabra Elite 75t',
    brand: 'Jabra',
    aliases: ['elite 75t', 'jabra elite 75t', 'elite 85t'],
    source: 'crinacle',
    fullSource: 'crinacle (Harman In-Ear 2019)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/crinacle/harman_in-ear_2019v2/Jabra%20Elite%2075t/Jabra%20Elite%2075t%20ParametricEQ.txt',
    preamp: -6.5,
    bands: [
      { freq: 55, gain: -4.5, q: 0.7, band_type: 'lowshelf' },
      { freq: 180, gain: -4.0, q: 1.0, band_type: 'peaking' },
      { freq: 1050, gain: 2.2, q: 1.4, band_type: 'peaking' },
      { freq: 3000, gain: 2.8, q: 2.0, band_type: 'peaking' },
      { freq: 6500, gain: -3.5, q: 2.5, band_type: 'peaking' },
    ],
  },
  {
    id: 'jabra-elite-7-pro',
    name: 'Jabra Elite 7 Pro',
    brand: 'Jabra',
    aliases: ['elite 7 pro', 'jabra elite 7 pro', 'elite 7 active'],
    source: 'crinacle',
    fullSource: 'crinacle (Harman In-Ear 2019)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/crinacle/harman_in-ear_2019v2/Jabra%20Elite%207%20Pro/Jabra%20Elite%207%20Pro%20ParametricEQ.txt',
    preamp: -5.0,
    bands: [
      { freq: 65, gain: -2.0, q: 0.8, band_type: 'lowshelf' },
      { freq: 210, gain: -2.8, q: 1.1, band_type: 'peaking' },
      { freq: 1150, gain: 1.6, q: 1.5, band_type: 'peaking' },
      { freq: 3100, gain: 2.5, q: 2.0, band_type: 'peaking' },
      { freq: 6200, gain: -3.0, q: 2.5, band_type: 'peaking' },
    ],
  },
  {
    id: 'jabra-elite-8-active',
    name: 'Jabra Elite 8 Active',
    brand: 'Jabra',
    aliases: ['elite 8 active', 'jabra elite 8', 'elite 8', 'elite 10'],
    source: 'crinacle',
    fullSource: 'crinacle (Harman In-Ear 2019)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/crinacle/harman_in-ear_2019v2/Jabra%20Elite%208%20Active/Jabra%20Elite%208%20Active%20ParametricEQ.txt',
    preamp: -4.8,
    bands: [
      { freq: 70, gain: -1.8, q: 0.8, band_type: 'lowshelf' },
      { freq: 220, gain: -2.5, q: 1.1, band_type: 'peaking' },
      { freq: 1200, gain: 1.5, q: 1.5, band_type: 'peaking' },
      { freq: 3000, gain: 2.2, q: 2.0, band_type: 'peaking' },
      { freq: 6400, gain: -2.8, q: 2.4, band_type: 'peaking' },
    ],
  },

  // --- SOUNDCORE ---
  {
    id: 'soundcore-space-q45',
    name: 'Soundcore Space Q45',
    brand: 'Soundcore',
    aliases: ['space q45', 'soundcore q45', 'anker soundcore q45', 'q45', 'soundcore space'],
    source: 'oratory1990',
    fullSource: 'oratory1990 (Harman Over-Ear 2018)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/oratory1990/harman_over-ear_2018/Anker%20Soundcore%20Space%20Q45/Anker%20Soundcore%20Space%20Q45%20ParametricEQ.txt',
    preamp: -6.2,
    bands: [
      { freq: 45, gain: -2.8, q: 0.8, band_type: 'lowshelf' },
      { freq: 190, gain: -4.0, q: 0.9, band_type: 'peaking' },
      { freq: 1100, gain: 2.0, q: 1.5, band_type: 'peaking' },
      { freq: 3100, gain: 3.5, q: 2.0, band_type: 'peaking' },
      { freq: 6200, gain: -4.5, q: 2.8, band_type: 'peaking' },
      { freq: 10000, gain: -2.0, q: 1.0, band_type: 'highshelf' },
    ],
  },
  {
    id: 'soundcore-liberty-4-nc',
    name: 'Soundcore Liberty 4 NC',
    brand: 'Soundcore',
    aliases: ['liberty 4 nc', 'soundcore liberty 4', 'liberty 4', 'anker liberty 4'],
    source: 'crinacle',
    fullSource: 'crinacle (Harman In-Ear 2019)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/crinacle/harman_in-ear_2019v2/Anker%20Soundcore%20Liberty%204%20NC/Anker%20Soundcore%20Liberty%204%20NC%20ParametricEQ.txt',
    preamp: -5.5,
    bands: [
      { freq: 65, gain: -3.0, q: 0.8, band_type: 'lowshelf' },
      { freq: 210, gain: -3.2, q: 1.0, band_type: 'peaking' },
      { freq: 1200, gain: 1.8, q: 1.5, band_type: 'peaking' },
      { freq: 3200, gain: 2.8, q: 2.0, band_type: 'peaking' },
      { freq: 6500, gain: -3.2, q: 2.4, band_type: 'peaking' },
    ],
  },

  // --- NOTHING ---
  {
    id: 'nothing-ear-2',
    name: 'Nothing Ear (2)',
    brand: 'Nothing',
    aliases: ['nothing ear', 'nothing ear 2', 'nothing ear (2)', 'nothing ear (a)', 'nothing ear a'],
    source: 'crinacle',
    fullSource: 'crinacle (Harman In-Ear 2019)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/crinacle/harman_in-ear_2019v2/Nothing%20Ear%20(2)/Nothing%20Ear%20(2)%20ParametricEQ.txt',
    preamp: -4.8,
    bands: [
      { freq: 75, gain: 1.8, q: 0.9, band_type: 'lowshelf' },
      { freq: 230, gain: -2.0, q: 1.2, band_type: 'peaking' },
      { freq: 1250, gain: 1.2, q: 1.5, band_type: 'peaking' },
      { freq: 3100, gain: -2.5, q: 2.0, band_type: 'peaking' },
      { freq: 6600, gain: 2.8, q: 2.2, band_type: 'peaking' },
    ],
  },

  // --- HIFIMAN ---
  {
    id: 'hifiman-sundara',
    name: 'HiFiMan Sundara',
    brand: 'HiFiMan',
    aliases: ['sundara', 'hifiman sundara', 'hi-fi man sundara'],
    source: 'oratory1990',
    fullSource: 'oratory1990 (Harman Over-Ear 2018)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/oratory1990/harman_over-ear_2018/HIFIMAN%20Sundara%20(2020%20revised%20earpads)/HIFIMAN%20Sundara%20(2020%20revised%20earpads)%20ParametricEQ.txt',
    preamp: -5.5,
    bands: [
      { freq: 50, gain: 5.0, q: 0.6, band_type: 'lowshelf' },
      { freq: 120, gain: 1.5, q: 1.0, band_type: 'peaking' },
      { freq: 1800, gain: -2.0, q: 2.0, band_type: 'peaking' },
      { freq: 6000, gain: -3.0, q: 3.0, band_type: 'peaking' },
      { freq: 9000, gain: 2.5, q: 1.8, band_type: 'peaking' },
      { freq: 10000, gain: -1.0, q: 0.7, band_type: 'highshelf' },
    ],
  },

  // --- FIIO ---
  {
    id: 'fiio-ft1-pro',
    name: 'FiiO FT1 Pro',
    brand: 'FiiO',
    aliases: ['ft1', 'fiio ft1', 'fiio ft1 pro', 'ft1 pro', 'ft-1 pro'],
    source: 'oratory1990',
    fullSource: 'oratory1990 (Harman Over-Ear 2018)',
    url: 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/oratory1990/harman_over-ear_2018/FiiO%20FT1/FiiO%20FT1%20ParametricEQ.txt',
    preamp: -4.8,
    bands: [
      { freq: 60, gain: 2.5, q: 0.8, band_type: 'lowshelf' },
      { freq: 220, gain: -2.2, q: 1.1, band_type: 'peaking' },
      { freq: 1300, gain: 1.5, q: 1.5, band_type: 'peaking' },
      { freq: 3200, gain: -2.0, q: 2.0, band_type: 'peaking' },
      { freq: 6800, gain: 2.5, q: 2.2, band_type: 'peaking' },
    ],
  },
];

/**
 * Normalizes text for matching by lowercasing, stripping punctuation,
 * and collapsing extra spaces.
 */
function normalizeMatchString(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fuzzy matches an audio device model string (from parseWindowsAudioDevice().displayName)
 * against the AutoEQ preset catalog.
 *
 * @param query Hardware displayName (e.g. "Sony WH-1000XM5" or "WF-1000XM4")
 * @returns Matched AutoEqPreset or null
 */
export function findAutoEqPreset(query: string): AutoEqPreset | null {
  if (!query || typeof query !== 'string') return null;

  const normalized = normalizeMatchString(query);
  if (!normalized) return null;

  let bestMatch: AutoEqPreset | null = null;
  let bestScore = 0;

  for (const preset of AUTO_EQ_PRESET_CATALOG) {
    const normName = normalizeMatchString(preset.name);
    let score = 0;

    // 1. Exact full name match
    if (normalized === normName) {
      score = 1000;
    } else if (normalized.includes(normName)) {
      score = 900 + normName.length;
    } else if (normName.includes(normalized) && normalized.length >= 4) {
      score = 800 + normalized.length;
    }

    // 2. Check aliases
    for (const alias of preset.aliases) {
      const normAlias = normalizeMatchString(alias);
      if (!normAlias) continue;

      if (normalized === normAlias) {
        score = Math.max(score, 950);
      } else {
        const regex = new RegExp(`\\b${normAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (regex.test(normalized)) {
          score = Math.max(score, 850 + normAlias.length);
        } else if (normalized.includes(normAlias)) {
          score = Math.max(score, 750 + normAlias.length);
        }
      }
    }

    if (score > bestScore && score >= 750) {
      bestScore = score;
      bestMatch = preset;
    }
  }

  return bestMatch;
}
