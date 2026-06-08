// Generates the Open Graph / social-share preview image — public/og-image.jpg (1200x630) — from the
// brand purple-dusk gradient + the W5 app icon + the app name & tagline drawn INTO the image. This is
// what a shared link renders as its preview card. The text is baked in (a common system sans-serif via
// sharp/resvg) so the card reads identically everywhere, regardless of how each platform renders the
// og:/twitter: meta text beside it. Run: node design/icons/build-og.mjs
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const W = 1200
const H = 630
const ICON = 330
const ICON_LEFT = 45 //  icon's left margin (45px); the title's right margin is matched to it (symmetric)
const ICON_TOP = Math.round((H - ICON) / 2)
const TEXT_X = 415 //     left edge (anchor) of the title
const SUB_X = 417 //      tagline anchor — nudged right 2px so its visible LEFT edge sits flush with the title's
const SUB_SIZE = 38.3 //  tagline size — shrunk a hair so its visible RIGHT edge sits flush with the title's too

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
    <radialGradient id="glow" cx="${((ICON_LEFT + ICON / 2) / W).toFixed(3)}" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#a855f7" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#a855f7" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <!-- Title sized so its right edge leaves a 45px margin = the icon's left margin (balanced). The
       one-line tagline sits directly beneath, pixel-tuned (SUB_X + SUB_SIZE) so its VISIBLE left AND
       right edges are flush with the title's — the title's "C" and the tagline's "M" have different
       left side bearings, so a shared anchor + size leaves them ~2px off. Dialed in against the real
       resvg render (pixel-measured), 2026-06-07. -->
  <text x="${TEXT_X}" y="310" font-family="Arial, Helvetica, sans-serif" font-size="101.6" font-weight="700" fill="#ffffff">Calendar Game</text>
  <text x="${SUB_X}" y="378" font-family="Arial, Helvetica, sans-serif" font-size="${SUB_SIZE}" font-weight="400" fill="#ddd0fb">Master Mental Day-of-the-Week Calculation</text>
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
