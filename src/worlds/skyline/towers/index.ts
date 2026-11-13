import type { TowerDef } from '../kit'
import { BILLIONAIRES_ROW } from './billionairesRow'
import { DOWNTOWN_HISTORIC } from './downtownHistoric'
import { HUDSON_YARDS } from './hudsonYards'
import { MIDTOWN_ICONS } from './midtownIcons'
import { MIDTOWN_MODERN } from './midtownModern'
import { PARK_AND_PLAZA } from './parkAndPlaza'
import { WORLD_TRADE_CENTER } from './worldTradeCenter'

export const TOWERS: TowerDef[] = [
  ...MIDTOWN_ICONS,
  ...MIDTOWN_MODERN,
  ...BILLIONAIRES_ROW,
  ...PARK_AND_PLAZA,
  ...HUDSON_YARDS,
  ...WORLD_TRADE_CENTER,
  ...DOWNTOWN_HISTORIC,
]
