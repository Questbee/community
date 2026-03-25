export default function Spinner({ size = 24 }: { size?: number }) {
  return (
    <span
      style={{ width: size, height: size }}
      className="inline-block rounded-full border-2 border-gray-300 border-t-brand-600 animate-spin"
      role="status"
      aria-label="Loading"
    />
  );
}
