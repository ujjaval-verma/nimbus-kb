export function QuotaPill({ quota }: { quota: { limit: number; remaining: number } | null }) {
  if (!quota) return null;
  const left = Math.max(0, quota.remaining);
  return (
    <span className="pill quota-pill"
      title={`Each visitor gets ${quota.limit} AI answer${quota.limit === 1 ? "" : "s"} a day on this public demo. Resets at midnight UTC.`}>
      {left === 0 ? "No answers left today" : <><span className="num">{left}</span>{` answer${left === 1 ? "" : "s"} left today`}</>}
    </span>
  );
}
