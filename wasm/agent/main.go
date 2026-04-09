package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/cloudwego/eino/compose"
	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/flow/agent/react"
	"github.com/cloudwego/eino/schema"
)

// Agent is a coding agent that runs inside Wanix WASM VM (WASI target).
// It uses Eino's ReAct loop with:
//   - LLMModel: calls LLM API via /#llm/ filesystem (write request, read result)
//   - PipeTools: calls tools via /#tools/ filesystem (write call, read result)
//
// Usage:
//
//	./agent.wasm "Fix the authentication bug in login.ts"
func main() {
	log.SetFlags(log.Lshortfile)
	log.Println("agent starting")

	prompt := "Analyze the current board state and help with any stalled tasks."
	if len(os.Args) > 1 && os.Args[1] != "" {
		prompt = os.Args[1]
	}

	log.Println("prompt:", prompt)

	// Create the LLM model (backs onto /#llm/ filesystem)
	llm := NewLLMModel()

	// Load tools from /#tools/list
	tools, err := loadToolsFromPipe()
	if err != nil {
		log.Fatal("load tools:", err)
	}
	log.Printf("loaded %d tools\n", len(tools))

	// Convert to Eino tool interfaces
	einoTools := make([]tool.InvokableTool, len(tools))
	for i, t := range tools {
		einoTools[i] = t
	}

	// Build the ReAct agent
	agent, err := react.NewAgent(context.Background(), &react.AgentConfig{
		Model: llm,
		ToolsConfig: compose.ToolsNodeConfig{
			Tools: einoToolsToAny(einoTools),
		},
		MaxStep: 12,
	})
	if err != nil {
		log.Fatal("create agent:", err)
	}

	// Run the agent with the prompt
	msg, err := agent.Generate(context.Background(), []*schema.Message{
		schema.SystemMessage(systemPrompt()),
		schema.UserMessage(prompt),
	})
	if err != nil {
		log.Fatal("agent generate:", err)
	}

	// Output the result
	log.Println("agent result:", msg.Content)
	fmt.Println(msg.Content)
}

func systemPrompt() string {
	return `You are an AI coding assistant integrated into a kanban board system.
You can analyze tasks, review code, debug stalled tasks, and help manage the board.

Available tools:
- Board tools: list_tasks, get_task, update_task, get_task_logs, get_jules_activities, list_artifacts, read_artifact, save_artifact
- Git tools: git_get_file, git_list_files

When analyzing stalled tasks:
1. First list_tasks to see what's on the board
2. get_task to inspect the stalled task
3. get_task_logs to download execution logs
4. get_jules_activities if it's a Jules task — check plans, bash output, errors
5. Analyze the logs and provide a diagnosis
6. Update the task with your findings via update_task

Be concise and actionable. Focus on finding root causes.`
}

// einoToolsToAny converts []tool.InvokableTool to []tool.BaseTool.
func einoToolsToAny(tools []tool.InvokableTool) []tool.BaseTool {
	out := make([]tool.BaseTool, len(tools))
	for i, t := range tools {
		out[i] = t
	}
	return out
}
