/**
 * Generate icon.ico from individual PNG size files using png-to-ico.
 * 
 * Usage: node icons/generate-ico.js
 * 
 * This script reads the PNG icons from the icons/ directory and creates a
 * multi-resolution .ico file. png-to-ico generates BMP-encoded ICO entries
 * (not PNG-encoded), which ensures maximum compatibility with electron-builder's
 * rcedit tool for embedding icons into the Windows .exe.
 */
const { imagesToIco } = require('png-to-ico');
const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');

const SCRIPT_DIR = __dirname; // icons/ directory
const SIZES = [256, 128, 64, 48, 32, 16];
const OUTPUT_PATH = path.join(SCRIPT_DIR, 'icon.ico');

async function createIco() {
  // Parse PNG files into the pngjs format that imagesToIco expects
  const pngImages = [];
  const missingSizes = [];

  for (const size of SIZES) {
    const pngPath = path.join(SCRIPT_DIR, `icon-${size}.png`);
    if (fs.existsSync(pngPath)) {
      const buf = fs.readFileSync(pngPath);
      const png = PNG.sync.read(buf);
      pngImages.push(png);
      console.log(`  ✓ icon-${size}.png (${png.width}x${png.height})`);
    } else {
      missingSizes.push(size);
      console.log(`  ✗ icon-${size}.png — MISSING (skipped)`);
    }
  }

  if (pngImages.length === 0) {
    console.error('ERROR: No PNG icon files found! Please run "node icons/generate-icons.js" first.');
    process.exit(1);
  }

  if (missingSizes.length > 0) {
    console.warn(`WARNING: Missing sizes: ${missingSizes.join(', ')}. ICO will contain ${pngImages.length} sizes.`);
  }

  // Generate ICO using png-to-ico (produces BMP-encoded ICO, best compatibility)
  const icoBuffer = await imagesToIco(pngImages);
  fs.writeFileSync(OUTPUT_PATH, icoBuffer);

  // Verify the output
  const header = icoBuffer.slice(0, 6);
  const type = header.readUInt16LE(2);
  const count = header.readUInt16LE(4);
  const isValid = type === 1 && count > 0;

  console.log(`\nGenerated: ${OUTPUT_PATH}`);
  console.log(`  Size: ${icoBuffer.length} bytes | Entries: ${count} | Format: ${isValid ? 'VALID (BMP-encoded)' : 'INVALID'}`);

  if (!isValid) {
    console.error('ERROR: Generated ICO is invalid!');
    process.exit(1);
  }
}

createIco().catch(err => {
  console.error('FATAL: Failed to generate ICO:', err.message || err);
  process.exit(1);
});
