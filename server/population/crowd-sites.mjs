/** Existing mapped destinations used by the browser population's day plans. */
export const CROWD_SITES = [
  { id: 'times-square', label: 'Times Square plaza', placeId: 'mapped:dohmh:50120398', x: -536, z: -77, radius: 140, boost: 120 },
  { id: 'central-park', label: 'Central Park', placeId: 'park_access:N04668', x: -494, z: -657, radius: 165, boost: 110 },
  { id: 'grand-central', label: 'Grand Central', placeId: 'station_access:metro-north:1', x: -239, z: -17, radius: 115, boost: 85 },
  { id: 'penn-station', label: 'Penn Station', placeId: 'mapped:dohmh:50132626', x: -676, z: 273, radius: 125, boost: 85 },
  { id: 'world-trade-center', label: 'World Trade Center', placeId: 'station_access:subway:138', x: -343, z: 1774, radius: 130, boost: 100 },
]

export function streetFigureLimit(x, z) {
  let boost = 0
  for (const site of CROWD_SITES) {
    const distance = Math.hypot(x - site.x, z - site.z)
    boost = Math.max(boost, Math.round(site.boost * Math.max(0, 1 - distance / site.radius)))
  }
  return 100 + boost
}
