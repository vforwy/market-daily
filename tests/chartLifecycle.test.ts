import assert from 'node:assert/strict'
import test from 'node:test'
import { createChartLifecycle } from '../src/lib/chartLifecycle.ts'

function setup() {
  let element: { id: number } | null = null
  const charts: { options: [object, boolean][]; resizes: number; disposes: number }[] = []
  const observers: { observed: unknown[]; disconnects: number; notify: () => void }[] = []
  const lifecycle = createChartLifecycle<{ id: number }, object>(
    () => {
      const chart = { options: [] as [object, boolean][], resizes: 0, disposes: 0 }
      charts.push(chart)
      return {
        setOption: (option: object, notMerge: boolean) => { chart.options.push([option, notMerge]) },
        resize: () => { chart.resizes += 1 },
        dispose: () => { chart.disposes += 1 },
      }
    },
    notify => {
      const observer = { observed: [] as unknown[], disconnects: 0, notify }
      observers.push(observer)
      return {
        observe: observed => { observer.observed.push(observed) },
        disconnect: () => { observer.disconnects += 1 },
      }
    },
  )
  return {
    lifecycle: {
      ...lifecycle,
      update: (option: object, resizeAfterUpdate = false) => lifecycle.update(element, option, resizeAfterUpdate),
    },
    charts,
    observers,
    setElement: (next: typeof element) => { element = next },
  }
}

test('creation stays lazy and also supports a chart element arriving after an empty state', () => {
  const state = setup()
  assert.equal(state.lifecycle.update({ series: [] }), false)
  state.lifecycle.resize()
  assert.equal(state.charts.length, 0)
  assert.equal(state.observers.length, 0)
  const element = { id: 1 }
  state.setElement(element)
  assert.equal(state.lifecycle.update({ series: [1] }), true)
  assert.deepEqual(state.observers[0].observed, [element])
})

test('updates reuse one instance and replace options rather than keeping removed series', () => {
  const state = setup()
  state.setElement({ id: 1 })
  const first = { series: ['near-far1', 'near-far2'] }
  const second = { series: ['near-far2'] }
  state.lifecycle.update(first)
  state.lifecycle.update(second)
  assert.equal(state.charts.length, 1)
  assert.deepEqual(state.charts[0].options, [[first, true], [second, true]])
})

test('resize observer and requested post-update resize use the live instance', () => {
  const state = setup()
  state.setElement({ id: 1 })
  state.lifecycle.update({}, true)
  state.observers[0].notify()
  state.lifecycle.resize()
  assert.equal(state.charts[0].resizes, 3)
})

test('cleanup disconnects and disposes once; delayed resize callbacks are harmless', () => {
  const state = setup()
  state.setElement({ id: 1 })
  state.lifecycle.update({})
  state.lifecycle.dispose()
  state.lifecycle.dispose()
  state.observers[0].notify()
  assert.equal(state.observers[0].disconnects, 1)
  assert.equal(state.charts[0].disposes, 1)
  assert.equal(state.charts[0].resizes, 0)
})

test('StrictMode cleanup then remount creates a fresh instance and observer', () => {
  const state = setup()
  state.setElement({ id: 1 })
  state.lifecycle.update({})
  state.lifecycle.dispose()
  state.lifecycle.update({})
  assert.equal(state.charts.length, 2)
  assert.equal(state.observers.length, 2)
  assert.equal(state.charts[0].disposes, 1)
  state.observers[1].notify()
  assert.equal(state.charts[1].resizes, 1)
})

test('a changed chart element releases the old resources before observing the replacement', () => {
  const state = setup()
  state.setElement({ id: 1 })
  state.lifecycle.update({})
  const replacement = { id: 2 }
  state.setElement(replacement)
  state.lifecycle.update({})
  assert.equal(state.charts[0].disposes, 1)
  assert.equal(state.observers[0].disconnects, 1)
  assert.deepEqual(state.observers[1].observed, [replacement])
})

test('observer initialization failure releases the partial chart and allows a later retry', () => {
  let disposes = 0
  let disconnects = 0
  let optionUpdates = 0
  let failObserve = true
  const lifecycle = createChartLifecycle<object, object>(
    () => ({
      setOption: () => { optionUpdates += 1 },
      resize: () => {},
      dispose: () => { disposes += 1 },
    }),
    () => ({
      observe: () => { if (failObserve) throw new Error('observe failed') },
      disconnect: () => { disconnects += 1 },
    }),
  )
  const element = {}
  assert.throws(() => lifecycle.update(element, {}), /observe failed/)
  assert.equal(disposes, 1)
  assert.equal(disconnects, 1)
  assert.equal(optionUpdates, 0)

  failObserve = false
  assert.equal(lifecycle.update(element, {}), true)
  assert.equal(optionUpdates, 1)
  lifecycle.dispose()
  assert.equal(disposes, 2)
  assert.equal(disconnects, 2)
})
