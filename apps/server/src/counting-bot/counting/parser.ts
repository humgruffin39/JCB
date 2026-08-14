const integerPattern = /^(0|[1-9][0-9]*)$/;
const fullWidthDigitPattern = /[０-９]/g;

function normalizeFullWidthDigits(value: string): string {
  return value.replace(fullWidthDigitPattern, (digit) =>
    String.fromCharCode(digit.charCodeAt(0) - 0xfee0),
  );
}

export function parseCountCandidate(content: string): bigint | null {
  const normalized = normalizeFullWidthDigits(content.trim());
  if (!integerPattern.test(normalized)) {
    return null;
  }
  return BigInt(normalized);
}
