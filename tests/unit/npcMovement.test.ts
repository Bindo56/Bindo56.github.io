import { describe, expect, it } from 'vitest'
import { movementFor } from '../../src/worlds/npcMovement'

const home = { id: 'home', label: 'Home', x: 0, z: 0 }
const office = { id: 'office', label: 'Office', x: 0, z: 100 }
const places = new Map([['home', home], ['office', office]])
const find = (id: string) => places.get(id)

describe('NPC travel from scheduled places', () => {
  it('uses the full commute window from home to office', () => {
    const episodes = [
      { startMinute: 0, endMinute: 480, activity: 'home', placeId: 'home', reason: '' },
      { startMinute: 480, endMinute: 510, activity: 'commute_to_work', placeId: 'office', reason: '' },
    ]
    expect(movementFor(episodes, 1, 495, 1000, find)).toMatchObject({
      from: home, to: office, startMinute: 480, endMinute: 510, progress: .5,
    })
    expect(movementFor(episodes, 1, 510, 1000, find)).toBeNull()
  })

  it('adds a short walk at the start of an outing and its return home', () => {
    const episodes = [
      { startMinute: 0, endMinute: 600, activity: 'home', placeId: 'home', reason: '' },
      { startMinute: 600, endMinute: 660, activity: 'personal_outing', placeId: 'office', reason: '' },
      { startMinute: 660, endMinute: 900, activity: 'home', placeId: 'home', reason: '' },
    ]
    expect(movementFor(episodes, 1, 607.5, 1000, find)?.progress).toBe(.5)
    expect(movementFor(episodes, 2, 665, 1000, find)?.to).toEqual(home)
    expect(movementFor(episodes, 1, 620, 1000, find)).toBeNull()
  })
})
