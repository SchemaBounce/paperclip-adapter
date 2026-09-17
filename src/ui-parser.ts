type TranscriptEntry =
  | { kind: 'assistant'; ts: string; text: string; delta?: boolean }
  | { kind: 'tool_call'; ts: string; name: string; input: unknown; toolUseId?: string }
  | {
      kind: 'tool_result';
      ts: string;
      toolUseId: string;
      content: string;
      isError: boolean;
    }
  | { kind: 'system'; ts: string; text: string }
  | { kind: 'stderr'; ts: string; text: string }
  | { kind: 'stdout'; ts: string; text: string };

const PREFIX = '[schemabounce] ';

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function textParts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(part => {
    const text = objectValue(objectValue(part)?.text)?.text;
    return typeof text === 'string' ? [text] : [];
  });
}

export function parseStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith(PREFIX)) return [{ kind: 'stdout', ts, text: line }];
  try {
    const payload = objectValue(JSON.parse(trimmed.slice(PREFIX.length)));
    if (!payload) return [{ kind: 'stdout', ts, text: line }];

    if (payload.kind === 'dispatch') {
      return [
        {
          kind: 'system',
          ts,
          text: `SchemaBounce task ${String(payload.taskId ?? '')} started.`,
        },
      ];
    }

    const artifact = objectValue(payload.artifact);
    if (artifact) {
      const content = textParts(artifact.parts).join('\n');
      const name = typeof artifact.name === 'string' ? artifact.name : 'response';
      if (name.startsWith('tool:')) {
        const toolName = name.slice(5) || 'tool';
        const toolUseId = `${String(payload.taskId ?? 'task')}-${String(artifact.index ?? 0)}-${toolName}`;
        return [
          { kind: 'tool_call', ts, name: toolName, input: {}, toolUseId },
          { kind: 'tool_result', ts, toolUseId, content, isError: false },
        ];
      }
      return content ? [{ kind: 'assistant', ts, text: content, delta: true }] : [];
    }

    const status = objectValue(payload.status);
    if (status && typeof status.state === 'string') {
      const message =
        typeof status.message === 'string' && status.message
          ? `${status.state}: ${status.message}`
          : status.state;
      const failed = ['TASK_STATE_FAILED', 'TASK_STATE_CANCELED', 'TASK_STATE_REJECTED'].includes(
        status.state
      );
      return [failed ? { kind: 'stderr', ts, text: message } : { kind: 'system', ts, text: message }];
    }

    return [{ kind: 'stdout', ts, text: line }];
  } catch {
    return [{ kind: 'stdout', ts, text: line }];
  }
}
