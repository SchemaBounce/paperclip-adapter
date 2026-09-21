import { describe, expect, it } from 'vitest';
import { parseStdoutLine } from './ui-parser.js';

const PREFIX = '[schemabounce] ';

describe('parseStdoutLine', () => {
  it('passes through lines without the schemabounce prefix as raw stdout', () => {
    expect(parseStdoutLine('some other line', '2026-01-01T00:00:00Z')).toEqual([
      { kind: 'stdout', ts: '2026-01-01T00:00:00Z', text: 'some other line' },
    ]);
  });

  it('renders a dispatch payload as a system line', () => {
    const line = `${PREFIX}${JSON.stringify({ kind: 'dispatch', taskId: 'task_123' })}`;
    expect(parseStdoutLine(line, 't1')).toEqual([
      { kind: 'system', ts: 't1', text: 'SchemaBounce task task_123 started.' },
    ]);
  });

  it('renders a text artifact as an assistant delta', () => {
    const line = `${PREFIX}${JSON.stringify({
      taskId: 't1',
      artifact: { name: 'response', index: 0, parts: [{ text: { text: 'hello world' } }] },
    })}`;
    expect(parseStdoutLine(line, 't1')).toEqual([{ kind: 'assistant', ts: 't1', text: 'hello world', delta: true }]);
  });

  it('renders a tool: artifact as a tool_call plus tool_result pair', () => {
    const line = `${PREFIX}${JSON.stringify({
      taskId: 't1',
      artifact: { name: 'tool:paperclipCheckoutIssue', index: 2, parts: [{ text: { text: '{"ok":true}' } }] },
    })}`;
    const entries = parseStdoutLine(line, 't1');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ kind: 'tool_call', name: 'paperclipCheckoutIssue' });
    expect(entries[1]).toMatchObject({ kind: 'tool_result', content: '{"ok":true}', isError: false });
  });

  it('renders a failed status as stderr', () => {
    const line = `${PREFIX}${JSON.stringify({
      taskId: 't1',
      status: { state: 'TASK_STATE_FAILED', message: 'boom' },
    })}`;
    expect(parseStdoutLine(line, 't1')).toEqual([{ kind: 'stderr', ts: 't1', text: 'TASK_STATE_FAILED: boom' }]);
  });

  it('renders a non-terminal status as a system line', () => {
    const line = `${PREFIX}${JSON.stringify({ taskId: 't1', status: { state: 'TASK_STATE_WORKING' } })}`;
    expect(parseStdoutLine(line, 't1')).toEqual([{ kind: 'system', ts: 't1', text: 'TASK_STATE_WORKING' }]);
  });

  it('falls back to raw stdout when the prefixed payload is not valid JSON', () => {
    const line = `${PREFIX}not json`;
    expect(parseStdoutLine(line, 't1')).toEqual([{ kind: 'stdout', ts: 't1', text: line }]);
  });
});
