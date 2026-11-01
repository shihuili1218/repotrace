export const DAY = 86400;
export const localDay = (at: number) => new Date((at + 8 * 3600) * 1000).toISOString().slice(0, 10);
export const localMidnight = (at: number) => Math.floor((at + 8 * 3600) / DAY) * DAY - 8 * 3600;
