// Generates the Open Graph / social-share preview image — public/og-image.png (1200x630) —
// from the brand purple-dusk gradient + the W5 app icon. This is what a shared link renders
// as its preview card image (the title + tagline come from the og:/twitter: meta tags in
// index.html, which platforms draw as text beside the image, so the image stays text-free and
// renders identically everywhere — no font dependency). Run: node design/icons/build-og.mjs
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const W = 1200
const H = 630
const ICON = 340
const ICON_LEFT = 120
const ICON_TOP = Math.round((H - ICON) / 2)

// Brand gradient (deep -> violet) + a soft radial glow behind the icon (left), with the app name
// + tagline as text on the right. Colors match the icon palette (#2e1065 / #5b21b6 / #7c3aed /
// #a855f7). Text uses a common sans-serif so sharp/resvg renders it from a system font.
const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2e1065"/>
      <stop offset="0.55" stop-color="#5b21b6"/>
      <stop offset="1" stop-color="#7c3aed"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.26" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#a855f7" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#a855f7" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <text x="540" y="300" font-family="Arial, Helvetica, sans-serif" font-size="82" font-weight="700" fill="#ffffff">Calendar Game</text>
  <text x="543" y="360" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="400" fill="#ddd0fb">Master Mental Day-of-the-Week Calculation</text>
</svg>`

// Round the icon's corners (~22% radius, echoing how iOS renders the home-screen icon) so it
// reads as an app tile rather than a hard square pasted on the gradient. dest-in keeps the icon
// only where the rounded-rect mask is opaque, leaving the corners transparent over the gradient.
const radius = Math.round(ICON * 0.22)
const roundMask = Buffer.from(
  `<svg width="${ICON}" height="${ICON}"><rect width="${ICON}" height="${ICON}" rx="${radius}" ry="${radius}"/></svg>`,
)
const icon = await sharp(join(root, 'public', 'pwa-512x512.png'))
  .resize(ICON, ICON)
  .composite([{ input: roundMask, blend: 'dest-in' }])
  .png()
  .toBuffer()

await sharp(Buffer.from(bg))
  .composite([{ input: icon, left: ICON_LEFT, top: ICON_TOP }])
  .jpeg({ quality: 90, mozjpeg: true }) // JPEG: standard for OG, ~5x smaller than PNG at card-display quality
  .toFile(join(root, 'public', 'og-image.jpg'))

console.log(`Wrote public/og-image.jpg (${W}x${H})`)
