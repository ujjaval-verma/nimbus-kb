export function QuotaPill({ quota }: { quota: { limit: number; remaining: number } | null }) {
  if (!quota || quota.remaining <= 0) return null;
  return (
    <span className="pill mono quota-pill" title="This public demo gives each visitor a few AI answers a day.">
      {`${quota.remaining} of ${quota.limit} answers left today`}
    </span>
  );
}
