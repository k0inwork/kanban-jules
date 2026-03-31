const str1 = "I found 4 sessions. Let me fetch the activity logs for the in-progress sessions to provide you with a comprehensive analysis.<tool_call>listActivities sessionId=9863360286157549758</arg_value><tool_call>listActivities sessionId=18066479312342670647</arg_value><tool_call>listActivities sessionId=16743095042007653578</arg_value>";
const str2 = "I found 4 sessions. Let me fetch the activity logs for the in-progress sessions to provide you with a comprehensive analysis.<tool_call>listActivities sessionId=9863360286157549758";

// The original regex:
const originalRegex = /<tool_call>\s*([a-zA-Z0-9_]+)\s+([a-zA-Z0-9_]+)\s*=\s*"?([^"<\n\r]+)/g;

// A regex that also matches truncated responses by ending with $
const truncatedRegex = /<tool_call>\s*([a-zA-Z0-9_]+)\s+([a-zA-Z0-9_]+)\s*=\s*"?([^"<\n\r]*)$/g;

function parse(str) {
  let parsed = [];
  let content = str;
  content = content.replace(originalRegex, (match, fnName, argKey, argValue) => {
    parsed.push({fnName, argKey, argValue});
    return `\n*[Tool Call: ${fnName}]*\n`;
  });
  content = content.replace(truncatedRegex, (match, fnName, argKey, argValue) => {
    parsed.push({fnName, argKey, argValue});
    return `\n*[Tool Call: ${fnName}]*\n`;
  });
  return {content, parsed};
}

console.log("STR1:", parse(str1));
console.log("STR2:", parse(str2));
