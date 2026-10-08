const fmt = (n: number) => n.toLocaleString("en-US");

export function UsagePill({ input, output, costUsd }: { input: number; output: number; costUsd: number }) {
  return (
    <span className="pill" title={`${fmt(input)} in, ${fmt(output)} out this session`}>
      Session: <span className="num">{fmt(input + output)}</span> tokens · <span className="num">${costUsd.toFixed(4)}</span>
    </span>
  );
}
