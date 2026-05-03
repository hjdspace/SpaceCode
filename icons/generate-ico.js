const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function createIco() {
  const sizes = [256, 128, 64, 48, 32, 16];
  const images = [];

  for (const size of sizes) {
    const inputPath = path.join(__dirname, 'icons', `icon-${size}.png`);
    if (fs.existsSync(inputPath)) {
      const image = sharp(inputPath);
      const metadata = await image.metadata();
      const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      images.push({
        width: info.width,
        height: info.height,
        data: Buffer.from(data)
      });
    }
  }

  if (images.length === 0) {
    throw new Error('No images found');
  }

  const iconDirHeader = Buffer.alloc(6);
  iconDirHeader.writeUInt16LE(0, 0); // Reserved
  iconDirHeader.writeUInt16LE(1, 2); // Type: ICO
  iconDirHeader.writeUInt16LE(images.length, 4); // Number of images

  let offset = 6 + images.length * 16;
  const dirEntries = [];

  for (const img of images) {
    const pngData = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } }).png().toBuffer();
    
    const entry = Buffer.alloc(16);
    entry.writeUInt8(img.width >= 256 ? 0 : img.width, 0); // Width
    entry.writeUInt8(img.height >= 256 ? 0 : img.height, 1); // Height
    entry.writeUInt8(0, 2); // Color palette
    entry.writeUInt8(0, 3); // Reserved
    entry.writeUInt16LE(1, 4); // Color planes
    entry.writeUInt16LE(32, 6); // Bits per pixel
    entry.writeUInt32LE(pngData.length, 8); // Size of image data
    entry.writeUInt32LE(offset, 12); // Offset
    
    dirEntries.push({ entry, data: pngData });
    offset += pngData.length;
  }

  const icoBuffer = Buffer.concat([iconDirHeader, ...dirEntries.map(d => d.entry), ...dirEntries.map(d => d.data)]);
  
  const outputPath = path.join(__dirname, 'icons', 'icon.ico');
  fs.writeFileSync(outputPath, icoBuffer);
  console.log(`Generated: ${outputPath} (${icoBuffer.length} bytes)`);
}

createIco().catch(console.error);
