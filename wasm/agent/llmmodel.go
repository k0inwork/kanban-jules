package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"

	"github.com/cloudwego/eino/components/model"
	"github.com/cloudwego/eino/schema"
)

const (
	llmRequestPath = "/llm/request"
	llmResultPath  = "/llm/result"
)

// LLMModel implements model.ChatModel by calling the LLM API
// through the /llm/ filesystem. It writes OpenAI-format JSON to
// /llm/request and reads the response from /llm/result.
type LLMModel struct {
	tools []*schema.ToolInfo
}

func NewLLMModel() *LLMModel {
	return &LLMModel{}
}

// --- OpenAI JSON types ---

type openaiMessage struct {
	Role       string          `json:"role"`
	Content    json.RawMessage `json:"content"`
	ToolCalls  []openaiToolCall `json:"tool_calls,omitempty"`
	ToolCallID string          `json:"tool_call_id,omitempty"`
}

type openaiToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type openaiTool struct {
	Type     string `json:"type"`
	Function struct {
		Name        string          `json:"name"`
		Description string          `json:"description"`
		Parameters  json.RawMessage `json:"parameters"`
	} `json:"function"`
}

type openaiRequest struct {
	Model    string          `json:"model"`
	Messages []openaiMessage `json:"messages"`
	Tools    []openaiTool    `json:"tools,omitempty"`
}

type openaiResponse struct {
	Choices []struct {
		Message struct {
			Role      string           `json:"role"`
			Content   *string          `json:"content"`
			ToolCalls []openaiToolCall `json:"tool_calls"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Error struct {
		Message string `json:"message"`
	} `json:"error"`
}

// --- model.BaseChatModel ---

// Generate calls the LLM via /llm/ filesystem and returns the response.
func (m *LLMModel) Generate(ctx context.Context, input []*schema.Message, opts ...model.Option) (*schema.Message, error) {
	req := openaiRequest{
		Model:    "agent",
		Messages: m.convertMessages(input),
		Tools:    m.convertTools(),
	}

	reqJSON, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	// Write request to /llm/request
	log.Printf("[llmmodel] writing request to %s, size=%d bytes", llmRequestPath, len(reqJSON))
	if err := os.WriteFile(llmRequestPath, reqJSON, 0666); err != nil {
		return nil, fmt.Errorf("write request: %w", err)
	}
	log.Printf("[llmmodel] request written, now reading result from %s", llmResultPath)

	// Read result from /llm/result (opening this file triggers the LLM call in LLMFS)
	resultBytes, err := os.ReadFile(llmResultPath)
	if err != nil {
		return nil, fmt.Errorf("read result: %w", err)
	}
	log.Printf("[llmmodel] got result, size=%d bytes, content=%.200s", len(resultBytes), string(resultBytes))

	var resp openaiResponse
	if err := json.Unmarshal(resultBytes, &resp); err != nil {
		return nil, fmt.Errorf("unmarshal response: %w", err)
	}

	if resp.Error.Message != "" {
		return nil, fmt.Errorf("LLM error: %s", resp.Error.Message)
	}

	if len(resp.Choices) == 0 {
		return nil, fmt.Errorf("no response from LLM (result was: %.200s)", string(resultBytes))
	}

	return m.convertResponse(&resp.Choices[0].Message), nil
}

// Stream returns a single-element stream wrapping Generate (no true streaming via filesystem).
func (m *LLMModel) Stream(ctx context.Context, input []*schema.Message, opts ...model.Option) (*schema.StreamReader[*schema.Message], error) {
	msg, err := m.Generate(ctx, input, opts...)
	if err != nil {
		return nil, err
	}
	return schema.StreamReaderFromArray([]*schema.Message{msg}), nil
}

// BindTools stores the tool definitions so they're included in LLM requests.
func (m *LLMModel) BindTools(tools []*schema.ToolInfo) error {
	m.tools = make([]*schema.ToolInfo, len(tools))
	copy(m.tools, tools)
	return nil
}

// --- helpers ---

func (m *LLMModel) convertMessages(msgs []*schema.Message) []openaiMessage {
	out := make([]openaiMessage, 0, len(msgs))
	for _, msg := range msgs {
		om := openaiMessage{
			Role: string(msg.Role),
		}
		if msg.Content != "" {
			om.Content = json.RawMessage(`"` + jsonEscape(msg.Content) + `"`)
		} else {
			om.Content = json.RawMessage(`null`)
		}
		if msg.ToolCallID != "" {
			om.ToolCallID = msg.ToolCallID
		}
		for _, tc := range msg.ToolCalls {
			om.ToolCalls = append(om.ToolCalls, openaiToolCall{
				ID:   tc.ID,
				Type: "function",
				Function: struct {
					Name      string `json:"name"`
					Arguments string `json:"arguments"`
				}{Name: tc.Function.Name, Arguments: tc.Function.Arguments},
			})
		}
		out = append(out, om)
	}
	return out
}

func (m *LLMModel) convertTools() []openaiTool {
	if len(m.tools) == 0 {
		return nil
	}
	out := make([]openaiTool, 0, len(m.tools))
	for _, t := range m.tools {
		ot := openaiTool{Type: "function"}
		ot.Function.Name = t.Name
		ot.Function.Description = t.Desc
		if t.ParamsOneOf != nil {
			schema, err := t.ParamsOneOf.ToOpenAPIV3()
			if err == nil && schema != nil {
				b, _ := json.Marshal(schema)
				ot.Function.Parameters = json.RawMessage(b)
			}
		}
		if ot.Function.Parameters == nil {
			ot.Function.Parameters = json.RawMessage(`{"type":"object","properties":{}}`)
		}
		out = append(out, ot)
	}
	return out
}

func (m *LLMModel) convertResponse(msg *struct {
	Role      string           `json:"role"`
	Content   *string          `json:"content"`
	ToolCalls []openaiToolCall `json:"tool_calls"`
}) *schema.Message {
	schemaMsg := &schema.Message{
		Role: schema.RoleType(msg.Role),
	}
	if msg.Content != nil {
		schemaMsg.Content = *msg.Content
	}
	for _, tc := range msg.ToolCalls {
		schemaMsg.ToolCalls = append(schemaMsg.ToolCalls, schema.ToolCall{
			ID:   tc.ID,
			Function: schema.FunctionCall{
				Name:      tc.Function.Name,
				Arguments: tc.Function.Arguments,
			},
		})
	}
	return schemaMsg
}

func jsonEscape(s string) string {
	b, _ := json.Marshal(s)
	return string(b[1 : len(b)-1])
}

// Verify LLMModel satisfies model.ChatModel
var _ model.ChatModel = (*LLMModel)(nil)
