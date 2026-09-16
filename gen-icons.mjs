// ===== 生成微讯 PWA 图标（绿色气泡 + weixun 文字）=====
// 用法：node gen-icons.mjs  → 生成 icon-192.png、icon-512.png、icon-180.png、icon-maskable-512.png
// 说明：SVG 图标（icon.svg）已够现代安卓 Edge/Chrome 安装用；跑本脚本可额外生成 PNG，
//       获得 iOS / 旧版浏览器的最佳兼容。需要本地装有 Node.js。
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

// ---------- 最小 PNG 编码（RGBA，无依赖） ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(size, pixelFn) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelFn(x, y);
      const o = y * stride + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- 颜色 ----------
const GREEN = [7, 193, 96];   // #07c160
const WHITE = [255, 255, 255];

// ---------- weixun 点阵字（5x7，bit4=最左） ----------
const GLYPHS = {
  w: [0b10101, 0b10101, 0b10101, 0b10101, 0b11111, 0b10101, 0b10101],
  e: [0b01110, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b01110],
  i: [0b00100, 0b00000, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  x: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  u: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  n: [0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b10001],
};
const WORD = 'weixun';
const GLYPH_W = 5, GLYPH_H = 7, GAP = 1;
const TEXT_W = WORD.length * GLYPH_W + (WORD.length - 1) * GAP; // 35
const TEXT_H = GLYPH_H;

// 文字墨迹范围（按墨迹居中）
let INK_MIN_X = GLYPH_W, INK_MAX_X = -1, INK_MIN_Y = GLYPH_H, INK_MAX_Y = -1;
for (let gi = 0; gi < WORD.length; gi++) {
  const g = GLYPHS[WORD[gi]];
  for (let r = 0; r < GLYPH_H; r++) {
    for (let c = 0; c < GLYPH_W; c++) {
      if (g[r] & (1 << (4 - c))) {
        const gx = gi * (GLYPH_W + GAP) + c;
        if (gx < INK_MIN_X) INK_MIN_X = gx;
        if (gx > INK_MAX_X) INK_MAX_X = gx;
        if (r < INK_MIN_Y) INK_MIN_Y = r;
        if (r > INK_MAX_Y) INK_MAX_Y = r;
      }
    }
  }
}
const INK_W = INK_MAX_X - INK_MIN_X + 1;
const INK_H = INK_MAX_Y - INK_MIN_Y + 1;

// 文字覆盖率（8x8 超采样抗锯齿）
function wordCover(px, py, left, top, unit) {
  let hit = 0; const steps = 8;
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < steps; j++) {
      const tx = (px + (i + 0.5) / steps - left) / unit;
      const ty = (py + (j + 0.5) / steps - top) / unit;
      if (tx < 0 || ty < 0 || tx >= TEXT_W || ty >= TEXT_H) continue;
      const gi = Math.floor(tx / (GLYPH_W + GAP));
      const gx = tx - gi * (GLYPH_W + GAP);
      if (gx >= GLYPH_W) continue;
      const glyph = GLYPHS[WORD[gi]];
      const row = Math.floor(ty), col = Math.floor(gx);
      if (glyph && (glyph[row] & (1 << (4 - col)))) hit++;
    }
  }
  return hit / (steps * steps);
}

// 圆角矩形 SDF（归一化坐标）
function roundRectSDF(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}
// 圆 SDF
function circleSDF(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}
// 点是否在三角形内（重心法）
function inTri(px, py, a, b, c) {
  const s1 = (b[0]-a[0])*(py-a[1]) - (b[1]-a[1])*(px-a[0]);
  const s2 = (c[0]-b[0])*(py-b[1]) - (c[1]-b[1])*(px-b[0]);
  const s3 = (a[0]-c[0])*(py-c[1]) - (a[1]-c[1])*(px-c[0]);
  const hasNeg = (s1<0)||(s2<0)||(s3<0);
  const hasPos = (s1>0)||(s2>0)||(s3>0);
  return !(hasNeg && hasPos);
}

// 渲染一个图标。maskable=true 时背景铺满整张、内容收进中央安全区
function makeIcon(size, maskable) {
  const contentScale = maskable ? 0.78 : 1.0;
  const off = (1 - contentScale) / 2;
  const cx = (px) => off + px * contentScale;
  const cy = (py) => off + py * contentScale;
  return encodePng(size, (x, y) => {
    const px = (x + 0.5) / size; // 归一化 [0,1]
    const py = (y + 0.5) / size;
    // 背景：绿色圆角方块（maskable 铺满，普通留圆角边）
    let bgColor = GREEN;
    if (!maskable) {
      const bgSdf = roundRectSDF(px, py, 0.5, 0.5, 0.47, 0.47, 0.22);
      if (bgSdf > 0) return [255, 255, 255, 255]; // 圆角外白色（防黑角）
    }
    // 聊天气泡：白色圆角矩形
    const bubble = roundRectSDF(px, py, 0.5, 0.40, 0.27, 0.18, 0.07);
    if (bubble <= 0) {
      // 气泡内三个省略号点（绿色）
      const d1 = circleSDF(px, py, 0.42, 0.40, 0.022);
      const d2 = circleSDF(px, py, 0.50, 0.40, 0.022);
      const d3 = circleSDF(px, py, 0.58, 0.40, 0.022);
      if (d1 <= 0 || d2 <= 0 || d3 <= 0) return [GREEN[0], GREEN[1], GREEN[2], 255];
      return [WHITE[0], WHITE[1], WHITE[2], 255];
    }
    // 气泡尾巴：白色小三角（气泡下方）
    if (inTri(px, py, [0.43, 0.575], [0.57, 0.575], [0.50, 0.66])) {
      return [WHITE[0], WHITE[1], WHITE[2], 255];
    }
    // 底部 weixun 文字（白色点阵）
    const unit = (0.34) / TEXT_W;
    const left = (0.5 - unit * INK_W / 2) - unit * INK_MIN_X;
    const top = (0.82 - unit * INK_H / 2) - unit * INK_MIN_Y;
    const c = wordCover(px, py, left, top, unit);
    if (c > 0) {
      const r = Math.round(GREEN[0] + (WHITE[0] - GREEN[0]) * c);
      const g = Math.round(GREEN[1] + (WHITE[1] - GREEN[1]) * c);
      const b = Math.round(GREEN[2] + (WHITE[2] - GREEN[2]) * c);
      return [r, g, b, 255];
    }
    return [bgColor[0], bgColor[1], bgColor[2], 255];
  });
}

writeFileSync('icon-192.png', makeIcon(192, false));
writeFileSync('icon-512.png', makeIcon(512, false));
writeFileSync('icon-180.png', makeIcon(180, false));
writeFileSync('icon-maskable-512.png', makeIcon(512, true));
console.log('已生成图标 → icon-192.png / icon-512.png / icon-180.png / icon-maskable-512.png');