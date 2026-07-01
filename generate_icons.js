// Generates minimal PNG icon files for the PRYZM Chrome extension
// Creates 16x16, 48x48, and 128x128 pixel icons

const fs = require('fs');
const path = require('path');

// Minimal valid PNG generator (creates a solid colored square)
function createPNG(size, r, g, b) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  function crc32(buf) {
    let c = 0xFFFFFFFF;
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let v = n;
      for (let k = 0; k < 8; k++) v = v & 1 ? 0xEDB88320 ^ (v >>> 1) : v >>> 1;
      table[n] = v;
    }
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  
  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeAndData = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData));
    return Buffer.concat([len, typeAndData, crc]);
  }
  
  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);    // width
  ihdr.writeUInt32BE(size, 4);    // height
  ihdr[8] = 8;                     // bit depth
  ihdr[9] = 2;                     // color type (RGB)
  ihdr[10] = 0;                    // compression
  ihdr[11] = 0;                    // filter
  ihdr[12] = 0;                    // interlace
  
  // IDAT chunk - raw image data
  // Each row: filter byte (0) + RGB pixels
  const rawRows = [];
  
  // Create a diamond/prism shape with gradient
  const center = size / 2;
  
  for (let y = 0; y < size; y++) {
    const row = [0]; // filter byte
    for (let x = 0; x < size; x++) {
      // Distance from center normalized 0-1
      const dx = (x - center) / center;
      const dy = (y - center) / center;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      // Diamond shape check
      const inDiamond = (Math.abs(dx) + Math.abs(dy)) < 0.85;
      
      if (inDiamond) {
        // Gradient from cyan to purple
        const t = (x / size);
        const pr = Math.round(78 + (123 - 78) * t);   // cyan R to purple R
        const pg = Math.round(205 + (104 - 205) * t);  // cyan G to purple G  
        const pb = Math.round(196 + (238 - 196) * t);  // cyan B to purple B
        row.push(pr, pg, pb);
      } else {
        // Dark background
        row.push(10, 10, 15);
      }
    }
    rawRows.push(Buffer.from(row));
  }
  
  const rawData = Buffer.concat(rawRows);
  
  // Compress with zlib
  const zlib = require('zlib');
  const compressed = zlib.deflateSync(rawData);
  
  // Build PNG
  const ihdrChunk = chunk('IHDR', ihdr);
  const idatChunk = chunk('IDAT', compressed);
  const iendChunk = chunk('IEND', Buffer.alloc(0));
  
  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Create icons directory
const iconsDir = path.join(__dirname, 'extension', 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

// Generate all sizes
[16, 48, 128].forEach(size => {
  const png = createPNG(size, 78, 205, 196); // Cyan diamond
  const filepath = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(filepath, png);
  console.log(`✅ Created ${filepath} (${png.length} bytes)`);
});

console.log('\\nAll icons generated!');
