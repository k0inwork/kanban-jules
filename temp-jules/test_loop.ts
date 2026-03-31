import { parseHallucinatedToolCalls } from './client/src/lib/ai/parseTools';

console.log(parseHallucinatedToolCalls("I found 4 sessions. Let me fetch the activity logs for the in-progress sessions to provide you with a comprehensive analysis.<tool_call>listActivities sessionId=9863360286157549758</arg_value><tool_call>listActivities sessionId=18066479312342670647</arg_value><tool_call>listActivities sessionId=16743095042007653578</arg_value>"));
