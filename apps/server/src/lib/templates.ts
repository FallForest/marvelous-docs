export type TemplateNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TemplateNode[];
  text?: string;
};

export type TemplateContent = { schemaVersion: 1; doc: { type: 'doc'; content: TemplateNode[] } };

export type Template = {
  id: string;
  name: string;
  description: string;
  content: TemplateContent;
};

function text(value: string): TemplateNode {
  return { type: 'text', text: value };
}

function paragraph(value: string): TemplateNode {
  return value ? { type: 'paragraph', content: [text(value)] } : { type: 'paragraph' };
}

function heading(level: number, value: string): TemplateNode {
  return { type: 'heading', attrs: { level }, content: [text(value)] };
}

function listItem(value: string): TemplateNode {
  return { type: 'listItem', content: [paragraph(value)] };
}

function bulletList(items: string[]): TemplateNode {
  return { type: 'bulletList', content: items.map(listItem) };
}

function orderedList(items: string[]): TemplateNode {
  return { type: 'orderedList', content: items.map(listItem) };
}

function taskItem(value: string, checked = false): TemplateNode {
  return { type: 'taskItem', attrs: { checked }, content: [paragraph(value)] };
}

function taskList(items: Array<{ text: string; checked?: boolean }>): TemplateNode {
  return { type: 'taskList', content: items.map(item => taskItem(item.text, item.checked ?? false)) };
}

function cell(value: string, header: boolean): TemplateNode {
  return { type: header ? 'tableHeader' : 'tableCell', content: [paragraph(value)] };
}

function table(headers: string[], rows: string[][]): TemplateNode {
  const headerRow: TemplateNode = { type: 'tableRow', content: headers.map(value => cell(value, true)) };
  const bodyRows: TemplateNode[] = rows.map(row => ({
    type: 'tableRow',
    content: headers.map((_, index) => cell(row[index] ?? '', false)),
  }));
  return { type: 'table', content: [headerRow, ...bodyRows] };
}

function codeBlock(language: string, value: string): TemplateNode {
  return { type: 'codeBlock', attrs: { language }, content: [text(value)] };
}

function template(id: string, name: string, description: string, nodes: TemplateNode[]): Template {
  return { id, name, description, content: { schemaVersion: 1, doc: { type: 'doc', content: nodes } } };
}

/** Built-in templates exposed by GET /api/v1/templates. */
export const templates: readonly Template[] = [
  template('blank', 'Blank document', 'Start from an empty page.', [paragraph('')]),
  template('meeting-notes', 'Meeting notes', 'Agenda, decisions, and action items.', [
    heading(1, 'Meeting notes'),
    paragraph('Date:  |  Facilitator:  |  Attendees:'),
    heading(2, 'Agenda'),
    bulletList(['Topic one', 'Topic two', 'Topic three']),
    heading(2, 'Decisions'),
    bulletList(['Decision and who approved it']),
    heading(2, 'Action items'),
    taskList([
      { text: 'Owner — follow up on the first topic' },
      { text: 'Owner — share the recap with the team' },
    ]),
    heading(2, 'Notes'),
    paragraph(''),
  ]),
  template('weekly-report', 'Weekly report', 'Weekly summary with metrics and risks.', [
    heading(1, 'Weekly report'),
    paragraph('Week of  |  Author:'),
    heading(2, 'Summary'),
    paragraph('One short paragraph on what moved this week.'),
    heading(2, 'Highlights'),
    bulletList(['Shipped the first highlight', 'Started the second highlight']),
    heading(2, 'Metrics'),
    table(['Metric', 'This week', 'Last week'], [
      ['Documents created', '', ''],
      ['Active members', '', ''],
      ['Open comments', '', ''],
    ]),
    heading(2, 'Risks and blockers'),
    bulletList(['Risk, owner, and mitigation']),
    heading(2, 'Next week'),
    orderedList(['Top priority', 'Second priority', 'Stretch goal']),
  ]),
  template('project-plan', 'Project plan', 'Goals, milestones, owners, and risks.', [
    heading(1, 'Project plan'),
    paragraph('Owner:  |  Status: Draft  |  Target date:'),
    heading(2, 'Goals'),
    bulletList(['Primary goal and how we measure it', 'Secondary goal']),
    heading(2, 'Milestones'),
    table(['Milestone', 'Owner', 'Target date'], [
      ['Discovery', '', ''],
      ['Build', '', ''],
      ['Launch', '', ''],
    ]),
    heading(2, 'In scope'),
    bulletList(['Scope item']),
    heading(2, 'Out of scope'),
    paragraph('Explicitly excluded work.'),
    heading(2, 'Risks'),
    bulletList(['Risk, likelihood, impact, mitigation']),
    heading(2, 'Open questions'),
    taskList([{ text: 'Resolve the first open question' }]),
  ]),
  template('product-spec', 'Product spec', 'Problem, users, scope, and success metrics.', [
    heading(1, 'Product spec'),
    paragraph('Status: Draft  |  Owner:  |  Reviewers:'),
    heading(2, 'Problem'),
    paragraph('What user problem are we solving, and why now?'),
    heading(2, 'Users'),
    bulletList(['Primary persona', 'Secondary persona']),
    heading(2, 'Success metrics'),
    table(['Metric', 'Target'], [
      ['Activation', ''],
      ['Weekly retention', ''],
    ]),
    heading(2, 'Scope'),
    bulletList(['Requirement one', 'Requirement two']),
    heading(2, 'Out of scope'),
    paragraph('Work that is intentionally excluded from this version.'),
    heading(2, 'Open questions'),
    bulletList(['Question, owner, and decision date']),
  ]),
  template('release-notes', 'Release notes', 'Highlights, fixes, and upgrade notes.', [
    heading(1, 'Release notes'),
    paragraph('Version  |  Released:'),
    heading(2, 'Highlights'),
    bulletList(['Newest feature', 'Second feature']),
    heading(2, 'Fixes'),
    bulletList(['Bug fix and its impact']),
    heading(2, 'Upgrade notes'),
    orderedList(['Back up the database', 'Pull the new images', 'Restart the stack']),
    codeBlock('bash', 'docker compose pull && docker compose up -d'),
    heading(2, 'Compatibility'),
    paragraph('API and client versions this release supports.'),
  ]),
];

const templatesById = new Map(templates.map(entry => [entry.id, entry]));

/** Looks up a built-in template by id. */
export function getTemplate(id: string): Template | undefined {
  return templatesById.get(id);
}

/** Lists built-in template identifiers, in display order. */
export function templateIds(): string[] {
  return templates.map(entry => entry.id);
}
