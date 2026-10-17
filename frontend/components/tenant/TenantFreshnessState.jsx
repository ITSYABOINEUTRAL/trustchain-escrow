export default function TenantFreshnessState({ state, onRetry }) {
  if (state === 'loading') return <p role="status">Loading tenant configuration…</p>;
  if (state === 'empty') return <p role="status">No tenant configuration is available.</p>;
  if (state === 'error') return <div role="alert">Configuration could not be loaded. <button type="button" onClick={onRetry}>Retry</button></div>;
  return null;
}
