const str = "I found 4 sessions. Let me fetch the activity logs for the in-progress sessions to provide you with a comprehensive analysis.<tool_call>listActivities sessionId=9863360286157549758</arg_value><tool_call>listActivities sessionId=18066479312342670647</arg_value><tool_call>listActivities sessionId=16743095042007653578</arg_value>";
const toolCallRegex = /<tool_call>\s*([a-zA-Z0-9_]+)\s+([a-zA-Z0-9_]+)\s*=\s*"?([^"<\n\r]+)/g;

let finalContent = str;
const parsedToolCalls = [];

finalContent = finalContent.replace(toolCallRegex, (match, fnName, argKey, argValue) => {
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

finalContent = finalContent.replace(/<think>[\s\S]*?<\/think>/g, '');
finalContent = finalContent.replace(/<\/tool_call>|<\/arg_value>|<\/think>|<think>/g, '');

console.log("FINAL CONTENT:");
console.log(finalContent);
console.log("PARSED TOOL CALLS:");
console.log(parsedToolCalls);
