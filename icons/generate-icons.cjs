const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const scriptDir = __dirname;

// Default SVG source (can be overridden via CLI argument)
// Usage: node icons/generate-icons.cjs [svg-filename]
// Example: node icons/generate-icons.cjs design-a-bold-bracket.svg
const defaultSvg = 'design-b-planet-bracket.svg';
const svgArg = process.argv[2];
const svgName = svgArg || defaultSvg;
const svgPath = path.join(scriptDir, svgName);

// Validate SVG exists
if (!fs.existsSync(svgPath)) {
  console.error(`ERROR: SVG file not found: ${svgPath}`);
  console.error(`Available SVGs in icons/:`);
  fs.readdirSync(scriptDir)
    .filter(f => f.endsWith('.svg'))
    .forEach(f => console.error(`  - ${f}`));
  process.exit(1);
}

console.log(`Source SVG: ${svgName}`);

const sizes = [16, 24, 32, 48, 64, 128, 256, 512];

async function generate() {
  for (const size of sizes) {
    await sharp(svgPath)
      .resize(size, size)
      .png()
      .toFile(path.join(scriptDir, 'icon-' + size + '.png'));
    console.log('Generated icon-' + size + '.png');
  }

  await sharp(svgPath)
    .resize(512, 512)
    .png()
    .toFile(path.join(scriptDir, 'icon.png'));
  console.log('Generated icon.png (512x512)');

  console.log('All icons generated!');
}

generate().catch(console.error);
