export interface CrowdSite {
  id: string
  label: string
  placeId: string
  x: number
  z: number
  radius: number
  boost: number
}
export const CROWD_SITES: CrowdSite[]
export function streetFigureLimit(x: number, z: number): number
