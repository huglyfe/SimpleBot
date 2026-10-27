/**
 * Reading a standard Character Card PNG: the chunks, their checksums, and the
 * embedded card payload. Nothing here touches the filesystem or the root.
 */

import {
  AuthoredValidationError,
  isRecord,
  parseAuthoredJson,
} from './authored-schemas.js';

export interface ParsedPng {
  width: number;
  height: number;
  text: ReadonlyMap<string, string>;
}

export function parseEmbeddedCard(
  filename: string,
  source: string,
): Record<string, unknown> {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      source,
    )
  ) {
    throw new AuthoredValidationError(
      `${filename} bot payload is not valid base64`,
    );
  }
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.from(source, 'base64'),
    );
  } catch {
    throw new AuthoredValidationError(
      `${filename} bot payload is not valid UTF-8`,
    );
  }
  const value = parseAuthoredJson(filename, decoded);
  if (!isRecord(value)) {
    throw new AuthoredValidationError(
      `${filename} bot payload must be a JSON object`,
    );
  }
  return value;
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

export function parsePng(data: Buffer): ParsedPng {
  if (data.length < 33 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new AuthoredValidationError('Bot artwork is not a PNG');
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let sawHeader = false;
  let sawEnd = false;
  const text = new Map<string, string>();
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > data.length) {
      throw new AuthoredValidationError('Bot PNG has a truncated chunk');
    }
    const type = data.subarray(offset + 4, offset + 8);
    const typeName = type.toString('ascii');
    if (!/^[A-Za-z]{4}$/u.test(typeName)) {
      throw new AuthoredValidationError('Bot PNG has an invalid chunk');
    }
    const content = data.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = data.readUInt32BE(offset + 8 + length);
    if (pngCrc32(Buffer.concat([type, content])) !== expectedCrc) {
      throw new AuthoredValidationError(
        `Bot PNG ${typeName} chunk has an invalid checksum`,
      );
    }
    if (!sawHeader) {
      if (typeName !== 'IHDR' || length !== 13) {
        throw new AuthoredValidationError(
          'Bot PNG must begin with an IHDR chunk',
        );
      }
      width = content.readUInt32BE(0);
      height = content.readUInt32BE(4);
      if (width === 0 || height === 0) {
        throw new AuthoredValidationError(
          'Bot PNG dimensions must be positive',
        );
      }
      sawHeader = true;
    } else if (typeName === 'tEXt') {
      const separator = content.indexOf(0);
      if (separator < 1 || separator > 79) {
        throw new AuthoredValidationError('Bot PNG has an invalid tEXt chunk');
      }
      text.set(
        content.subarray(0, separator).toString('latin1'),
        content.subarray(separator + 1).toString('latin1'),
      );
    } else if (typeName === 'IEND') {
      if (length !== 0) {
        throw new AuthoredValidationError('Bot PNG has an invalid IEND chunk');
      }
      sawEnd = true;
      offset = end;
      break;
    }
    offset = end;
  }
  if (!sawEnd || offset !== data.length) {
    throw new AuthoredValidationError('Bot PNG must end with an IEND chunk');
  }
  return { width, height, text };
}

function pngCrc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    const entry = PNG_CRC_TABLE[(crc ^ byte) & 0xff];
    if (entry === undefined)
      throw new Error('PNG checksum table is incomplete');
    crc = entry ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
