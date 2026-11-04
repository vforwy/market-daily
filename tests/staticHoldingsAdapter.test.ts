import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createStaticHoldingsAdapter } from '../src/api/staticHoldingsAdapter.ts'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/holdings-protocol.json', import.meta.url), 'utf8'))
function client() {
  const requests: string[] = []
  const fetcher = (async (url: string | URL | Request) => {
    const path = new URL(String(url), 'https://test.local').pathname.split('/holdings/')[1]
    requests.push(path)
    if (path === 'index.json') return new Response(JSON.stringify(fixture.index))
    return fixture.assets[path] ? new Response(fixture.assets[path].body) : new Response('', { status: 404 })
  }) as typeof fetch
  return { api: createStaticHoldingsAdapter('/market-daily/', fetcher), requests, fetcher }
}

test('all top-N boards exactly match the canonical private view, loading no member archive', async () => {
  const { api, requests } = client()
  for (const n of [5, 10, 20]) assert.deepEqual(await api.holdingSeat('rb', n), fixture.boards[String(n)])
  assert.equal(requests.filter(path => path === 'RB/board.json').length, 1)
  assert.ok(requests.every(path => !path.includes('/members/')))
})

test('changes and monthly ranks match canonical backend results, including gaps and sign changes', async () => {
  const { api } = client()
  for (const entry of fixture.cases) {
    const actual = entry.kind === 'changes'
      ? await api.holdingSeatChanges(...entry.args as [string, string, number, 'long' | 'short', string])
      : await api.holdingSeatRanks(...entry.args as [string, string, 'long' | 'short', string, number])
    assert.deepEqual(actual, entry.expected, `${entry.kind} ${entry.args}`)
  }
})

test('a failed or mixed-generation asset can be retried instead of remaining cached', async () => {
  const baseline = client()
  let wrong = true
  const fetcher = (async (...args: Parameters<typeof fetch>) => {
    if (String(args[0]).includes('board.json') && wrong) { wrong = false; return new Response('{}') }
    return baseline.fetcher(...args)
  }) as typeof fetch
  const api = createStaticHoldingsAdapter('/', fetcher)
  await assert.rejects(api.holdingSeat('RB'), /更新/)
  assert.deepEqual(await api.holdingSeat('RB'), fixture.boards['5'])
})
