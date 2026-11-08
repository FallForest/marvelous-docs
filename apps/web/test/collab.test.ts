import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveCollabUrl } from '../src/lib/collab.ts'

test('resolveCollabUrl prefers an explicitly configured url', () => {
  assert.equal(
    resolveCollabUrl({ protocol: 'https:', host: 'docs.example.com' }, 'wss://collab.example.com/collab'),
    'wss://collab.example.com/collab',
  )
})

test('resolveCollabUrl derives wss for https pages', () => {
  assert.equal(resolveCollabUrl({ protocol: 'https:', host: 'docs.example.com' }, ''), 'wss://docs.example.com/collab')
})

test('resolveCollabUrl derives ws for http pages', () => {
  assert.equal(resolveCollabUrl({ protocol: 'http:', host: 'localhost:5173' }, ''), 'ws://localhost:5173/collab')
})

test('resolveCollabUrl returns an empty string without a location', () => {
  assert.equal(resolveCollabUrl(undefined, ''), '')
})
