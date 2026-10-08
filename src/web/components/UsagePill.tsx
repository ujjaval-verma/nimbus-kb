const fmt = (n: number) => n.toLocaleString("en-US");

export function UsagePill({ input, output, costUsd }: { input: number; output: number; costUsd: number }) {
  return (
    <span className="pill mono" title={`${fmt(input)} in, ${fmt(output)} out this session`}>
      {fmt(input + output)} tokens · ${costUsd.toFixed(4)}
    </span>
  );
}
