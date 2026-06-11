const sharp = require('sharp');
const path = require('path');

const scriptDir = __dirname;
const svgPath = path.join(scriptDir, 'option3-hexagon-neural.svg');

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
