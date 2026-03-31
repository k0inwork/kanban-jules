export function parseHallucinatedToolCalls(text: string): { cleanText: string; toolCalls: any[] } {
  let finalContent = text || '';
  const parsedToolCalls: any[] = [];

  // Match complete or partial tool calls.
  // We use `g` for complete ones.
  const completeToolCallRegex = /<tool_call>\s*([a-zA-Z0-9_]+)\s+([a-zA-Z0-9_]+)\s*=\s*"?([^"<\n\r]+)/g;

  // To handle abruptly truncated responses (e.g., due to model token limits),
  // we look for a partial match at the very end of the string ($).
  const truncatedToolCallRegex = /<tool_call>\s*([a-zA-Z0-9_]+)\s+([a-zA-Z0-9_]+)\s*=\s*"?([^"<\n\r]*)$/;

  finalContent = finalContent.replace(completeToolCallRegex, (match, fnName, argKey, argValue) => {
    parsedToolCalls.push({
      function: {
        name: fnName,
        arguments: JSON.stringify({ [argKey]: argValue })
      },
      id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      type: 'function'
    });
    return `\n*[Tool Call: ${fnName}]*\n`;
  });

  // Then check for a truncated one at the end
  finalContent = finalContent.replace(truncatedToolCallRegex, (match, fnName, argKey, argValue) => {
    parsedToolCalls.push({
      function: {
        name: fnName,
        arguments: JSON.stringify({ [argKey]: argValue || "" })
      },
      id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      type: 'function'
    });
    return `\n*[Tool Call: ${fnName}]*\n`;
  });

  // Clean up any dangling closing tags left behind by the simpler regex
  // Also clean up <think> blocks as requested by memories
  finalContent = finalContent.replace(/<think>[\s\S]*?<\/think>/g, '');

  // If a <think> block is truncated at the end of the response:
  finalContent = finalContent.replace(/<think>[\s\S]*?$/g, '');

  finalContent = finalContent.replace(/<\/tool_call>|<\/arg_value>|<\/think>|<think>/g, '');

  return { cleanText: finalContent, toolCalls: parsedToolCalls };
}
