// Whole numbers only: 200K, 1M (1,000,000 and 1,048,576 both read as 1M).
export function fmtContext(tokens: number): string {
  return tokens >= 1_000_000 ? `${Math.round(tokens / 1_000_000)}M` : `${Math.round(tokens / 1000)}K`;
}

export function fmtPrice(usd: number): string {
  return `$${usd.toFixed(2)}`;
}
