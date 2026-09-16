const fs = require('fs');
const path = require('path');

const exePath = process.argv[2] || path.join(__dirname, '..', 'dist', 'markdownlite.exe');

if (!fs.existsSync(exePath)) {
  console.error(`EXE not found: ${exePath}`);
  process.exit(1);
}

const buf = fs.readFileSync(exePath);

// PE header offset is stored at DOS header offset 0x3C
const peOffset = buf.readUInt32LE(0x3C);

// Validate PE signature
const peSig = buf.toString('ascii', peOffset, peOffset + 4);
if (peSig !== 'PE\x00\x00') {
  console.error('Invalid PE file: missing PE signature');
  process.exit(1);
}

// Optional header starts after PE signature (4 bytes) + COFF header (20 bytes)
const optionalHeaderOffset = peOffset + 4 + 20;

// Verify optional header magic (0x10B = PE32, 0x20B = PE32+)
const magic = buf.readUInt16LE(optionalHeaderOffset);
if (magic !== 0x10B && magic !== 0x20B) {
  console.error(`Unexpected optional header magic: 0x${magic.toString(16)}`);
  process.exit(1);
}

// Subsystem field is at offset 0x44 within the optional header for both PE32 and PE32+
const subsystemOffset = optionalHeaderOffset + 0x44;
const currentSubsystem = buf.readUInt16LE(subsystemOffset);

const SUBSYSTEM_WINDOWS_GUI = 2;
const SUBSYSTEM_WINDOWS_CUI = 3;

if (currentSubsystem === SUBSYSTEM_WINDOWS_GUI) {
  console.log('Already WINDOWS_GUI subsystem.');
  process.exit(0);
}

if (currentSubsystem !== SUBSYSTEM_WINDOWS_CUI) {
  console.warn(`Unexpected subsystem ${currentSubsystem}, expected ${SUBSYSTEM_WINDOWS_CUI} (WINDOWS_CUI).`);
}

buf.writeUInt16LE(SUBSYSTEM_WINDOWS_GUI, subsystemOffset);
fs.writeFileSync(exePath, buf);

console.log(`Changed subsystem to WINDOWS_GUI: ${exePath}`);
