/** Calendar-day boundaries for the parking site's India timezone. */
export function monitorDayRange(now = new Date()) {
  const indiaOffset = 330 * 60 * 1000;
  const day = new Date(now.getTime() + indiaOffset).toISOString().slice(0, 10);
  const start = new Date(`${day}T00:00:00+05:30`);
  return { start: start.toISOString(), end: new Date(start.getTime() + 86400000).toISOString() };
}
