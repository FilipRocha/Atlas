import { describe, it, expect } from 'vitest'
import { parseNativeSmart } from './disk-smart-native'

describe('parseNativeSmart', () => {
  it('lê NVMe e SATA e indexa pelo número do disco', () => {
    const map = parseNativeSmart(
      JSON.stringify([
        {
          index: 0,
          kind: 'nvme',
          powerOnHours: 1234,
          temperature: 41,
          percentUsed: 4,
          lifeLeft: null,
          reallocatedSectors: null
        },
        {
          index: 3,
          kind: 'ata',
          powerOnHours: 72,
          temperature: null,
          percentUsed: null,
          lifeLeft: 100,
          reallocatedSectors: 0
        }
      ])
    )
    expect(map.get('0')).toMatchObject({ kind: 'nvme', powerOnHours: 1234, percentUsed: 4 })
    expect(map.get('3')).toMatchObject({
      kind: 'ata',
      powerOnHours: 72,
      lifeLeft: 100,
      reallocatedSectors: 0
    })
  })

  it('aceita objeto único (PowerShell com um só disco)', () => {
    const map = parseNativeSmart(
      JSON.stringify({ index: 1, kind: 'nvme', powerOnHours: 10, temperature: 30, percentUsed: 0 })
    )
    expect(map.get('1')?.powerOnHours).toBe(10)
  })

  it('descarta valores impossíveis em vez de exibi-los', () => {
    const map = parseNativeSmart(
      JSON.stringify([
        { index: 0, kind: 'ata', powerOnHours: 0, temperature: 500, lifeLeft: 0, percentUsed: null }
      ])
    )
    expect(map.get('0')).toMatchObject({ powerOnHours: null, temperature: null, lifeLeft: null })
  })

  it('ignora saída vazia, inválida ou sem índice', () => {
    expect(parseNativeSmart('').size).toBe(0)
    expect(parseNativeSmart('not json').size).toBe(0)
    expect(parseNativeSmart('[{"kind":"nvme"}]').size).toBe(0)
  })
})
