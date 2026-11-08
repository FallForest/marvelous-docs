import test from 'node:test';
import assert from 'node:assert/strict';
import { getTemplate, templateIds, templates } from '../src/lib/templates.js';
import { schema } from '../src/lib/schema.js';
import { markdownToTiptap, tiptapToMarkdown } from '../src/lib/markdown.js';

const EXPECTED = ['blank', 'meeting-notes', 'weekly-report', 'project-plan', 'product-spec', 'release-notes'];

test('exposes the six built-in templates in display order', () => {
  assert.equal(templates.length, 6);
  assert.deepEqual(templateIds(), EXPECTED);
  assert.deepEqual(new Set(templateIds()).size, EXPECTED.length);
});

test('every template carries valid metadata and schema-valid content', () => {
  for (const template of templates) {
    assert.ok(template.id.length > 0, 'template id');
    assert.ok(template.name.length > 0, template.id + ' name');
    assert.ok(template.description.length > 0, template.id + ' description');
    assert.equal(template.content.schemaVersion, 1);
    assert.equal(template.content.doc.type, 'doc');
    assert.ok(Array.isArray(template.content.doc.content));
    assert.doesNotThrow(() => schema.nodeFromJSON(template.content.doc), template.id + ' must match the server schema');
  }
});

test('every non-blank template has visible body content', () => {
  for (const template of templates) {
    if (template.id === 'blank') continue;
    assert.ok(template.content.doc.content.length > 1, template.id + ' should have more than one block');
    const markdown = tiptapToMarkdown(template.content.doc);
    assert.ok(markdown.trim().length > 0, template.id + ' should export markdown');
    assert.doesNotThrow(() => schema.nodeFromJSON(markdownToTiptap(markdown)));
  }
});

test('looks templates up by id', () => {
  const meeting = getTemplate('meeting-notes');
  assert.ok(meeting);
  assert.equal(meeting?.name, 'Meeting notes');
  assert.equal(getTemplate('does-not-exist'), undefined);
});
