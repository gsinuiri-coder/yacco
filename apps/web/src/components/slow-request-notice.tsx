import { SLOW_REQUEST_MESSAGE } from "../api/timing";

/** Cold-start notice shared by every paginated list screen. */
export function SlowRequestNotice({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p className="notice notice--info" role="status">
      {SLOW_REQUEST_MESSAGE}
    </p>
  );
}
