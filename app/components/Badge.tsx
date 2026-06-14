export function StatusBadge({ status }: { status: string }) {
  const cls = status === 'Fully paid' ? 'badge-paid' : status === 'Partial' ? 'badge-partial' : 'badge-unpaid'
  return <span className={`badge ${cls}`}>{status}</span>
}
export function ChannelBadge({ channel }: { channel: string }) {
  return <span className={`badge ${channel === 'UW' ? 'badge-uw' : 'badge-direct'}`}>{channel === 'UW' ? 'Upwork' : channel || 'Direct'}</span>
}
export function NewRepBadge({ newrep }: { newrep: string }) {
  return <span className={`badge ${newrep === 'New' ? 'badge-new' : 'badge-repeat'}`}>{newrep}</span>
}
